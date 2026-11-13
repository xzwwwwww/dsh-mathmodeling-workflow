import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { gateLogic, gateFigures, gateFigureMinimum, gatePaperDataCheck, gatePdfPages, gateAiDisclosure, gatePages, runGates, parseFigureManifest } from '../lib/gates.js';
import { mergeFigureManifests, figureCategory } from '../lib/figureManifest.js';
import { paperDataInputs } from '../lib/paperDataSnapshot.js';
import { stripTexComments, readTexInputs } from '../lib/texInputs.js';
import { COMPETITIONS } from '../lib/switches.js';

const dataStep = { key: 'paper-figure', gates: ['figures'] };
const drawStep = { key: 'paper-figure-drawio', gates: ['figures'] };
const htmlStep = { key: 'paper-figure-html', gates: ['figures'] };
const manifest = (body) => `<!-- BEGIN FIGURE_MANIFEST -->\n${body}\n<!-- END FIGURE_MANIFEST -->`;
const tex = (body) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
const tables = (n = 4) => Array.from({ length: n }, () => '\\begin{tabular}{ll}a & b\\\\\\end{tabular}').join('\n');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'mmw-gates-regression-'));
  t.after(async () => {
    assert.equal(path.dirname(ws), path.resolve(os.tmpdir()));
    assert.match(path.basename(ws), /^mmw-gates-regression-/);
    await rm(ws, { recursive: true, force: true });
  });
  return ws;
}
async function put(ws, rel, value) {
  await mkdir(path.dirname(path.join(ws, rel)), { recursive: true });
  await writeFile(path.join(ws, rel), typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array) ? JSON.stringify(value) : value);
}
async function state(ws, switches = {}, steps = []) { await put(ws, '.mmw/state.json', { switches, steps }); }
async function logic(ws, contract, probes, values = {}) {
  await put(ws, 'LOGIC_CONTRACT.json', contract);
  await put(ws, 'results.json', { ...values, logic_probes: probes });
  return gateLogic(ws, {});
}
function imageKey(t, value) {
  const previous = process.env.GPT_IMAGE_API_KEY;
  if (value) process.env.GPT_IMAGE_API_KEY = value; else delete process.env.GPT_IMAGE_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.GPT_IMAGE_API_KEY; else process.env.GPT_IMAGE_API_KEY = previous; });
}

test('F03 canonical bounds signs are checked against the contract, including dishonest claim and duplicates', async (t) => {
  const ws = await fixture(t);
  const contract = { bounds: [{ quantity: 'eta', is: 'upper' }] };
  assert.equal((await logic(ws, contract, { bounds: [{ quantity: 'eta', claim: 'upper', probe_delta_sign: -1 }] })).ok, true);
  const reverse = await logic(ws, contract, { bounds: [{ quantity: 'eta', claim: 'upper', probe_delta_sign: 1 }] });
  assert.equal(reverse.ok, false); assert.match(reverse.hint, /方向反/);
  const dishonest = await logic(ws, contract, { bounds: [{ quantity: 'eta', claim: 'lower', probe_delta_sign: 1 }] });
  assert.equal(dishonest.ok, false); assert.match(dishonest.hint, /合同冲突/);
  assert.equal((await logic(ws, contract, { bounds: [{ quantity: 'eta', probe_delta_sign: 'bad', observed_sign: -1 }] })).ok, false);
  assert.equal((await logic(ws, contract, { bounds: [{ quantity: 'eta', observed_sign: -1 }] })).ok, true);
  assert.equal((await logic(ws, contract, { bounds: [{ quantity: 'eta', probe_delta_sign: 0 }] })).ok, true);
  await put(ws, 'figures/z.json', { logic_probes: { bounds: [{ quantity: 'eta', claim: 'upper', probe_delta_sign: -1 }] } });
  assert.equal((await logic(ws, contract, { bounds: [{ quantity: 'eta', probe_delta_sign: 1 }] })).ok, false);
  assert.equal((await logic(ws, { bounds: [...contract.bounds, { quantity: 'eta', is: 'lower' }] }, { bounds: [{ quantity: 'eta', probe_delta_sign: -1 }] })).ok, false);
});

