// Run with Node; uses Git Bash on Windows. No TeX compiler, API, cleanup, or process kill is run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bash = process.env.MMW_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const bundledPython = 'C:/Users/admin/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe';
const python = process.env.MMW_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : 'python3');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mmw-skills-regression-'));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const en = read('assets/skills/编译与合规English/SKILL.md');
const zh = read('assets/skills/编译与合规/SKILL.md');
const common = read('assets/utils/compile_check.sh');
const utils = read('assets/utils/compile_utils.sh');
let passed = 0;
function put(cwd, rel, text) {
  const target = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
function fixture(name) {
  const cwd = path.join(scratch, name);
  fs.mkdirSync(cwd);
  put(cwd, 'paper/main.tex', String.raw`\documentclass{article}
\title{A paper}
\begin{document}
Evidence \citep{a}.
\begin{thebibliography}{9}
\bibitem{a} An actual reference.
\end{thebibliography}
\end{document}
`);
  put(cwd, 'paper/main.log', 'No warnings\n');
  put(cwd, 'paper/sections/results.tex', 'Results and evidence.\n');
  return cwd;
}
function run(cwd, source, env = {}) {
  put(cwd, '_tmp/probe.sh', source);
  const result = spawnSync(bash, ['_tmp/probe.sh'], {
    cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, MMW_PYTHON: python, PYTHON: python, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...env },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}
function section(text, start, end) {
  const a = text.indexOf(start);
  assert.ok(a >= 0, `missing section ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert.ok(b >= 0, `missing end ${end}`);
  return text.slice(a, b);
}
function blockAfter(text, heading) {
  const tail = text.slice(text.indexOf(heading));
  const match = tail.match(/```bash\r?\n([\s\S]*?)```/);
  assert.ok(match, `missing shell block ${heading}`);
  return match[1];
}
function test(name, body) {
  body();
  passed++;
  console.log(`PASS ${name}`);
}
const bibliography = section(common, '# 6. Bibliography', '# 7. Citation count');
function bibCheck(cwd) {
  return run(cwd, `PAPER_DIR=paper\nEXIT_CODE=0\n${bibliography}\nexit "$EXIT_CODE"\n`);
}
try {
  test('inline bibliography passes without bbl; empty inline bibliography fails', () => {
    const cwd = fixture('inline');
    assert.equal(bibCheck(cwd).status, 0);
    const text = fs.readFileSync(path.join(cwd, 'paper/main.tex'), 'utf8');
    put(cwd, 'paper/main.tex', text.replace('\\bibitem{a} An actual reference.', ''));
    assert.equal(bibCheck(cwd).status, 1);
  });
  test('BibTeX requires populated bbl and source database', () => {
    const cwd = fixture('bibtex');
    put(cwd, 'paper/main.tex', String.raw`\documentclass{article}
\bibliography{references}`);
    put(cwd, 'paper/references.bib', '@article{a,title={Evidence}}\n');
    assert.equal(bibCheck(cwd).status, 1);
    put(cwd, 'paper/main.bbl', String.raw`\bibitem{a} Evidence`);
    assert.equal(bibCheck(cwd).status, 0);
    put(cwd, 'paper/main.bbl', '');
    assert.equal(bibCheck(cwd).status, 1);
  });
  for (const [language, skill, engine] of [['English', en, 'pdflatex'], ['Chinese', zh, 'xelatex']]) {
    test(`${language} runs BibTeX only when actual aux requests it; failures stop compilation`, () => {
      const cwd = fixture(`compile-${language}`);
      const compile = blockAfter(skill, '### Step 3:');
      const stubs = `export TRACE="$PWD/_tmp/trace"\n${engine}() { echo tex >> "$TRACE"; printf '%s\\n' "$AUX_CONTENT" > main.aux; }\nbibtex() { echo bibtex >> "$TRACE"; return "${'${BIB_EXIT:-0}'}"; }\n`;
      let result = run(cwd, stubs + compile, { AUX_CONTENT: '\\relax' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(cwd, '_tmp/trace'), 'utf8'), 'tex\ntex\ntex\n');
      put(cwd, '_tmp/trace', '');
      result = run(cwd, stubs + compile, { AUX_CONTENT: '\\bibdata{references}' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(cwd, '_tmp/trace'), 'utf8'), 'tex\nbibtex\ntex\ntex\n');
      put(cwd, '_tmp/trace', '');
      result = run(cwd, stubs + compile, { AUX_CONTENT: '\\bibdata{references}', BIB_EXIT: '9' });
      assert.equal(result.status, 9, result.stderr);
      assert.equal(fs.readFileSync(path.join(cwd, '_tmp/trace'), 'utf8'), 'tex\nbibtex\n');
    });
    test(`${language} captures both failures and chooses fallback by existence only`, () => {
      const cwd = fixture(`exit-${language}`);
      let script;
      if (language === 'English') {
        script = section(blockAfter(skill, '### Step 7:'), 'echo "=== Running check scripts ==="', '# --- CRITICAL ---');
      } else {
        script = 'GATE_FAIL=0\n' + section(skill, '# 18. Run compile_check.sh', '# 19. 符号说明');
      }
      script += '\nprintf "RESULT CC=%s WC=%s GATE=%s\\n" "$CC_EXIT" "$WC_EXIT" "$GATE_FAIL"\n';
      put(cwd, '_utils/compile_check.sh', 'echo primary-compile\nexit 7\n');
      put(cwd, '_utils/writing_check.sh', 'echo primary-writing\nexit 0\n');
      put(cwd, 'skills/shared-scripts/compile_check.sh', 'echo fallback-compile\nexit 0\n');
      put(cwd, 'skills/shared-scripts/writing_check.sh', 'echo fallback-writing\nexit 0\n');
      let result = run(cwd, script);
      assert.match(result.stdout, /RESULT CC=7 WC=0 GATE=1/);
      assert.doesNotMatch(result.stdout, /fallback/);
      put(cwd, '_utils/compile_check.sh', 'exit 0\n');
      put(cwd, '_utils/writing_check.sh', 'exit 8\n');
      result = run(cwd, script);
      assert.match(result.stdout, /RESULT CC=0 WC=8 GATE=1/);
      assert.doesNotMatch(result.stdout, /fallback/);
      // Remove only this known temporary fixture file to exercise missing-primary fallback.
      const primary = path.join(cwd, '_utils/compile_check.sh');
      assert.ok(primary.startsWith(scratch + path.sep));
      fs.unlinkSync(primary);
      result = run(cwd, script);
      assert.match(result.stdout, /fallback-compile/);
      assert.match(result.stdout, /RESULT CC=0 WC=8 GATE=1/);
      const fallback = path.join(cwd, 'skills/shared-scripts/compile_check.sh');
      assert.ok(fallback.startsWith(scratch + path.sep));
      fs.unlinkSync(fallback);
      result = run(cwd, script);
      assert.match(result.stdout, /RESULT CC=127 WC=8 GATE=2/);
    });
  }
  for (const [language, rel, heading] of [
    ['English', 'assets/skills/论文撰写English/SKILL.md', '### Step 5: Final verification'],
    ['Chinese', 'assets/skills/论文撰写/SKILL.md', '### Step 6: Final verification'],
  ]) {
    test(`${language} writing verification preserves business failure without fallback`, () => {
      const cwd = fixture(`writing-${language}`);
      put(cwd, '_utils/writing_check.sh', 'echo primary-writing\nexit 6\n');
      put(cwd, 'skills/shared-scripts/writing_check.sh', 'echo fallback-writing\nexit 0\n');
      const script = blockAfter(read(rel), heading) + '\nprintf "WC=%s\\n" "$WC_EXIT"\n';
      const result = run(cwd, script);
      assert.match(result.stdout, /WC=6/);
      assert.doesNotMatch(result.stdout, /fallback-writing/);
    });
  }
  test('English complete final gate accepts inline bibliography without bbl', () => {
    const cwd = fixture('english-full-gate');
    put(cwd, 'paper/main.pdf', 'test fixture only '.repeat(8000));
    put(cwd, '_utils/compile_check.sh', `PAPER_DIR=paper\nEXIT_CODE=0\n${bibliography}\nexit "$EXIT_CODE"\n`);
    put(cwd, '_utils/writing_check.sh', 'exit 0\n');
    const result = run(cwd, blockAfter(en, '### Step 7:') + '\ntest "$GATE_FAIL" -eq 0\n');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /ALL CRITICAL PASSED/);
  });
  test('authority permits 0.42 and 0.50; mismatch and unregistered small dimensions fail', () => {
    const cwd = fixture('figure-sizes');
    put(cwd, '_utils/compile_check.sh', common);
    const tall = String.raw`\includegraphics[width=.42\textwidth,height=.8\textheight,keepaspectratio]{../figures/tall.pdf}`;
    const vertical = String.raw`\includegraphics[width=0.50\textwidth,height=0.80\textheight,keepaspectratio]{../figures/vertical.pdf}`;
    put(cwd, 'figures/latex_includes.tex', `${tall}\n${vertical}\n`);
    put(cwd, 'paper/sections/results.tex', `${tall}\n${vertical}\n`);
    const command = 'bash _utils/compile_check.sh --figure-sizes paper/\n';
    assert.equal(run(cwd, command).status, 0);
    put(cwd, 'paper/sections/results.tex', tall.replace('.42', '.85'));
    assert.equal(run(cwd, command).status, 1);
    // Exercise only the real width-preprocessing section, not the cleanup script.
    const sizing = section(utils, '# 4.5 规整图片宽度', '# 5. 添加 hidelinks');
    let result = run(cwd, 'PAPER_DIR=paper\nPYTHON="$MMW_PYTHON"\n' + sizing);
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(path.join(cwd, 'paper/sections/results.tex'), 'utf8'), /width=\.42/);
    assert.equal(run(cwd, command).status, 0);
    put(cwd, 'paper/sections/results.tex', tall.replace('tall.pdf', 'unregistered.pdf'));
    assert.equal(run(cwd, command).status, 1);
    put(cwd, 'paper/sections/results.tex', String.raw`\includegraphics[width=.85\textwidth,height=.2\textheight,keepaspectratio]{unknown.pdf}`);
    assert.equal(run(cwd, command).status, 1);
  });
  test('genuine parallel panels remain valid and are not expanded by preprocessing', () => {
    const cwd = fixture('parallel');
    put(cwd, '_utils/compile_check.sh', common);
    const tex = String.raw`\begin{minipage}{.48\textwidth}
\includegraphics[width=.48\textwidth,keepaspectratio]{left.pdf}
\end{minipage}
\begin{subfigure}{.48\textwidth}
\includegraphics[width=.48\textwidth,keepaspectratio]{right.pdf}
\end{subfigure}`;
    put(cwd, 'paper/sections/results.tex', tex);
    const sizing = section(utils, '# 4.5 规整图片宽度', '# 5. 添加 hidelinks');
    run(cwd, 'PAPER_DIR=paper\nPYTHON="$MMW_PYTHON"\n' + sizing);
    assert.equal(fs.readFileSync(path.join(cwd, 'paper/sections/results.tex'), 'utf8'), tex);
    assert.equal(run(cwd, 'bash _utils/compile_check.sh --figure-sizes paper/\n').status, 0);
  });
  test('process preflight never calls global process termination or sleep', () => {
    const cwd = fixture('process-preflight');
    const preflight = section(utils, '# 0.', '# 1. 清理特殊 Unicode');
    const result = run(cwd, 'taskkill() { echo FORBIDDEN; return 99; }\npkill() { echo FORBIDDEN; return 99; }\nkill() { echo FORBIDDEN; return 99; }\nsleep() { echo FORBIDDEN; return 99; }\n' + preflight);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /FORBIDDEN/);
    // Also reject alternate calls outside this preflight (never execute the full cleanup script).
    for (const text of [utils, en, zh]) assert.doesNotMatch(text, /\b(?:taskkill|pkill)\b/);
  });
  test('legacy fast review preserves old findings and does not create zero verdict', () => {
    const cwd = fixture('legacy-fast');
    put(cwd, 'CLAUDE.md', 'MMW_FAST_MODE=1\n');
    put(cwd, 'COMP_REVIEW.md', 'Existing unresolved issue R001\n');
    const verdict = '{"fatal_count":1,"findings":[{"id":"R001"}]}';
    put(cwd, 'COMP_REVIEW_VERDICT.json', verdict);
    const skill = read('assets/skills/逻辑对抗复核/SKILL.md');
    assert.equal(run(cwd, blockAfter(skill, '## ⚡')).status, 0);
    assert.equal(fs.readFileSync(path.join(cwd, 'COMP_REVIEW_VERDICT.json'), 'utf8'), verdict);
    const report = fs.readFileSync(path.join(cwd, 'COMP_REVIEW.md'), 'utf8');
    assert.match(report, /Existing unresolved issue R001/);
    assert.match(report, /skipped/);
  });
  console.log(`ALL PASS (${passed} behavioral regressions)`);
} finally {
  // Delete only the exact fresh test directory, never a workspace or a computed user directory.
  assert.ok(path.isAbsolute(scratch) && path.basename(scratch).startsWith('mmw-skills-regression-'));
  fs.rmSync(scratch, { recursive: true, force: true });
}
