import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readTexInputs } from './texInputs.js';

/** Version-1 paper_data_check.py input contract. Hash original bytes after stamping. */
export async function paperDataInputs(ws) {
  const paths = [];
  async function walk(dir, accept) {
    let entries;
    try { entries = await readdir(path.join(ws, dir), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel, accept);
      else if (entry.isFile() && accept(rel, entry.name)) paths.push(rel);
    }
  }
  await walk('paper', (rel) => rel.endsWith('.tex') || rel === 'paper/main.md');
  await walk('figures', (rel, name) => /\.(?:json|tex|md)$/.test(name) && !name.startsWith('TABLE_DATA_CHECK_'));
  for (const rel of ['results.json', 'all_results.json']) {
    try { if ((await stat(path.join(ws, rel))).isFile()) paths.push(rel); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let hasMain = false;
  try { hasMain = (await stat(path.join(ws, 'paper', 'main.tex'))).isFile(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hasMain) {
    const chain = await readTexInputs(ws);
    if (chain.errors.length) throw new Error(chain.errors.join('; '));
    paths.push(...chain.files.keys());
  }
  // v1 uses JavaScript UTF-16 lexical order (Python uses UTF-16BE as its key).
  const unique = [...new Set(paths)].sort();
  return Promise.all(unique.map(async (rel) => ({ path: rel,
    sha256: createHash('sha256').update(await readFile(path.join(ws, rel))).digest('hex') })));
}