test('F03 monotonic uses observed_sign and cannot override contract expectation', async (t) => {
  const ws = await fixture(t);
  const contract = { monotonic: [{ more: 'x', then: 'cost', dir: 'worse', expect_sign: 1 }] };
  assert.equal((await logic(ws, contract, { monotonic: [{ more: 'x', then: 'cost', observed_sign: 1, expect_sign: 1, expect_dir: 'worse' }] })).ok, true);
  assert.equal((await logic(ws, contract, { monotonic: [{ more: 'x', then: 'cost', observed_sign: 1, expect_sign: 2, expect_dir: ' WORSE ' }] })).ok, true);
  for (const expect_sign of [0, true, '1', null]) assert.equal((await logic(ws, contract, { monotonic: [{ more: 'x', then: 'cost', observed_sign: 1, expect_sign }] })).ok, false);
  assert.equal((await logic(ws, contract, { monotonic: [{ more: 'x', then: 'cost', observed_sign: -1, expect_sign: -1 }] })).ok, false);
  assert.equal((await logic(ws, contract, { monotonic: [{ more: 'x', then: 'cost', observed_sign: 1, expect_dir: 'better' }] })).ok, false);
});

test('F03 conflicting contracts fail without probes; compatible monotonic fragments merge', async (t) => {
  const ws = await fixture(t);
  assert.equal((await logic(ws, { bounds: [{ quantity: 'q', is: 'upper' }, { quantity: 'q', is: 'lower' }] }, {})).ok, false);
  assert.equal((await logic(ws, { bounds: [{ quantity: 'q', is: 'upper' }, { quantity: 'q', is: 'upper' }] }, {})).ok, true);
  for (const fragments of [
    [{ more: 'x', then: 'q', dir: 'better' }, { more: 'x', then: 'q', dir: 'worse' }],
    [{ more: 'x', then: 'q', expect_sign: 1 }, { more: 'x', then: 'q', expect_sign: -1 }],
  ]) assert.equal((await logic(ws, { monotonic: fragments }, {})).ok, false);
  const compatible = { monotonic: [{ more: 'x', then: 'q', dir: 'better' }, { more: 'x', then: 'q', expect_sign: -1 }, { more: 'x', then: 'q' }] };
  assert.equal((await logic(ws, compatible, { monotonic: [{ more: 'x', then: 'q', observed_sign: -1 }] })).ok, true);
  assert.equal((await logic(ws, compatible, { monotonic: [{ more: 'x', then: 'q', observed_sign: 1 }] })).ok, false);
});

test('F18 feature word boundaries and explanation types match Python semantics', async (t) => {
  const ws = await fixture(t);
  const contract = { must_features: ['T1', 'a.b', '', null], equivalence_claims: [{ claim: 'same', quantity_a: 'a', quantity_b: 'b', explanation: [] }] };
  await put(ws, 'code/main.py', 'T12 = 1\na.b = 3\n');
  const bad = await logic(ws, contract, {}, { a: 10, b: 20 });
  assert.equal(bad.ok, false); assert.equal(bad.detail.fails.length, 2);
  await put(ws, 'code/main.py', 'T1 = 1\na.b = 3\n');
  for (const explanation of [[], {}, true, 12, '', '  ']) {
    contract.equivalence_claims[0].explanation = explanation;
    assert.equal((await logic(ws, contract, {}, { a: 10, b: 20 })).ok, false);
  }
  contract.equivalence_claims[0].explanation = 'The approximation excludes fixed costs.';
  const good = await logic(ws, contract, {}, { a: 10, b: 20 });
  assert.equal(good.ok, true); assert.equal(good.detail.warns.length, 1);
  await put(ws, 'code/main.py', '前T1后 = 1\naXb = 2\n');
  assert.equal((await logic(ws, contract, {}, { a: 10, b: 10 })).ok, false);
});

async function paperCheckFixture(t) {
  const ws = await fixture(t);
  await state(ws, { validation_mode: 'strict' });
  await put(ws, 'PAPER_DATA_CHECK_REPORT.md', '# Report\n## 结论\n通过');
  await put(ws, 'PAPER_DATA_CHECKLIST.md', '# Checked source values');
  await put(ws, 'paper/main.tex', '% DATA_CHECK_PASSED\n' + tex('\\input{sections/body}'));
  await put(ws, 'paper/sections/body.tex', 'Cost is 12.');
  await put(ws, 'paper/main.md', 'Cost is 12.');
  await put(ws, 'figures/deep/table.tex', '\\begin{tabular}{l}12\\end{tabular}');
  await put(ws, 'figures/deep/data.json', { cost: 12 });
  await put(ws, 'figures/plan.md', 'Plan');
  await put(ws, 'results.json', { cost: 12 });
  await put(ws, 'all_results.json', { total: 12 });
  return ws;
}
async function stamp(ws, overrides = {}) {
  await put(ws, 'PAPER_DATA_CHECK_RESULT.json', { version: 1, status: 'passed', mode: 'pdf', inputs: await paperDataInputs(ws), ...overrides });
}

