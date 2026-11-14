// Regression for prompt/runtime synchronization; no Python or plotting dependency needed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';
import { normalizeSwitches } from '../lib/switches.js';
import { resolveSteps } from '../lib/steps.js';
import { readState, writeState } from '../lib/state.js';
import { ensurePlotRuntime, missingPlotExports, PLOT_RUNTIME_EXPORTS } from '../lib/plotRuntime.js';
import { refreshBundledChecks, scaffoldWorkspace } from '../lib/scaffold.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = await mkdtemp(path.join(os.tmpdir(), 'mmw-plot-sync-'));
const latest = await readFile(path.join(repo, 'assets/utils/plot_utils.py'), 'utf8');
const old = execFileSync('git', ['show', '209c27c:assets/utils/plot_utils.py'], { cwd: repo, encoding: 'utf8' });
const assets = path.join(root, 'assets');
async function put(base, rel, text) { const f = path.join(base, rel); await mkdir(path.dirname(f), {recursive:true}); await writeFile(f,text); }
const tools = new Map();
const dispose = apply({ tools: { register(d) {tools.set(d.name,d); return () => tools.delete(d.name); } },
  systemPrompt: {section() {return () => {}; }}, workingDirectory: {ensure: async () => root} });
const exec = {agent:{id:'plot-sync'},signal:new AbortController().signal};
let groups = 0;
const pass = name => { groups++; console.log('PASS '+name); };
try {
  await put(assets, 'utils/plot_utils.py', latest);
  await put(assets, 'skills/论文撰写/templates/default/main.tex', '% fixture template');
  const switches = normalizeSwitches({figure_style:'nature'}).switches;
  assert.deepEqual(missingPlotExports(latest), []);
  for (const name of ['set_paper_placement','draw_vector_heatmap','dynamic_limits']) assert.ok(missingPlotExports(old).includes(name));
  pass('the released broken helper is detected and the bundle implements the entire prompt contract');

  const fresh = path.join(root,'fresh');
  await scaffoldWorkspace({workspaceDir:fresh,assetsDir:assets,inputFiles:[],switches,steps:[],title:'fresh'});
  assert.equal(await readFile(path.join(fresh,'_utils/plot_utils.py'),'utf8'),latest);
  pass('new workspaces copy the complete compatible helper');

  for (const crlf of [false,true]) {
    const ws = path.join(root, crlf ? 'legacy-crlf':'legacy-lf');
    await put(ws,'_utils/plot_utils.py', crlf ? old.replace(/\r?\n/g,'\r\n'):old);
    await refreshBundledChecks(ws,assets);
    assert.equal(await readFile(path.join(ws,'_utils/plot_utils.py'),'utf8'),latest);
    await refreshBundledChecks(ws,assets);
    assert.equal(await readFile(path.join(ws,'_utils/plot_utils.py'),'utf8'),latest);
  }
  pass('known original LF/CRLF copies upgrade atomically and remain idempotent');

  const missing = path.join(root,'missing'); await mkdir(missing);
  await refreshBundledChecks(missing,assets);
  assert.equal(await readFile(path.join(missing,'_utils/plot_utils.py'),'utf8'),latest);
  pass('missing utils directories and helpers are repaired');

  const custom = path.join(root,'custom-compatible');
  await put(custom,'_utils/plot_utils.py',latest+'\n# user extension: preserve\n');
  await refreshBundledChecks(custom,assets);
  assert.equal(await readFile(path.join(custom,'_utils/plot_utils.py'),'utf8'),latest+'\n# user extension: preserve\n');
  pass('compatible user extensions are preserved byte-for-byte');

  const incompatible = path.join(root,'custom-old');
  const localOld=old+'\n# custom palette change\n';
  await put(incompatible,'_utils/plot_utils.py',localOld);
  await assert.rejects(refreshBundledChecks(incompatible,assets), e => e.code==='PLOT_RUNTIME_INCOMPATIBLE' && /set_paper_placement/.test(e.message));
  assert.equal(await readFile(path.join(incompatible,'_utils/plot_utils.py'),'utf8'),localOld);
  const candidates=(await readdir(path.join(incompatible,'_utils'))).filter(n=>n.startsWith('plot_utils.bundled-'));
  assert.equal(candidates.length,1);
  assert.equal(await readFile(path.join(incompatible,'_utils',candidates[0]),'utf8'),latest);
  await assert.rejects(refreshBundledChecks(incompatible,assets),/自定义/);
  assert.equal((await readdir(path.join(incompatible,'_utils'))).filter(n=>n.startsWith('plot_utils.bundled-')).length,1);
  pass('incompatible custom helpers block dispatch while retaining originals and a complete merge candidate');

  const brokenAssets=path.join(root,'broken-assets');
  await put(brokenAssets,'utils/plot_utils.py',old);
  await assert.rejects(ensurePlotRuntime(fresh,brokenAssets),/随包.*缺少/);
  assert.equal(await readFile(path.join(fresh,'_utils/plot_utils.py'),'utf8'),latest);
  pass('an internally inconsistent bundle fails before changing a workspace');

  const ws=path.join(root,'dispatch');
  await put(ws,'_utils/plot_utils.py',old);
  const steps=resolveSteps(switches).map(s=>({...s,companions:s.companions??[],status:s.key==='paper-figure'?'pending':s.order<3?'completed':'pending',attempts:0,dir:`_steps/${s.key}`,promptPath:`_steps/${s.key}/prompt.md`}));
  await writeState(ws,{version:1,title:'plot dispatch',workspace:'dispatch',inputFiles:[],switches,steps});
  const next=await tools.get('modeling_next').execute({workspace:ws},exec);
  assert.equal(next.step.key,'paper-figure');
  assert.deepEqual(missingPlotExports(await readFile(path.join(ws,'_utils/plot_utils.py'),'utf8')),[]);
  assert.ok((await readFile(next.promptPath,'utf8')).includes('set_paper_placement'));
  pass('modeling_next upgrades the helper before serving the new Nature prompt');

  const blocked=path.join(root,'blocked-dispatch');
  await put(blocked,'_utils/plot_utils.py',localOld);
  await writeState(blocked,{version:1,title:'custom',workspace:'blocked-dispatch',inputFiles:[],switches,steps:steps.map(s=>({...s}))});
  await assert.rejects(tools.get('modeling_next').execute({workspace:blocked},exec),/自定义.*缺少接口/);
  assert.equal((await readState(blocked)).steps.find(s=>s.key==='paper-figure').status,'pending');
  pass('a new prompt is not dispatched against an incompatible custom runtime');

  const outside=path.join(root,'outside'); await mkdir(outside);
  await put(outside,'plot_utils.py',old);
  const linked=path.join(root,'linked-utils'); await mkdir(linked);
  await symlink(outside,path.join(linked,'_utils'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(refreshBundledChecks(linked,assets),/不是实际工作区目录/);
  assert.equal(await readFile(path.join(outside,'plot_utils.py'),'utf8'),old);
  const linkedFile=path.join(root,'linked-file'); await mkdir(path.join(linkedFile,'_utils'),{recursive:true});
  // Windows directory junctions need no Developer Mode; put one at the file slot.
  await symlink(process.platform==='win32' ? outside : path.join(outside,'plot_utils.py'),
    path.join(linkedFile,'_utils/plot_utils.py'),process.platform==='win32'?'junction':'file');
  await assert.rejects(refreshBundledChecks(linkedFile,assets),/不是实际文件/);
  assert.equal(await readFile(path.join(outside,'plot_utils.py'),'utf8'),old);
  pass('utils directory/file links never overwrite outside content');
  assert.ok(PLOT_RUNTIME_EXPORTS.length >= 12);
  console.log(`PLOT RUNTIME SYNC PASS (${groups} groups)`);
} finally {
  dispose();
  assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('mmw-plot-sync-'));
  await rm(root,{recursive:true,force:true});
}
