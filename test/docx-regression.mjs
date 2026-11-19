import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';
import { checkWordPageProof } from '../lib/docxRuntime.js';
import { gateAiDisclosure } from '../lib/gates.js';
import { resolveSteps } from '../lib/steps.js';
import { normalizeSwitches } from '../lib/switches.js';
import { exerciseWord, put } from './docx-workflow-fixture.mjs';
import { PDFDocument } from 'pdf-lib';

assert.equal(normalizeSwitches({}).switches.output_format, 'pdf');
for (const competition of ['cumcm', 'mcm']) {
  const { switches, errors } = normalizeSwitches({ competition, output_format: 'docx' });
  assert.deepEqual(errors, []);
  const steps = resolveSteps(switches);
  assert.equal(steps.length, 8);
  assert.deepEqual(steps.slice(-2).map(step => step.primaryOutput), ['paper/main.md', 'paper/main.docx']);
  assert.ok(steps.at(-2).key.endsWith(`${switches.language}-docx`));
  assert.ok(steps.find(step => step.key === 'comp-review').order < steps.at(-2).order);
}
const pdf = await PDFDocument.create();
pdf.addPage(); pdf.addPage();
const bytes = await pdf.save();
assert.equal(await checkWordPageProof(bytes, 2), 2);
await assert.rejects(checkWordPageProof(bytes, 1), /超过赛事 1 页/);
await assert.rejects(checkWordPageProof(Buffer.from('not a PDF'), 2));
console.log('PASS DOCX switch, routing, and actual PDF page-tree gate');

const check = (binary, args) => binary && spawnSync(binary, args, { stdio: 'ignore', timeout: 5000 }).status === 0;
const dependencies = check(process.env.MMW_PYTHON, ['-I', '-c', 'import docx, PIL']) &&
  check(process.env.MMW_PANDOC || 'pandoc', ['--version']) && check(process.env.MMW_PDFTOPPM || 'pdftoppm', ['-v']);
if (!dependencies) {
  if (process.env.MMW_TEST_DOCX === '1') throw new Error('DOCX release tests require Python with python-docx/Pillow, Pandoc 3.x and pdftoppm.');
  console.log('SKIP live DOCX workflow (missing Python DOCX, Pandoc or PDF image converter)');
} else {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mmw-docx-'));
  const tools = new Map();
  const dispose = apply({ tools: { register(d) { tools.set(d.name, d); return () => tools.delete(d.name); } },
    systemPrompt: { section() { return () => {}; } }, workingDirectory: { ensure: async () => root } });
  try {
    const input = path.join(root, 'input');
    await put(input, 'question.md', '# Synthetic scheduling question\nSelect a feasible plan.');
    const ai = path.join(root, 'disclosure');
    await put(ai, '.mmw/state.json', { switches: { output_format: 'docx', ai_disclosure: 'used' } });
    const decl = '## AI Tool Usage Statement\n\nThe team used a tool for document formatting.\n\n## References\n\nVerified reference.\n\n## AI Tool Usage Details\n\n';
    const grid = '| Tool | Use |\n| --- | --- |\n| Sample | Formatting |\n\n';
    await put(ai, 'paper/main.md', decl + grid.repeat(3));
    assert.equal((await gateAiDisclosure(ai)).ok, false);
    await put(ai, 'paper/main.md', decl + grid.repeat(4));
    assert.equal((await gateAiDisclosure(ai)).ok, true);
    const exec = { agent: { id: 'docx-regression' }, signal: new AbortController().signal };
    const locations = await exerciseWord((name, args) => tools.get(name).execute(args, exec), input,
      { pagination: process.env.MMW_TEST_DOCX_PAGINATION === '1' });
    console.log('PASS strict DOCX eight-step workflow, stale-data/export rejection, and recovery');
    if (locations.english) console.log('PASS English fast DOCX workflow and real pagination');
    if (process.env.MMW_KEEP_DOCX_FIXTURES === '1') console.log(JSON.stringify(locations));
  } finally {
    dispose();
    if (process.env.MMW_KEEP_DOCX_FIXTURES !== '1') await rm(root, { recursive: true, force: true });
  }
}