test('F05 old marker/reports require rerun; only fresh version-1 passed JSON passes', async (t) => {
  const ws = await paperCheckFixture(t);
  const old = await gatePaperDataCheck(ws, {});
  assert.equal(old.ok, false); assert.match(old.hint, /重跑/);
  await stamp(ws); assert.equal((await gatePaperDataCheck(ws, {})).ok, true);
  for (const status of ['failed', 'unavailable', 'unknown']) {
    await stamp(ws, { status }); assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  }
  await stamp(ws, { version: 2 }); assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await stamp(ws, { mode: 'unknown' }); assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await stamp(ws);
  await put(ws, 'results.json', {});
  const stale = await gatePaperDataCheck(ws, {});
  assert.equal(stale.ok, false); assert.match(stale.hint, /快照过期/);
  await state(ws, { validation_mode: 'fast' }); assert.equal((await gatePaperDataCheck(ws, {})).code, 2);
});

test('F05 snapshot is sorted raw-byte hashes of the entire specified recursive input set', async (t) => {
  const ws = await paperCheckFixture(t);
  await put(ws, 'paper/unused/deep/draft.tex', Buffer.from([0xff, 13, 10, 37]));
  await put(ws, 'figures/deep/TABLE_DATA_CHECK_old.json', 'excluded');
  await put(ws, 'figures/ignore.txt', 'excluded');
  const expected = ['all_results.json', 'figures/deep/data.json', 'figures/deep/table.tex', 'figures/plan.md', 'paper/main.md', 'paper/main.tex', 'paper/sections/body.tex', 'paper/unused/deep/draft.tex', 'results.json'];
  const snapshot = await paperDataInputs(ws);
  assert.deepEqual(snapshot.map((item) => item.path), expected);
  for (const input of snapshot) assert.equal(input.sha256, hash(await readFile(path.join(ws, input.path))));
  for (const rel of expected) {
    await stamp(ws);
    const bytes = await readFile(path.join(ws, rel));
    await put(ws, rel, Buffer.concat([bytes, Buffer.from(' ')]));
    assert.equal((await gatePaperDataCheck(ws, {})).ok, false, rel);
  }
  await stamp(ws);
  await put(ws, 'figures/deep/TABLE_DATA_CHECK_old.json', 'changed but excluded');
  await put(ws, 'PAPER_DATA_CHECK_RESULT.json', { version: 1, status: 'passed', mode: 'pdf', inputs: await paperDataInputs(ws), extra: 'result file is not an input' });
  assert.equal((await gatePaperDataCheck(ws, {})).ok, true);
  await put(ws, 'paper/new.tex', 'new file'); assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await stamp(ws);
  // Verify omission and input ordering cannot disguise an incomplete snapshot.
  const current = await paperDataInputs(ws);
  await stamp(ws, { inputs: current.slice(1) }); assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await stamp(ws, { inputs: [...current].reverse() }); assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
});

test('F05 final compile revalidates fresh snapshots and stamp must follow the marker', async (t) => {
  const ws = await paperCheckFixture(t);
  const doc = await PDFDocument.create(); doc.addPage(); await put(ws, 'paper/main.pdf', await doc.save());
  await stamp(ws);
  assert.equal((await runGates(ws, { key: 'comp-compile-zh', gates: [] })).ok, true);
  await put(ws, 'paper/sections/body.tex', 'Compilation preprocessing changed the body.');
  assert.equal((await runGates(ws, { key: 'comp-compile-zh', gates: [] })).ok, false);
  await put(ws, 'paper/main.tex', tex('Body without marker.')); await stamp(ws);
  assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await put(ws, 'paper/main.tex', '% DATA_CHECK_PASSED\n' + tex('Body without marker.'));
  assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await stamp(ws); assert.equal((await gatePaperDataCheck(ws, {})).ok, true);
  await put(ws, 'paper/\ue000.tex', 'high BMP'); await put(ws, 'paper/😀.tex', 'astral');
  const paths = (await paperDataInputs(ws)).map((item) => item.path);
  assert.ok(paths.indexOf('paper/😀.tex') < paths.indexOf('paper/\ue000.tex'));
});

