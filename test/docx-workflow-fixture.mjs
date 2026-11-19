// Deterministic inputs through the complete plugin workflow, using real Word conversion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';

export async function put(workspace, relativePath, value) {
  const file = path.join(workspace, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value));
}

const results = { cost: 12.5, accuracy: 0.94, recall: 0.83, evaluation: { sample_count: 240, comparator_cost: 19.8 } };
const manifest = `<!-- BEGIN FIGURE_MANIFEST -->
**DATA 数据图：**
- fig_q1_cost
**DRAWIO 流程图：**
- fig_framework
**TABLE 表格：**
- TABLE_main
<!-- END FIGURE_MANIFEST -->`;
const renderPdfPath = 'paper/docx-layout-check.pdf';
const appendix = '```python\nprint(987654)\n```';
const chinesePaper = [
  '# 调度模型回归样稿', '', '## 摘要', '', '模型计算的成本为 12.5 元，准确率为 94%。', '',
  '关键词：调度；敏感性；误差', '', '## 目录', '', '- 问题求解', '- 结果检验', '',
  '## 1 问题 1：确定调度方案', '', '本节给出求解流程，并利用定量结果检验调度方案。', '',
  '![图 1 成本对比](figures/fig_q1_cost.png)', '', '图中的结果与成本表一致。', '',
  '![图 2 求解流程](../figures/fig_framework.pdf)', '',
  '目标函数为 $f(x)=x^2$，由边际变化解释求解过程。', '',
  '$$\n\\frac{\\partial f}{\\partial x}=2x\n$$', '',
  '**表 1 成本核对**', '', '| 指标 | 值 |', '| --- | --- |', '| 成本 | 12.5 |', '',
  '<!-- label: TABLE_main -->', '', '## 2 结论与检验', '',
  '进一步核对数据边界条件，分析扰动对决策结果的影响，并将模型的定量输出与重复对照实验的真实结果逐项检查。\n\n'.repeat(40),
  '## 参考文献', '', '[1] Boyd S, Vandenberghe L. Convex Optimization. Cambridge University Press, 2004.', '',
  '## 附录', '', appendix, '',
].join('\n');

