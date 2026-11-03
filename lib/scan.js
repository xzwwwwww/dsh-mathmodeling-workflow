import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const KIND_BY_EXT = {
  '.pdf': 'problem',
  '.docx': 'problem',
  '.doc': 'problem',
  '.md': 'text',
  '.txt': 'text',
  '.csv': 'data',
  '.tsv': 'data',
  '.xlsx': 'data',
  '.xls': 'data',
  '.json': 'data',
  '.ipynb': 'code',
  '.py': 'code',
  '.m': 'code',
  '.r': 'code',
  '.zip': 'code',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.svg': 'image',
};

const REQUIREMENT_HINTS = ['要求', 'requirement', '说明', 'readme', '自定义', '格式', '模板说明', '注意事项'];
const PROBLEM_HINTS = ['赛题', '题目', 'problem', 'question', '竞赛题', '试题'];

/** 递归扫描输入文件夹（最多三层），返回带分类的文件清单。 */
export async function scanInput(inputDir) {
  const files = [];
  async function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const lower = entry.name.toLowerCase();
      let kind = KIND_BY_EXT[ext] ?? 'other';
      // 文本类文件按名字升级：赛题 > 自定义要求
      if (kind === 'text') {
        if (PROBLEM_HINTS.some((h) => lower.includes(h))) kind = 'problem';
        else if (REQUIREMENT_HINTS.some((h) => lower.includes(h))) kind = 'requirements';
      }
      const info = await stat(full);
      files.push({
        path: full,
        rel: path.relative(inputDir, full).split(path.sep).join('/'),
        name: entry.name,
        ext,
        kind,
        size: info.size,
      });
    }
  }
  await walk(inputDir, 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

export function summarizeScan(files) {
  const byKind = {};
  for (const f of files) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const problems = files.filter((f) => f.kind === 'problem');
  const requirements = files.filter((f) => f.kind === 'requirements');
  return {
    total: files.length,
    byKind,
    problemFiles: problems.map((f) => f.rel),
    requirementFiles: requirements.map((f) => f.rel),
    hasData: files.some((f) => f.kind === 'data'),
    hasImages: files.some((f) => f.kind === 'image'),
  };
}