test('F06 every competition parses actual PDF; validity and page limit are independent', async (t) => {
  const ws = await fixture(t);
  const doc = await PDFDocument.create(); doc.addPage();
  const valid = await doc.save();
  for (const competition of Object.keys(COMPETITIONS)) {
    await state(ws, { competition });
    await put(ws, 'paper/main.pdf', valid); assert.equal((await gatePdfPages(ws)).ok, true, competition);
    await put(ws, 'paper/main.pdf', 'x'.repeat(54000)); assert.equal((await gatePdfPages(ws)).ok, false, competition);
  }
  await state(ws, { competition: 'cumcm' });
  assert.equal((await runGates(ws, { key: 'comp-compile-zh', gates: [] })).ok, false);
  await put(ws, 'paper/main.pdf', await (await PDFDocument.create()).save({ addDefaultPage: false }));
  assert.equal((await gatePdfPages(ws)).ok, false);
  const large = await PDFDocument.create(); for (let i = 0; i < 26; i++) large.addPage();
  await put(ws, 'paper/main.pdf', await large.save());
  assert.equal((await gatePdfPages(ws)).ok, true);
  await state(ws, { competition: 'mcm' }); assert.equal((await gatePdfPages(ws)).ok, false);
});

test('F08 merges all root manifests, all blocks, checkbox/table rows, later-stage category overrides', async (t) => {
  const ws = await fixture(t);
  await put(ws, 'PROBLEM_ANALYSIS.md', manifest('**数据图**\n- fig_base\n- fig_move'));
  await put(ws, 'TOPIC.md', manifest('**数据图**\n- [ ] `fig_topic`'));
  await put(ws, 'CUSTOM.md', manifest('**数据图**\nfig_custom'));
  await put(ws, 'PAPER_PLAN.md', manifest('**数据图**\n- fig_plan'));
  await put(ws, 'MODELING_REPORT.md', manifest('**数据图（HTML optional）**\n- fig_new\n**总数: TIKZ=0**\n- fig_after_total') + '\n' + manifest('**DrawIO**\n- fig_move\n**表格**\n| TABLE_cost | data |'));
  const merged = await mergeFigureManifests(ws);
  assert.deepEqual(merged.sources, ['PROBLEM_ANALYSIS.md', 'TOPIC.md', 'CUSTOM.md', 'PAPER_PLAN.md', 'MODELING_REPORT.md']);
  assert.deepEqual(merged.groups.DATA, ['fig_base', 'fig_topic', 'fig_custom', 'fig_plan', 'fig_new', 'fig_after_total']);
  assert.deepEqual(merged.groups.DRAWIO, ['fig_move']); assert.deepEqual(merged.groups.TABLE, ['TABLE_cost']);
  // Python's merger preserves the heading category even for a TABLE row. It still is not an image.
  await put(ws, 'RESULTS.md', manifest('**数据图**\n| TABLE_other | value |'));
  await put(ws, 'figures/TABLE_other.pdf', 'pdf');
  await put(ws, 'figures/fig_base.pdf', 'pdf');
  const missing = await gateFigures(ws, dataStep);
  assert.equal(missing.ok, false); assert.equal(missing.detail.planned, 6); assert.equal(missing.detail.missing.length, 5);
  for (const name of merged.groups.DATA) await put(ws, `figures/${name}.png`, 'png');
  assert.equal((await gateFigures(ws, dataStep)).ok, true);
  assert.equal((await gateFigures(ws, drawStep)).ok, false);
  await put(ws, 'figures/fig_move.drawio', '<mxfile/>'); await put(ws, 'figures/fig_move.pdf', 'pdf');
  assert.equal((await gateFigures(ws, drawStep)).ok, true);
});

