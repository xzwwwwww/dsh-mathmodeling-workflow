import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPETITIONS, DEFAULT_SWITCHES, COMPETITION_KEYS, normalizeSwitches, summarizeSwitches } from './lib/switches.js';
import { resolveSteps, stepDirName } from './lib/steps.js';
import { scanInput, summarizeScan } from './lib/scan.js';
import { scaffoldWorkspace, readSkillBody } from './lib/scaffold.js';
import { buildStepPrompt } from './lib/prompt.js';
import { runGates } from './lib/gates.js';
import { readState, writeState, nextPendingStep, progressOf } from './lib/state.js';
import { addQuestion, openQuestions, answerQuestion, describeOpen } from './lib/questions.js';
import { buildClaudeMd, buildEnvSkill } from './lib/claudeMd.js';

const ASSETS_DIR = fileURLToPath(new URL('./assets', import.meta.url));
const BUILD = '0.3.6';
const text = (t) => [{ type: 'text', text: t }];
const jsonSchema = { type: 'object', additionalProperties: true };

export const inject = ['tools', 'systemPrompt', 'workingDirectory'];

const PROTOCOL = `## 数学建模竞赛工作流（mathmodeling-workflow 插件）
当用户要求跑数学建模竞赛（国赛/美赛/五一杯/华中杯/亚太赛等），或提到"用建模插件/竞赛工作流/整套流程"，按下面协议执行：
1. 先确认开关（缺项就用默认值并在回复里列出来）：竞赛 \`modeling_init\` 的 competition、题号、页数、figure_style、flowchart_engine、diagram_style、rich_mode、validation_mode、ai_disclosure、enable_comp_review、custom_requirements。
   - **页数开关 \`max_pages\` 是「正文页数目标（下限）」**：目录之后 → 参考文献之前（无目录则摘要之后 → 参考文献之前），不含摘要/目录/参考文献/附录代码/AI 声明；**不是全文页数上限，也不是天花板**。转述给别人时原样带上这个口径，不要自己换算成"全文不超过 N 页"。
2. 调 \`modeling_init\`（input_dir = 用户准备好的赛题目录）。它会扫描文件、建 workspace、写 CLAUDE.md、复制 _utils/_references/_templates/skills（技能整包）。**不要自己手写这些文件**。
3. 循环：\`modeling_next\` 拿本步 prompt 文件 → 用 \`subagent\`（prompt 用返回的 subagent_prompt，cwd 用返回的 cwd）派发一个子代理 → 子代理结束后调 \`modeling_finish\` 验收。
4. **子代理要提问时**：子代理自己会调 \`modeling_ask\`（或结束时告诉你它卡在哪），你收到后调 \`modeling_pending\` 取问题 → 用 \`ask_user_question\` 问用户 → 拿到回答后调 \`modeling_answer\` 记录 → 再 \`send_message\` 把「用户回答：…」发回同一个子代理让它继续，最后才 \`modeling_finish\`。不要替用户编答案。
5. 验收失败时：把 hints 追加进下一次派发（继续用同一子代理的 send_message，或新建子代理并引用同一 prompt 文件 + hints），最多重试 2 次；仍失败就向用户汇报卡点。
6. 每次只派一个子代理，不要并行；主会话不要自己写建模/代码/论文内容，只做调度与验收。逻辑对抗复核（comp-review）默认开启，排在**图表之后、论文之前**（它要复核图表并触发重画，必须等图齐了再跑）；除非用户明确要求省钱才传 enable_comp_review: false。
7. 全部步骤 completed 后调 \`modeling_status\` 汇报产物路径与最终 PDF。`;

function toolOutput(name, renderKey) {
  return {
    schema: jsonSchema,
    render(_args, value) {
      if (value && typeof value === 'object' && typeof value[renderKey] === 'string') {
        return text(value[renderKey]);
      }
      return text(JSON.stringify(value ?? {}, null, 2));
    },
  };
}

async function sessionCwd(ctx, exec) {
  try {
    if (ctx.workingDirectory && exec.agent) return await ctx.workingDirectory.ensure(exec.agent, exec.signal);
  } catch {
    /* fall through */
  }
  return process.cwd();
}

