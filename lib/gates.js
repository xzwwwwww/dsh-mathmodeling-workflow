import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { COMPETITIONS } from './switches.js';

const MANIFEST_BEGIN = '<!-- BEGIN FIGURE_MANIFEST -->';
const MANIFEST_END = '<!-- END FIGURE_MANIFEST -->';
const SECTION_KEYWORDS = [
  ['DATA', ['数据图', 'DATA', '数据图表']],
  ['TABLE', ['表格', 'TABLE']],
  // GPTIMG 必须排在 DRAWIO 前：标题同时含「逐问/image」与「流程」时先按 image 归（引擎以 CLAUDE.md 标记为准，解析后再兜底重排）
  ['GPTIMG', ['GPT', '场景图', '概念图', '机理图', '机理示意', '机制图', '机制示意', '系统示意图', '逐问', 'image']],
  ['DRAWIO', ['DRAWIO', '流程', '结构图', '架构图', 'html']],
  ['TIKZ', ['TIKZ', '模型图', '推导', 'tikz']],
];
const NAME_RE = /^(fig_[A-Za-z0-9_]+|tikz_[A-Za-z0-9_]+|TABLE_[A-Za-z0-9_]+)$/;

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

export function parseFigureManifest(text) {
  const start = text.indexOf(MANIFEST_BEGIN);
  const end = text.indexOf(MANIFEST_END);
  if (start < 0 || end <= start) return null;
  const block = text.slice(start + MANIFEST_BEGIN.length, end);
  const groups = {};
  let current = 'OTHER';
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    const bold = line.match(/^\*\*(.+?)\*\*/);
    if (bold) {
      const title = bold[1];
      current = 'OTHER';
      for (const [kind, words] of SECTION_KEYWORDS) {
        if (words.some((w) => title.toLowerCase().includes(w.toLowerCase()))) {
          current = kind;
          break;
        }
      }
      continue;
    }
    const item = line.match(/^[-*]\s+`?([A-Za-z0-9_]+)`?/);
    if (item && NAME_RE.test(item[1])) (groups[current] ??= []).push(item[1]);
  }
  return groups;
}

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
function isFigureProduced(name, exts, stepKey) {
  const e = exts ?? new Set();
  if (/^tikz_/i.test(name)) return e.has('pdf'); // TikZ 只有 PDF 成品
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

export async function gateFigures(ws, step) {
  const ownKinds = STEP_FIGURE_KINDS[step.key];
  if (!(step.gates ?? []).includes('figures') && !ownKinds) {
    return result('figures', true, 2, { reason: 'not a figure gate' });
  }
  if (!ownKinds) {
    return result('figures', true, 2, { reason: `step ${step.key} has no figure kinds`, step: step.key });
  }
  let groups = null;
  let source = null;
  for (const name of ['PROBLEM_ANALYSIS.md', 'PAPER_PLAN.md', 'MODELING_REPORT.md']) {
    const text = await readText(path.join(ws, name));
    if (!text) continue;
    const parsed = parseFigureManifest(text);
    if (parsed) {
      groups = parsed;
      source = name;
      break;
    }
  }
  if (!groups) {
    return result('figures', true, 2, { reason: 'no FIGURE_MANIFEST' }, '⚠ 未找到 FIGURE_MANIFEST：下游无法对账，建议在规划文档补上');
  }
  // 逐问流程图的引擎以 CLAUDE.md 标记为准：即使 manifest 章节名写进了另一组，也按实际引擎归组
  // （避免 image 逐问图被并进 DrawIO/HTML 组，或 DrawIO 逐问图被并进 GPTIMG 组）
  const claudeText = (await readText(path.join(ws, 'CLAUDE.md'))) ?? '';
  const flowStyle = /MMW_PER_PROBLEM_FLOW_STYLE=(gptimage|drawio)/i.exec(claudeText)?.[1]?.toLowerCase();
  if (flowStyle) {
    const from = flowStyle === 'gptimage' ? 'DRAWIO' : 'GPTIMG';
    const to = flowStyle === 'gptimage' ? 'GPTIMG' : 'DRAWIO';
    const moves = (groups[from] ?? []).filter((n) => /^fig_flow_q\d+/i.test(n));
    if (moves.length) {
      groups[from] = groups[from].filter((n) => !moves.includes(n));
      groups[to] = [...(groups[to] ?? []), ...moves];
    }
  }
  const byKind = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  const gptSkipped = [];
  if (ownKinds.includes('GPTIMG') && (groups.GPTIMG ?? []).length && !(await hasGptImageKey(ws))) {
    gptSkipped.push(...groups.GPTIMG);
  }
  const planned = ownKinds
    .flatMap((kind) => groups[kind] ?? [])
    .filter((name) => !gptSkipped.includes(name));
  const deferred = Object.fromEntries(
    Object.entries(groups)
      .filter(([kind]) => !ownKinds.includes(kind))
      .map(([kind, list]) => [kind, list.length]),
  );
  if (!planned.length) {
    return result('figures', true, 2, {
      source,
      scope: ownKinds,
      byKind,
      deferred,
      gptImgSkipped: gptSkipped,
      reason: gptSkipped.length ? '只剩概念图且未配置生图 key，跳过' : 'manifest 里本步没有对应类别的图',
    }, gptSkipped.length
      ? `⚠ 规划了 ${gptSkipped.length} 张概念图/机理图，但没有配置 GPT_IMAGE_API_KEY / _gpt_image_config.json，已跳过（不影响流程）`
      : `⚠ 本步（${ownKinds.join('/')}）在 manifest 里没有要产出的图，跳过对账`);
  }
  const produced = await producedFiles(ws);
  const missing = planned.filter((n) => !isFigureProduced(n, produced.get(n), step.key));
  const detail = {
    source,
    scope: ownKinds,
    planned: planned.length,
    matched: planned.length - missing.length,
    missing,
    byKind,
    deferred,
    gptImgSkipped: gptSkipped,
  };
  if (missing.length) {
    const shown = missing.slice(0, 12).join('、');
    return result('figures', false, 1, detail,
      `本步负责的 ${planned.length} 张（${ownKinds.join('/')}）里还有 ${missing.length} 张没产出：${shown}${missing.length > 12 ? '…' : ''}` +
      '；其他类别的图属于后续步骤，不要越步去画');
  }
  return result('figures', true, 0, detail);
}

// ---------------------------------------------------------------- pages

// 正文页数口径：目录（若有）之后 → 参考文献之前；无目录则摘要之后 → 参考文献之前。
// 因此只统计 paper/sections/ 里的正文章节：排除附录/代码、AI 声明、参考文献等非正文文件。
// 英文论文的临时章节文件 current_chapter.tex 也排除（不参与正文估算）。
const NON_BODY_NAME = /^(?:a_|z_|appendix|references?|0_|00_|current_chapter)/i;
const NON_BODY_MARK = /\\(?:appendix|bibliography)\b|\\begin\{thebibliography\}|\\section\*?\{\s*(?:附录|参考文献|AI\s*工具使用声明|Appendix|References|AI\s*Tool\s*Usage)/i;

export async function gatePages(ws, step) {
  const sectionsDir = path.join(ws, 'paper', 'sections');
  const entries = await listDir(sectionsDir);
  const texFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.tex'));
  if (!texFiles.length) return result('pages', true, 2, { reason: 'no paper/sections/*.tex' });

  const counted = [];
  const skipped = [];
  let chars = 0;
  for (const f of texFiles) {
    const text = (await readText(path.join(sectionsDir, f.name))) ?? '';
    if (NON_BODY_NAME.test(f.name) || NON_BODY_MARK.test(text)) {
      skipped.push(f.name);
      continue;
    }
    counted.push(f.name);
    chars += text.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, ' ').replace(/[{}%~]/g, '').length;
  }
  if (!counted.length) {
    return result('pages', true, 2, { reason: 'no body sections found', skipped },
      '⚠ 没有找到正文 section（只找到附录/参考文献类文件），无法估算正文页数');
  }

  const state = JSON.parse((await readText(path.join(ws, '.mmw', 'state.json'))) ?? '{}');
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

// MCM/ICM 的 25 页是**总页数上限**（含 Summary Sheet/目录/参考文献/附录，AI 使用报告另附），
// 与 max_pages（正文写作目标）是两回事。编译后按 main.log 的实际页数核对。
export async function gatePdfPages(ws) {
  const state = JSON.parse((await readText(path.join(ws, '.mmw', 'state.json'))) ?? '{}');
  const competition = state?.switches?.competition;
  const spec = COMPETITIONS[competition] ?? null;
  const limit = spec?.pageLimit ?? null;
  if (!limit) return result('pdf_pages', true, 2, { reason: 'no page limit for this competition' });
  const log = (await readText(path.join(ws, 'paper', 'main.log'))) ?? '';
  const m = /Output written on main\.pdf\s*\((\d+)\s+pages?/i.exec(log);
  const pages = m ? Number(m[1]) : null;
  if (pages === null) {
    return result('pdf_pages', true, 2, { reason: 'no page count in paper/main.log', limit },
      `⚠ 未能从 paper/main.log 读到 PDF 页数，跳过 ${competition} 总页数硬上限 ${limit} 页核对`);
  }
  const detail = { competition, pages, limit };
  if (pages > limit) {
    return result('pdf_pages', false, 1, detail,
      `PDF 共 ${pages} 页，超过 ${competition} 的硬上限 ${limit} 页（含 Summary Sheet/目录/参考文献/附录；AI 使用报告另附不计）；压正文与附录后重新编译`);
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
  const probes = {};
  const files = [path.join(ws, 'results.json')];
  for (const entry of await listDir(path.join(ws, 'figures'))) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(ws, 'figures', entry.name));
  }
  for (const f of files) {
    const data = await loadJson(f);
    const items = data?.logic_probes?.bounds;
    if (Array.isArray(items)) {
      for (const item of items) if (item?.quantity) probes[String(item.quantity)] = item;
    }
  }
  return probes;
}

async function loadResultValues(ws) {
  const values = {};
  const files = [path.join(ws, 'results.json')];
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

  for (const item of contract?.bounds ?? []) {
    const q = String(item.quantity ?? '');
    const declared = item.is;
    const probe = probes[q];
    if (!probe) {
      skipped.push(`bounds:${q}（无逻辑探针）`);
      continue;
    }
    const sign = num(probe.observed_sign);
    if (sign === null) {
      skipped.push(`bounds:${q}（探针缺 observed_sign）`);
      continue;
    }
    if (declared === 'upper' && sign >= 0) fails.push(`方向反：${q} 声明 upper（输入增大应减小），探针 sign=${sign}`);
    if (declared === 'lower' && sign <= 0) fails.push(`方向反：${q} 声明 lower（输入增大应增大），探针 sign=${sign}`);
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
      if (item.explanation) warns.push(`等价声称差 ${(rel * 100).toFixed(1)}% 但有解释：${item.claim}`);
      else fails.push(`等价声称不成立：${item.claim}（A=${a} B=${b} 差 ${(rel * 100).toFixed(1)}% > ${(tol * 100).toFixed(1)}%）`);
    }
  }

  const mustFeatures = contract?.must_features ?? [];
  if (mustFeatures.length) {
    let codeText = '';
    for (const entry of await listDir(path.join(ws, 'code'))) {
      if (entry.isFile() && entry.name.endsWith('.py')) codeText += (await readText(path.join(ws, 'code', entry.name))) ?? '';
    }
    if (!codeText) skipped.push('must_features（无 code/*.py）');
    else for (const feat of mustFeatures) if (!codeText.includes(String(feat))) fails.push(`漏变量：关键变量「${feat}」没出现在 code/ 源码里`);
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
          if (le !== null && value > le * (1 + REL_TOL)) fails.push(`跨问矛盾：${up} 要求 ${q} ≤ ${le}，但 ${down} 实际 ${value}`);
          if (ge !== null && value < ge * (1 - REL_TOL)) fails.push(`跨问矛盾：${up} 要求 ${q} ≥ ${ge}，但 ${down} 实际 ${value}`);
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
  const decl = path.join(ws, 'paper', 'sections', 'Z_ai_disclosure.tex');
  const appendix = path.join(ws, 'paper', 'appendix', 'B_ai_detail.tex');
  const mainTex = (await readText(path.join(ws, 'paper', 'main.tex'))) ?? '';
  const injected = mainTex.includes('Z_ai_disclosure');
  const mainMd = (await readText(path.join(ws, 'paper', 'main.md'))) ?? '';

  if (mode === 'off') {
    const residue = [];
    if (await isFile(decl)) residue.push('paper/sections/Z_ai_disclosure.tex');
    if (await isFile(appendix)) residue.push('paper/appendix/B_ai_detail.tex');
    if (injected) residue.push('main.tex 的 Z_ai_disclosure \\input');
    if (residue.length) return result('ai_disclosure', false, 1, { mode, residue }, `AI 声明是关的，但检测到残留：${residue.join('、')}`);
    return result('ai_disclosure', true, 0, { mode });
  }

  if (!(await isFile(decl))) return result('ai_disclosure', false, 1, { mode }, '缺 paper/sections/Z_ai_disclosure.tex');
  if (mainTex && !injected) return result('ai_disclosure', false, 1, { mode }, '声明文件存在但 main.tex 没注入 \\input（跑 _utils/inject_ai_disclosure.py）');
  if (mode === 'none') {
    if (await isFile(appendix)) return result('ai_disclosure', false, 1, { mode }, 'none 模式不应有附录使用详情');
    if (!mainMd && !(await isFile(path.join(ws, 'paper', 'main.tex')))) return result('ai_disclosure', false, 1, { mode }, '没有论文主文件');
    return result('ai_disclosure', true, 0, { mode });
  }
  if (!(await isFile(appendix))) return result('ai_disclosure', false, 1, { mode }, 'used 模式缺 paper/appendix/B_ai_detail.tex（四表放附录）');
  const appendixText = (await readText(appendix)) ?? '';
  const tables = (appendixText.match(/\\begin\{(?:tabular|longtable)/g) ?? []).length;
  if (tables < 4) return result('ai_disclosure', false, 1, { mode, tables }, `used 模式附录应有 4 张表，当前 ${tables} 张`);
  return result('ai_disclosure', true, 0, { mode, tables });
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
  const detail = { mode, marker, failed };
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
  for (const name of step.gates ?? ['artifact']) {
    const fn = GATES[name];
    if (!fn) {
      results.push(result(name, true, 3, { reason: 'unknown gate' }));
      continue;
    }
    const r = await fn(ws, step);
    results.push(r);
    if (!r.ok && r.severity === 'hard') break;
  }
  const ok = results.every((r) => r.ok || r.severity === 'soft');
  return { ok, results, hints: results.filter((r) => !r.ok && r.hint).map((r) => r.hint) };
}