test('F08 same-stage manifests use mtime then lowercase name, and category spellings stay compatible', async (t) => {
  const ws = await fixture(t);
  await put(ws, 'A_PLAN.md', manifest('**数据图**\n- fig_duplicate'));
  await put(ws, 'Z_PLAN.md', manifest('**流程图**\n- fig_duplicate'));
  await utimes(path.join(ws, 'A_PLAN.md'), 10, 10); await utimes(path.join(ws, 'Z_PLAN.md'), 10, 10);
  assert.deepEqual((await mergeFigureManifests(ws)).groups.DRAWIO, ['fig_duplicate']);
  await utimes(path.join(ws, 'A_PLAN.md'), 20, 20);
  assert.deepEqual((await mergeFigureManifests(ws)).groups.DATA, ['fig_duplicate']);
  for (const [heading, kind] of [['流程图', 'DRAWIO'], ['概念图', 'GPTIMG'], ['机理示意图', 'GPTIMG'], ['逐问流程图（HTML）', 'DRAWIO'], ['逐问流程图（GPT Image）', 'GPTIMG'], ['TikZ 模型', 'TIKZ'], ['数据图（HTML）', 'DATA']]) {
    assert.equal(figureCategory(heading), kind, heading);
    assert.deepEqual(parseFigureManifest(manifest(`**${heading}**\n- fig_one`))[kind], ['fig_one']);
  }
});

async function fallbackFixture(t, engine = 'drawio') {
  const ws = await fixture(t);
  await put(ws, 'PROBLEM_ANALYSIS.md', manifest('**数据图**\n- fig_data\n**GPT Image**\n- fig_scene'));
  await put(ws, 'figures/fig_data.pdf', 'pdf');
  await put(ws, 'figures/_gptimg_status.txt', 'ALL_FAILED\n');
  await put(ws, 'figures/_gptimg_failed.txt', 'fig_scene\n');
  await state(ws, { flowchart_engine: engine }, [{ ...dataStep, status: 'running' }, { ...(engine === 'html' ? htmlStep : drawStep), status: 'pending' }]);
  return ws;
}

test('F09 failed GPT is transferred only to a real later step; receiver owes source and PDF', async (t) => {
  imageKey(t, 'configured-but-failed');
  const ws = await fallbackFixture(t);
  const handoff = await gateFigures(ws, dataStep);
  assert.equal(handoff.ok, true); assert.deepEqual(handoff.detail.gptImgTransferred, ['fig_scene']);
  const absent = await gateFigures(ws, drawStep);
  assert.equal(absent.ok, false); assert.deepEqual(absent.detail.missing, ['fig_scene']);
  await put(ws, 'figures/fig_scene.pdf', 'pdf');
  assert.equal((await gateFigures(ws, drawStep)).ok, false);
  await put(ws, 'figures/fig_scene.html', '<html/>');
  assert.equal((await gateFigures(ws, drawStep)).ok, false);
  await put(ws, 'figures/fig_scene.drawio', '<mxfile/>');
  assert.equal((await gateFigures(ws, drawStep)).ok, true);
});

test('F09 failed evidence takes priority even without a key; skip/no-state cannot silently defer', async (t) => {
  imageKey(t, null);
  const ws = await fallbackFixture(t, 'html');
  assert.equal((await gateFigures(ws, dataStep)).ok, true);
  assert.equal((await gateFigures(ws, htmlStep)).ok, false);
  for (const [switches, steps] of [[{ skip_drawio: true }, [dataStep, htmlStep]], [{}, [htmlStep, dataStep]], [{}, [dataStep]], [{}, []]]) {
    await state(ws, switches, steps);
    const failure = await gateFigures(ws, dataStep); assert.equal(failure.ok, false); assert.match(failure.hint, /没有可移交/);
  }
  await put(ws, 'figures/fig_scene.html', '<html/>'); await put(ws, 'figures/fig_scene.pdf', 'pdf');
  assert.equal((await gateFigures(ws, dataStep)).ok, true);
  assert.equal((await gateFigures(ws, htmlStep)).ok, true);
});

test('F09 incomplete/contradictory status fails; optional no-key illustrations remain compatible', async (t) => {
  imageKey(t, null);
  const ws = await fallbackFixture(t);
  await put(ws, 'figures/_gptimg_failed.txt', '');
  assert.equal((await gateFigures(ws, dataStep)).ok, false);
  await put(ws, 'figures/_gptimg_failed.txt', 'fig_unknown');
  assert.equal((await gateFigures(ws, dataStep)).ok, false);
  await put(ws, 'figures/_gptimg_status.txt', 'ALL_SUCCESS');
  assert.equal((await gateFigures(ws, dataStep)).ok, false);
  await put(ws, 'figures/_gptimg_failed.txt', '');
  const skipped = await gateFigures(ws, dataStep);
  assert.equal(skipped.ok, true); assert.deepEqual(skipped.detail.gptImgSkipped, ['fig_scene']);
});

