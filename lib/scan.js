import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const KIND_BY_EXT = {
  '.pdf': 'problem',
  '.docx': 'problem',
  '.dotx': 'template',
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
const WORD_FILE = /\.do[ct]x$/i;
const TEMPLATE_HINT = /模板|范本|template/i;

export function selectDocxTemplate(switches, uploaded) {
  if (switches.output_format !== 'docx' || switches.docx_template === 'off') return null;
  const word = uploaded.filter((rel) => WORD_FILE.test(rel) && !path.posix.basename(rel).startsWith('~$'));
  const requested = switches.docx_template ?? 'auto';
  if (requested !== 'auto') {
    const rel = requested.replaceAll('\\', '/').replace(/^\.\//, '');
    const selected = word.find((item) => item === rel || item === `user_data/${rel}`);
    if (!selected) throw new Error(`指定的 Word 模板未在赛题输入中找到：${requested}。请填写上传的 .docx/.dotx 相对路径。`);
    return selected;
  }
  const templates = word.filter((item) => /\.dotx$/i.test(item) || TEMPLATE_HINT.test(item));
  if (templates.length > 1) {
    throw new Error(`发现多个 Word 模板：${templates.join('、')}。请用 docx_template 指定一个相对路径。`);
  }
  return templates[0] ?? null;
}

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
      if (ext === '.docx' && TEMPLATE_HINT.test(path.relative(inputDir, full))) kind = 'template';
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
    templateFiles: files.filter((f) => f.kind === 'template').map((f) => f.rel),
    hasData: files.some((f) => f.kind === 'data'),
    hasImages: files.some((f) => f.kind === 'image'),
  };
}
