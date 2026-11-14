// Real isolated DSH Host compatibility test. Does not launch UI or call an LLM.
// Install the public exact-version DSH packages in an ordinary disposable npm project.
// MMW_DSH_ROOT=<that project> MMW_PLUGIN_ROOT=<clean plugin checkout> MMW_PYTHON=<python>
// node test/dsh-host-compat.mjs
// Output and deterministic fixtures remain under MMW_HOST_RESULTS_DIR (default <DSH root>/host-results).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(process.env.MMW_DSH_ROOT ?? process.cwd());
const pluginRoot = path.resolve(process.env.MMW_PLUGIN_ROOT ?? path.join(here, '..'));
const expectedVersion = process.env.MMW_DSH_VERSION ?? '0.2.2-rc.3';
const python = process.env.MMW_PYTHON;
assert.ok(python, 'MMW_PYTHON must name a Python 3 executable (no packages or LLM needed)');
assert.ok(existsSync(path.join(pluginRoot, 'index.js')), 'MMW_PLUGIN_ROOT must identify the clean plugin package');
const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json'));
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const outRoot = path.resolve(process.env.MMW_HOST_RESULTS_DIR ?? path.join(runtimeRoot, 'host-results'));
await mkdir(outRoot, { recursive: true });
const fixtureRoot = await mkdtemp(path.join(outRoot, 'fixture-'));
const reportPath = path.join(fixtureRoot, 'host-result.json');
const callsPath = path.join(fixtureRoot, 'tool-calls.json');
const report = { expectedVersion, runtimeRoot, pluginRoot, fixtureRoot, node: process.version,
  versions: {}, mounted: [], checks: [], commands: [], strictGates: [],
  boundaries: ['Real Cordis Context, ToolsService, SystemPrompt, LocalFileSystem, SessionStore, SessionProjectionRegistry, WorkingDirectoryService and NativeToolExecutor.',
    'Minimal Agent carrier uses an actual Session and a real active Cordis context; no Agent loop or model provider is mounted.',
    'All modeling actions run through ctx.tools.execute and the real native schema/policy/output pipeline.',
    'Artifacts are deterministic synthetic fixtures. Python paper_data_check is run for real; PDF is generated with pdf-lib, not TeX.',
    'No Desktop/Web UI end-to-end verification; no server started; no profile or system install modified; no LLM or image requests.',
    'Only a clean plugin tree is supported: never point MMW_PLUGIN_ROOT at a checkout containing user image credentials.'] };
const calls = [];
let ctx;
let fiber;
let count = 0;
const check = (name, evidence = {}) => { report.checks.push({ name, pass: true, ...evidence }); console.log('PASS ' + name); };
const put = async (ws, rel, value) => { const p = path.join(ws, rel); await mkdir(path.dirname(p), {recursive:true});
  await writeFile(p, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2)); };
const readState = async ws => JSON.parse(await readFile(path.join(ws, '.mmw', 'state.json'), 'utf8'));
const saveState = async (ws, state) => put(ws, '.mmw/state.json', state);

// This intentionally overwrites the test PROCESS's variable without reading its old value.
// Nonsecret sentinel bypasses optional config reads; there are no GPTIMG fixture items or image calls.
process.env.GPT_IMAGE_API_KEY = 'MMW_OFFLINE_FIXTURE_NOT_A_REAL_KEY';
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Network requests are forbidden by this offline fixture'); };