test('F09 partial failures transfer only failed items and successful GPT items remain required', async (t) => {
  imageKey(t, 'key');
  const ws = await fallbackFixture(t, 'html');
  await put(ws, 'PROBLEM_ANALYSIS.md', manifest('**数据图**\n- fig_data\n**GPT Image**\n- fig_scene\n- fig_success'));
  await put(ws, 'figures/_gptimg_status.txt', 'SOME_FAILED');
  const missingSuccess = await gateFigures(ws, dataStep);
  assert.equal(missingSuccess.ok, false); assert.deepEqual(missingSuccess.detail.missing, ['fig_success']);
  await put(ws, 'figures/fig_success.png', 'png');
  assert.equal((await gateFigures(ws, dataStep)).ok, true);
  await put(ws, 'figures/fig_scene.drawio', '<mxfile/>'); await put(ws, 'figures/fig_scene.pdf', 'pdf');
  assert.equal((await gateFigures(ws, htmlStep)).ok, false);
  await put(ws, 'figures/fig_scene.html', '<html/>'); assert.equal((await gateFigures(ws, htmlStep)).ok, true);
  await state(ws, { flowchart_engine: 'html' }, [{ ...dataStep, status: 'running' }, { ...htmlStep, status: 'completed' }]);
  const recheck = await gateFigures(ws, dataStep); assert.equal(recheck.ok, true); assert.deepEqual(recheck.detail.gptImgTransferred, []);
});

test('F14 explicit minimum counts distinct delivered DATA items only and also gates skipped figure workflows', async (t) => {
  const ws = await fixture(t);
  await state(ws, { min_figures: 2 });
  await put(ws, 'PROBLEM_ANALYSIS.md', manifest('**数据图**\n- fig_data1\n- fig_data2\n| TABLE_misplaced | value |\n**GPT Image**\n- fig_concept\n**表格**\n- TABLE_cost\n**流程图**\n- fig_flow'));
  for (const name of ['fig_data1', 'fig_concept', 'fig_flow', 'TABLE_cost', 'TABLE_misplaced']) await put(ws, `figures/${name}.pdf`, 'pdf');
  await put(ws, 'figures/fig_data1.png', 'png'); await put(ws, 'figures/fig_unplanned.pdf', 'pdf');
  assert.equal((await gateFigureMinimum(ws)).ok, false);
  assert.equal((await runGates(ws, { key: 'comp-paper-zh', gates: [] })).ok, false);
  await put(ws, 'figures/fig_data2.pdf', ''); assert.equal((await gateFigureMinimum(ws)).ok, false);
  await put(ws, 'figures/fig_data2.pdf', 'pdf'); assert.equal((await gateFigureMinimum(ws)).ok, true);
  assert.equal((await runGates(ws, { key: 'comp-paper-zh', gates: [] })).ok, true);
  await state(ws, { min_figures: '3' }); assert.equal((await gateFigures(ws, dataStep)).ok, false);
  await state(ws, { min_figures: 'auto' }); assert.equal(await gateFigureMinimum(ws), null);
  const empty = await fixture(t); await state(empty, { min_figures: 1 }); assert.equal((await gateFigures(empty, dataStep)).ok, false);
});

test('F17 disk-only/commented/after-end AI details do not count; indirect input/include does', async (t) => {
  const ws = await fixture(t);
  await put(ws, 'CLAUDE.md', 'MMW_AI_DISCLOSURE=used');
  await put(ws, 'paper/sections/Z_ai_disclosure.tex', '\\section*{AI 工具使用声明}\n辅助用途。');
  await put(ws, 'paper/appendix/B_ai_detail.tex', '\\section{AI 工具使用详情}\n' + tables());
  await put(ws, 'paper/main.tex', tex('\\input{sections/Z_ai_disclosure}\n% \\input{appendix/B_ai_detail}') + '\\input{appendix/B_ai_detail}');
  assert.equal((await gateAiDisclosure(ws)).ok, false);
  await put(ws, 'paper/sections/wrapper.tex', '\\include{appendix/B_ai_detail}');
  await put(ws, 'paper/main.tex', tex('\\include{sections/Z_ai_disclosure}\n\\input{sections/wrapper}'));
  const good = await gateAiDisclosure(ws); assert.equal(good.ok, true); assert.equal(good.detail.tables, 4);
  await put(ws, 'paper/appendix/B_ai_detail.tex', tables(3) + '\n' + tables().split('\n').map((line) => '% ' + line).join('\n'));
  assert.equal((await gateAiDisclosure(ws)).ok, false);
});

