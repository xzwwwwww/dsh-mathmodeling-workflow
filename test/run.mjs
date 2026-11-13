// One entry point for Node behavioral regressions and Python helper regressions.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundledPython = path.resolve(path.dirname(process.execPath), '..', '..', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
const candidates = [...new Set([process.env.MMW_PYTHON, process.env.PYTHON, bundledPython, 'python', 'python3'].filter(Boolean))];
const python = candidates.find((candidate) => spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 10)'], { stdio: 'ignore' }).status === 0);
if (!python) throw new Error('Python 3.10+ is required for helper regressions; set MMW_PYTHON to its executable.');
const env = { ...process.env, MMW_PYTHON: python, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
const suites = ['smoke.mjs', 'state-regression.mjs', 'gates-regression.mjs', 'skills-regression.mjs', 'tex-dependencies-regression.mjs'];
for (const name of suites) {
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.execPath, [path.join(root, 'test', name)], { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error(result.error ?? `${name} failed (${result.status})`); process.exit(1); }
}
console.log('\nRunning Python helper regressions');
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'test', '-v'], { cwd: root, env, stdio: 'inherit' });
if (result.error || result.status !== 0) { console.error(result.error ?? `Python tests failed (${result.status})`); process.exit(1); }
console.log('\nALL WORKFLOW REGRESSIONS PASS');