function python(script, args, cwd, expected = 0) {
  const result = spawnSync(process.env.MMW_PYTHON, ['-X', 'utf8', script, ...args], {
    cwd, encoding: 'utf8', timeout: 180_000, env: { ...process.env, PYTHONIOENCODING: 'utf8' },
  });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.equal(result.status, expected, `${script} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function figureFiles(ws) {
  const createImage = 'from PIL import Image, ImageDraw; im=Image.new("RGB", (900, 480), "white"); d=ImageDraw.Draw(im); d.line([(90,50),(90,400),(820,400)], fill="#25374b", width=5); d.rectangle((250,170,410,400), fill="#0F4D92"); d.rectangle((520,110,680,400), fill="#6295b1"); im.save("figures/fig_q1_cost.png", dpi=(300,300))';
  const processResult = spawnSync(process.env.MMW_PYTHON, ['-c', createImage], { cwd: ws });
  assert.equal(processResult.status, 0, processResult.stderr?.toString());
  const doc = await PDFDocument.create();
  const page = doc.addPage([360, 200]);
  page.drawRectangle({ x: 30, y: 116, width: 130, height: 55, color: rgb(.15, .35, .55) });
  page.drawRectangle({ x: 200, y: 30, width: 130, height: 55, color: rgb(.26, .5, .4) });
  page.drawLine({ start: { x: 160, y: 139 }, end: { x: 201, y: 60 }, thickness: 3 });
  await put(ws, 'figures/fig_framework.pdf', await doc.save());
  await put(ws, 'figures/fig_framework.html', '<!doctype html><title>Workflow diagram fixture</title><p>Input → Model → Result</p>');
  await put(ws, 'figures/TABLE_main.md', '| 指标 | 值 |\n| --- | --- |\n| 成本 | 12.5 |');
  await put(ws, 'figures/latex_includes.tex', '% Source figure inventory for the deterministic workflow test.\n');
}

export async function exerciseWord(call, input, { pagination = false } = {}) {
  const init = await call('modeling_init', { input_dir: input, workspace_name: 'word-strict-回归', competition: 'generic',
    max_pages: 2, validation_mode: 'strict', min_figures: 1, min_tables: 1, flowchart_engine: 'html' });
  const ws = init.workspace;
  const change = await call('modeling_switches', { workspace: ws, switches: { output_format: 'docx' } });
  assert.equal(change.switches.output_format, 'docx');
  const next = async (key) => {
    const response = await call('modeling_next', { workspace: ws });
    assert.equal(response.step.key, key);
    return readFile(response.promptPath, 'utf8');
  };
  const finish = async (gate, pass = true) => {
    const response = await call('modeling_finish', { workspace: ws });
    assert.equal(response.pass, pass, JSON.stringify(response));
    if (gate) assert.ok(response.results.some((entry) => entry.gate === gate && entry.ok === pass), JSON.stringify(response));
    return response;
  };
  await next('comp-prob-analysis');
  await put(ws, 'PROBLEM_ANALYSIS.md', '## 问题 1\n' + '分析输入条件和约束的回归样稿。\n'.repeat(75) + manifest);
  await finish();
  await next('comp-modeling');
  await put(ws, 'MODELING_REPORT.md', '模型的目标函数与约束由样例定义。\n'.repeat(80));
  await finish();
  await next('comp-code');
  await put(ws, 'RESULTS.md', '计算结果来自已确定的离线算法。\n'.repeat(60));
  await put(ws, 'figures/all_results.json', results);
  await put(ws, 'code/main.py', '# Fixture calculation with deterministic output and no network dependency.\nprint(12.5)\n');
  await finish();
  await next('paper-figure');
  await figureFiles(ws);
  await finish('figures');
  await next('paper-figure-html');
  await finish('figures');
  await next('comp-review');
  await put(ws, 'COMP_REVIEW.md', '检查边界、图源和合并清单，逐项核对合成结果与章节。\n'.repeat(8));
  await put(ws, 'COMP_REVIEW_VERDICT.json', { fatal_count: 0, major_count: 0, minor_count: 0, findings: [] });
  await finish('review_verdict');

  const precheck = (mode, options = [], expected = 0) => python('_utils/docx_paper.py',
    [mode, '--workspace', '.', '--competition', 'generic', '--language', 'zh', ...options], ws, expected);
  const checkNumbers = (expected = 0) => python('_utils/paper_data_check.py', ['--mode', 'docx'], ws, expected);
  const paperPrompt = await next('comp-paper-zh-docx');
  assert.match(paperPrompt, /docx-cn-engine markdown 约定/);
  assert.match(paperPrompt, /图号起句检测/);
  assert.match(paperPrompt, /MMW_FAST_MODE=1/);
  assert.doesNotMatch(paperPrompt, /MH_FAST_MODE=1/);
  assert.match(paperPrompt, /paper_data_check.py --mode docx/);
  assert.match(paperPrompt, /docx_paper.py precheck/);
  assert.doesNotMatch(paperPrompt, /docx_paper.py export/);
  await put(ws, 'paper/main.md', chinesePaper.replace('figures/fig_q1_cost.png', 'https://example.invalid/figure.png'));
  await finish('docx_source', false);
  await put(ws, 'paper/main.md', chinesePaper.replace('<!-- label: TABLE_main -->', '<!-- label: TABLE_draft -->'));
  await finish('docx_source', false);
  await put(ws, 'paper/main.md', chinesePaper.replace('问题 1：', '求解：'));
  await finish('docx_source', false);
  await put(ws, 'paper/main.md', chinesePaper.replace('| 12.5 |', '| 78.91 |'));
  checkNumbers(1);
  await finish('paper_data_check', false);
  await put(ws, 'paper/main.md', chinesePaper.replace('## 参考文献', '准确率为83%，召回率为94%。\n\n## 参考文献'));
  checkNumbers(1);
  await finish('paper_data_check', false);
  await put(ws, 'paper/main.md', chinesePaper.replace('## 参考文献', '准确率为94%，召回率为83%。\n\n## 参考文献'));
  precheck('precheck', ['--report']);
  checkNumbers();
  const certPath = path.join(ws, 'PAPER_DATA_CHECK_RESULT.json');
  const stamp = JSON.parse(await readFile(certPath, 'utf8'));
  await put(ws, 'PAPER_DATA_CHECK_RESULT.json', { ...stamp, mode: 'pdf' });
  await finish('paper_data_check', false);
  await put(ws, 'PAPER_DATA_CHECK_RESULT.json', stamp);
  const authoritative = await readFile(path.join(ws, 'paper/main.md'), 'utf8');
  await put(ws, 'paper/main.md', authoritative + '\n<!-- edited after verification -->\n');
  const stale = await finish('paper_data_check', false);
  assert.ok(stale.results.some((gate) => gate.detail.fresh === false));
  checkNumbers();
  await finish('paper_data_check');

  const exportPrompt = await next('docx-export');
  assert.match(exportPrompt, /DOCX_FORMAT_CHECK_REPORT\.md/);
  assert.doesNotMatch(exportPrompt, /DOCX 模板占位映射器/);
  assert.match(exportPrompt, /Hard Output Gate/);
  assert.match(exportPrompt, /docx_paper.py export/);
  assert.match(exportPrompt, /docx_paper.py verify/);
  await put(ws, 'paper/main.docx', 'Invalid Word file. '.repeat(1000));
  await finish('docx_output', false);
  precheck('export');
  const report = JSON.parse(precheck('verify'));
  assert.equal(report.ok, true);
  const result = await finish('docx_output');
  assert.equal(result.next, null);
  const status = await call('modeling_status', { workspace: ws });
  assert.deepEqual(status.progress, { done: 8, total: 8 });
  assert.equal(status.finalPaper, path.join(ws, 'paper/main.docx'));
  assert.ok((await stat(status.finalPaper)).size > 10000);
  await assert.rejects(stat(path.join(ws, 'paper/main.tex')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(ws, renderPdfPath)), { code: 'ENOENT' });
  await put(ws, 'figures/fig_q1_cost.png', Uint8Array.of(1, 2, 3));
  assert.equal((await call('modeling_status', { workspace: ws })).finalPaper, null);
  const staleOutput = await call('modeling_finish', { workspace: ws, step: 'docx-export' });
  assert.equal(staleOutput.pass, false);
  await figureFiles(ws);
  precheck('export');
  checkNumbers();
  await finish('docx_output');

  let english;
  if (pagination) {
    const templateDir = path.join(input, 'supplied');
    const rel = 'supplied/Competition Template.docx';
    const file = path.join(input, rel);
    await mkdir(templateDir, { recursive: true });
    const makeTemplate = `from docx import Document
from docx.shared import Inches
import sys
doc = Document()
doc.sections[0].top_margin = Inches(1.1)
for text in ('Competition document', 'Title placeholder', 'Summary Sheet', 'Body placeholder', 'References', 'Appendix'):
    doc.add_paragraph(text)
doc.save(sys.argv[1])`;
    const made = spawnSync(process.env.MMW_PYTHON, ['-I', '-X', 'utf8', '-c', makeTemplate, file]);
    assert.equal(made.status, 0, made.stderr?.toString());
    const initEnglish = await call('modeling_init', { input_dir: input, workspace_name: 'word-fast-english', competition: 'mcm',
      output_format: 'docx', max_pages: 1, validation_mode: 'fast', ai_disclosure: 'none', skip_figures: true });
    english = initEnglish.workspace;
    assert.deepEqual(initEnglish.steps.slice(-3).map((s) => s.key), ['comp-paper-en-docx', 'docx-template-map', 'docx-export']);
    const finishEnglish = async (key) => {
      const r = await call('modeling_finish', { workspace: english });
      assert.equal(r.step, key); assert.equal(r.pass, true, JSON.stringify(r)); return r;
    };
    const nextEnglish = async (key) => {
      const r = await call('modeling_next', { workspace: english });
      assert.equal(r.step.key, key); return readFile(r.promptPath, 'utf8');
    };
    await nextEnglish('comp-prob-analysis');
    await put(english, 'PROBLEM_ANALYSIS.md', '## Problem 1\n' + 'Assess objectives and physical constraints.\n'.repeat(45));
    await finishEnglish('comp-prob-analysis');
    await nextEnglish('comp-modeling');
    await put(english, 'MODELING_REPORT.md', 'Trace each model assumption to the deterministic inputs.\n'.repeat(40));
    await finishEnglish('comp-modeling');
    await nextEnglish('comp-code');
    await put(english, 'RESULTS.md', 'Document algorithm and reproducible evaluation of the model.\n'.repeat(30));
    await put(english, 'code/main.py', '# Calculate a reproducible model result for use in the paper.\nprint(12.5)\n');
    await put(english, 'figures/all_results.json', results);
    await finishEnglish('comp-code');
    const enPrompt = await nextEnglish('comp-paper-en-docx');
    assert.match(enPrompt, /Write Summary Sheet LAST/);
    assert.match(enPrompt, /Claims-Evidence Matrix Verification/);
    assert.match(enPrompt, /--page-limit 25/);
    const source = [
      '# Scheduling under Limited Capacity', '', '## Summary Sheet', '', 'We report a deterministic comparison.', '',
      '## 1. Sub-Problem 1: Select a schedule', '',
      'The cost model provides a consistent basis for selecting a timetable. Each feasible solution is evaluated against the operating constraints.\n\n'.repeat(40),
      'The objective is $C=\\sum_i c_i x_i$.', '', '## 2. Conclusion', '', 'The comparison supports the proposed workflow.', '',
      '## AI Tool Usage Statement', '', 'The team did not use any AI tools during the competition.', '', '## References', '',
      '[1] Boyd S, Vandenberghe L. Convex Optimization. Cambridge University Press, 2004.', '',
      '## Appendix A: Portable fixture', '', '```text',
      Array.from({ length: 180 }, (_, i) => createHash('sha256').update(`fixture-${i}`).digest('hex').slice(0, 32)).join('\n'),
      '```', '',
    ].join('\n');
    await put(english, 'paper/main.md', source.replace('## Summary Sheet', '## Abstract'));
    const noSummary = await call('modeling_finish', { workspace: english });
    assert.ok(noSummary.results.some((g) => g.gate === 'docx_source' && !g.ok && g.detail.error.includes('Summary Sheet')));
    await put(english, 'paper/main.md', source);
    const writing = await finishEnglish('comp-paper-en-docx');
    assert.ok(writing.results.some((g) => g.gate === 'paper_data_check' && g.code === 2));
    const templatePrompt = await nextEnglish('docx-template-map');
    assert.match(templatePrompt, /user_data\/supplied\/Competition Template\.docx/);
    assert.match(templatePrompt, /DOCX 模板占位映射器/);
    assert.match(templatePrompt, /verify-preview/);
    const anchorMap = { language: 'en', title_anchor_para_idx: 1, abstract_anchor_para_idx: 2, body_anchor_para_idx: 3,
      references_anchor_para_idx: 4, appendix_anchor_para_idx: 5, body_anchor_mode: 'delete', delete_paragraph_indices: [] };
    await put(english, '_template_map.json', anchorMap);
    await put(english, '_template_check_report.md', '# Template trial fixture\nVerified the mapped title, summary, body, references and appendix against the selected template.\n');
    const opts = ['--workspace', '.', '--language', 'en', '--competition', 'mcm', '--page-limit', '25'];
    const runDocx = (op, flags = [], status = 0) => python('_utils/docx_paper.py', [op, ...opts, ...flags], english, status);
    runDocx('export', ['--template-preview']);
    runDocx('verify-preview');
    await put(english, '_template_map.json', { ...anchorMap, body_anchor_mode: 'keep' });
    const stalePreview = await call('modeling_finish', { workspace: english });
    assert.ok(stalePreview.results.some(g => g.gate === 'docx_template' && !g.ok), JSON.stringify(stalePreview));
    await put(english, '_template_map.json', anchorMap);
    await finishEnglish('docx-template-map');
    const exportPrompt = await nextEnglish('docx-export');
    assert.doesNotMatch(exportPrompt, /DOCX 模板占位映射器/);
    runDocx('export');
    const exported = await finishEnglish('docx-export');
    assert.ok(exported.results.find(g => g.gate === 'docx_output').detail.layoutPages > 0);
    assert.ok((await stat(path.join(english, renderPdfPath))).size > 1000);
    assert.equal((await call('modeling_status', { workspace: english })).finalPaper, path.join(english, 'paper/main.docx'));
  }
  return { chinese: ws, english };
}
