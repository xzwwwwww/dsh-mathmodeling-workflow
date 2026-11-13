import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import path from 'node:path';
import { paperDataInputs } from './paperDataSnapshot.js';
import { COMPETITIONS } from './switches.js';
import { workspaceFlowStyle, questionHeadings } from './flowPlan.js';
import { parseFigureManifest, mergeFigureManifests } from './figureManifest.js';
import { readTexInputs, documentContent } from './texInputs.js';
export { parseFigureManifest } from './figureManifest.js';

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function result(gate, ok, code, detail, hint = '', severity = 'hard') {
  return { gate, ok, code, severity, detail, hint };
}

// ---------------------------------------------------------------- artifact

export async function gateArtifact(ws, step) {
  const rel = step.primaryOutput;
  if (!rel) return result('artifact', true, 2, { reason: 'no primary_output' });
  const target = path.join(ws, rel);
  if (rel.endsWith('/')) {
    if (!(await isDir(target))) return result('artifact', false, 1, { missing: rel }, `主产物目录 ${rel} 不存在，必须在该目录下产出文件`);
    const files = (await listDir(target)).filter((e) => e.isFile());
    if (!files.length) return result('artifact', false, 1, { empty: rel }, `主产物目录 ${rel} 为空`);
    return result('artifact', true, 0, { files: files.length });
  }
  if (!(await isFile(target))) return result('artifact', false, 1, { missing: rel }, `主产物 ${rel} 不存在，必须写出该文件后再结束本步`);
  const info = await stat(target);
  const minBytes = Number(step.minBytes ?? 100);
  if (info.size < minBytes) {
    return result('artifact', false, 1, { path: rel, size: info.size, minBytes }, `主产物 ${rel} 只有 ${info.size} 字节（< ${minBytes}），内容明显不完整`);
  }
  return result('artifact', true, 0, { path: rel, size: info.size });
}

// ---------------------------------------------------------------- companions