test('F17 legal inline details and none declaration pass without fixed files; unrelated body tables cannot count', async (t) => {
  const ws = await fixture(t);
  await put(ws, 'CLAUDE.md', 'MMW_AI_DISCLOSURE=used');
  await put(ws, 'paper/main.tex', tex(tables() + '\\section*{AI 工具使用声明}辅助用途。'));
  assert.equal((await gateAiDisclosure(ws)).ok, false);
  await put(ws, 'paper/main.tex', tex('\\section*{AI Tool Usage Statement}Auxiliary use.\n\\appendix\n\\section{AI Tool Usage Details}\n' + tables()));
  assert.equal((await gateAiDisclosure(ws)).ok, true);
  await put(ws, 'CLAUDE.md', 'MMW_AI_DISCLOSURE=none');
  await put(ws, 'paper/main.tex', tex('\\section*{AI 工具使用声明}未使用 AI 工具。'));
  assert.equal((await gateAiDisclosure(ws)).ok, true);
  await put(ws, 'CLAUDE.md', ''); assert.equal((await gateAiDisclosure(ws)).ok, false);
});

test('F21 only actual body input/include chain counts, strips comments, preserves escaped percent', async (t) => {
  const ws = await fixture(t);
  await state(ws, { max_pages: 1 });
  await put(ws, 'paper/main.tex', tex('\\input{sections/body}\n% \\input{sections/unused}'));
  await put(ws, 'paper/sections/body.tex', '正文\n% ' + '注释'.repeat(10000) + '\n' + '% more comments\n'.repeat(10000) + '结束');
  await put(ws, 'paper/sections/unused.tex', '未引用'.repeat(10000));
  const short = await gatePages(ws, {}); assert.equal(short.ok, false); assert.ok(short.detail.chars < 20);
  await put(ws, 'paper/sections/body.tex', '\\include{sections/real}\n\\bibliography{references}\n' + '文献之后'.repeat(10000));
  await put(ws, 'paper/sections/real.tex', '正文'.repeat(400));
  const enough = await gatePages(ws, {}); assert.equal(enough.ok, true); assert.ok(enough.detail.chars < 900);
  assert.ok(!enough.detail.skippedNonBody.includes('sections/unused.tex'));
  assert.equal(stripTexComments('93\\% is retained % comment\nnext'), '93\\% is retained \nnext');
  assert.equal(stripTexComments('a\\\\% comment\nb'), 'a\\\\\nb');
});

test('F21 main-inline body excludes preamble, abstract, TOC, bibliography and appendix; input errors fail closed', async (t) => {
  const ws = await fixture(t);
  await state(ws, { max_pages: 1, language: 'en' });
  await put(ws, 'paper/main.tex', '\\title{' + 'p'.repeat(10000) + '}\n' + tex('\\begin{abstract}' + 'a'.repeat(10000) + '\\end{abstract}\n\\tableofcontents\n' + 'b'.repeat(1800) + '\\begin{thebibliography}{9}' + 'r'.repeat(10000) + '\\end{thebibliography}\n\\appendix\n' + 'x'.repeat(10000)));
  const good = await gatePages(ws, {}); assert.equal(good.ok, true); assert.equal(good.detail.chars, 1800);
  await put(ws, 'paper/main.tex', tex('\\input{sections/missing}'));
  assert.equal((await gatePages(ws, {})).ok, false);
  await put(ws, 'paper/sections/missing.tex', '\\input{sections/missing}');
  assert.equal((await gatePages(ws, {})).ok, false);
  await put(ws, 'paper/main.tex', tex('\\input{\\dynamic}')); assert.equal((await gatePages(ws, {})).ok, false);
});