try {
  const packages = ['@deepseek-ai/dsh', '@deepseek-ai/cordis', '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-working-directory', '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-fs-local',
    '@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-scope'];
  for (const name of packages) {
    const pkg = runtimeRequire(name + '/package.json'); report.versions[name] = pkg.version;
    assert.equal(pkg.version, name === '@deepseek-ai/cordis' ? '4.1.0' : expectedVersion);
  }
  check('exact public runtime versions', { versions: report.versions });
  const { Context } = await load('@deepseek-ai/cordis');
  const { renderPrompt } = await load('@deepseek-ai/dsh-system-prompt');
  const { PDFDocument } = await load('pdf-lib');
  ctx = new Context();
  for (const [name, config] of [
    ['@deepseek-ai/dsh-system-prompt', {}], ['@deepseek-ai/dsh-tools', {}],
    ['@deepseek-ai/dsh-session', {}], ['@deepseek-ai/dsh-session-projection', {}],
    ['@deepseek-ai/dsh-fs-local', {cwd: fixtureRoot}],
    ['@deepseek-ai/dsh-working-directory', {defaultDirectory: fixtureRoot}],
    ['@deepseek-ai/dsh-tool-executor-native', {}],
  ]) {
    const module = await load(name); const f = await ctx.plugin(module.default ?? module, config);
    assert.equal(f.state, 2); report.mounted.push({name, state:f.state});
  }
  const plugin = await import(pathToFileURL(path.join(pluginRoot, 'index.js')).href);
  fiber = await ctx.plugin(plugin, {}); assert.equal(fiber.state, 2);
  const expectedNames = ['modeling_init','modeling_next','modeling_finish','modeling_ask','modeling_pending','modeling_answer','modeling_status','modeling_switches'].sort();
  assert.deepEqual(ctx.tools.schemas().map(t=>t.name).sort(), expectedNames);
  check('all eight definitions register in real ToolsService', {names:expectedNames});

  // Session cwd differs from process.cwd, so fallback-to-process.cwd cannot accidentally pass.
  const sessionDir = path.join(fixtureRoot, 'session-cwd'); await mkdir(sessionDir);
  const session = ctx.sessions.create(undefined, {meta:{cwd:sessionDir}});
  const notices = [];
  const agent = {id:session.id, session, ctx, inject(message) {notices.push(message);} };
  assert.notEqual(sessionDir, process.cwd());
  assert.equal(await ctx.workingDirectory.ensure(agent), sessionDir);
  let accessCount = 0;
  ctx.on('working-directory/access', async (_request, next) => { accessCount++; return next(); });
  const assembly = await ctx.systemPrompt.assemble({agent,scope:agent});
  assert.equal(assembly.tools.length, 8);
  assert.ok(renderPrompt(assembly).includes('数学建模竞赛工作流'));
  assert.ok(assembly.contexts.some(s=>s.name==='working-directory:current' && s.text.includes(JSON.stringify(sessionDir))));
  check('prompt injection and real Session working-directory context');
  const nested = path.join(sessionDir, 'nested'); await mkdir(nested);
  assert.equal(await ctx.workingDirectory.set(agent,'nested'), nested);
  assert.equal(ctx.workingDirectory.get(session), nested);
  assert.equal(await ctx.workingDirectory.set(agent,'..'), sessionDir);
  assert.equal(notices.length, 2);
  check('working-directory set/ensure uses filesystem and Session projection', {sessionId:session.id,notices:notices.length});

  const signal = new AbortController().signal;
  const raw = async (name, args) => {
    const input = {calls:[{type:'tool-call',id:'compat-'+(++count),name,arguments:JSON.stringify(args)}],agent,signal};
    const result = await ctx.tools.execute(input);
    calls.push({name,args,result});
    assert.equal(result.results.length,1);
    return result.results[0].result;
  };
  const call = async (name, args) => { const result = await raw(name,args);
    assert.equal(result.isError,false, name+': '+JSON.stringify(result)); return result.value; };
  const error = async (name,args,pattern) => { const r=await raw(name,args); assert.equal(r.isError,true);
    assert.match(r.error.message,pattern); return r; };
  await error('modeling_init',{},/赛题目录不存在|undefined/);
  await error('not_a_registered_tool',{},/Unknown|unknown/);
  report.boundaries.push('Raw ToolDefinition parameters are model-facing declarations: rc.3 native pipeline invokes the raw execute body without defineTool argument validation. Missing input_dir returns the plugin business error, not a required-parameter schema error. Output values are validated by the real native pipeline.');
  check('native pipeline returns plugin business errors and unknown-name failures');

  const input = path.join(sessionDir,'fixture-input'); await mkdir(input);
  await put(input,'problem.md','# Deterministic offline fixture\nA mathematical test with synthetic values.');
  await put(input,'data.csv','x,y\n1,2\n');
  const init = await call('modeling_init',{input_dir:'fixture-input',workspace_name:'strict',competition:'generic',max_pages:1,ai_disclosure:'off'});
  const ws = init.workspace; assert.equal(ws,path.join(sessionDir,'strict'));
  assert.equal(init.steps.length,8);
  assert.ok((await stat(path.join(ws,'skills','赛题分析','SKILL.md'))).isFile());
  assert.ok((await readFile(path.join(ws,'user_data','data.csv'),'utf8')).includes('1,2'));
  assert.equal((await readState(ws)).steps[0].status,'pending');
  await call('modeling_switches',{workspace:ws,switches:{flowchart_engine:'html',figure_style:'nature',diagram_style:'plain',title:'RC3 deterministic fixture'}});
  const switched = await readState(ws);
  assert.equal(switched.title,'RC3 deterministic fixture');
  assert.ok(switched.steps.some(s=>s.key==='paper-figure-html'));
  assert.ok((await readFile(path.join(ws,'CLAUDE.md'),'utf8')).includes('RC3 deterministic fixture'));
  check('registered init scaffolds relative to real Session cwd; pre-start switches propagate', {workspace:ws});

  let next = await call('modeling_next',{workspace:ws});
  assert.equal(next.step.key,'comp-prob-analysis'); assert.equal(next.cwd,ws);
  assert.ok((await readFile(next.promptPath,'utf8')).includes('PROBLEM_ANALYSIS.md'));
  await call('modeling_next',{workspace:ws}); assert.equal((await readState(ws)).steps[0].attempts,1);
  await error('modeling_switches',{workspace:ws,switches:{rich_mode:true}},/正在执行|等待回答/);
  const q1=await call('modeling_ask',{workspace:ws,question:'Choose fixture label?',options:['A','B']});
  const q2=await call('modeling_ask',{workspace:ws,question:'Choose fixture split?',options:['time','random']});
  assert.equal((await call('modeling_pending',{workspace:ws})).questions.length,2);
  assert.equal((await call('modeling_next',{workspace:ws})).waiting,true);
  assert.equal((await call('modeling_finish',{workspace:ws})).waiting,true);
  await error('modeling_answer',{workspace:ws,answer:'ambiguous'},/question_id/);
  await error('modeling_answer',{workspace:ws,question_id:q1.question_id,answer:' '},/不能为空/);
  const answer=await call('modeling_answer',{workspace:ws,question_id:q1.question_id,answer:'FIXTURE_LABEL_A'});
  assert.ok(answer.relay.includes('FIXTURE_LABEL_A'));
  assert.equal((await readState(ws)).steps[0].status,'waiting');
  await call('modeling_answer',{workspace:ws,question_id:q2.question_id,answer:'FIXTURE_TIME_SPLIT'});
  assert.equal((await readState(ws)).steps[0].status,'running');
  next=await call('modeling_next',{workspace:ws});
  const resumed=await readFile(next.promptPath,'utf8');
  assert.ok(resumed.includes('FIXTURE_LABEL_A') && resumed.includes('FIXTURE_TIME_SPLIT'));
  assert.equal((await call('modeling_pending',{workspace:ws})).questions.length,0);
  check('question pending/ambiguous/empty/partial/full answers and resumed prompt');

  const finish = async (expected, pass=true) => { const r=await call('modeling_finish',{workspace:ws});
    assert.equal(r.step,expected); assert.equal(r.pass,pass,JSON.stringify(r)); return r; };
  const missing=await finish('comp-prob-analysis',false);
  assert.equal(missing.results[0].gate,'artifact');
  assert.equal((await readState(ws)).steps[0].status,'blocked');
  assert.ok(missing.hints.length);
  const manifest='<!-- BEGIN FIGURE_MANIFEST -->\n**DATA 数据图：**\n- fig_q1_value\n**DRAWIO 流程图：**\n- fig_framework\n**总数：DATA=1, DRAWIO=1**\n<!-- END FIGURE_MANIFEST -->\n';
  await put(ws,'PROBLEM_ANALYSIS.md',manifest+'Synthetic analysis evidence. '.repeat(100));
  await put(ws,'LOGIC_CONTRACT.json',{LOGIC_CONTRACT_MACHINE:{bounds:[{quantity:'efficiency',is:'upper'}]}});
  await put(ws,'figures/all_results.json',{value:12.5,logic_probes:{bounds:[{quantity:'efficiency',probe_delta_sign:1}]}});
  const logicBad=await finish('comp-prob-analysis',false);
  assert.ok(logicBad.results.some(r=>r.gate==='logic' && !r.ok));
  await put(ws,'figures/all_results.json',{value:12.5,logic_probes:{bounds:[{quantity:'efficiency',probe_delta_sign:-1}]}});
  await call('modeling_next',{workspace:ws});
  let r=await finish('comp-prob-analysis'); report.strictGates.push({step:r.step,results:r.results});
  await error('modeling_switches',{workspace:ws,switches:{title:'late'}},/已有步骤完成/);
  check('missing artifact and conflicting logic block; repaired analysis passes');

  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'comp-modeling');
  assert.ok((await readFile(next.promptPath,'utf8')).includes('FIXTURE_TIME_SPLIT'));
  await put(ws,'MODELING_REPORT.md','Synthetic model derivation. '.repeat(100));
  r=await finish('comp-modeling'); report.strictGates.push({step:r.step,results:r.results});
  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'comp-code');
  await put(ws,'RESULTS.md','Synthetic deterministic programming results. '.repeat(50));
  const noCode=await finish('comp-code',false); assert.ok(noCode.results.some(r=>r.gate==='companions'&&!r.ok));
  await put(ws,'code/main.py','# Offline deterministic fixture\nVALUE = 12.5\nprint(VALUE)\n');
  r=await finish('comp-code'); report.strictGates.push({step:r.step,results:r.results});
  check('modeling and code gates require actual companion artifacts');

  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'paper-figure');
  await put(ws,'figures/latex_includes.tex','% deterministic synthetic figures\n\\includegraphics{figures/fig_q1_value.pdf}\n');
  const missingFig=await finish('paper-figure',false);
  assert.ok(missingFig.results.some(r=>r.gate==='figures'&&!r.ok&&r.detail.missing.includes('fig_q1_value')));
  const imagePdf=await PDFDocument.create(); imagePdf.addPage();
  await put(ws,'figures/fig_q1_value.pdf',await imagePdf.save());
  r=await finish('paper-figure'); report.strictGates.push({step:r.step,results:r.results});
  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'paper-figure-html');
  await put(ws,'figures/fig_framework.pdf',await imagePdf.save());
  const noSource=await finish('paper-figure-html',false); assert.ok(noSource.results.some(r=>r.gate==='figures'&&!r.ok));
  await put(ws,'figures/fig_framework.html','<!doctype html><title>Offline fixture</title><p>Deterministic framework source</p>');
  r=await finish('paper-figure-html'); report.strictGates.push({step:r.step,results:r.results});
  check('data figure reconciliation and HTML source plus PDF gate');

  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'comp-review');
  await put(ws,'COMP_REVIEW.md','# Synthetic deterministic review ledger\nChecked synthetic bounds and figure source evidence. '.repeat(5));
  await put(ws,'COMP_REVIEW_VERDICT.json',{fatal_count:1,major_count:0,minor_count:0,findings:[]});
  const badReview=await finish('comp-review',false); assert.ok(badReview.results.some(r=>r.gate==='review_verdict'&&!r.ok));
  await put(ws,'COMP_REVIEW_VERDICT.json',{fatal_count:0,major_count:0,minor_count:0,findings:[]});
  r=await finish('comp-review'); report.strictGates.push({step:r.step,results:r.results});
  check('strict adversarial verdict blocks unresolved findings and accepts zero fixture');

  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'comp-paper-zh');
  await put(ws,'paper/main.tex','\\documentclass{article}\n\\begin{document}\n'+ 'Deterministic synthetic body. '.repeat(100)+'\n\\input{sections/body}\n\\end{document}\n');
  await put(ws,'paper/sections/body.tex','\\section{Fixture results}\nThe observed value is 12.5.\n'+'Synthetic evidence with stable values. '.repeat(30));
  const pythonCheck=() => {
    const args=[path.join(ws,'_utils','paper_data_check.py'),'--mode','pdf','--workspace',ws,'--quiet'];
    const result=spawnSync(python,args,{stdio:'inherit',cwd:ws});
    report.commands.push({executable:python,args,cwd:ws,status:result.status,error:result.error?.message});
    assert.equal(result.status,0,'real paper_data_check.py failed');
  };
  pythonCheck();
  assert.equal(JSON.parse(await readFile(path.join(ws,'PAPER_DATA_CHECK_RESULT.json'),'utf8')).status,'passed');
  await put(ws,'paper/sections/body.tex',(await readFile(path.join(ws,'paper/sections/body.tex'),'utf8'))+'\nAdditional fixture sentence.');
  const stale=await finish('comp-paper-zh',false);
  assert.ok(stale.results.some(r=>r.gate==='paper_data_check'&&!r.ok&&r.detail.fresh===false));
  pythonCheck();
  r=await finish('comp-paper-zh'); report.strictGates.push({step:r.step,results:r.results});
  check('strict paper pages/disclosure gates and real Python input-hash freshness');

  next=await call('modeling_next',{workspace:ws}); assert.equal(next.step.key,'comp-compile-zh');
  await put(ws,'paper/main.pdf','invalid synthetic PDF'.repeat(3000));
  const invalid=await finish('comp-compile-zh',false);
  assert.ok(invalid.results.some(r=>r.gate==='pdf_pages'&&!r.ok));
  const pdf=await PDFDocument.create(); pdf.addPage();
  let randomState=123456789;
  const randomBytes=Uint8Array.from({length:60000},()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return randomState&255;});
  await pdf.attach(randomBytes,'deterministic-fixture.bin');
  await put(ws,'paper/main.pdf',await pdf.save({useObjectStreams:false}));
  assert.ok((await stat(path.join(ws,'paper/main.pdf'))).size>=50000);
  // Compile dispatch refreshes bundled TeX dependencies; recheck the final input set.
  pythonCheck();
  r=await finish('comp-compile-zh'); report.strictGates.push({step:r.step,results:r.results});
  assert.equal((await call('modeling_next',{workspace:ws})).done,true);
  const status=await call('modeling_status',{workspace:ws}); assert.deepEqual(status.progress,{done:8,total:8});
  assert.ok((await readState(ws)).steps.every(s=>s.status==='completed'));
  check('all eight strict steps complete; invalid PDF blocks; real PDF page tree passes', {progress:status.progress});

  const fast=await call('modeling_init',{input_dir:'fixture-input',workspace_name:'fast',competition:'generic',max_pages:1,validation_mode:'fast'});
  assert.equal(fast.steps.length,7); assert.ok(!fast.steps.some(s=>s.key==='comp-review'));
  const legacy=await call('modeling_init',{input_dir:'fixture-input',workspace_name:'legacy-fast',competition:'generic',max_pages:1});
  const legacyState=await readState(legacy.workspace); legacyState.switches.validation_mode='fast';
  const ri=legacyState.steps.findIndex(s=>s.key==='comp-review'); legacyState.steps.slice(0,ri).forEach(s=>s.status='completed');
  legacyState.steps[ri].status='waiting'; legacyState.questions=[{id:'obsolete-question',step:'comp-review',status:'open',question:'legacy fixture',options:[]}];
  await saveState(legacy.workspace,legacyState);
  const legacyNext=await call('modeling_next',{workspace:legacy.workspace}); assert.equal(legacyNext.step.key,'comp-paper-zh');
  const skippedState=await readState(legacy.workspace);
  assert.equal(skippedState.steps[ri].status,'skipped'); assert.equal(skippedState.steps[ri].lastGate.skipped,true);
  assert.equal(skippedState.questions[0].status,'cancelled');
  assert.equal(existsSync(path.join(legacy.workspace,'COMP_REVIEW_VERDICT.json')),false);
  const skippedFinish=await call('modeling_finish',{workspace:legacy.workspace,step:'comp-review'});
  assert.equal(skippedFinish.skipped,true);
  check('new fast omits review; legacy waiting review skips and cancels questions without verdict');

  assert.ok(accessCount>calls.length, 'real ensure must run for every native modeling invocation plus assemblies');
  report.workingDirectoryAccesses=accessCount;
  await fiber.dispose(); fiber=undefined;
  assert.equal(ctx.tools.schemas().length,0);
  const after=await ctx.systemPrompt.assemble({agent,scope:agent});
  assert.ok(!renderPrompt(after).includes('数学建模竞赛工作流'));
  assert.equal(after.tools.length,0);
  await error('modeling_status',{workspace:ws},/Unknown|unknown/);
  check('Cordis plugin unload releases all tools and prompt section');
  fiber=await ctx.plugin(plugin,{}); assert.equal(ctx.tools.schemas().length,8);
  await fiber.dispose(); fiber=undefined; assert.equal(ctx.tools.schemas().length,0);
  check('remount after unload does not duplicate registrations');
  assert.equal(networkAttempts,0);
  report.networkAttempts=networkAttempts; report.toolCalls=calls.length; report.pass=true;
} catch (error) {
  report.pass=false; report.error={name:error.name,message:error.message,stack:error.stack};
  process.exitCode=1;
} finally {
  try { if(ctx) await ctx.fiber.dispose(); report.hostDisposed=true; }
  catch(error) { report.disposeError=String(error); report.pass=false; process.exitCode=1; }
  await writeFile(callsPath,JSON.stringify(calls,null,2));
  await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,toolCalls:report.toolCalls,reportPath,callsPath,error:report.error},null,2));
}
