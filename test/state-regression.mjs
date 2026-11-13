// Behavioral regressions for workflow ordering, skip semantics and persisted decisions.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';
import { refreshBundledChecks } from '../lib/scaffold.js';
import { normalizeSwitches, COMPETITIONS } from '../lib/switches.js';
import { resolveSteps } from '../lib/steps.js';
import { readState, writeState, nextPendingStep, progressOf } from '../lib/state.js';
import { buildClaudeMd, buildEnvSkill } from '../lib/claudeMd.js';
import { buildStepPrompt } from '../lib/prompt.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'mmw-state-regression-'));
const tools = new Map();
const dispose = apply({
  tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } },
  systemPrompt: { section() { return () => {}; } },
  workingDirectory: { ensure: async () => root },
});
const exec = { agent: { id: 'regression' }, signal: new AbortController().signal };
const call = (name, args) => tools.get(name).execute(args, exec);
let assertions = 0;
function pass(name) { assertions++; console.log('PASS ' + name); }
async function workspace(name, input = {}, legacyReview = false) {
  const ws = path.join(root, name);
  await mkdir(ws, { recursive: true });
  const switches = normalizeSwitches(input).switches;
  const steps = resolveSteps(legacyReview ? { ...switches, validation_mode: 'strict' } : switches).map((s) => ({
    ...s, companions: s.companions ?? [], status: 'pending', attempts: 0,
    promptPath: `_steps/${s.key}/prompt.md`, dir: `_steps/${s.key}`,
  }));
  await writeState(ws, { version: 1, title: name, workspace: name, switches, explicitSwitches: input, inputFiles: [], steps });
  return ws;
}
try {
  const strict = normalizeSwitches({}).switches;
  const fast = normalizeSwitches({ validation_mode: 'fast' }).switches;
  assert.equal(resolveSteps(strict).length, 8);
  assert.equal(resolveSteps(fast).length, 7);
  assert.equal(resolveSteps(fast).some(s => s.key === 'comp-review'), false);
  pass('new fast workflows do not dispatch adversarial review');

  const ordered = await workspace('ordering');
  await assert.rejects(call('modeling_finish', { workspace: ordered, step: 'comp-compile-zh' }), /不能越过/);
  await writeFile(path.join(ordered, 'PROBLEM_ANALYSIS.md'), 'analysis'.repeat(300));
  await assert.rejects(call('modeling_finish', { workspace: ordered }), /尚未派发/);
  await assert.rejects(call('modeling_ask', { workspace: ordered, question: 'premature' }), /已派发/);
  await call('modeling_next', { workspace: ordered });
  const result = await call('modeling_finish', { workspace: ordered });
  assert.equal(result.pass, true);
  assert.equal((await readState(ordered)).steps[0].status, 'completed');
  assert.equal((await call('modeling_finish', { workspace: ordered, step: 'comp-prob-analysis' })).pass, true);
  pass('only the current dispatched step can be accepted; completed calls stay idempotent');

  const legacy = await workspace('legacy-next', { validation_mode: 'fast' }, true);
  let state = await readState(legacy);
  const ri = state.steps.findIndex(s => s.key === 'comp-review');
  state.steps.slice(0, ri).forEach(s => { s.status = 'completed'; });
  await writeState(legacy, state);
  const next = await call('modeling_next', { workspace: legacy });
  state = await readState(legacy);
  assert.equal(state.steps[ri].status, 'skipped');
  assert.equal(state.steps[ri].lastGate.skipped, true);
  assert.equal(next.step.key, 'comp-paper-zh');
  assert.equal(progressOf(state).done, ri + 1);
  await assert.rejects(readFile(path.join(legacy, 'COMP_REVIEW_VERDICT.json')), /ENOENT/);
  pass('legacy fast review skips without fabricating a zero-findings verdict');

  const legacyFinish = await workspace('legacy-finish', { validation_mode: 'fast' }, true);
  state = await readState(legacyFinish);
  const review = state.steps.findIndex(s => s.key === 'comp-review');
  state.steps.slice(0, review).forEach(s => { s.status = 'completed'; });
  state.steps[review].status = 'waiting';
  state.questions = [{ id: 'old-q', step: 'comp-review', status: 'open', question: 'old pending question' }];
  await writeState(legacyFinish, state);
  const skipped = await call('modeling_finish', { workspace: legacyFinish, step: 'comp-review' });
  state = await readState(legacyFinish);
  assert.equal(skipped.skipped, true);
  assert.equal(state.questions[0].status, 'cancelled');
  assert.equal((await call('modeling_finish', { workspace: legacyFinish, step: 'comp-review' })).skipped, true);
  pass('legacy fast finish explicitly archives obsolete questions and is idempotent');

  const questions = await workspace('decisions');
  await call('modeling_next', { workspace: questions });
  const q1 = await call('modeling_ask', { workspace: questions, question: 'Which label?' });
  const q2 = await call('modeling_ask', { workspace: questions, question: 'Which split?' });
  await assert.rejects(call('modeling_answer', { workspace: questions, answer: 'ambiguous' }), /question_id/);
  await assert.rejects(call('modeling_answer', { workspace: questions, question_id: q1.question_id, answer: '  ' }), /不能为空/);
  assert.equal((await readState(questions)).questions.filter(q => q.status === 'open').length, 2);
  await call('modeling_answer', { workspace: questions, question_id: q1.question_id, answer: 'LABEL_COLUMN_719' });
  assert.equal((await readState(questions)).steps[0].status, 'waiting');
  assert.equal((await call('modeling_next', { workspace: questions })).waiting, true);
  await call('modeling_answer', { workspace: questions, question_id: q2.question_id, answer: 'TIME_SPLIT_719' });
  assert.equal((await readState(questions)).steps[0].status, 'running');
  const resumed = await call('modeling_next', { workspace: questions });
  const prompt = await readFile(resumed.promptPath, 'utf8');
  assert.ok(prompt.includes('LABEL_COLUMN_719') && prompt.includes('TIME_SPLIT_719'));
  state = await readState(questions);
  const later = await buildStepPrompt({ workspace: questions, state, step: state.steps[1], skillBody: '', index: 1, total: state.steps.length });
  assert.ok(later.includes('LABEL_COLUMN_719') && later.includes('TIME_SPLIT_719'));
  pass('answers require unambiguous IDs and survive both re-dispatch and downstream steps');

  const inconsistent = { steps: [{ key: 'first', status: 'pending' }, { key: 'later', status: 'waiting' }] };
  assert.equal(nextPendingStep(inconsistent).key, 'first');
  pass('later waiting states cannot override dependency order');

  const title = await workspace('old-title');
  await call('modeling_switches', { workspace: title, switches: { title: 'New project title', min_figures: 40, min_tables: 7, min_models: 3 } });
  state = await readState(title);
  assert.equal(state.title, 'New project title');
  assert.ok((await readFile(path.join(title, 'CLAUDE.md'), 'utf8')).startsWith('# 研究项目: New project title'));
  const env = await readFile(path.join(title, '.env_skill'), 'utf8');
  assert.ok(env.includes('export MIN_FIGURES=40') && env.includes('export MIN_TABLES=7') && env.includes('export MIN_MODELS=3'));
  assert.ok(buildEnvSkill(strict).includes('export MIN_FIGURES=0'));
  const titled = await call('modeling_next', { workspace: title });
  assert.ok((await readFile(titled.promptPath, 'utf8')).includes('New project title'));
  pass('title updates and explicit numerical requirements reach generated files and prompts');

  const migration = await workspace('helper-migration', { min_figures: 12 });
  const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const assets = path.join(repo, 'assets');
  await mkdir(path.join(migration, '_utils'));
  const oldEnv = buildEnvSkill((await readState(migration)).switches).split('\n').filter(l => !l.startsWith('export MIN_')).join('\n') + 'export CUSTOM_LOCAL=kept\n';
  await writeFile(path.join(migration, '.env_skill'), oldEnv);
  const custom = '# local custom logic checker: keep unchanged\n';
  await writeFile(path.join(migration, '_utils', 'logic_audit.py'), custom);
  // Released baseline content is loaded from git, never a path in a live user workspace.
  const oldPaper = execFileSync('git', ['show', 'e0dca93:assets/utils/paper_data_check.py'], { cwd: repo, encoding: 'utf8' });
  await writeFile(path.join(migration, '_utils', 'paper_data_check.py'), oldPaper);
  await refreshBundledChecks(migration, assets);
  assert.equal(await readFile(path.join(migration, '_utils', 'paper_data_check.py'), 'utf8'), await readFile(path.join(assets, 'utils', 'paper_data_check.py'), 'utf8'));
  assert.equal(await readFile(path.join(migration, '_utils', 'logic_audit.py'), 'utf8'), custom);
  const upgradedEnv = await readFile(path.join(migration, '.env_skill'), 'utf8');
  assert.ok(upgradedEnv.includes('export MIN_FIGURES=12') && upgradedEnv.includes('export CUSTOM_LOCAL=kept'));
  await refreshBundledChecks(migration, assets);
  assert.equal((await readFile(path.join(migration, '.env_skill'), 'utf8')).match(/export MIN_FIGURES=/g).length, 1);
  pass('legacy stock helpers upgrade by fingerprint while custom helpers and environment additions survive');

  for (const competition of Object.keys(COMPETITIONS)) {
    const sw = normalizeSwitches({ competition, rich_mode: true }).switches;
    const md = buildClaudeMd({ switches: sw, steps: resolveSteps(sw), title: 'rich' });
    if (!COMPETITIONS[competition].pageLimit) assert.ok(!md.includes('不超过 30 页'));
    else assert.ok(md.includes('总页数硬上限: 25 页'));
    if (sw.language === 'zh') assert.ok(sw.max_pages >= 40);
  }
  pass('rich-mode rules do not impose contradictory unverified 30-page total caps');

  const pstate = { ...state, questions: [], switches: strict, steps: resolveSteps(strict) };
  for (const step of pstate.steps) {
    const p = await buildStepPrompt({ workspace: title, state: pstate, step, skillBody: '', index: step.order, total: pstate.steps.length });
    if (step.key === 'comp-review' || step.key.startsWith('comp-compile')) {
      assert.ok(p.includes('本步获准修复'));
      assert.ok(!p.includes('## 上游产物（只读'));
    } else assert.ok(p.includes('本步只读上游产物'));
  }
  pass('review and compile have explicit repair scopes while ordinary steps remain read-only');
  console.log(`STATE REGRESSIONS PASS (${assertions} groups)`);
} finally {
  dispose();
  // root comes only from mkdtemp above; cleanup never targets repository or user input.
  await rm(root, { recursive: true, force: true });
}
