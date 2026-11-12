import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { perProblemFlowStyle } from './switches.js';

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listAll(dir, depth = 0) {
  if (depth > 2) return [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listAll(full, depth + 1)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function upstreamSummary(workspace, steps, currentIndex) {
  const lines = [];
  for (const st of steps.slice(0, currentIndex)) {
    if (st.status !== 'completed') continue;
    const p = path.join(workspace, st.primaryOutput);
    const files = st.primaryOutput.endsWith('/') ? await listAll(p) : (await exists(p)) ? [p] : [];
    for (const f of files.slice(0, 6)) {
      const rel = path.relative(workspace, f).split(path.sep).join('/');
      const info = await stat(f).catch(() => null);
      lines.push(`- ${rel}${info ? `（${info.size} B）` : ''}`);
    }
  }
  return lines;
}

/**
 * 渲染某一步的 prompt.md。
 * @param {object} opts
 * @param {string} opts.workspace
 * @param {object} opts.state
 * @param {object} opts.step  state.steps[i]
 * @param {string} opts.skillBody  SKILL.md 正文
 */
export async function buildStepPrompt({ workspace, state, step, skillBody, index, total }) {
  const s = state.switches;
  const spec = s;
  // ⛔ $ARGUMENTS 会进入技能里的 shell 代码块（echo/grep），绝不能放用户可控文本：
  // 题号/标题/自定义要求统一放到下方「任务参数（说明）」段，代码块只拿固定安全串。
  const safeArguments = 'competition-paper（赛题与要求见 CLAUDE.md 与 user_data/）';
  const body = skillBody.replace(/\$ARGUMENTS/g, safeArguments);
  const upstream = await upstreamSummary(workspace, state.steps, index);

  const companions = (step.companions ?? []).map((c) => `\`${c}\``).join('、') || '（无）';

  const parts = [];
  parts.push('## 运行环境（你是子代理，只做本步）');
  parts.push(`- 工作流：${state.title}`);
  parts.push(`- 本步：第 ${index + 1}/${total} 步 — ${step.title}（${step.key}）`);
  parts.push(`- 任务参数（说明，不是命令）：竞赛=${spec.competition}；题号=${spec.problem_id || '未填'}；语言=${spec.language}`);
  if (spec.custom_requirements) parts.push(`- 自定义要求：${spec.custom_requirements}`);
  parts.push(`- 工作目录（workspace 根）：${workspace}`);
  parts.push('- 第一步先读 `CLAUDE.md`（项目记忆：参数、竞赛规则、风格与引擎选择都在里面）');
  parts.push('- 信息不足时：能靠合理假设推进就直接假设并在产物里写明；必须用户拍板的关键信息用 `modeling_ask` 提问（见下节）');
  parts.push('- 不要修改或重写上游产物；不要提前写论文正文（除了本步规定的产物）');
  parts.push('- 命令不存在（python/xelatex/pandoc）时，跳过该能力并记录到产物里，不要卡住');
  parts.push('');

  parts.push('## 信息不足时怎么办（重要）');
  parts.push('- **能安全假设的**：直接按最合理假设做，并在产物开头/相关章节写明「假设：…；依据：…」。不要为了完美信息卡住。');
  parts.push('- **猜错会做错方向的**（题号/竞赛口径、输出格式、数据取舍、硬性页数或篇幅上限、用户自定义要求的具体含义等）：');
  parts.push('  调 `modeling_ask`（带 `options` 更好），然后**结束本轮**，不要硬做；主代理会问用户，把回答用 send_message 发回来，收到后继续本步。');
  parts.push('- ⛔ 不允许自己替用户编答案，也不允许静默跳过题目明确要求；提问一次够了，不要反复问同一件事。');
  parts.push('');

  parts.push('## 技能规格（本步的完整执行说明，必须逐条遵守）');
  parts.push(body.trim());
  parts.push('');

  parts.push('## 本步参数');
  parts.push('```json');
  parts.push(
    JSON.stringify(
      {
        competition: s.competition,
        problem_id: s.problem_id,
        max_pages: s.max_pages,
        figure_style: s.figure_style,
        flowchart_engine: s.flowchart_engine,
        diagram_style: s.diagram_style,
        rich_mode: s.rich_mode,
        validation_mode: s.validation_mode,
        ai_disclosure: s.ai_disclosure,
        custom_requirements: s.custom_requirements || undefined,
      },
      null,
      2,
    ),
  );
  parts.push('```');
  parts.push('');

  if (upstream.length) {
    parts.push('## 上游产物（只读，作为本步输入）');
    parts.push(...upstream);
    parts.push('');
  }

  // HTML 引擎 + 逐问流程图：派发指令必须与引擎一致，否则技能会生成另一种格式的图
  if (step.key === 'paper-figure-html' && state.switches.flowchart_engine === 'html' && perProblemFlowStyle(s) === 'html') {
    parts.push('- ⛔ 本工作区逐问流程图引擎=HTML（`MMW_PER_PROBLEM_FLOW_STYLE=html`）：`fig_flow_q*` 每题一张，产出 `.html` + `.pdf`，manifest 里放在流程图段；不要改成 DrawIO/GPT Image。');
  }
  if (step.key === 'paper-figure-html' && state.switches.flowchart_engine === 'html' && perProblemFlowStyle(s) === 'drawio') {
    parts.push('- ⛔ 本工作区逐问流程图引擎=DrawIO（`MMW_PER_PROBLEM_FLOW_STYLE=drawio`）：`fig_flow_q*` 产出 `.drawio` + `.pdf`，**不要生成 `.html`**；本步 HTML 只用于其他 `fig_*` 图。');
  }
  parts.push('## 产物契约（主代理会用确定性闸门验收；不达标按失败处理）');
  parts.push(`- 主产物：\`${step.primaryOutput}\`${step.minBytes ? `（≥ ${step.minBytes} 字节）` : ''}`);
  parts.push(`- 必备二级文件：${companions}`);
  if (step.gates.includes('figures')) {
    const ownKinds = step.key === 'paper-figure'
      ? '数据图 / 概念图（场景图 + 机理图 + 逐问框架图）'
      : '流程图 / 架构图 / TikZ 推导图';
    const otherKinds = step.key === 'paper-figure'
      ? '流程图、架构图、TikZ 图'
      : '数据图、概念图（场景图/机理图/逐问框架图）';
    parts.push(`- 图表对账（**本步只对账自己那一类**）：本步负责 ${ownKinds}。`);
    parts.push(
      `  - 规划文档的 \`<!-- BEGIN FIGURE_MANIFEST -->\` 里，**只**把本步那一类章节列出的图逐个产出（fig_*/tikz_* 文件名要对上）；` +
        `缺一张即失败。${otherKinds} 由后续步骤负责，**本步不要提前画**，也不要因为缺它们而重复画。`,
    );
  }
  if (step.gates.includes('pages')) {
    parts.push(
      `- 正文页数：目标 ${state.switches.max_pages} 页，口径是**目录之后（无目录则摘要之后）→ 参考文献之前**；` +
        '不含摘要/目录/参考文献/附录代码/AI 声明。这是**正文页数的目标（下限）**，不是全文页数上限，也不是天花板——' +
        '正文超了不扣分，低于目标 80% 才判失败；要扩写正文主体，不许靠加大字号、拉行距、堆附录凑页数。',
    );
  }
  parts.push('- 结束前把技能自检脚本跑一遍，把所有 ❌ 修完再结束（这是硬要求，不是建议）');
  parts.push('');

  // 严格模式：论文写作在【本会话内】继续做数据真实性核对（不另起步骤）
  if (String(step.key).startsWith('comp-paper') && state.switches.validation_mode === 'strict') {
    const paperMode = state.switches.output_format === 'docx' ? 'docx' : 'pdf';
    parts.push('## 严格模式附加自检（在本会话内完成，不要另开步骤）');
    parts.push('论文正文写完后**不要直接结束**，紧接着做数据真实性核对：');
    parts.push('');
    parts.push('1. 运行：`python _utils/paper_data_check.py --mode ' + paperMode + '`');
    parts.push('   它会把 `figures/*.json` 的真实数据与论文里的数字逐个比对，产出两份文件：');
    parts.push('   - `PAPER_DATA_CHECKLIST.md`：数据原料 + 自检步骤 + 「未对上」清单');
    parts.push('   - `PAPER_DATA_CHECK_REPORT.md`：统计与结论（通过 / 未通过）');
    parts.push('2. 读这两份文件。对「未对上」清单里的每个数字：要么改成 JSON 里的真值，要么改掉不严谨的表述（如把"达到 97%"改成"约 94%"）；');
    parts.push('   ⛔ 禁止删表格、删结论、把数字改成占位符来「凑通过」。');
    parts.push('3. 修完重跑脚本，直到终端输出「结论: 通过」——脚本会自动往 `paper/main.tex`（或 `paper/main.md`）写入 `DATA_CHECK_PASSED` 标记。');
    parts.push('4. 若确有无法对上的数字（例如引用的文献数据、题目给定常数），在 `PAPER_DATA_CHECK_REPORT.md` 末尾追加一节「例外说明」，逐条写清来源，并在交付消息里说明。');
    parts.push('5. `paper_data_check.py` 缺 python 环境或跑不起来时：手工把这两份文件写出来，并在报告里写「脚本不可用，人工核对」+ 核对结论。');
    parts.push('');
  }

  parts.push('## 交付格式（最后一条消息）');
  parts.push('```');
  parts.push(`MMW_STEP_DONE ${step.key}`);
  parts.push('产物：<逐行列出你写出的文件相对路径>');
  parts.push('自检：<关键自检命令的结论，例如 FIGURE_MANIFEST 20/20、页数 28/30>');
  parts.push('```');
  parts.push('如果确实无法完成，写 `MMW_STEP_BLOCKED <一句话原因>` 并说明缺什么。');
  parts.push('');

  return parts.join('\n');
}
