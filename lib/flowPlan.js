import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { perProblemFlowStyle } from './switches.js';

// 初始化时写入的标记记录了这个工作区采用的实际引擎，升级后继续沿用。
export async function workspaceFlowStyle(workspace, switches) {
  if (switches?.flow_per_problem === false) return 'off';
  const text = await readFile(path.join(workspace, 'CLAUDE.md'), 'utf8').catch(() => '');
  const marker = [...text.matchAll(/^MMW_PER_PROBLEM_FLOW_STYLE=(html|drawio|gptimage)[ \t]*\r?$/gm)].at(-1);
  return marker?.[1] ?? perProblemFlowStyle(switches);
}

function questionNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  const digits = '零一二三四五六七八九';
  const [tens, ones] = token.split('十');
  if (ones === undefined) return digits.indexOf(token);
  const decade = tens ? digits.indexOf(tens) : 1;
  return decade * 10 + digits.indexOf(ones || '零');
}

export function questionHeadings(analysis) {
  const headings = new Set();
  for (const line of analysis.replace(/^\s*\x60{3,}[\s\S]*?^\s*\x60{3,}[^\n]*$/gm, '').split(/\r?\n/)) {
    if (!/^#{1,6}\s/.test(line)) continue;
    const match = line.match(/(?:问题\s*(\d+|[一二三四五六七八九十]+)|第\s*(\d+|[一二三四五六七八九十]+)\s*问)|\b(?:problem|question|q)\s*(\d+)\b/i);
    if (match) {
      const id = questionNumber(match[1] ?? match[2] ?? match[3]);
      if (id > 0) headings.add(id);
    }
  }
  return headings;
}
