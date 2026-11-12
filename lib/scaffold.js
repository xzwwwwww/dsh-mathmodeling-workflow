import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile, copyFile, rm, lstat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildClaudeMd, buildEnvSkill } from './claudeMd.js';
import { STATE_VERSION, writeState } from './state.js';
import { stepDirName } from './steps.js';
import { COMPETITIONS } from './switches.js';

const FONT_FILE_RE = /((?:[\w.-]+\/)*[\w.-]+\.(?:ttf|ttc|otf))/gi;
const WINDOWS_FONTS = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts');
const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.git']);

async function copyDir(src, dst) {
  await cp(src, dst, {
    recursive: true,
    force: true,
    filter: (p) => !p.endsWith('.enc') && !SKIP_DIRS.has(path.basename(p)),
  });
}

async function walk(dir, depth = 0, out = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 2) await walk(full, depth + 1, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/**
 * 从 .tex/.cls/.cfg 里找出模板引用的字体文件名，缺失的从系统字体目录补齐。
 * 支持 `fonts/xxx.ttf` 这类子目录引用；补不上不算硬错误（XeLaTeX 也能按字体名解析），
 * 只写一份 FONTS_MISSING.md 提醒。
 */
export async function ensureFonts(templatesDir, onlyDirs = null) {
  const missing = [];
  const copied = [];
  const seen = new Set();
  if (!existsSync(templatesDir)) return { copied, missing };

  for (const entry of await readdir(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (onlyDirs && !onlyDirs.includes(entry.name)) continue;
    const root = path.join(templatesDir, entry.name);
    for (const file of await walk(root)) {
      if (!/\.(tex|cls|cfg)$/i.test(file)) continue;
      const text = await readFile(file, 'utf8').catch(() => '');
      for (const m of text.matchAll(FONT_FILE_RE)) {
        const ref = m[1].replace(/\\/g, '/');
        const key = `${entry.name}/${ref.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const target = path.join(root, ...ref.split('/'));
        if (existsSync(target)) continue;
        const base = path.basename(ref);
        const candidates = [path.join(WINDOWS_FONTS, base), path.join(WINDOWS_FONTS, base.toLowerCase())];
        let done = false;
        for (const candidate of candidates) {
          if (existsSync(candidate)) {
            await mkdir(path.dirname(target), { recursive: true });
            await copyFile(candidate, target).catch(() => {});
            copied.push(`${entry.name}/${ref}`);
            done = true;
            break;
          }
        }
        if (!done) missing.push(`${entry.name}/${ref}`);
      }
    }
  }

  await writeFile(
    path.join(templatesDir, 'FONTS_MISSING.md'),
    [
      '# 字体检查',
      '',
      copied.length ? `已从系统字体目录补齐：${copied.join('、')}` : '未从系统字体目录补齐任何字体。',
      '',
      missing.length
        ? `以下字体未找到（XeLaTeX 也可能按字体名从系统解析；若编译报缺字体，请手动放入对应模板目录）：\n${missing.map((m) => `- ${m}`).join('\n')}`
        : '模板引用的字体文件均已就位或由系统字体提供。',
      '',
    ].join('\n'),
    'utf8',
  );
  return { copied, missing };
}

/**
 * 创建工作区骨架。
 * @param {object} opts
 * @param {string} opts.workspaceDir 绝对路径
 * @param {string} opts.assetsDir 插件 assets 目录
 * @param {Array<{path:string,rel:string,name:string}>} opts.inputFiles 用户文件夹里的文件
 * @param {object} opts.switches
 * @param {Array} opts.steps
 * @param {string} opts.title
 */
/**
 * 同步 LaTeX 模板包（按语言选技能自带 templates）并回填字体。
 * init 与 modeling_switches（改 language/competition）都调用，避免切换语言后 `_templates` 仍停在旧语言。
 */
export async function syncTemplates({ workspaceDir, assetsDir, switches }) {
  const spec = COMPETITIONS[switches.competition] ?? COMPETITIONS.generic;
  const templateSkill = switches.language === 'en' ? '论文撰写English' : '论文撰写';
  const templateSrc = path.join(assetsDir, 'skills', templateSkill, 'templates');
  const dest = path.join(workspaceDir, '_templates');
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await copyDir(templateSrc, dest);
  const fontInfo = await ensureFonts(dest, [spec.latex, 'default']);
  fontInfo.copied = [...new Set(fontInfo.copied)];
  fontInfo.missing = [...new Set(fontInfo.missing)];
  return { templateSkill, fontInfo };
}

export async function scaffoldWorkspace({ workspaceDir, assetsDir, inputFiles, switches, steps, title }) {
  const dirs = ['user_data', 'code', 'figures', '_utils', '_references', '_templates', 'skills', '_steps', '.mmw'];
  for (const d of dirs) await mkdir(path.join(workspaceDir, d), { recursive: true });

  // 1) 工具库（plot_utils / check 脚本 / scholar_fetch / .pyc 工具）
  await copyDir(path.join(assetsDir, 'utils'), path.join(workspaceDir, '_utils'));

  // 2) KaTeX 素材（html 流程图引擎渲染公式用）
  const katexSrc = path.join(assetsDir, 'katex');
  if (existsSync(katexSrc)) await copyDir(katexSrc, path.join(workspaceDir, '_utils', 'katex'));

  // 3) LaTeX 模板包 + 字体回填（按语言选技能自带 templates：英文用 论文撰写English 的 mcm/apmcm/default）
  const { fontInfo } = await syncTemplates({ workspaceDir, assetsDir, switches });

  // 4) 技能整包（SKILL.md + references/ + templates/ + tools/ 原样复制）
  const skillsSrc = path.join(assetsDir, 'skills');
  const skillNames = await readdir(skillsSrc).catch(() => []);
  for (const name of skillNames) {
    const src = path.join(skillsSrc, name);
    if (!existsSync(src)) continue;
    const dst = path.join(workspaceDir, 'skills', name);
    await copyDir(src, dst);
    const refs = path.join(src, 'references');
    if (existsSync(refs)) await copyDir(refs, path.join(workspaceDir, '_references'));
  }

  // 5) 用户文件：保留相对目录结构（A/data.csv 与 A_data.csv 不再压成同一个文件名），并防同名冲突
  const uploaded = [];
  for (const f of inputFiles) {
    const relParts = String(f.rel ?? path.basename(f.path))
      .split('/')
      .filter((p) => p && p !== '.' && p !== '..');
    const baseTarget = path.join(workspaceDir, 'user_data', ...(relParts.length ? relParts : [path.basename(f.path)]));
    let target = baseTarget;
    let n = 1;
    while (existsSync(target)) {
      target = `${baseTarget}.${n++}`;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(f.path, target);
    uploaded.push(path.relative(workspaceDir, target).split(path.sep).join('/'));
  }

  const claudeMd = buildClaudeMd({ switches, steps, title, uploaded });
  await writeFile(path.join(workspaceDir, 'CLAUDE.md'), claudeMd, 'utf8');
  await writeFile(path.join(workspaceDir, '.env_skill'), buildEnvSkill(switches), 'utf8');

  const now = new Date().toISOString();
  const state = {
    version: STATE_VERSION,
    createdAt: now,
    updatedAt: now,
    title,
    workspace: path.basename(workspaceDir),
    inputFiles: uploaded,
    switches,
    steps: steps.map((st) => ({
      key: st.key,
      title: st.title,
      skill: st.skill,
      order: st.order,
      primaryOutput: st.primaryOutput,
      minBytes: st.minBytes ?? 100,
      companions: st.companions ?? [],
      gates: st.gates ?? ['artifact'],
      status: 'pending',
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      lastGate: null,
      promptPath: path.join('_steps', stepDirName(st.order, st.key), 'prompt.md'),
      dir: path.join('_steps', stepDirName(st.order, st.key)),
    })),
  };
  await writeState(workspaceDir, state);
  return { state, uploaded, fontInfo };
}

// 仅升级已发布的原版脚本（v0.4.4–0.5.0，按 LF 计算 SHA-256），保留工作区自定义版本。
const previousHelpers = {
  'paper_data_check.py': [
    '20dedc16b3040b431bbc3ffc76e973176286e92d8d83092b72327096c253104a',
    '6bfec24b27eefb9cff02bbdb388c49b556c9b6844aeb0057d6df985d76c05c0e',
    'a097de9584bafb6859ce0bfd2cf6daa13502f5e1d2fa208daa52fd3ddfafbd3b',
    'ff46bac2ab477fbd967ef56dce9fc3e3f7404c8eba5877f4b2530c4ae70ced8d',
  ],
  'screenshot_capture.py': [
    '527144d6f2000725248e08f802830dce31c161143c5bab1589df00570c22afe0',
  ],
  'data_profile.py': [
    '36d2beeda0c5fa153a39adbf5ff38b13a25c6f89f9b7170ddcbba1711644bc10',
  ],
  'cross_problem_check.py': [
    '75fba952ec0ddfbc20f877d1354c2f888d4629753d5c5a91ae27665c69c4ba7c',
  ],
};

export async function refreshBundledChecks(workspace, assetsDir) {
  const dir = path.join(workspace, '_utils');
  if (!(await lstat(dir).catch(() => null))?.isDirectory()) return;
  for (const [name, hashes] of Object.entries(previousHelpers)) {
    const target = path.join(dir, name);
    if (!(await lstat(target).catch(() => null))?.isFile()) continue;
    const original = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
    if (!hashes.includes(createHash('sha256').update(original).digest('hex'))) continue;
    const tmp = path.join(dir, '.' + name + '.' + randomUUID());
    try {
      await copyFile(path.join(assetsDir, 'utils', name), tmp);
      await rename(tmp, target);
    } finally {
      await rm(tmp, { force: true });
    }
  }
}

/** 读技能正文（去掉 YAML front matter） */
export async function readSkillBody(assetsDir, skill) {
  const p = path.join(assetsDir, 'skills', skill, 'SKILL.md');
  const raw = await readFile(p, 'utf8');
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end > 0) return raw.slice(raw.indexOf('\n', end + 1) + 1).trimStart();
  }
  return raw;
}