test('F17/F21 literal code cannot create inputs, document boundaries, declarations or tables', async (t) => {
  const ws = await fixture(t);
  await state(ws, { max_pages: 1 });
  await put(ws, 'CLAUDE.md', 'MMW_AI_DISCLOSURE=used');
  await put(ws, 'paper/sections/Z_ai_disclosure.tex', '\\section*{AI 工具使用声明}声明。');
  await put(ws, 'paper/appendix/B_ai_detail.tex', '\\section{AI 工具使用详情}\n' + tables());
  const examples = [
    ...['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment'].map((env) => `\\begin{${env}}\n% literal percent\n\\input{missing}\n\\input{appendix/B_ai_detail}\n\\end{document}\n\\end{${env}}`),
    '\\verb|\\input{missing}| \\verb*%\\input{appendix/B_ai_detail}%',
    '\\lstinline[language=Python]|\\input{missing}| \\lstinline{\\input{appendix/B_ai_detail}}',
  ];
  for (const example of examples) {
    await put(ws, 'paper/main.tex', tex('正文'.repeat(400) + '\n' + example + '\n\\input{sections/Z_ai_disclosure}'));
    const chain = await readTexInputs(ws);
    assert.deepEqual(chain.errors, []); assert.equal(chain.files.has('paper/appendix/B_ai_detail.tex'), false);
    assert.equal((await gatePages(ws, {})).ok, true, example);
    assert.equal((await gateAiDisclosure(ws)).ok, false, example);
  }
  await put(ws, 'data/after.txt', 'Input after inline code remains reachable.');
  for (const inline of ['\\lstinline*1*', '\\lstinline*!*', '\\lstinline*1\\input{missing}*', '\\lstinline[language=Python]*!\\input{missing}*']) {
    await put(ws, 'paper/main.tex', tex(inline + '\n\\input{../data/after.txt}'));
    const chain = await readTexInputs(ws);
    assert.deepEqual(chain.errors, [], inline);
    assert.equal(chain.files.has('data/after.txt'), true, inline);
    assert.match(chain.text, /Input after inline code remains reachable\./, inline);
    const snapshot = await paperDataInputs(ws);
    assert.deepEqual(snapshot.map((input) => input.path), ['data/after.txt', 'paper/appendix/B_ai_detail.tex', 'paper/main.tex', 'paper/sections/Z_ai_disclosure.tex'], inline);
    assert.equal(snapshot[0].sha256, hash(await readFile(path.join(ws, 'data/after.txt'))), inline);
  }
  await put(ws, 'paper/main.tex', tex('% \\begin{verbatim}\n\\input{sections/Z_ai_disclosure}\n\\input{appendix/B_ai_detail}'));
  assert.equal((await gateAiDisclosure(ws)).ok, true);
  await put(ws, 'paper/main.tex', tex('正文'.repeat(400) + '\n\\input{sections/A_code}'));
  await put(ws, 'paper/sections/A_code.tex', 'Appendix example: \\input{missing}');
  assert.equal((await gatePages(ws, {})).ok, true);
});

test('F05 snapshot includes main-reachable inputs outside standard directories and rejects broken chains', async (t) => {
  const ws = await paperCheckFixture(t);
  await put(ws, 'paper/main.tex', '% DATA_CHECK_PASSED\n' + tex('\\input{sections/body}\n\\input{../data/result.txt}'));
  await put(ws, 'data/result.txt', 'External table cost is 12.');
  await stamp(ws);
  assert.ok((await paperDataInputs(ws)).some((input) => input.path === 'data/result.txt'));
  assert.equal((await gatePaperDataCheck(ws, {})).ok, true);
  await put(ws, 'data/result.txt', 'External table cost is 99.');
  assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await stamp(ws);
  await put(ws, 'paper/main.tex', '% DATA_CHECK_PASSED\n' + tex('\\input{missing}'));
  assert.equal((await gatePaperDataCheck(ws, {})).ok, false);
  await assert.rejects(() => paperDataInputs(ws), /missing input/);
  await put(ws, 'paper/main.tex', '% DATA_CHECK_PASSED\n' + tex('\\input{\\dynamic}'));
  await assert.rejects(() => paperDataInputs(ws), /dynamic input/);
});

test('TeX includeonly and nested paths follow main compile directory, not directory enumeration', async (t) => {
  const ws = await fixture(t);
  await put(ws, 'paper/main.tex', '\\includeonly{sections/a}\n' + tex('\\include{sections/a}\n\\include{sections/b}'));
  await put(ws, 'paper/sections/a.tex', '\\input{sections/leaf}');
  await put(ws, 'paper/sections/leaf.tex', 'reachable');
  const chain = await readTexInputs(ws);
  assert.deepEqual(chain.errors, []); assert.match(chain.text, /reachable/); assert.equal(chain.files.has('paper/sections/b.tex'), false);
});
