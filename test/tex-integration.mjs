// Optional real-engine integration; set MMW_TEX_BIN to an existing TeX bin directory.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatePdfPages, gatePaperDataCheck } from '../lib/gates.js';
import { syncTemplates, refreshBundledChecks } from '../lib/scaffold.js';
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = process.env.MMW_TEX_BIN;
const python = process.env.MMW_PYTHON;
if (!bin || !python) throw new Error('Set MMW_TEX_BIN and MMW_PYTHON for real-engine integration.');
const root = await mkdtemp(path.join(os.tmpdir(), 'mmw-real-tex-'));
console.log('Real TeX evidence directory:', root);
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
async function run(engineName, competition, template, legacy = false) {
  const ws = path.join(root, competition + '-' + engineName + (legacy ? '-legacy' : ''));
  const paper = path.join(ws, 'paper');
  await mkdir(path.join(paper, 'sections'), { recursive: true });
  await mkdir(path.join(ws, '.mmw'), { recursive: true });
  await mkdir(path.join(ws, 'figures'), { recursive: true });
  await writeFile(path.join(ws, '.mmw/state.json'), JSON.stringify({ switches: { competition, validation_mode: 'strict' } }));
  await writeFile(path.join(ws, 'figures/all_results.json'), JSON.stringify({ accuracy: .93, cost: 12 }));
  await writeFile(path.join(ws, 'figures/TABLE_accuracy.tex'), '\\begin{tabular}{lr}\nAccuracy & $93\\%$ \\\\\n\\end{tabular}\n');
  let main;
  if (template) {
    // Follow the real workspace path: templates include bundled runtime dependencies and licenses.
    if (!legacy) await syncTemplates({ workspaceDir: ws, assetsDir: path.join(repo, 'assets'), switches: { competition, language: 'en' } });
    const source = legacy ? path.join(repo, 'assets/skills/论文撰写English/templates', template) : path.join(ws, '_templates', template);
    await cp(source, paper, { recursive: true });
    if (legacy) await refreshBundledChecks(ws, path.join(repo, 'assets'));
    for (const filename of ['xpatch.sty', 'xstring.sty', 'xstring.tex', 'scalefnt.sty', 'mweights.sty', 'fontaxes.sty', 'fontaxes-v1.sty']) {
      assert.ok((await readFile(path.join(paper, filename))).length > 0, `missing bundled ${filename}`);
    }
    assert.ok((await readFile(path.join(paper, 'third-party/tex/xpatch/xpatch.dtx'))).length > 0);
    assert.ok((await readFile(path.join(paper, 'third-party/tex/xpatch/lppl-1.3c.txt'))).length > 0);
    main = await readFile(path.join(paper, 'main.tex'), 'utf8');
    main = main.replace('[Paper Title]', 'Workflow integration verification')
      .replace(/\[Summary:[^\]]*\]/, 'The accuracy was $93\\%$ and the cost was 12.')
      .replace('[Keyword1]; [Keyword2]; [Keyword3]', 'verification; modeling; reproducibility')
      .replace('[A/B/C]', 'A').replace('[Team Number]', '0000')
      .replace('[School Name]', 'Test school').replace(/\[Member [ABC]\]/g, 'Test member')
      .replace('% \\bibitem{ref1} Author. Title[J]. Journal, Year.', '\\bibitem{ref1} Author. Verification reference.');
    const names = [...main.matchAll(/\\input\{sections\/([^}]+)\}/g)].map(m => m[1]);
    for (const name of names) await writeFile(path.join(paper, 'sections', name + '.tex'), name === 'A_code'
      ? '\\section{Code} The implementation was validated.\n'
      : '\\section{Verification}\nThe cost was 12. The accuracy was $93\\%$. Verification follows~\\cite{ref1}.\n');
    await writeFile(path.join(paper, 'sections', names[0] + '.tex'), '\\section{Verification}\nThe cost was 12. The accuracy was $93\\%$. Verification follows~\\cite{ref1}.\n\\input{../figures/TABLE_accuracy.tex}\n');
  } else {
    main = '\\documentclass{article}\n\\begin{document}\n\\input{sections/results}\n\\begin{thebibliography}{9}\n\\bibitem{ref1} Author. Verification reference.\n\\end{thebibliography}\n\\end{document}\n';
    await writeFile(path.join(paper, 'sections/results.tex'), '\\section{Verification}\nThe cost was 12. The accuracy was $93\\%$. See~\\cite{ref1}.\n\\input{../figures/TABLE_accuracy.tex}\n');
  }
  await writeFile(path.join(paper, 'main.tex'), main);
  const engine = path.join(bin, engineName + (process.platform === 'win32' ? '.exe' : ''));
  for (let pass = 1; pass <= 2; pass++) {
    const fd = openSync(path.join(ws, `console-${pass}.txt`), 'w');
    let r;
    try { r = spawnSync(engine, ['--disable-installer', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'], { cwd: paper, env, stdio: ['ignore', fd, fd], timeout: 45000 }); }
    finally { closeSync(fd); }
    assert.equal(r.status, 0, `${competition}/${engineName} pass ${pass} failed; inspect ${ws}; ${r.error ?? ''}`);
  }
  const valid = await gatePdfPages(ws);
  assert.equal(valid.ok, true, JSON.stringify(valid));
  const checked = spawnSync(python, [path.join(repo, 'assets/utils/paper_data_check.py'), '--workspace', ws, '--mode', 'pdf'], { env, stdio: 'inherit' });
  assert.equal(checked.status, 0, `${competition} paper data check failed`);
  assert.equal((await gatePaperDataCheck(ws, {})).ok, true);
  console.log(`REAL TEX PASS ${competition}/${engineName}${legacy ? '/legacy' : '/fresh'}: ${valid.detail.pages} pages; inline references + math + external table + fresh data proof`);
}
const selection = new Set((process.env.MMW_TEX_CASES ?? 'generic,mcm,apmcm').split(','));
const cases = [ ['xelatex', 'generic', null], ['pdflatex', 'generic', null], ['pdflatex', 'mcm', 'mcm'], ['pdflatex', 'apmcm', 'apmcm'], ['pdflatex', 'mcm', 'mcm', true], ['pdflatex', 'apmcm', 'apmcm', true] ];
const failures = [];
for (const [engine, competition, template, legacy] of cases) {
  if (!selection.has(competition)) continue;
  try { await run(engine, competition, template, legacy); }
  catch (error) { failures.push(error.message); console.error('REAL TEX FAIL:', error.message); }
}
if (failures.length) { console.error(`Real TeX integration failed in ${failures.length} case(s); evidence retained at ${root}`); process.exitCode = 1; }
else console.log('REAL TEX INTEGRATION ALL PASS (selected cases)');