function resolvePath(cwd, p) {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

async function requireState(workspace) {
  const state = await readState(workspace);
  if (!state) throw new Error(`不是本插件创建的 workspace（缺 .mmw/state.json）：${workspace}`);
  return state;
}

function stepView(step, state) {
  const index = state.steps.findIndex((s) => s.key === step.key);
  return { key: step.key, title: step.title, index, total: state.steps.length };
}

function progressLines(state) {
  const marks = { pending: '·', running: '▶', blocked: '!', completed: '✓' };
  return state.steps.map((s, i) => `${String(i + 1).padStart(2, '0')} ${marks[s.status] ?? '?'} ${s.title}（${s.key}）→ ${s.primaryOutput}`).join('\n');
}

export function apply(ctx, config = {}) {
  const cwd = (exec) => sessionCwd(ctx, exec);
  const disposers = [];
  const register = (def) => disposers.push(ctx.tools.register(def));

  disposers.push(ctx.systemPrompt.section({ name: 'mathmodeling-workflow-protocol', order: 640, text: PROTOCOL, interpolate: false }));

  // ---------------------------------------------------------------- init

  register({
    name: 'modeling_init',
    description:
      '为一个数学建模竞赛任务建立工作区：扫描赛题目录（赛题/数据/自定义要求），按开关解析步骤，生成 workspace（含 CLAUDE.md、.env_skill、_utils、_references、_templates、skills、user_data），并落 .mmw/state.json。返回工作区路径、检测到的文件、步骤清单与第 1 步的 prompt 文件。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['input_dir'],
      properties: {
        input_dir: { type: 'string', description: '用户准备好的赛题目录（绝对路径，或相对当前会话工作目录）' },
        workspace_name: { type: 'string', description: '工作区目录名，默认由赛题目录名 + 时间戳生成；创建在当前会话工作目录下' },
        competition: {
          type: 'string',
          enum: COMPETITION_KEYS,
          description: `赛项模板，默认 cumcm。可选：${COMPETITION_KEYS.join(', ')}`,
        },
        problem_id: { type: 'string', description: '题号（A/B/C…），写进参数与竞赛规则' },
        title: { type: 'string', description: '论文标题/赛题简称，默认取赛题目录名' },
        max_pages: { type: 'number', description: '正文页数目标（下限，不是全文上限）：目录之后→参考文献之前；无目录则摘要之后→参考文献之前；不含摘要/目录/参考文献/附录代码/AI 声明。缺省用赛项默认，rich_mode 打开时抬到 ≥50' },
        figure_style: { type: 'string', enum: ['default', 'nature'], description: '数据图风格：default=去指纹随机配色；nature=深蓝主色+Arial+粗轴' },
        flowchart_engine: { type: 'string', enum: ['drawio', 'html'], description: '流程图引擎：drawio 产物可拖拽编辑；html 布局更好但不可拖拽。会替换步骤里的技能' },
        diagram_style: { type: 'string', enum: ['mono', 'plain', 'modern'], description: '流程图版式，仅 html 引擎生效' },
        rich_mode: { type: 'boolean', description: '丰满模式：正文 40-60 页、30+ 图、摘要 1500-2200 字、12 类章节扩展' },
        validation_mode: { type: 'string', enum: ['strict', 'fast'], description: 'strict=完整审查（默认）；fast=省额度，跳过对抗复核与反复自修' },
        ai_disclosure: { type: 'string', enum: ['off', 'used', 'none'], description: 'AI 工具使用声明：off 不写；none 只加一句未使用；used 加声明章节+附录四表' },
        comp_date_start: { type: 'string', description: '比赛开始日期 YYYY-MM-DD（ai_disclosure=used 时用于随机交互日期）' },
        comp_date_end: { type: 'string', description: '比赛结束日期 YYYY-MM-DD' },
        enable_comp_review: { type: 'boolean', description: '是否插入「逻辑对抗复核」步骤（默认开；传 false 可省一次子代理调用）' },
        skip_figures: { type: 'boolean', description: '跳过两个图表步骤' },
        skip_drawio: { type: 'boolean', description: '只跳过流程图步骤' },
        min_figures: { type: ['number', 'string'], description: '最少数据图张数，或 auto' },
        min_tables: { type: ['number', 'string'], description: '最少表格数，或 auto' },
        min_models: { type: ['number', 'string'], description: '最少模型数，或 auto' },
        custom_requirements: { type: 'string', description: '用户自定义要求（导师规范/评审偏好/必须包含的内容）' },
        overwrite: { type: 'boolean', description: '工作区已存在时是否删除重建，默认 false' },
      },
    },
    output: toolOutput('modeling_init', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const inputDir = resolvePath(base, String(args.input_dir));
      const info = await stat(inputDir).catch(() => null);
      if (!info?.isDirectory()) throw new Error(`赛题目录不存在或不是目录：${inputDir}`);

      const { switches, errors } = normalizeSwitches(args);
      if (errors.length) throw new Error(errors.join('；'));

      const stamp = new Date().toISOString().slice(0, 13).replace(/[:T]/g, '');
      const defaultName = `modeling-${path.basename(inputDir).replace(/[^\w\u4e00-\u9fff-]+/g, '_')}-${stamp}`;
      const workspaceName = String(args.workspace_name ?? defaultName);
      const workspace = path.join(base, workspaceName);
      if (existsSync(workspace)) {
        if (!args.overwrite) throw new Error(`工作区已存在：${workspace}（要重建请传 overwrite=true）`);
        await rm(workspace, { recursive: true, force: true });
      }

      const files = await scanInput(inputDir);
      if (!files.length) throw new Error(`赛题目录里没有可用文件：${inputDir}`);
      const scan = summarizeScan(files);

      const steps = resolveSteps(switches);
      const title = switches.title || `${COMPETITIONS[switches.competition].label}${switches.problem_id ? ` ${switches.problem_id}题` : ''} - ${path.basename(inputDir)}`;
      switches.title = title;

      const { state, uploaded, fontInfo } = await scaffoldWorkspace({
        workspaceDir: workspace,
        assetsDir: ASSETS_DIR,
        inputFiles: files,
        switches,
        steps,
        title,
      });

      const warnings = [];
      if (!scan.problemFiles.length) warnings.push('没检测到 PDF/DOCX 赛题文件，只找到文本/数据；请确认赛题原文在目录里');
      if (fontInfo.missing.length) warnings.push(`模板缺字体：${fontInfo.missing.join(', ')}（已写 _templates/FONTS_MISSING.md，编译前需补）`);

      const report = [
        `工作区已创建：${workspace}`,
        `插件构建：${BUILD}`,
        `赛项：${summarizeSwitches(switches)}`,
        `页数口径：正文 ${switches.max_pages} 页 = 目录之后→参考文献之前（无目录则摘要之后→参考文献之前），不含摘要/目录/参考文献/附录/AI 声明；**是目标（下限），不是全文页数上限**`,
        '',
        '检测到的输入：',
        `- 文件共 ${scan.total} 个：${Object.entries(scan.byKind).map(([k, v]) => `${k}=${v}`).join('，')}`,
        scan.problemFiles.length ? `- 赛题：${scan.problemFiles.join('、')}` : '- 赛题：未检测到',
        scan.requirementFiles.length ? `- 自定义要求：${scan.requirementFiles.join('、')}` : '- 自定义要求：未检测到',
        `- 已复制到 user_data/：${uploaded.length} 个`,
        '',
        '步骤清单：',
        progressLines(state),
        '',
        warnings.length ? `⚠ ${warnings.join('\n⚠ ')}` : '无警告',
        '',
        '下一步：调 `modeling_next` 拿第 1 步的 prompt，然后派发一个子代理。',
      ].join('\n');

      return { report, workspace, steps: state.steps.map((s) => ({ key: s.key, title: s.title, status: s.status })), scan, warnings };
    },
  });

  // ---------------------------------------------------------------- next

  register({
    name: 'modeling_next',
    description:
      '读取工作流状态，渲染「当前待执行步骤」的 prompt.md（内联技能规格、参数、上游产物与产物契约），返回该文件路径与可直接交给 subagent 的 prompt/cwd。重复调用同一步不会重复计次。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace'],
      properties: {
        workspace: { type: 'string', description: 'modeling_init 返回的工作区路径（绝对路径或相对会话目录）' },
      },
    },
    output: toolOutput('modeling_next', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);

      const step = nextPendingStep(state);
      if (!step) {
        const { done, total } = progressOf(state);
        return { report: `所有步骤已完成（${done}/${total}）。调 modeling_status 查看产物。`, done: true };
      }
      if (step.status === 'waiting') {
        const lines = describeOpen(state, step.key);
        return {
          report: [
            `第 ${step.order + 1} 步「${step.title}」正在等回答：`,
            ...(lines.length ? lines : ['（未登记问题，用 modeling_pending 查看）']),
            '',
            '流程：modeling_pending → ask_user_question → modeling_answer → send_message 给同一个子代理 → modeling_finish。',
          ].join('\n'),
          waiting: true,
          step: stepView(step, state),
        };
      }
      const index = state.steps.findIndex((s) => s.key === step.key);
      const skillBody = await readSkillBody(ASSETS_DIR, step.skill);
      const prompt = await buildStepPrompt({ workspace, state, step, skillBody, index, total: state.steps.length });

      const dir = path.join(workspace, step.dir);
      await mkdir(dir, { recursive: true });
      const promptPath = path.join(workspace, step.promptPath);
      await writeFile(promptPath, prompt, 'utf8');

      step.status = 'running';
      step.attempts = (step.attempts ?? 0) + 1;
      step.startedAt = step.startedAt ?? new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      await writeState(workspace, state);

      const pageLine = (step.gates ?? []).includes('pages')
        ? `页数口径（别搞错）：max_pages=${state.switches.max_pages} 是**正文页数目标（下限）**——目录之后→参考文献之前（无目录则摘要之后→参考文献之前），不含摘要/目录/参考文献/附录/AI 声明；不是全文页数上限，正文超了不扣分。\n`
        : '';
      const subagentPrompt =
        `你是数学建模竞赛工作流的第 ${index + 1}/${state.steps.length} 步执行者（${step.title}）。\n` +
        `先读取 ${promptPath} 并严格按其中的规格执行；工作目录固定为 ${workspace}。\n` +
        pageLine +
        `遇到必须由用户决定、猜错会做错方向的信息，调 modeling_ask 提交问题并结束本轮等待；` +
        `能靠合理假设推进的，就在产物里写清假设继续。不要越过本步去写后续产物。完成后按 prompt 末尾的交付格式回复。`;

      const report = [
        `第 ${index + 1}/${state.steps.length} 步：${step.title}（${step.key}）`,
        `prompt 文件：${promptPath}`,
        `工作目录：${workspace}`,
        `主产物：${step.primaryOutput}${step.minBytes ? `（≥ ${step.minBytes} B）` : ''}`,
        step.companions.length ? `二级文件：${step.companions.join('、')}` : '',
        `尝试次数：${step.attempts}`,
        '',
        '派发方式：调用 subagent，prompt 用下面的文本，cwd 传工作目录。',
        '---- subagent_prompt ----',
        subagentPrompt,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        report,
        step: stepView(step, state),
        promptPath,
        cwd: workspace,
        subagent_prompt: subagentPrompt,
      };
    },
  });

  // ---------------------------------------------------------------- finish

  register({
    name: 'modeling_finish',
    description:
      '对刚跑完的步骤执行确定性闸门（主产物/二级文件/图表对账/逻辑合同/页数/AI声明/对抗复核裁定），通过则标记完成并返回下一步；失败则返回必须修复的 hints，供再次派发时追加。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace'],
      properties: {
        workspace: { type: 'string', description: '工作区路径' },
        step: { type: 'string', description: '要验收的步骤 key；缺省=当前 running/blocked 的那步' },
        note: { type: 'string', description: '子代理自报的结论（可选，仅记录到日志）' },
      },
    },
    output: toolOutput('modeling_finish', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);

      const key = args.step ? String(args.step) : null;
      const step = key ? state.steps.find((s) => s.key === key) : nextPendingStep(state);
      if (!step) return { report: '没有可验收的步骤（全部已完成）。', pass: true, done: true, next: null };

      // 子代理提交了问题还没回答：先走「问用户 → 回答 → 回传」的闭环，不要越过它验产物
      const pending = openQuestions(state, step.key);
      if (pending.length) {
        return {
          report: [
            `⏸ 第 ${step.order + 1} 步「${step.title}」还在等回答，先处理问题再验收：`,
            ...describeOpen(state, step.key),
            '',
            '流程：modeling_pending → ask_user_question → modeling_answer → send_message 给同一个子代理 → 再 modeling_finish。',
          ].join('\n'),
          pass: false,
          waiting: true,
          hints: [],
          next: null,
          questions: pending.map((q) => ({ id: q.id, question: q.question, options: q.options })),
        };
      }

      const report = await runGates(workspace, step);
      step.lastGate = { at: new Date().toISOString(), ok: report.ok, results: report.results };
      let next = null;

      if (report.ok) {
        step.status = 'completed';
        step.finishedAt = new Date().toISOString();
        const after = nextPendingStep(state);
        if (after) next = { step: after.key, title: after.title, promptPath: after.promptPath };
      } else {
        step.status = 'blocked';
      }

      state.updatedAt = new Date().toISOString();
      await writeState(workspace, state);

      const lines = report.results.map((r) => {
        const mark = r.code === 0 ? '✓' : r.code === 2 ? '⚠' : '✗';
        return `${mark} ${r.gate}: ${JSON.stringify(r.detail)}`;
      });

      const summary = report.ok
        ? [
            `✅ 第 ${step.order + 1} 步「${step.title}」通过验收。`,
            ...lines,
            next ? `下一步：${next.title}（${next.step}）→ 调 modeling_next` : '全部步骤已完成 → 调 modeling_status 汇报。',
          ]
        : [`❌ 第 ${step.order + 1} 步「${step.title}」未通过：`, ...lines, '', '修复指引（派发下一次时附上）：', ...report.hints.map((h) => `- ${h}`)].join('\n');

      return {
        report: summary,
        pass: report.ok,
        step: step.key,
        hints: report.hints,
        next,
        results: report.results.map((r) => ({ gate: r.gate, ok: r.ok, code: r.code, detail: r.detail })),
      };
    },
  });

  // ---------------------------------------------------------------- ask / pending / answer

  register({
    name: 'modeling_ask',
    description:
      '子代理在信息不足且猜错会做错方向时调用：把问题登记到工作流状态并结束本轮，等主代理问用户后回传答案。能靠合理假设推进的不要用这个，写清假设继续即可。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace', 'question'],
      properties: {
        workspace: { type: 'string', description: '工作区路径' },
        question: { type: 'string', description: '要让用户决定的问题（一句话，具体到可回答）' },
        options: { type: 'array', items: { type: 'string' }, description: '可选答案（给用户点选），没有就不传' },
        step: { type: 'string', description: '所属步骤 key，默认当前执行中的那一步' },
      },
    },
    output: toolOutput('modeling_ask', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);
      const step = args.step
        ? state.steps.find((s) => s.key === String(args.step))
        : nextPendingStep(state);
      if (!step) throw new Error('没有执行中的步骤，无法登记问题');
      const item = addQuestion(state, {
        step: step.key,
        question: String(args.question),
        options: args.options ?? [],
      });
      step.status = 'waiting';
      state.updatedAt = new Date().toISOString();
      await writeState(workspace, state);
      return {
        report: [
          `问题已登记：[${item.id}] ${item.question}`,
          '请结束本轮，等待主代理把用户回答通过 send_message 发给你；收到后继续本步，不要重复提问。',
        ].join('\n'),
        question_id: item.id,
        step: step.key,
      };
    },
  });

  register({
    name: 'modeling_pending',
    description:
      '主代理用：列出子代理提交、尚未回答的问题（含所属步骤与可选答案）。拿到后用 ask_user_question 问用户。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace'],
      properties: { workspace: { type: 'string', description: '工作区路径' } },
    },
    output: toolOutput('modeling_pending', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);
      const open = openQuestions(state);
      if (!open.length) return { report: '没有待回答的问题。', questions: [] };
      const report = [
        `待回答 ${open.length} 个问题：`,
        ...open.map(
          (q) => `- [${q.id}]（${q.step}）${q.question}${q.options.length ? `\n    可选：${q.options.join(' / ')}` : ''}`,
        ),
        '',
        '→ 用 ask_user_question 问用户 → modeling_answer 记录 → send_message 把回答发回同一子代理。',
      ].join('\n');
      return {
        report,
        questions: open.map((q) => ({ id: q.id, step: q.step, question: q.question, options: q.options })),
      };
    },
  });

  register({
    name: 'modeling_answer',
    description:
      '主代理用：记录用户对某个问题的回答，并把可直接 send_message 给子代理的文本一并返回（把这段发回同一个子代理，它就会继续）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace', 'answer'],
      properties: {
        workspace: { type: 'string', description: '工作区路径' },
        answer: { type: 'string', description: '用户的回答（原文，不要改写）' },
        question_id: { type: 'string', description: '问题 id；只有一个待答问题时可省略' },
      },
    },
    output: toolOutput('modeling_answer', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);
      const open = openQuestions(state);
      const id = args.question_id ? String(args.question_id) : open[0]?.id;
      if (!id) throw new Error('没有待回答的问题');
      const item = answerQuestion(state, id, args.answer);
      if (!item) throw new Error(`问题 ${id} 不存在或已回答`);
      const step = state.steps.find((s) => s.key === item.step);
      if (step && step.status === 'waiting') step.status = 'running';
      state.updatedAt = new Date().toISOString();
      await writeState(workspace, state);
      const relay =
        `用户对问题「${item.question}」的回答：${item.answer}\n` +
        `请据此继续第 ${(step?.order ?? 0) + 1} 步（${step?.title ?? item.step}），不要重复提问。`;
      return { report: `已记录回答，把下面这段 send_message 给子代理：\n---\n${relay}\n---`, relay, question_id: id, step: item.step };
    },
  });

  // ---------------------------------------------------------------- status

  register({
    name: 'modeling_status',
    description: '查看工作流进度：每一步状态、产物路径与大小、开关快照、最近一次闸门结果。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace'],
      properties: { workspace: { type: 'string', description: '工作区路径' } },
    },
    output: toolOutput('modeling_status', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);
      const { done, total } = progressOf(state);

      const rows = [];
      for (const s of state.steps) {
        const primary = path.join(workspace, s.primaryOutput);
        const info = await stat(primary).catch(() => null);
        const size = info ? (info.isDirectory() ? '目录' : `${info.size} B`) : '—';
        rows.push(`${String(s.order + 1).padStart(2, '0')} ${s.status.padEnd(9)} ${s.title}（${s.key}）→ ${s.primaryOutput} ${size}`);
      }

      let paper = '—';
      const pdf = path.join(workspace, 'paper', 'main.pdf');
      const pdfInfo = await stat(pdf).catch(() => null);
      if (pdfInfo?.isFile()) paper = `paper/main.pdf（${pdfInfo.size} B）`;

      const pendingLines = openQuestions(state).map(
        (q) => `- [${q.id}]（${q.step}）${q.question}${q.options.length ? `（可选：${q.options.join(' / ')}）` : ''}`,
      );

      const report = [
        `工作区：${workspace}`,
        `进度：${done}/${total} ｜ 开关：${summarizeSwitches(state.switches)}`,
        '',
        ...rows,
        '',
        ...(pendingLines.length ? ['待回答的问题（先处理再继续）：', ...pendingLines, ''] : []),
        `最终论文：${paper}`,
      ].join('\n');

      return { report, progress: { done, total }, workspace, questions: openQuestions(state).map((q) => ({ id: q.id, step: q.step, question: q.question, options: q.options })) };
    },
  });

  // ---------------------------------------------------------------- switches

  register({
    name: 'modeling_switches',
    description:
      '在流程开始前调整开关（竞赛/题号/页数/图表风格与引擎/丰满模式/审查模式/AI声明/对抗复核）。会重新解析步骤并重写 CLAUDE.md 与 .env_skill；已有步骤完成后再改会被拒绝。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace'],
      properties: {
        workspace: { type: 'string', description: '工作区路径' },
        switches: { type: 'object', additionalProperties: true, description: '要覆盖的开关子集，字段同 modeling_init' },
      },
    },
    output: toolOutput('modeling_switches', 'report'),
    async execute(args, exec) {
      const base = await cwd(exec);
      const workspace = resolvePath(base, String(args.workspace));
      const state = await requireState(workspace);
      if (state.steps.some((s) => s.status === 'completed')) {
        throw new Error('已有步骤完成，不能改开关（改步骤集合会让索引错位）。请新建工作区。');
      }
      const { switches, errors } = normalizeSwitches({ ...state.switches, ...(args.switches ?? {}) });
      if (errors.length) throw new Error(errors.join('；'));

      const steps = resolveSteps(switches);
      const claudeMd = buildClaudeMd({ switches, steps, title: state.title, uploaded: state.inputFiles });
      await writeFile(path.join(workspace, 'CLAUDE.md'), claudeMd, 'utf8');
      await writeFile(path.join(workspace, '.env_skill'), buildEnvSkill(switches), 'utf8');

      state.switches = switches;
      state.steps = steps.map((st) => ({
        key: st.key,
        title: st.title,
        skill: st.skill,
        order: st.order,
        primaryOutput: st.primaryOutput,
        minBytes: st.minBytes ?? 100,
        companions: st.companions ?? [],
        gates: st.gates ?? ['artifact'],
        status: 'pending',
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastGate: null,
        promptPath: path.join('_steps', stepDirName(st.order, st.key), 'prompt.md'),
        dir: path.join('_steps', stepDirName(st.order, st.key)),
      }));
      state.updatedAt = new Date().toISOString();
      await writeState(workspace, state);

      return {
        report: [`开关已更新：${summarizeSwitches(switches)}`, '', '新步骤清单：', progressLines(state)].join('\n'),
        switches,
      };
    },
  });
  // 插件卸载时释放全部注册（工具 + system prompt 段）
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch {
        /* 忽略单个释放失败 */
      }
    }
  };
}



