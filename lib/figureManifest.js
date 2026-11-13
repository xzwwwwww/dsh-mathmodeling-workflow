import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { lexicalCompare } from './lexicalCompare.js';

// Keep category precedence and source ordering in sync with _utils/figure_manifest.py.
export function figureCategory(heading) {
  if (/tikz/i.test(heading)) return 'TIKZ';
  if (/数据图|data\s*(?:figure|plot|chart)s?/i.test(heading)) return 'DATA';
  if (/gpt|image/i.test(heading)) return 'GPTIMG';
  if (/drawio|html/i.test(heading)) return 'DRAWIO';
  if (/场景|概念|机理|机制|系统示意/.test(heading)) return 'GPTIMG';
  if (/流程|结构图|架构图|逐问/.test(heading)) return 'DRAWIO';
  if (/table|表格/i.test(heading)) return 'TABLE';
  return 'DATA';
}

function entries(text) {
  const merged = new Map();
  let found = false;
  for (const block of text.matchAll(/<!-- BEGIN FIGURE_MANIFEST -->([\s\S]*?)<!-- END FIGURE_MANIFEST -->/g)) {
    found = true;
    let category = 'DATA';
    for (const line of block[1].split(/\r?\n/)) {
      if (line.trimStart().startsWith('**')) {
        if (!/(?:总数|total|count)/i.test(line)) category = figureCategory(line);
        continue;
      }
      const match = line.match(/^\s*(?:-\s*)?(?:\[[ xX]\]\s*)?`?((?:fig_|tikz_|TABLE_)[A-Za-z0-9_]+)`?(.*)$/)
        ?? line.match(/^\s*\|\s*`?(TABLE_[A-Za-z0-9_]+)`?(.*\|\s*)$/);
      if (match) merged.set(match[1], category);
    }
  }
  return found ? merged : null;
}

function groupsFrom(merged) {
  const groups = {};
  for (const [name, category] of merged) (groups[category] ??= []).push(name);
  return groups;
}

export function parseFigureManifest(text) {
  const parsed = entries(text);
  return parsed ? groupsFrom(parsed) : null;
}

function stagePriority(name) {
  const stem = path.parse(name).name.toLowerCase();
  if (/problem|analysis/.test(stem)) return 10;
  if (/topic/.test(stem)) return 20;
  if (/plan|proposal|outline/.test(stem)) return 30;
  if (/model|result/.test(stem)) return 40;
  return 25;
}

export async function mergeFigureManifests(ws) {
  const sources = [];
  for (const entry of await readdir(ws, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = path.join(ws, entry.name);
    const parsed = entries(await readFile(full, 'utf8'));
    if (parsed) sources.push({ name: entry.name, priority: stagePriority(entry.name), mtime: (await stat(full, { bigint: true })).mtimeNs, parsed });
  }
  sources.sort((a, b) => a.priority - b.priority || (a.mtime < b.mtime ? -1 : a.mtime > b.mtime ? 1 : 0)
    || lexicalCompare(a.name.toLowerCase(), b.name.toLowerCase()));
  const merged = new Map();
  for (const source of sources) for (const [name, category] of source.parsed) merged.set(name, category);
  return { groups: sources.length ? groupsFrom(merged) : null, sources: sources.map((s) => s.name) };
}
