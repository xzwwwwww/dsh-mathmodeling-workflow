// 离线冒烟测试：不依赖 Cordis 运行时，直接验证 scaffold / prompt / gates 三条主链。
import { mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSwitches, summarizeSwitches, COMPETITION_KEYS, perProblemFlowStyle } from '../lib/switches.js';
import { resolveSteps } from '../lib/steps.js';
import { scanInput, summarizeScan } from '../lib/scan.js';
import { scaffoldWorkspace, readSkillBody } from '../lib/scaffold.js';
import { buildStepPrompt } from '../lib/prompt.js';
import { buildClaudeMd } from '../lib/claudeMd.js';
import { runGates, gatePaperDataCheck, gatePages, gateFigures, parseFigureManifest } from '../lib/gates.js';
import { readState, writeState, nextPendingStep } from '../lib/state.js';
import { addQuestion, openQuestions, answerQuestion, describeOpen } from '../lib/questions.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(ROOT, 'assets');
import os from 'node:os';

const TMP = path.join(os.tmpdir(), 'mml-smoke');

let failures = 0;
function check(name, cond, extra = '') {
  const ok = Boolean(cond);
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
}

async function fixture() {
  const dir = path.join(TMP, '赛题A-调度优化');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '赛题A.md'), '# 赛题A\n某调度优化问题……', 'utf8');
  await writeFile(path.join(dir, '附件1.csv'), 'a,b\n1,2\n', 'utf8');
  await writeFile(path.join(dir, '自定义要求.md'), '必须包含灵敏度分析', 'utf8');
  return dir;
}