async function matchPattern(ws, pattern) {
  if (!pattern.includes('*')) {
    const p = path.join(ws, pattern);
    return (await isFile(p)) ? [p] : [];
  }
  const segments = pattern.split('/');
  const starIdx = segments.findIndex((s) => s.includes('*'));
  if (starIdx < 0) return [];
  const base = path.join(ws, ...segments.slice(0, starIdx));
  const filePattern = segments[starIdx];
  const rest = segments.slice(starIdx + 1);
  const re = new RegExp(`^${filePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const out = [];
  for (const entry of await listDir(base)) {
    if (!re.test(entry.name)) continue;
    const full = path.join(base, entry.name, ...rest);
    if (await isFile(full)) out.push(full);
  }
  return out;
}

export async function gateCompanions(ws, step) {
  const patterns = step.companions ?? [];
  if (!patterns.length) return result('companions', true, 2, { reason: 'none declared' });
  const missing = [];
  const empty = [];
  const found = [];
  for (const pattern of patterns) {
    const hits = await matchPattern(ws, pattern);
    if (!hits.length) {
      missing.push(pattern);
      continue;
    }
    for (const hit of hits) {
      // 英文论文技能的临时工作文件，不是正式章节，不参与二级产物对账
      if (path.basename(hit).toLowerCase() === 'current_chapter.tex') continue;
      const rel = path.relative(ws, hit).split(path.sep).join('/');
      found.push(rel);
      const info = await stat(hit);
      if (info.size <= 50) empty.push(rel);
    }
  }
  const detail = { missing, empty };
  if (missing.length || empty.length) {
    return result(
      'companions',
      false,
      1,
      detail,
      `二级文件缺失或为空占位（>50 字节才算有内容）：${[...missing, ...empty].join('、')}`,
    );
  }
  return result('companions', true, 0, { files: found });
}

// ---------------------------------------------------------------- figures

async function producedFiles(ws) {
  const map = new Map(); // stem -> Set(ext)，零字节文件不算产出
  for (const dir of ['figures', 'paper/figures']) {
    for (const entry of await listDir(path.join(ws, dir))) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const m = /^(.+)\.([^.]+)$/.exec(entry.name);
      if (!m) continue;
      let info;
      try {
        info = await stat(path.join(ws, dir, entry.name));
      } catch {
        continue;
      }
      if (!info.size) continue; // 空文件（0 字节）不能糊弄验收
      if (!map.has(m[1])) map.set(m[1], new Set());
      map.get(m[1]).add(m[2].toLowerCase());
    }
  }
  return map;
}

// 按引擎核对源文件 + 可嵌入论文的成品（不是“文件名出现过就算”）
function isFigureProduced(name, exts, stepKey, flowStyle) {
  const e = exts ?? new Set();
  if (/^tikz_/i.test(name)) return e.has('pdf'); // TikZ 只有 PDF 成品
  // 逐问流程图按实际引擎验收：flow_per_problem 选 drawio 时即使全局是 html 引擎，
  // 这些图也是 DrawIO 产物（.drawio + .pdf），不能强求 .html。
  if (/^fig_flow_q\d+/i.test(name) && flowStyle === 'drawio') return e.has('drawio') && e.has('pdf');
  if (stepKey === 'paper-figure-html') return e.has('html') && e.has('pdf'); // HTML 源 + 截图 PDF
  if (stepKey === 'paper-figure-drawio') return e.has('drawio') && e.has('pdf'); // DrawIO 源 + 导出 PDF
  return e.has('pdf') || e.has('png'); // 数据图 / GPT 概念图
}

// 每个图步只管自己那一类图：数据图步不等流程图，流程图步不重画数据图。
// 否则数据图步会因「缺流程图」永远验收不过，被迫提前干下一步的活。
const STEP_FIGURE_KINDS = {
  'paper-figure': ['DATA', 'GPTIMG'],
  'paper-figure-drawio': ['DRAWIO', 'TIKZ'],
  'paper-figure-html': ['DRAWIO', 'TIKZ'],
};

// 概念图/场景图/机理图（GPTIMG）需要 image API key；没配 key 就不能硬性要求产出，否则整步卡死。
async function hasGptImageKey(ws) {
  if (process.env.GPT_IMAGE_API_KEY) return true;
  const raw = await readText(path.join(ws, '_utils', '_gpt_image_config.json'));
  if (!raw) return false;
  try {
    const cfg = JSON.parse(raw);
    return Boolean(cfg.api_key || cfg.apiKey || cfg.key || cfg.GPT_IMAGE_API_KEY);
  } catch {
    return false;
  }
}

async function gateFlowPlan(ws, step) {
  const state = await loadJson(path.join(ws, '.mmw', 'state.json'));
  const switches = state?.switches;
  if (!switches?.flow_per_problem || switches.skip_figures) return null;
  const engine = await workspaceFlowStyle(ws, switches);
  if (switches.skip_drawio && engine !== 'gptimage') return null;
  const producer = engine === 'gptimage' ? 'paper-figure' : 'paper-figure-' + switches.flowchart_engine;
  if (step.key !== 'comp-prob-analysis' && step.key !== producer) return null;
  const analysis = await readText(path.join(ws, 'PROBLEM_ANALYSIS.md')) ?? '';
  const checklist = await loadJson(path.join(ws, 'CAPABILITY_CHECKLIST.json'));
  const headings = questionHeadings(analysis);
  const count = Number.isSafeInteger(checklist?.n_subproblems) && checklist.n_subproblems > 0 ? checklist.n_subproblems : 0;
  if (!headings.size && !count) {
    return result('flow_plan', false, 1, {}, '请在 CAPABILITY_CHECKLIST.json 填写 n_subproblems 或在赛题分析中逐问列出编号标题');
  }
  const groups = parseFigureManifest(analysis) ?? {};
  const planned = new Set([...(groups.DRAWIO ?? []), ...(groups.GPTIMG ?? [])]
    .filter((name) => /^fig_flow_q\d+$/.test(name)));
  const missingIds = new Set([...headings].filter((id) => !planned.has('fig_flow_q' + id)));
  // 只列前 12 个缺项，异常的题数不能导致巨量分配。
  for (let id = 1; id <= count && missingIds.size < 12; id++) {
    if (!planned.has('fig_flow_q' + id)) missingIds.add(id);
  }
  const missing = [...missingIds].sort((a, b) => a - b).map((id) => 'fig_flow_q' + id);
  const extra = [...planned].filter((name) => {
    const id = Number(name.slice('fig_flow_q'.length));
    return name !== 'fig_flow_q' + id || id < 1 || (id > count && !headings.has(id));
  });
  const ok = !missing.length && !extra.length;
  return result('flow_plan', ok, ok ? 0 : 1, { missing, extra },
    ok ? '' : '请按子问题编号修正 PROBLEM_ANALYSIS.md 的 FIGURE_MANIFEST：缺 ' + missing.join('、') + '；多 ' + extra.join('、'));
}

function fallbackProduced(exts, receiverKey) {
  const e = exts ?? new Set();
  if (!e.has('pdf')) return false;
  if (receiverKey === 'paper-figure-html') return e.has('html');
  if (receiverKey === 'paper-figure-drawio') return e.has('drawio');
  // Standalone calls have no declared future step: the replacement must already exist.
  return e.has('drawio') || e.has('html');
}

async function gptFallback(ws, state, step, names, produced) {
  const status = (await readText(path.join(ws, 'figures', '_gptimg_status.txt')))?.trim() ?? '';
  const raw = (await readText(path.join(ws, 'figures', '_gptimg_failed.txt')))?.trim() ?? '';
  const failed = [...new Set(raw.split(/\s+/).filter(Boolean))];
  const evidence = failed.length > 0 || ['ALL_FAILED', 'SOME_FAILED', 'GPT_IMG_DISABLED'].includes(status);
  if (!evidence) return { evidence: false };
  if (!['ALL_FAILED', 'SOME_FAILED', 'GPT_IMG_DISABLED'].includes(status)) {
    return { evidence, error: 'GPT 失败名单存在但状态不一致；重跑生图并写入 ALL_FAILED/SOME_FAILED 与完整失败名单' };
  }
  // DISABLED is the documented no-Python path; every planned GPT item is transferred.
  const replacements = status === 'GPT_IMG_DISABLED' && !failed.length ? [...names] : failed;
  const unknown = replacements.filter((name) => !names.includes(name));
  const incomplete = !replacements.length || unknown.length
    || (status === 'ALL_FAILED' && replacements.length !== names.length)
    || (status === 'SOME_FAILED' && replacements.length >= names.length);
  if (incomplete) return { evidence, error: 'GPT 失败状态与合并清单/失败名单不一致；请重跑并记录全部失败 basename', unknown };
  const isReceiver = ['paper-figure-html', 'paper-figure-drawio'].includes(step.key);
  const steps = Array.isArray(state?.steps) ? state.steps : [];
  const current = steps.findIndex((s) => s.key === 'paper-figure');
  const future = current >= 0 ? steps.slice(current + 1).find((s) =>
    ['paper-figure-html', 'paper-figure-drawio'].includes(s.key) && !['completed', 'skipped'].includes(s.status)) : null;
  const canTransfer = step.key === 'paper-figure' && future && !state?.switches?.skip_drawio && !state?.switches?.skip_figures;
  if (canTransfer) return { evidence, transferred: replacements, receiverKey: future.key };
  const receiverKey = isReceiver ? step.key : null;
  // No state, no future producer, or skip_drawio: replacements must be delivered now.
  const missing = replacements.filter((name) => !fallbackProduced(produced.get(name), receiverKey));
  return { evidence, replacements, receiverKey,
    ...(missing.length && !isReceiver ? { error: `GPT 失败图没有可移交的后续流程图步骤，必须在本步产出替代源文件和 PDF：${missing.join('、')}`, missing } : {}) };
}

export async function gateFigureMinimum(ws, groups = undefined, produced = undefined) {
  const state = await loadJson(path.join(ws, '.mmw', 'state.json'));
  const raw = state?.switches?.min_figures;
  const minimum = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : null;
  if (!Number.isSafeInteger(minimum) || minimum <= 0) return null;
  groups ??= (await mergeFigureManifests(ws)).groups;
  produced ??= await producedFiles(ws);
  const dataNames = [...new Set(groups?.DATA ?? [])].filter((name) => !name.startsWith('TABLE_'));
  const matched = dataNames.filter((name) => isFigureProduced(name, produced.get(name), 'paper-figure', 'off'));
  const detail = { scope: 'data-figures', minimum, planned: dataNames.length, produced: matched.length, names: matched };
  return result('figure_minimum', matched.length >= minimum, matched.length >= minimum ? 0 : 1, detail,
    matched.length >= minimum ? '' : `显式 min_figures=${minimum} 要求至少 ${minimum} 张数据图；合并清单中已产出 ${matched.length} 张（TABLE/流程图/GPT 概念图不计）`);
}

export async function gateFigures(ws, step) {
  const ownKinds = STEP_FIGURE_KINDS[step.key];
  if (!(step.gates ?? []).includes('figures') && !ownKinds) {
    return result('figures', true, 2, { reason: 'not a figure gate' });
  }
  if (!ownKinds) {
    return result('figures', true, 2, { reason: `step ${step.key} has no figure kinds`, step: step.key });
  }
  const { groups, sources } = await mergeFigureManifests(ws);
  const source = sources.join(',');
  if (!groups) {
    const minimum = await gateFigureMinimum(ws, groups);
    if (minimum && !minimum.ok) return minimum;
    return result('figures', true, 2, { reason: 'no FIGURE_MANIFEST', sources }, '⚠ 未找到 FIGURE_MANIFEST：下游无法对账，建议在规划文档补上');
  }
  // 逐问流程图的引擎以 CLAUDE.md 标记为准：即使 manifest 章节名写进了另一组，也按实际引擎归组
  // （避免 image 逐问图被并进 DrawIO/HTML 组，或 DrawIO 逐问图被并进 GPTIMG 组）
  const state = await loadJson(path.join(ws, '.mmw', 'state.json'));
  const flowStyle = await workspaceFlowStyle(ws, state?.switches);
  if (flowStyle !== 'off') {
    const from = flowStyle === 'gptimage' ? 'DRAWIO' : 'GPTIMG';
    const to = flowStyle === 'gptimage' ? 'GPTIMG' : 'DRAWIO';
    const moves = (groups[from] ?? []).filter((n) => /^fig_flow_q\d+/i.test(n));
    if (moves.length) {
      groups[from] = groups[from].filter((n) => !moves.includes(n));
      groups[to] = [...(groups[to] ?? []), ...moves];
    }
  }
  const byKind = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  const produced = await producedFiles(ws);
  const gptNames = (groups.GPTIMG ?? []).filter((name) => !name.startsWith('TABLE_'));
  const fallback = await gptFallback(ws, state, step, gptNames, produced);
  if (fallback.error) return result('figures', false, 1, { source, sources, ...fallback }, fallback.error);
  const gptSkipped = [];
  // Compatibility: no key and no failure evidence means optional illustrations remain skipped.
  // Failure evidence takes precedence over key availability, including on the receiving step.
  if (ownKinds.includes('GPTIMG') && !fallback.evidence && !(await hasGptImageKey(ws))) {
    gptSkipped.push(...gptNames);
  }
  const transferred = fallback.transferred ?? [];
  const replacements = fallback.replacements ?? [];
  const planned = [...new Set([
    ...ownKinds.flatMap((kind) => groups[kind] ?? [])
      .filter((name) => !name.startsWith('TABLE_') && !gptSkipped.includes(name) && !transferred.includes(name)),
    ...replacements,
  ])];
  const deferred = Object.fromEntries(Object.entries(groups)
    .filter(([kind]) => !ownKinds.includes(kind)).map(([kind, list]) => [kind, list.length]));
  const missing = planned.filter((n) => replacements.includes(n)
    ? !fallbackProduced(produced.get(n), fallback.receiverKey)
    : !isFigureProduced(n, produced.get(n), step.key, flowStyle));
  const detail = {
    source, sources, scope: ownKinds, planned: planned.length,
    matched: planned.length - missing.length, missing, byKind, deferred,
    gptImgSkipped: gptSkipped, gptImgTransferred: transferred,
    gptImgReplacements: replacements, fallbackReceiver: fallback.receiverKey ?? null,
  };
  if (missing.length) {
    return result('figures', false, 1, detail,
      `本步负责的图还有 ${missing.length} 张没产出：${missing.slice(0, 12).join('、')}；` +
      'GPT 失败替代图必须有对应流程图源文件和 PDF，不能只保留失败记录');
  }
  if (step.key === 'paper-figure') {
    const minimum = await gateFigureMinimum(ws, groups, produced);
    if (minimum && !minimum.ok) return minimum;
    if (minimum) detail.minimumDataFigures = minimum.detail;
  }
  return result('figures', true, planned.length || transferred.length ? 0 : 2, detail,
    gptSkipped.length ? `⚠ 未配置生图 key，跳过 ${gptSkipped.length} 张可选概念图/机理图` : '');
}

// ---------------------------------------------------------------- pages

// 正文页数口径：目录（若有）之后 → 参考文献之前；无目录则摘要之后 → 参考文献之前。
// Only literal inputs reachable from main count; unused drafts and TeX comments never do.
const NON_BODY_NAME = /^(?:a_code|z_ai_disclosure|appendix|references?|abstract|summary|title|contents|0_|00_|current_chapter)/i;
const NON_BODY_MARK = /\\(?:appendix|bibliography|printbibliography)\b|\\begin\s*\{(?:thebibliography|appendices|appendixx)\}|\\(?:section|chapter)\*?\s*\{\s*(?:附录|参考文献|AI\s*工具使用声明|Appendix|References|AI\s*Tool\s*Usage)/i;

export async function gatePages(ws, step) {
  const chain = await readTexInputs(ws, { skipFile: (rel) => {
    if (rel === 'paper/main.tex') return false;
    if (/^(?:a_code|z_ai_disclosure|appendix|references?)/i.test(path.basename(rel)) || /\/(?:appendix|appendices)\//i.test(rel)) return '\\appendix';
    return NON_BODY_NAME.test(path.basename(rel));
  } });
  if (chain.errors.length) return result('pages', false, 1, { errors: chain.errors },
    '无法确定正文的实际 TeX 引用链：' + chain.errors.join('；'));
  let body = documentContent(chain.text);
  // Contents (when present) ends the front matter; otherwise start after abstract.
  const starts = [...body.matchAll(/\\tableofcontents\b|\\end\s*\{(?:abstract|summary)\}/g)];
  if (starts.length) {
    const last = starts.at(-1);
    body = body.slice(last.index + last[0].length);
  }
  body = body.split(NON_BODY_MARK)[0];
  const counted = [...chain.files.values()].filter((f) => !f.skipped).map((f) => f.path);
  const skipped = [...chain.files.values()].filter((f) => f.skipped).map((f) => f.path);
  const chars = body.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, ' ').replace(/[{}%~]/g, '').replace(/\s+/g, ' ').trim().length;

  const state = (await loadJson(path.join(ws, '.mmw', 'state.json'))) ?? {};
  const target = state?.switches?.max_pages ?? 30;
  const language = state?.switches?.language ?? 'zh';
  // 中文按 900 字/页；英文按 2200 字符/页（与英文论文技能自检口径一致）
  const charsPerPage = language === 'en' ? 2200 : 900;
  const pages = chars / charsPerPage;
  const detail = {
    scope: 'body-pages',
    definition: '目录之后（无目录则摘要之后）→ 参考文献之前；不含摘要/目录/参考文献/附录',
    language,
    charsPerPage,
    chars,
    estPages: Number(pages.toFixed(1)),
    target,
    sections: counted.length,
    skippedNonBody: skipped,
  };
  if (pages < target * 0.8) {
    const unit = language === 'en' ? `${charsPerPage} chars/page` : `${charsPerPage} 字/页`;
    return result('pages', false, 1, detail,
      `正文约 ${pages.toFixed(1)} 页（${unit}，只算目录后→参考文献前的正文），低于目标 ${target} 页的 80%；` +
      '要扩写正文主体，不是加附录/参考文献，也不是加大字号或拉宽行距');
  }
  return result('pages', true, 0, detail);
}

// ---------------------------------------------------------------- pdf pages（赛事总页数硬上限）

export async function gatePdfPages(ws) {
  const state = JSON.parse((await readText(path.join(ws, '.mmw', 'state.json'))) ?? '{}');
  const competition = state?.switches?.competition;
  const spec = COMPETITIONS[competition] ?? null;
  const limit = spec?.pageLimit ?? null;
  let pages;
  try {
    const bytes = await readFile(path.join(ws, 'paper', 'main.pdf'));
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    pages = document.getPageCount();
    if (!pages) throw new Error('PDF 页树为空');
  } catch (error) {
    return result('pdf_pages', false, 1, { limit, error: error.message },
      '无法读取 paper/main.pdf 的页树，请重新编译有效的 PDF 后再验收');
  }
  const source = 'pdf';
  const separateReport = existsSync(path.join(ws, 'paper', 'ai_usage_report.pdf'));
  const detail = { competition, pages, limit, source, separateAiReport: separateReport };
  if (limit && pages > limit) {
    return result('pdf_pages', false, 1, detail,
      `PDF 共 ${pages} 页（来源 ${source}），超过 ${competition} 的硬上限 ${limit} 页（含 Summary Sheet/目录/参考文献/附录；AI 使用报告请另附 paper/ai_usage_report.pdf，不计入主 PDF）；压正文与附录后重新编译`);
  }
  return result('pdf_pages', true, 0, detail);
}

// ---------------------------------------------------------------- logic

async function loadJson(file) {
  const text = await readText(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = prefix ? `${prefix}.${k}` : k;
      flatten(v, key, out);
      if (v === null || typeof v !== 'object') out[k] = v;
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (prefix) {
    out[prefix] = value;
    out[prefix.split('.').pop()] = value;
  }
  return out;
}

async function loadContract(ws) {
  for (const name of ['LOGIC_CONTRACT.json', 'LOGIC_CONTRACT_MACHINE.json']) {
    const data = await loadJson(path.join(ws, name));
    if (data && typeof data === 'object') return data.LOGIC_CONTRACT_MACHINE ?? data;
  }
  const report = await readText(path.join(ws, 'MODELING_REPORT.md'));
  if (!report) return null;
  for (const m of report.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g)) {
    try {
      const data = JSON.parse(m[1]);
      if (data && data.LOGIC_CONTRACT_MACHINE) return data.LOGIC_CONTRACT_MACHINE;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function collectProbes(ws) {
  const probes = { bounds: [], monotonic: [] };
  const files = [path.join(ws, 'results.json'), path.join(ws, 'all_results.json')];
  for (const entry of await listDir(path.join(ws, 'figures'))) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(ws, 'figures', entry.name));
  }
  for (const f of files) {
    const data = await loadJson(f);
    for (const kind of ['bounds', 'monotonic']) {
      const items = data?.logic_probes?.[kind];
      if (Array.isArray(items)) probes[kind].push(...items.filter((item) => item && typeof item === 'object' && !Array.isArray(item)));
    }
  }
  return probes;
}

async function loadResultValues(ws) {
  const values = {};
  const files = [path.join(ws, 'results.json'), path.join(ws, 'all_results.json')];
  for (const entry of await listDir(path.join(ws, 'figures'))) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(ws, 'figures', entry.name));
  }
  for (const f of files) {
    const data = await loadJson(f);
    if (data) Object.assign(values, flatten(data));
  }
  return values;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function gateLogic(ws, step) {
  const contract = await loadContract(ws);
  const ledger = await loadJson(path.join(ws, 'CROSS_PROBLEM_LEDGER.json'));
  if (!contract && !ledger) {
    return result('logic', true, 2, { reason: 'no LOGIC_CONTRACT_MACHINE / CROSS_PROBLEM_LEDGER' }, '⚠ 无逻辑合同：本步未做方向/重复计量/跨问核对（建议建模步产出 LOGIC_CONTRACT_MACHINE）');
  }
  const probes = await collectProbes(ws);
  const values = await loadResultValues(ws);
  const fails = [];
  const warns = [];
  const skipped = [];
  const normalized = (value) => String(value ?? '').trim().toLowerCase();
  const boundsByQuantity = new Map();
  for (const item of contract?.bounds ?? []) {
    if (!item || !item.quantity || !['upper', 'lower'].includes(normalized(item.is))) continue;
    const q = String(item.quantity);
    const declared = normalized(item.is);
    if (boundsByQuantity.has(q) && boundsByQuantity.get(q) !== declared) fails.push(`合同冲突：${q} 同时声明 upper/lower`);
    else boundsByQuantity.set(q, declared);
  }
  const monotonicByPair = new Map();
  for (const item of contract?.monotonic ?? []) {
    if (!item || !item.more || !item.then) continue;
    const key = JSON.stringify([item.more, item.then]);
    const merged = monotonicByPair.get(key) ?? {};
    const dir = normalized(item.dir ?? item.expect_dir);
    const sign = num(item.expect_sign);
    if (typeof dir === 'string' && dir.trim()) {
      if (merged.dir && merged.dir !== dir) fails.push(`合同冲突：${item.more}→${item.then} 单调 dir 相反`);
      else merged.dir = dir;
    }
    if (sign !== null && sign !== 0) {
      if (merged.expect_sign && (merged.expect_sign > 0) !== (sign > 0)) fails.push(`合同冲突：${item.more}→${item.then} 单调 expect_sign 相反`);
      else merged.expect_sign = sign;
    }
    if (sign === 0 && merged.expect_sign === undefined) merged.expect_sign = 0;
    monotonicByPair.set(key, merged);
  }

  for (const [q] of boundsByQuantity) {
    if (!probes.bounds.some((probe) => String(probe.quantity ?? '') === q)) skipped.push(`bounds:${q}（无逻辑探针）`);
  }
  for (const probe of probes.bounds) {
    const q = String(probe.quantity ?? '?');
    const declared = boundsByQuantity.get(q);
    const claim = declared ?? normalized(probe.claim);
    if (declared && probe.claim !== undefined && normalized(probe.claim) !== declared) fails.push(`探针与合同冲突：${q} claim=${probe.claim}，合同 is=${declared}`);
    const canonical = Object.hasOwn(probe, 'probe_delta_sign');
    const sign = num(canonical ? probe.probe_delta_sign : probe.observed_sign);
    if (sign === null) { fails.push(`bounds:${q}（探针缺有效 probe_delta_sign）`); continue; }
    if (!canonical) warns.push(`bounds:${q} 使用历史 observed_sign；新探针应写 probe_delta_sign`);
    if (sign === 0 || !['upper', 'lower'].includes(claim)) { skipped.push(`bounds:${q}（零变化或无有效方向）`); continue; }
    if (claim === 'upper' && sign > 0) fails.push(`方向反：${q} 声明 upper（输入增大应减小），探针 sign=${sign}`);
    if (claim === 'lower' && sign < 0) fails.push(`方向反：${q} 声明 lower（输入增大应增大），探针 sign=${sign}`);
  }

  for (const probe of probes.monotonic) {
    const declared = monotonicByPair.get(JSON.stringify([probe.more, probe.then]));
    const label = `${probe.more}→${probe.then}`;
    const probeExpectation = num(probe.expect_sign);
    if (declared?.expect_sign && probe.expect_sign !== undefined
      && (!probeExpectation || (declared.expect_sign > 0) !== (probeExpectation > 0))) fails.push(`单调探针与合同冲突：${label} expect_sign`);
    const direction = declared?.dir;
    if (direction && probe.expect_dir !== undefined && direction !== normalized(probe.expect_dir)) fails.push(`单调探针与合同冲突：${label} expect_dir`);
    const observed = num(probe.observed_sign);
    const expected = num(declared?.expect_sign ?? probe.expect_sign);
    if (observed === null) { fails.push(`monotonic:${label}（探针缺有效 observed_sign）`); continue; }
    if (!observed) { skipped.push(`monotonic:${label}（零变化）`); continue; }
    if (expected === null || expected === 0) { warns.push(`monotonic:${label}（未给 expect_sign，需人工确认）`); continue; }
    if ((observed > 0) !== (expected > 0)) fails.push(`单调方向反：${label} observed_sign=${observed}，expect_sign=${expected}`);
  }

  for (const item of contract?.constraints_with_margin ?? []) {
    const q = String(item.quantity ?? '');
    const limit = num(item.limit);
    const value = num(values[q]);
    if (limit === null || value === null) {
      skipped.push(`margin:${q}（缺 limit 或结果值）`);
      continue;
    }
    let margin = (limit - value) / Math.abs(limit || 1);
    if (item.kind === 'ge') margin = -margin;
    const minMargin = num(item.min_margin) ?? 0;
    if (Math.abs(margin) <= 1e-9) fails.push(`零裕度：${q}=${value} 恰好等于限值 ${limit}`);
    else if (margin < minMargin) fails.push(`裕度不足：${q}=${value} 距限值 ${limit} 仅 ${(margin * 100).toFixed(1)}%`);
  }

  for (const item of contract?.equivalence_claims ?? []) {
    const a = num(values[String(item.quantity_a ?? '')]);
    const b = num(values[String(item.quantity_b ?? '')]);
    if (a === null || b === null) {
      skipped.push(`equiv:${item.claim}（两量数值不可得）`);
      continue;
    }
    const tol = num(item.rel_tol) ?? 0.02;
    const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
    if (rel > tol) {
      if (typeof item.explanation === 'string' && item.explanation.trim()) warns.push(`等价声称差 ${(rel * 100).toFixed(1)}% 但有解释：${item.claim}`);
      else fails.push(`等价声称不成立：${item.claim}（A=${a} B=${b} 差 ${(rel * 100).toFixed(1)}% > ${(tol * 100).toFixed(1)}%）`);
    }
  }

  const mustFeatures = contract?.must_features ?? [];
  if (mustFeatures.length) {
    let codeText = '';
    for (const entry of await listDir(path.join(ws, 'code'))) {
      if (entry.isFile() && entry.name.endsWith('.py')) codeText += '\n' + ((await readText(path.join(ws, 'code', entry.name))) ?? '');
    }
    if (!codeText) skipped.push('must_features（无 code/*.py）');
    else for (const feat of mustFeatures) {
      if (typeof feat !== 'string' || !feat.trim()) continue;
      const escaped = feat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(codeText)) fails.push(`漏变量：关键变量「${feat}」没出现在 code/ 源码里`);
    }
  }

  for (const [q, rng] of Object.entries(contract?.train_range ?? {})) {
    if (!Array.isArray(rng) || rng.length !== 2) continue;
    const lo = num(rng[0]);
    const hi = num(rng[1]);
    const value = num(values[q]);
    if (lo === null || hi === null || value === null) continue;
    const width = Math.abs(hi - lo) || 1;
    if (value < lo - 0.5 * width || value > hi + 0.5 * width) {
      warns.push(`外推：${q}=${value} 远离观测区间 [${lo}, ${hi}]，正文必须标「情景模拟、需现场标定」`);
    }
  }

  if (ledger?.problems) {
    // 按题号建观测索引 {problem_id: {quantity: value}}，与 cross_problem_check.py 口径一致。
    // 不能只按指标名合并：不同题的同名指标会互相覆盖，导致跨问约束读错下游值。
    const observed = {};
    for (const p of ledger.problems) {
      const pid = String(p.id ?? '?');
      const obs = {};
      for (const [k, v] of Object.entries(p.observed ?? {})) obs[k] = num(v);
      observed[pid] = obs;
    }
    const REL_TOL = 1e-6;
    for (const p of ledger.problems) {
      const up = String(p.id ?? '?');
      for (const c of p.conclusions ?? []) {
        const q = String(c.quantity ?? '');
        for (const down of c.imposes?.on ?? []) {
          const value = observed[String(down)]?.[q];
          if (value === null || value === undefined) continue;
          const le = num(c.imposes?.must_le);
          const ge = num(c.imposes?.must_ge);
          if (le !== null && value > le + Math.abs(le) * REL_TOL) fails.push(`跨问矛盾：${up} 要求 ${q} ≤ ${le}，但 ${down} 实际 ${value}`);
          if (ge !== null && value < ge - Math.abs(ge) * REL_TOL) fails.push(`跨问矛盾：${up} 要求 ${q} ≥ ${ge}，但 ${down} 实际 ${value}`);
        }
      }
    }
  }

  const detail = { fails, warns, skipped };
  if (fails.length) return result('logic', false, 1, detail, `逻辑硬错，必须修正源产物后重跑：\n- ${fails.join('\n- ')}`);
  return result('logic', true, 0, detail);
}

// ---------------------------------------------------------------- review verdict

export async function gateReviewVerdict(ws) {
  const verdict = await loadJson(path.join(ws, 'COMP_REVIEW_VERDICT.json'));
  if (!verdict) return result('review_verdict', false, 1, { reason: 'verdict missing' }, '缺 COMP_REVIEW_VERDICT.json；对抗复核未收尾');
  const counts = { fatal: verdict.fatal_count, major: verdict.major_count, minor: verdict.minor_count };
  const bad = Object.entries(counts).filter(([, v]) => !(Number.isInteger(v) && v === 0));
  const ledger = await readText(path.join(ws, 'COMP_REVIEW.md'));
  const detail = { counts, findings: (verdict.findings ?? []).length, ledger: Boolean(ledger && ledger.length > 100) };
  if (bad.length) return result('review_verdict', false, 1, detail, `还有未清零的问题：${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (detail.findings > 0) return result('review_verdict', false, 1, detail, 'findings 非空却声称已清零，裁定自相矛盾');
  if (!detail.ledger) return result('review_verdict', false, 1, detail, 'COMP_REVIEW.md 缺失或过短：必须保留首轮发现与修复证据');
  return result('review_verdict', true, 0, detail);
}

// ---------------------------------------------------------------- ai disclosure

export async function gateAiDisclosure(ws) {
  const cm = (await readText(path.join(ws, 'CLAUDE.md'))) ?? '';
  const mode = cm.match(/MMW_AI_DISCLOSURE=(used|none)/)?.[1] ?? 'off';
  const declRel = 'paper/sections/Z_ai_disclosure.tex';
  const detailRel = 'paper/appendix/B_ai_detail.tex';
  const hasTex = await isFile(path.join(ws, 'paper', 'main.tex'));
  const chain = hasTex ? await readTexInputs(ws) : { text: '', files: new Map(), errors: [] };
  const mainMd = hasTex ? '' : (await readText(path.join(ws, 'paper', 'main.md'))) ?? '';
  const text = hasTex ? documentContent(chain.text) : mainMd;
  const statementTitle = /AI\s*(?:工具|Tool\s*)?\s*(?:使用声明|Usage\s+Statement|Usage\s+Disclosure)/i;
  const detailTitle = /AI\s*(?:工具|Tool\s*)?\s*(?:使用详情|Usage\s+Details?)/i;
  const reachableDecl = chain.files.get(declRel);
  const reachableDetail = chain.files.get(detailRel);
  const declaration = Boolean(reachableDecl?.text.trim() || statementTitle.test(text));
  // Prefer the reachable detail file. Otherwise accept details legally inlined in the appendix.
  let detailText = reachableDetail?.text ?? '';
  if (!detailText) {
    const headings = hasTex
      ? [...text.matchAll(/\\(?:section|chapter)\*?\s*\{([^{}]*)\}/g)]
      : [...text.matchAll(/^#{1,2}\s+(.+)$/gm)];
    const index = headings.findIndex((heading) => detailTitle.test(heading[1]));
    if (index >= 0) detailText = text.slice(headings[index].index + headings[index][0].length, headings[index + 1]?.index);
  }
  if (mode === 'off') {
    const residue = [];
    for (const rel of [declRel, detailRel]) if (await isFile(path.join(ws, rel))) residue.push(rel);
    if (declaration || detailTitle.test(text)) residue.push('论文实际引用链中的 AI 声明/详情');
    if (residue.length) return result('ai_disclosure', false, 1, { mode, residue }, `AI 声明是关的，但检测到残留：${residue.join('、')}`);
    return result('ai_disclosure', true, 0, { mode });
  }
  if (chain.errors.length) return result('ai_disclosure', false, 1, { mode, errors: chain.errors }, 'AI 声明引用链不可解析：' + chain.errors.join('；'));
  if (!declaration) return result('ai_disclosure', false, 1, { mode }, '论文主文件实际 input/include 引用链中缺 AI 工具使用声明（可合法内联）');
  if (mode === 'none') {
    if (await isFile(path.join(ws, detailRel)) || detailText || detailTitle.test(text)) return result('ai_disclosure', false, 1, { mode }, 'none 模式不应有附录使用详情');
    return result('ai_disclosure', true, 0, { mode });
  }
  const tables = hasTex
    ? (detailText.match(/\\begin\s*\{(?:tabular\*?|tabularx|tabulary|longtable|longtabu|tblr)\}/g) ?? []).length
    : (detailText.match(/^\s*\|?\s*:?-{3,}:?\s*\|[^\n]*$/gm) ?? []).length;
  const detail = { mode, tables, scope: hasTex ? 'main-input-chain' : 'main-markdown', reachableFiles: [...chain.files.keys()] };
  if (tables < 4) return result('ai_disclosure', false, 1, detail, `used 模式实际引用链/内联附录中应有 4 张表，当前 ${tables} 张；仅在磁盘上写 B_ai_detail.tex 不足以通过`);
  return result('ai_disclosure', true, 0, detail);
}

// ---------------------------------------------------------------- paper data check

export async function gatePaperDataCheck(ws, step) {
  const state = JSON.parse((await readText(path.join(ws, '.mmw', 'state.json'))) ?? '{}');
  const mode = state?.switches?.validation_mode ?? 'strict';
  if (mode !== 'strict') {
    return result('paper_data_check', true, 2, { mode }, '⚠ 快速模式：跳过论文数据真实性核对');
  }
  const report = await readText(path.join(ws, 'PAPER_DATA_CHECK_REPORT.md'));
  const checklist = await readText(path.join(ws, 'PAPER_DATA_CHECKLIST.md'));
  const missing = [];
  if (!report) missing.push('PAPER_DATA_CHECK_REPORT.md');
  if (!checklist) missing.push('PAPER_DATA_CHECKLIST.md');
  if (missing.length) {
    return result('paper_data_check', false, 1, { mode, missing },
      `严格模式必须运行 \`python _utils/paper_data_check.py --mode pdf\`（Word 用 --mode docx）并产出：${missing.join('、')}`);
  }

  const stamp = await loadJson(path.join(ws, 'PAPER_DATA_CHECK_RESULT.json'));
  if (!stamp || stamp.version !== 1 || !['pdf', 'docx'].includes(stamp.mode)
    || stamp.status !== 'passed' || !Array.isArray(stamp.inputs)) {
    return result('paper_data_check', false, 1, { mode, status: stamp?.status ?? 'missing', version: stamp?.version ?? null },
      '缺少本次有效的 PAPER_DATA_CHECK_RESULT.json（version=1/status=passed）；旧 marker/Markdown 不足以验收，请重跑 python _utils/paper_data_check.py --mode pdf（Word 用 --mode docx）');
  }
  let snapshot;
  try { snapshot = await paperDataInputs(ws); }
  catch (error) { return result('paper_data_check', false, 1, { mode, error: error.message }, '无法重算论文数据输入快照；修复读取错误后重跑数据检查'); }
  const fresh = stamp.inputs.length === snapshot.length && stamp.inputs.every((input, i) =>
    input && typeof input.path === 'string' && /^[0-9a-f]{64}$/.test(input.sha256)
    && input.path === snapshot[i].path && input.sha256 === snapshot[i].sha256);
  if (!fresh) return result('paper_data_check', false, 1, { mode, fresh: false, recordedInputs: stamp.inputs.length, currentInputs: snapshot.length },
    '论文/表格/结果已变更，PAPER_DATA_CHECK_RESULT.json 输入哈希快照过期；请重跑 paper_data_check.py 后再验收');

  let marker = false;
  for (const rel of ['paper/main.tex', 'paper/main.md']) {
    const text = await readText(path.join(ws, rel));
    if (text && text.includes('DATA_CHECK_PASSED')) marker = true;
  }
  if (!marker) {
    for (const entry of await listDir(path.join(ws, 'paper', 'sections'))) {
      if (!entry.isFile() || !entry.name.endsWith('.tex')) continue;
      const text = await readText(path.join(ws, 'paper', 'sections', entry.name));
      if (text && text.includes('DATA_CHECK_PASSED')) marker = true;
    }
  }

  const verdict = report.split('## 结论')[1] ?? report;
  const failed = /未通过|必须修改/.test(verdict);
  const detail = { mode, marker, failed, fresh: true, inputs: snapshot.length, version: stamp.version };
  if (failed || !marker) {
    const hint = failed
      ? '论文数据核对未通过：按 PAPER_DATA_CHECKLIST.md 的「未对上」表逐个修数字或改表述，重跑到报告写「通过」'
      : '报告已通过但没有写回 DATA_CHECK_PASSED 标记（重跑脚本会自动写入 main.tex / main.md）';
    return result('paper_data_check', false, 1, detail, hint);
  }
  return result('paper_data_check', true, 0, detail);
}

// ---------------------------------------------------------------- runner

const GATES = {
  artifact: (ws, step) => gateArtifact(ws, step),
  companions: (ws, step) => gateCompanions(ws, step),
  figures: (ws, step) => gateFigures(ws, step),
  pages: (ws, step) => gatePages(ws, step),
  pdf_pages: (ws) => gatePdfPages(ws),
  logic: (ws, step) => gateLogic(ws, step),
  review_verdict: (ws) => gateReviewVerdict(ws),
  ai_disclosure: (ws) => gateAiDisclosure(ws),
  paper_data_check: (ws, step) => gatePaperDataCheck(ws, step),
};

export async function runGates(ws, step) {
  const results = [];
  const names = [...(step.gates ?? ['artifact'])];
  // Old persisted workflows also owe a valid final PDF, irrespective of contest limits.
  if (/^comp-compile-/.test(step.key)) {
    if (!names.includes('pdf_pages')) names.push('pdf_pages');
    if (!names.includes('paper_data_check')) names.push('paper_data_check');
  }
  // 兼容旧工作区已经落盘的 steps/gates 清单。
  if (step.key === 'comp-prob-analysis' || Object.hasOwn(STEP_FIGURE_KINDS, step.key)) {
    const coverage = await gateFlowPlan(ws, step);
    if (coverage) results.push(coverage);
    if (coverage && !coverage.ok) return { ok: false, results, hints: [coverage.hint] };
  }
  for (const name of names) {
    const fn = GATES[name];
    if (!fn) {
      results.push(result(name, true, 3, { reason: 'unknown gate' }));
      continue;
    }
    const r = await fn(ws, step);
    results.push(r);
    if (!r.ok && r.severity === 'hard') break;
  }
  if (/^comp-paper-/.test(step.key) && results.every((r) => r.ok || r.severity === 'soft')) {
    const minimum = await gateFigureMinimum(ws);
    if (minimum) results.push(minimum);
  }
  const ok = results.every((r) => r.ok || r.severity === 'soft');
  return { ok, results, hints: results.filter((r) => !r.ok && r.hint).map((r) => r.hint) };
}