async function main() {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  // 1) 开关
  const { switches, errors } = normalizeSwitches({ competition: 'cumcm', problem_id: 'A', rich_mode: true, figure_style: 'nature', flowchart_engine: 'html', diagram_style: 'plain', ai_disclosure: 'used', comp_date_start: '2026-09-05', comp_date_end: '2026-09-08' });
  check('开关无错', errors.length === 0, errors.join(';'));
  check('丰满模式抬页数到 50', switches.max_pages >= 50, `max_pages=${switches.max_pages}`);
  check('竞赛枚举齐全', COMPETITION_KEYS.length >= 10, COMPETITION_KEYS.join(','));
  console.log('  ', summarizeSwitches(switches));

  // 2) 步骤解析
  const steps = resolveSteps(switches);
  const keys = steps.map((s) => s.key);
  check('html 引擎替换流程图步', keys.includes('paper-figure-html') && !keys.includes('paper-figure-drawio'), keys.join('>'));
  const noReview = resolveSteps({ ...switches, enable_comp_review: false }).map((s) => s.key);
  const withReview = resolveSteps({ ...switches, enable_comp_review: true }).map((s) => s.key);
  check('对抗复核默认进链，可显式关闭', keys.includes('comp-review') && !noReview.includes('comp-review') && withReview.includes('comp-review'));
  check('对抗复核在论文之前', withReview.indexOf('comp-review') < withReview.indexOf('comp-paper-zh'));
  check('对抗复核在图表之后', withReview.indexOf('comp-review') > withReview.indexOf('paper-figure-drawio')
    && withReview.indexOf('comp-review') > withReview.indexOf('paper-figure'));
  const skipped = resolveSteps({ ...switches, skip_figures: true }).map((s) => s.key);
  check('skip_figures 去掉两个图表步', !skipped.some((k) => k.startsWith('paper-figure')));

  // 2b) 英文赛事：语言推断 + 论文/编译步替换
  const mcm = normalizeSwitches({ competition: 'mcm', problem_id: 'A' });
  check('MCM 自动推断英文', mcm.errors.length === 0 && mcm.switches.language === 'en' && mcm.switches.max_pages === 25,
    `${mcm.switches.language}/${mcm.switches.max_pages}`);
  check('中文赛项默认中文', normalizeSwitches({ competition: 'cumcm' }).switches.language === 'zh');
  check('显式 language 覆盖自动推断', normalizeSwitches({ competition: 'mcm', language: 'zh' }).switches.language === 'zh');
  const enSteps = resolveSteps(mcm.switches);
  const enKeys = enSteps.map((s) => s.key);
  check('英文语言替换论文/编译步', enKeys.includes('comp-paper-en') && enKeys.includes('comp-compile-en')
    && !enKeys.includes('comp-paper-zh') && !enKeys.includes('comp-compile-zh'), enKeys.join('>'));
  check('英文论文步用英文技能', enSteps.find((s) => s.key === 'comp-paper-en')?.skill === '论文撰写English');
  check('英文编译步用英文技能', enSteps.find((s) => s.key === 'comp-compile-en')?.skill === '编译与合规English');
  check('英文编译在论文之后', enKeys.indexOf('comp-paper-en') < enKeys.indexOf('comp-compile-en'));
  check('英文步数为 8', enSteps.length === 8, String(enSteps.length));

  // 3) 扫描 + scaffold
  const inputDir = await fixture();
  const files = await scanInput(inputDir);
  const scan = summarizeScan(files);
  check('扫描识别赛题与要求', scan.problemFiles.length >= 1 && scan.requirementFiles.length >= 1, JSON.stringify(scan.byKind));

  const workspace = path.join(TMP, 'ws');
  const { state } = await scaffoldWorkspace({ workspaceDir: workspace, assetsDir: ASSETS, inputFiles: files, switches, steps, title: '国赛 A题 - 调度优化' });

  for (const rel of ['CLAUDE.md', '.env_skill', '_utils/plot_utils.py', '_utils/screenshot_capture.py', '_utils/katex/katex.min.js', '_utils/paper_data_check.py', '_utils/_gpt_image_config.json', '_templates/cumcm/main.tex', 'skills/赛题分析/SKILL.md', 'skills/编程实现/references/checks/sanity_check.md', 'skills/论文撰写/templates/cumcm/main.tex', 'user_data/赛题A.md']) {
    check(`生成 ${rel}`, existsSync(path.join(workspace, rel)));
  }
  const cm = await readFile(path.join(workspace, 'CLAUDE.md'), 'utf8');
  check('CLAUDE.md 含丰满模式条款', cm.includes('丰满模式') && cm.includes('12 类章节扩展'));
  check('CLAUDE.md 含 AI 声明标记', cm.includes('MMW_AI_DISCLOSURE=used'));
  check('CLAUDE.md 含竞赛规则', cm.includes('## 竞赛规则（全国大学生数学建模竞赛 (CUMCM)）'));
  check('CLAUDE.md 流水线列出步骤', cm.includes('paper-figure-html'));
  check('state.json 落盘', (await readState(workspace))?.steps?.length === steps.length);

  // 3b) 英文 scaffold：技能/模板/CLAUDE.md/页数口径
  const enWs = path.join(TMP, 'ws_en');
  await scaffoldWorkspace({ workspaceDir: enWs, assetsDir: ASSETS, inputFiles: files, switches: mcm.switches, steps: enSteps, title: 'MCM A题' });
  for (const rel of ['skills/论文撰写English/SKILL.md', 'skills/编译与合规English/SKILL.md', '_templates/mcm/main.tex',
    '_templates/mcm/mcmthesis.cls', 'skills/论文撰写English/templates/mcm/main.tex', '.env_skill']) {
    check(`英文工作区生成 ${rel}`, existsSync(path.join(enWs, rel)));
  }
  const enCm = await readFile(path.join(enWs, 'CLAUDE.md'), 'utf8');
  check('英文 CLAUDE.md 语言行', enCm.includes('语言: English') && enCm.includes('2200 字符/页'));
  check('英文 CLAUDE.md 含 MCM 规则', enCm.includes('Summary Sheet') && enCm.includes('pdflatex') && enCm.includes('mcmthesis'));
  check('英文 CLAUDE.md 步骤用英文 key', enCm.includes('comp-paper-en') && !enCm.includes('comp-paper-zh'));
  check('英文 .env_skill 含 LANGUAGE=en', (await readFile(path.join(enWs, '.env_skill'), 'utf8')).includes('export LANGUAGE=en'));
  check('英文技能无旧前缀残留', !(await readFile(path.join(enWs, 'skills/论文撰写English/SKILL.md'), 'utf8')).includes(String.fromCharCode(77, 72) + '_'));

  // 4) prompt 渲染
  const body = await readSkillBody(ASSETS, '赛题分析');
  const prompt = await buildStepPrompt({ workspace, state, step: state.steps[0], skillBody: body, index: 0, total: state.steps.length });
  check('prompt 内联技能正文', prompt.includes('赛题分析') && prompt.length > 2000, `${prompt.length} 字符`);
  check('prompt 含产物契约', prompt.includes('PROBLEM_ANALYSIS.md') && prompt.includes('MMW_STEP_DONE'));
  check('prompt 替换了 $ARGUMENTS', !prompt.includes('$ARGUMENTS'));

  // 5) 闸门：先说失败
  const fail = await runGates(workspace, state.steps[0]);
  check('缺产物时 artifact 闸失败', !fail.ok && fail.results[0].gate === 'artifact', JSON.stringify(fail.results[0].detail));

  // 6) 造假产物 → 图表对账应抓住
  await writeFile(path.join(workspace, 'PROBLEM_ANALYSIS.md'), '# 分析\n<!-- BEGIN FIGURE_MANIFEST -->\n**DATA 数据图：**\n- fig_q1_trend\n- fig_q1_dist\n**总数：DATA=2**\n<!-- END FIGURE_MANIFEST -->\n' + 'x'.repeat(2000), 'utf8');
  await writeFile(path.join(workspace, 'figures', 'latex_includes.tex'), '% includes\n' + '% '.repeat(80), 'utf8');
  const figStep = state.steps.find((s) => s.key === 'paper-figure');
  const figFail = await runGates(workspace, figStep);
  const figGate = figFail.results.find((r) => r.gate === 'figures');
  check('图表对账抓住缺图', figFail.ok === false && figGate?.detail?.missing?.length === 2, JSON.stringify(figGate?.detail));

  // 7) 补齐图 + 逻辑合同 → 全绿
  await mkdir(path.join(workspace, 'figures'), { recursive: true });
  await writeFile(path.join(workspace, 'figures', 'fig_q1_trend.pdf'), '%PDF-1.4', 'utf8');
  await writeFile(path.join(workspace, 'figures', 'fig_q1_dist.pdf'), '%PDF-1.4', 'utf8');
  await writeFile(
    path.join(workspace, 'LOGIC_CONTRACT.json'),
    JSON.stringify({ LOGIC_CONTRACT_MACHINE: { bounds: [{ quantity: '效率', is: 'upper' }], constraints_with_margin: [{ quantity: '出口浓度', limit: 10, kind: 'le', min_margin: 0.05 }] } }),
    'utf8',
  );
  await writeFile(path.join(workspace, 'figures', 'all_results.json'), JSON.stringify({ logic_probes: { bounds: [{ quantity: '效率', observed_sign: -0.3 }] }, 出口浓度: 9.1 }), 'utf8');
  const pass = await runGates(workspace, figStep);
  check('补齐后验收通过', pass.ok, JSON.stringify(pass.results.map((r) => [r.gate, r.ok, r.detail])));

  // 8) 方向标反 → 逻辑闸失败（逻辑闸挂在 comp-prob-analysis / comp-modeling 上）
  await writeFile(path.join(workspace, 'LOGIC_CONTRACT.json'), JSON.stringify({ LOGIC_CONTRACT_MACHINE: { bounds: [{ quantity: '效率', is: 'lower' }] } }), 'utf8');
  const bad = await runGates(workspace, state.steps[0]);
  const logicGate = bad.results.find((r) => r.gate === 'logic');
  check('方向反被逻辑闸抓住', bad.ok === false && /方向反/.test(logicGate?.hint ?? ''), logicGate?.hint);

  // 9) AI 声明残留 → off 模式必须失败
  const offState = JSON.parse(await readFile(path.join(workspace, '.mmw', 'state.json'), 'utf8'));
  offState.switches.ai_disclosure = 'off';
  const cm2 = cm.replace(/MMW_AI_DISCLOSURE=used[^\n]*\n?/g, '').replace(/MMW_AI_DISC_DATE_[A-Z]+=[^\n]*\n?/g, '');
  await writeFile(path.join(workspace, 'CLAUDE.md'), cm2, 'utf8');
  await mkdir(path.join(workspace, 'paper', 'sections'), { recursive: true });
  await writeFile(path.join(workspace, 'paper', 'sections', 'Z_ai_disclosure.tex'), '\\section*{AI 工具使用声明}\n' + 'x'.repeat(80), 'utf8');
  await writeFile(path.join(workspace, 'paper', 'main.tex'), '\\documentclass{ctexart}\n\\begin{document}\n' + 'x'.repeat(3000) + '\n\\end{document}\n', 'utf8');
  const paperStep = offState.steps.find((s) => s.key === 'comp-paper-zh');
  const aiRes = await runGates(workspace, paperStep);
  const aiGate = aiRes.results.find((r) => r.gate === 'ai_disclosure');
  check('off 模式下声明残留被抓', aiRes.ok === false && /残留/.test(aiGate?.hint ?? ''), aiGate?.hint);

  // 10) 严格模式：数据核对闸门三态 + 论文步 prompt 带附加任务
  const pdcWs = path.join(TMP, 'pdc_ws');
  await mkdir(path.join(pdcWs, '.mmw'), { recursive: true });
  await writeFile(path.join(pdcWs, '.mmw', 'state.json'), JSON.stringify({ switches: { validation_mode: 'strict' } }), 'utf8');
  const miss = await gatePaperDataCheck(pdcWs, {});
  check('严格模式缺两份 md → 闸门失败', !miss.ok && /PAPER_DATA_CHECK/.test(miss.hint), miss.hint);

  await writeFile(path.join(pdcWs, 'PAPER_DATA_CHECKLIST.md'), '# 清单\n', 'utf8');
  await writeFile(path.join(pdcWs, 'PAPER_DATA_CHECK_REPORT.md'), '# 报告\n\n## 结论\n\n通过：论文里的数据性数字都能在 JSON 找到来源。\n', 'utf8');
  const noMarker = await gatePaperDataCheck(pdcWs, {});
  check('报告通过但缺标记 → 闸门失败', !noMarker.ok && /DATA_CHECK_PASSED/.test(noMarker.hint), noMarker.hint);

  await mkdir(path.join(pdcWs, 'paper'), { recursive: true });
  await writeFile(path.join(pdcWs, 'paper', 'main.tex'), '% DATA_CHECK_PASSED\n', 'utf8');
  const okGate = await gatePaperDataCheck(pdcWs, {});
  check('报告通过 + 标记在位 → 闸门通过', okGate.ok, JSON.stringify(okGate.detail));

  await writeFile(path.join(pdcWs, '.mmw', 'state.json'), JSON.stringify({ switches: { validation_mode: 'fast' } }), 'utf8');
  const fastGate = await gatePaperDataCheck(pdcWs, {});
  check('快速模式跳过数据核对', fastGate.ok && fastGate.code === 2, JSON.stringify(fastGate.detail));

  const paperText = await buildStepPrompt({
    workspace,
    state,
    step: state.steps.find((s) => s.key === 'comp-paper-zh'),
    skillBody: await readSkillBody(ASSETS, '论文撰写'),
    index: 6,
    total: state.steps.length,
  });
  check('论文步 prompt 含严格模式数据核对任务',
    paperText.includes('paper_data_check.py') && paperText.includes('PAPER_DATA_CHECKLIST.md') && paperText.includes('DATA_CHECK_PASSED'));

  // 12) 子代理提问 → 主代理 → 回传
  const qState = { steps: [{ key: 'comp-code', status: 'running' }], questions: [] };
  const q1 = addQuestion(qState, { step: 'comp-code', question: '第 3 题要求的是成本最小还是时间最短？', options: ['成本最小', '时间最短'] });
  check('登记问题后进入待答状态', openQuestions(qState).length === 1 && describeOpen(qState).join('').includes('成本最小'));
  qState.steps[0].status = 'waiting';
  check('waiting 步骤会被 nextPendingStep 优先选中', nextPendingStep(qState)?.key === 'comp-code');
  const answered = answerQuestion(qState, q1.id, '成本最小');
  check('记录用户回答', answered?.status === 'answered' && openQuestions(qState).length === 0);
  check('回答可回传给子代理', String(answered.answer).includes('成本最小'));
  qState.steps[0].status = 'running';
  check('回答后步骤恢复 running', qState.steps[0].status === 'running');
  // 13) 正文页数口径：目录后→参考文献前，附录/代码/参考文献不算
  const pagesWs = path.join(TMP, 'pages_ws');
  await mkdir(path.join(pagesWs, '.mmw'), { recursive: true });
  await mkdir(path.join(pagesWs, 'paper', 'sections'), { recursive: true });
  await writeFile(path.join(pagesWs, '.mmw', 'state.json'), JSON.stringify({ switches: { max_pages: 10 } }), 'utf8');
  await writeFile(path.join(pagesWs, 'paper', 'sections', '5_problem1.tex'), '正文内容'.repeat(1150), 'utf8');
  await writeFile(path.join(pagesWs, 'paper', 'sections', 'A_code.tex'), '\\appendix\n附录代码'.repeat(20000), 'utf8');
  await writeFile(path.join(pagesWs, 'paper', 'sections', 'Z_ai_disclosure.tex'), 'AI 声明'.repeat(2000), 'utf8');
  const pg1 = await gatePages(pagesWs, {});
  check('正文页数只算正文（附录/代码/声明不计）',
    pg1.ok === false && pg1.detail.chars < 6000 && pg1.detail.skippedNonBody.length >= 2,
    JSON.stringify({ chars: pg1.detail.chars, skipped: pg1.detail.skippedNonBody, pages: pg1.detail.estPages }));

  await writeFile(path.join(pagesWs, 'paper', 'sections', '6_problem2.tex'), '正文内容'.repeat(1150), 'utf8');
  const pg2 = await gatePages(pagesWs, {});
  check('正文补齐后通过且口径写进 detail', pg2.ok === true && pg2.detail.scope === 'body-pages',
    JSON.stringify({ pages: pg2.detail.estPages, target: pg2.detail.target }));

  // 13b) 英文页数口径：2200 字符/页，排除 current_chapter.tex
  const enPagesWs = path.join(TMP, 'pages_en');
  await mkdir(path.join(enPagesWs, '.mmw'), { recursive: true });
  await mkdir(path.join(enPagesWs, 'paper', 'sections'), { recursive: true });
  await writeFile(path.join(enPagesWs, '.mmw', 'state.json'), JSON.stringify({ switches: { max_pages: 10, language: 'en' } }), 'utf8');
  await writeFile(path.join(enPagesWs, 'paper', 'sections', '1_intro.tex'), 'A'.repeat(22000), 'utf8');
  await writeFile(path.join(enPagesWs, 'paper', 'sections', 'current_chapter.tex'), 'B'.repeat(8000), 'utf8');
  const enPg = await gatePages(enPagesWs, {});
  check('英文按 2200 字符/页估算且排除临时章节',
    enPg.ok === true && enPg.detail.charsPerPage === 2200 && enPg.detail.chars === 22000
      && enPg.detail.skippedNonBody.includes('current_chapter.tex'),
    JSON.stringify({ chars: enPg.detail.chars, pages: enPg.detail.estPages, skipped: enPg.detail.skippedNonBody }));
  // 11) 图表风格 → 技能映射
  const natureSkills = resolveSteps({ ...switches, figure_style: 'nature' }).map((s) => s.skill);
  const defaultSkills = resolveSteps({ ...switches, figure_style: 'default' }).map((s) => s.skill);
  check('nature 风格改用「自然风格图表」技能',
    natureSkills.includes('自然风格图表') && !natureSkills.includes('图表生成'), natureSkills.join('>'));
  check('default 风格仍用「图表生成」技能',
    defaultSkills.includes('图表生成') && !defaultSkills.includes('自然风格图表'), defaultSkills.join('>'));
  check('自然风格图表技能资产存在', existsSync(path.join(ASSETS, 'skills', '自然风格图表', 'SKILL.md')));

  const askPrompt = await buildStepPrompt({
    workspace,
    state,
    step: state.steps[0],
    skillBody: await readSkillBody(ASSETS, state.steps[0].skill),
    index: 0,
    total: state.steps.length,
  });
  check('prompt 含提问协议（modeling_ask + 结束本轮）',
    askPrompt.includes('modeling_ask') && askPrompt.includes('结束本轮'));

  // 12) 图步各管各的：数据图步不等流程图，流程图步不重画数据图
  const figWs = path.join(TMP, 'fig_ws');
  await mkdir(path.join(figWs, 'figures'), { recursive: true });
  await writeFile(path.join(figWs, 'PROBLEM_ANALYSIS.md'), [
    '<!-- BEGIN FIGURE_MANIFEST -->',
    '**数据图**',
    '- fig_q1_trend',
    '- fig_q2_cost',
    '**流程图**',
    '- fig_flow_q1',
    '**概念图**',
    '- fig_scene_q1',
    '**表格**',
    '- TABLE_q1',
    '<!-- END FIGURE_MANIFEST -->',
  ].join('\n'), 'utf8');
  for (const f of ['fig_q1_trend.pdf', 'fig_q2_cost.pdf']) await writeFile(path.join(figWs, 'figures', f), 'pdf', 'utf8');
  const dataStep = { key: 'paper-figure', gates: ['figures'] };
  const flowStep = { key: 'paper-figure-html', gates: ['figures'] };
  const gf1 = await gateFigures(figWs, dataStep);
  check('数据图步只对账数据图（不等流程图）',
    gf1.ok === true && gf1.detail.planned === 2 && gf1.detail.deferred.FLOW === undefined && gf1.detail.byKind.DRAWIO === 1,
    JSON.stringify({ planned: gf1.detail.planned, deferred: gf1.detail.deferred }));
  check('没配生图 key 时概念图自动跳过（不卡步）',
    (gf1.detail.gptImgSkipped ?? []).includes('fig_scene_q1') && !gf1.detail.missing.includes('fig_scene_q1'),
    JSON.stringify(gf1.detail.gptImgSkipped));
  const gf2 = await gateFigures(figWs, flowStep);
  check('流程图步只对账流程图（不重画数据图）',
    gf2.ok === false && gf2.detail.missing.includes('fig_flow_q1') && gf2.detail.deferred.DATA === 2,
    JSON.stringify({ missing: gf2.detail.missing, deferred: gf2.detail.deferred }));
  await writeFile(path.join(figWs, 'figures', 'fig_flow_q1.pdf'), 'pdf', 'utf8');
  const gf3 = await gateFigures(figWs, flowStep);
  check('流程图补齐后通过，表格不参与图对账', gf3.ok === true && gf3.detail.planned === 1, JSON.stringify(gf3.detail.byKind));

  // 12b) 机理图：章节名归类 + 有无生图 key 时的对账行为
  const mechWs = path.join(TMP, 'mech_ws');
  await mkdir(path.join(mechWs, 'figures'), { recursive: true });
  await writeFile(path.join(mechWs, 'PROBLEM_ANALYSIS.md'), [
    '<!-- BEGIN FIGURE_MANIFEST -->',
    '**数据图**',
    '- fig_q1_trend',
    '**机理示意图**',
    '- fig_mechanism_q1',
    '<!-- END FIGURE_MANIFEST -->',
  ].join('\n'), 'utf8');
  await writeFile(path.join(mechWs, 'figures', 'fig_q1_trend.pdf'), 'pdf', 'utf8');
  const mechParse = parseFigureManifest(await readFile(path.join(mechWs, 'PROBLEM_ANALYSIS.md'), 'utf8'));
  check('「机理示意图」章节归入 GPTIMG', (mechParse?.GPTIMG ?? []).includes('fig_mechanism_q1'), JSON.stringify(mechParse));
  const mechNoKey = await gateFigures(mechWs, { key: 'paper-figure', gates: ['figures'] });
  check('无 key 时机理图自动跳过', mechNoKey.ok === true && (mechNoKey.detail.gptImgSkipped ?? []).includes('fig_mechanism_q1'),
    JSON.stringify({ ok: mechNoKey.ok, skipped: mechNoKey.detail.gptImgSkipped }));
  process.env.GPT_IMAGE_API_KEY = 'test-key';
  const mechKey = await gateFigures(mechWs, { key: 'paper-figure', gates: ['figures'] });
  delete process.env.GPT_IMAGE_API_KEY;
  check('有 key 时机理图纳入对账（缺图即失败）',
    mechKey.ok === false && mechKey.detail.missing.includes('fig_mechanism_q1'),
    JSON.stringify({ ok: mechKey.ok, missing: mechKey.detail.missing }));

  // 13) 页数口径写进 prompt（目标/下限，不是全文上限）
  const paperStep2 = state.steps.find((s) => s.key === 'comp-paper-zh');
  const paperText2 = await buildStepPrompt({ workspace, state, step: paperStep2, skillBody: await readSkillBody(ASSETS, paperStep.skill), index: 6, total: state.steps.length });
  check('论文步 prompt 明确「不是全文页数上限」', paperText2.includes('不是全文页数上限'));
  check('图表步 prompt 明确「不要提前画」流程图', (await buildStepPrompt({ workspace, state, step: state.steps.find((s) => s.key === 'paper-figure'), skillBody: 'x', index: 3, total: 8 })).includes('不要提前画'));

  // 14) 场景图固定风格（MCM Academic Illustration）
  const gptSrc = await readFile(path.join(ASSETS, 'utils', 'gpt_image.py'), 'utf8');
  check('场景图内置 MCM 学术插图固定风格',
    gptSrc.includes('Academic monochrome technical illustration')
      && gptSrc.includes('Strict monochromatic grayscale palette')
      && gptSrc.includes('Flat 2D/3D vector-style rendering')
      && gptSrc.includes('Avoid'));
  check('场景图提示词模板含三段结构', gptSrc.includes('【场景主题】') && gptSrc.includes('【场景元素】') && gptSrc.includes('【构图要求】'));
  check('内置机理图固定风格（Scientific Mechanism Diagram）',
    gptSrc.includes('Scientific mechanism diagram') && gptSrc.includes('Soft pastel palette') && gptSrc.includes('Rounded-rectangle modules'));
  check('机理图模板含【主题】【内容要求】且支持 --style',
    gptSrc.includes('【主题】') && gptSrc.includes('【内容要求】') && gptSrc.includes('--style'));
  check('支持 --dry-run 预览最终提示词', gptSrc.includes('--dry-run'));

  // 15) 技能引用的 _utils 脚本必须真实存在（防止技能文档指向缺失工具）
  const skillFiles = await readdir(path.join(ASSETS, 'skills'), { recursive: true });
  const missingUtils = new Set();
  for (const rel of skillFiles) {
    if (!rel.endsWith('.md')) continue;
    const text = await readFile(path.join(ASSETS, 'skills', rel), 'utf8');
    for (const m of text.matchAll(/_utils\/([A-Za-z0-9_.-]+\.(?:py|sh))/g)) {
      if (!existsSync(path.join(ASSETS, 'utils', m[1]))) missingUtils.add(m[1]);
    }
  }
  check('技能引用的 _utils 脚本都存在', missingUtils.size === 0, [...missingUtils].join(', '));

  // 16) 编程实现步必须要求结果 JSON（论文数据核对依赖它）
  const codeStep = state.steps.find((s) => s.key === 'comp-code');
  check('编程实现步要求 figures/*.json', codeStep.companions.includes('figures/*.json'));
  check('数据图质量检查脚本随包提供', existsSync(path.join(ASSETS, 'utils', 'figure_pdf_quality_check.py')));

  // 17) 逐问流程图：开关 + 自定义要求里的 image 选择 + 标记与技能
  check('逐问流程图默认关', perProblemFlowStyle({ flow_per_problem: false }) === 'off');
  check('开启但未点名 image → DrawIO',
    perProblemFlowStyle({ flow_per_problem: true, custom_requirements: '每问画流程图' }) === 'drawio');
  check('开启且自定义要求点名 image → GPT Image',
    perProblemFlowStyle({ flow_per_problem: true, custom_requirements: '每问流程图用 image 生成' }) === 'gptimage');
  const flowSwitches = normalizeSwitches({ flow_per_problem: true, custom_requirements: '每问流程图用 image 生成' }).switches;
  const flowCm = buildClaudeMd({ switches: flowSwitches, steps: resolveSteps(flowSwitches), title: 't', uploaded: [] });
  check('CLAUDE.md 写逐问流程标记',
    flowCm.includes('MMW_FLOW_PER_PROBLEM=1') && flowCm.includes('MMW_PER_PROBLEM_FLOW_STYLE=gptimage'));
  check('framework 固定风格随包提供',
    gptSrc.includes('Visual modeling framework diagram') && gptSrc.includes('graphical abstract style') && gptSrc.includes('"framework"'));
  const flowParsed = parseFigureManifest('<!-- BEGIN FIGURE_MANIFEST -->\n**逐问流程图（GPT Image）**\n- fig_flow_q1\n<!-- END FIGURE_MANIFEST -->');
  check('逐问流程图（GPT Image）章节归入 GPTIMG', (flowParsed?.GPTIMG ?? []).includes('fig_flow_q1'), JSON.stringify(flowParsed));
  const flowWs = path.join(TMP, 'flow_ws');
  await mkdir(path.join(flowWs, 'figures'), { recursive: true });
  await writeFile(path.join(flowWs, 'PROBLEM_ANALYSIS.md'), [
    '<!-- BEGIN FIGURE_MANIFEST -->',
    '**数据图**',
    '- fig_q1_trend',
    '**逐问流程图（GPT Image）**',
    '- fig_flow_q1',
    '<!-- END FIGURE_MANIFEST -->',
  ].join('\n'), 'utf8');
  await writeFile(path.join(flowWs, 'figures', 'fig_q1_trend.pdf'), 'pdf', 'utf8');
  const flowNoKey = await gateFigures(flowWs, { key: 'paper-figure', gates: ['figures'] });
  check('逐问框架图无 key 自动跳过', flowNoKey.ok === true && (flowNoKey.detail.gptImgSkipped ?? []).includes('fig_flow_q1'),
    JSON.stringify(flowNoKey.detail.gptImgSkipped));
  process.env.GPT_IMAGE_API_KEY = 'test-key';
  const flowKey = await gateFigures(flowWs, { key: 'paper-figure', gates: ['figures'] });
  delete process.env.GPT_IMAGE_API_KEY;
  check('有 key 时逐问框架图纳入对账', flowKey.ok === false && flowKey.detail.missing.includes('fig_flow_q1'),
    JSON.stringify(flowKey.detail.missing));

  // 17b) 逐问流程图引擎按 CLAUDE.md 标记归组：章节名写错也不串进 DrawIO/HTML 组
  const imgParsed = parseFigureManifest('<!-- BEGIN FIGURE_MANIFEST -->\n**流程图（image）**\n- fig_flow_q2\n<!-- END FIGURE_MANIFEST -->');
  check('「流程图（image）」章节归入 GPTIMG', (imgParsed?.GPTIMG ?? []).includes('fig_flow_q2'), JSON.stringify(imgParsed));

  const mkFlowWs = async (name, title, marker) => {
    const dir = path.join(TMP, name);
    await mkdir(path.join(dir, 'figures'), { recursive: true });
    await writeFile(path.join(dir, 'PROBLEM_ANALYSIS.md'), [
      '<!-- BEGIN FIGURE_MANIFEST -->',
      '**数据图**',
      '- fig_q1_trend',
      title,
      '- fig_flow_q1',
      '<!-- END FIGURE_MANIFEST -->',
    ].join('\n'), 'utf8');
    await writeFile(path.join(dir, 'CLAUDE.md'), `- language: en\nMMW_FLOW_PER_PROBLEM=1\nMMW_PER_PROBLEM_FLOW_STYLE=${marker}\n`, 'utf8');
    await writeFile(path.join(dir, 'figures', 'fig_q1_trend.pdf'), 'pdf', 'utf8');
    return dir;
  };
  const misplacedImg = await mkFlowWs('flow_misplaced_img', '**流程图（DrawIO）**', 'gptimage');
  process.env.GPT_IMAGE_API_KEY = 'test-key';
  const misImg = await gateFigures(misplacedImg, { key: 'paper-figure', gates: ['figures'] });
  delete process.env.GPT_IMAGE_API_KEY;
  check('image 模式：误写 DrawIO 段的逐问图仍按 GPTIMG 要求',
    misImg.ok === false && misImg.detail.missing.includes('fig_flow_q1'), JSON.stringify(misImg.detail));
  const misplacedDrawio = await mkFlowWs('flow_misplaced_drawio', '**逐问流程图（GPT Image）**', 'drawio');
  const misDrawio = await gateFigures(misplacedDrawio, { key: 'paper-figure-drawio', gates: ['figures'] });
  check('drawio 模式：误写 GPT Image 段的逐问图仍按 DRAWIO 要求',
    misDrawio.ok === false && misDrawio.detail.missing.includes('fig_flow_q1'), JSON.stringify(misDrawio.detail));
  check('gpt_image 默认 --lang auto 且可读 CLAUDE.md',
    gptSrc.includes('default="auto"') && gptSrc.includes('def resolve_lang')
      && gptSrc.includes('Use English labels') && gptSrc.includes('【标注文字】图内标注使用简体中文'));

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('SMOKE ERROR', error);
  process.exitCode = 1;
});



