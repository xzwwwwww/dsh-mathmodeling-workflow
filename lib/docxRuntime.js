import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { COMPETITIONS } from './switches.js';

const exec = promisify(execFile);
const helper = 'docx_paper.py';
const bundledHelper = fileURLToPath(new URL(`../assets/utils/${helper}`, import.meta.url));
export const DOCX_PDF_PROOF = 'paper/docx-layout-check.pdf';

export function docxPageLimit(switches) {
  return COMPETITIONS[switches.competition]?.pageLimit ?? 0;
}

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const ORIGINAL_SKILLS = ['中文Word论文撰写', '英文Word论文撰写', 'Word导出', 'Word格式自检', 'Word模板映射'];
const LEGACY_HELPERS = new Set([
  'c4ac1c875425c1b579ba3aa38a788c0de2f7d1b01215f9e68fbf5c33337d806d',
  '47ca0ccae40b3d41c34f83c8df81a0650eed944818f89af0188f56dc3a250f2c',
]);
const originalRequirements = [
  'tools/docx-cn-engine/md_to_docx.js', 'tools/docx-cn-engine/mathml-to-docx.js',
  'tools/docx_style_profiles/competition_zh.json', 'tools/docx_style_profiles/competition_en.json',
  'tools/scholar_fetch.py',
];
const fileExists = async (p) => (await stat(p).catch(() => null))?.isFile() === true;

async function docxNode() {
  if (process.env.MMW_NODE) return process.env.MMW_NODE;
  const binary = process.platform === 'win32' ? 'node.exe' : 'node';
  if (path.basename(process.execPath).toLowerCase() === binary) return process.execPath;
  const desktopNode = process.env.DSH_HOME && path.join(process.env.DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', binary);
  return desktopNode && await fileExists(desktopNode) ? desktopNode : undefined;
}

async function matchesAgentApp(app) {
  if (!(await Promise.all(originalRequirements.map((rel) => fileExists(path.join(app, rel))))).every(Boolean)) return false;
  for (const tool of ['docx_precheck', 'docx_export']) {
    if (!(await fileExists(path.join(app, 'tools', `${tool}.py`)) || await fileExists(path.join(app, 'tools', `${tool}.pyc`)))) return false;
  }
  return true;
}

export async function resolveDocxAgentApp() {
  const app = path.join(assets, 'docx-agent');
  if (!(await matchesAgentApp(app))) throw new Error('插件安装包缺少原版 DOCX 工具或技能，请重新安装完整插件。');
  return realpath(app);
}

function bodyFromSkill(text) {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '').trim();
}

export function docxSkillName(step, switches) {
  if (step.key === 'docx-export') return 'Word导出';
  if (step.key === 'docx-template-map') return 'Word模板映射';
  if (/^comp-paper-(?:zh|en)-docx$/.test(step.key)) return switches.language === 'en' ? '英文Word论文撰写' : '中文Word论文撰写';
  return null;
}

async function replaceGenerated(file, content) {
  const info = await lstat(file).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (info && !info.isFile()) throw new Error(`DOCX 工作流文件必须是普通文件：${file}`);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, { flag: 'wx' });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function ensureDirectory(dir) {
  await mkdir(dir, { recursive: true });
  if (!(await lstat(dir)).isDirectory()) throw new Error(`DOCX 工作流目录必须是实际目录：${dir}`);
}

export async function ensureDocxTools(workspace, assetsDir, { stageSkills = false, template } = {}) {
  const app = await resolveDocxAgentApp();
  const dir = path.join(workspace, '_utils');
  await ensureDirectory(dir);
  const target = path.join(dir, helper);
  const source = await readFile(path.join(assetsDir, 'utils', helper));
  const info = await lstat(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) await replaceGenerated(target, source);
  else {
    if (!info.isFile()) throw new Error(`_utils/${helper} 必须是普通文件`);
    const current = await readFile(target);
    if (!source.equals(current)) {
      const hash = createHash('sha256').update(current.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
      if (!LEGACY_HELPERS.has(hash)) throw new Error(`_utils/${helper} 有自定义改动，请先备份并更新为插件随包版本。`);
      await replaceGenerated(target, source);
    }
  }
  const meta = path.join(workspace, '.mmw');
  await ensureDirectory(meta);
  await replaceGenerated(path.join(meta, 'docx-agent.json'), JSON.stringify({ agentApp: app, node: await docxNode(), template }, null, 2) + '\n');
  if (stageSkills) {
    const dir = path.join(workspace, 'skills');
    await ensureDirectory(dir);
    for (const name of ORIGINAL_SKILLS) {
      const target = path.join(dir, name);
      await ensureDirectory(target);
      await replaceGenerated(path.join(target, 'SKILL.md'), await readFile(path.join(assets, 'skills', name, 'SKILL.md')));
    }
    await replaceGenerated(path.join(workspace, '_utils', 'docx_agent_scholar_fetch.py'), await readFile(path.join(app, 'tools', 'scholar_fetch.py')));
    for (const tool of ['docx_template_analyze.pyc', 'docx_template_fill.pyc']) {
      await replaceGenerated(path.join(workspace, '_utils', tool), await readFile(path.join(app, 'tools', tool)));
    }
  }
  return app;
}

export async function readDocxSkill(name, { templateArgs, legacyTemplate } = {}) {
  if (!ORIGINAL_SKILLS.includes(name)) throw new Error(`未知的原版 DOCX 技能：${name}`);
  const read = async (skill) => bodyFromSkill(await readFile(path.join(assets, 'skills', skill, 'SKILL.md'), 'utf8'));
  const template = async () => {
    let skill = (await read('Word模板映射'))
      .replace(/python3 _utils\/docx_template_fill\.py \\\r?\n[\s\S]*?tee _template_fill\.log/, `python _utils/docx_paper.py export --template-preview --workspace . ${templateArgs.join(' ')}`)
      .replace(/python3 _utils\/docx_template_analyze\.py\b/g, '"$DOCX_AGENT_PYTHON" -I -X utf8 _utils/docx_template_analyze.pyc');
    if (name === 'Word模板映射') {
      skill = skill.replace(/(### Step 1：定位模板 \+ 源 Markdown\s*)```bash[\s\S]*?```/i, (_match, heading) => `${heading}\`\`\`bash\nTEMPLATE=$(python -c 'import json; print(json.load(open(".mmw/docx-agent.json", encoding="utf-8"))["template"])')\nSOURCE=paper/main.md\n[ -f "$TEMPLATE" ] && [ -f "$SOURCE" ] || exit 1\n\`\`\``);
      skill = skill.replace(/\*\*重点关注 log 中的：\*\*[\s\S]*?(?=### Step 6)/, '试填命令须返回 `ok: true`。通过后直接进入下一节，对照试填文件检查各区域。\n\n');
    }
    return skill;
  };
  if (name === 'Word模板映射') return template();
  const body = (await read(name)).replace(/\bMH_([A-Z][A-Z0-9_]*)\b/g, 'MMW_$1');
  if (name !== 'Word导出') return body;
  const format = (await read('Word格式自检')).replace(/\$ARGUMENTS/g, 'paper/main.md');
  return [format, ...(legacyTemplate ? [await template()] : []), body].join('\n\n---\n\n');
}

export function docxArgs(switches) {
  const competition = Object.hasOwn(COMPETITIONS, switches.competition) ? switches.competition : 'generic';
  return ['--language', switches.language === 'en' ? 'en' : 'zh', '--competition', competition,
    '--page-limit', String(docxPageLimit({ competition }))];
}

export async function inspectDocx(workspace, switches, command, signal, template) {
  const agentApp = await resolveDocxAgentApp();
  const node = await docxNode();
  const nodePath = process.env.DSH_NODE_EXECUTABLE || process.execPath;
  const python = process.platform === 'win32' ? 'python.exe' : 'bin/python3';
  const bundledPython = path.resolve(path.dirname(nodePath), '..', '..', 'python', python);
  const desktopPython = process.env.DSH_HOME && path.join(process.env.DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', python);
  const candidates = process.env.MMW_PYTHON ? [process.env.MMW_PYTHON] : [desktopPython, bundledPython, 'python3', 'python'].filter(Boolean);
  const selection = template === null ? ['--no-template'] : template ? ['--template', template] : [];
  for (const executable of candidates) {
    if (signal?.aborted) throw new Error('DOCX 验收已取消');
    try {
      // Do not resolve modules/executables from the paper workspace. Arguments never enter a shell.
      const { stdout } = await exec(executable, ['-I', '-X', 'utf8', bundledHelper, command,
        '--workspace', workspace, '--agent-app', agentApp, ...docxArgs(switches), ...selection], { cwd: path.dirname(bundledHelper), windowsHide: true,
        timeout: 90_000, maxBuffer: 1024 * 1024, signal, env: { ...process.env, MMW_NODE: node } });
      const info = JSON.parse(stdout);
      if (info.ok !== true) throw new Error(info.error || 'DOCX 检查未返回成功');
      return info;
    } catch (error) {
      if (error.code === 'ENOENT' && !process.env.MMW_PYTHON) continue;
      let reason;
      try { reason = JSON.parse(error.stdout).error; } catch { /* process-level diagnostic below */ }
      throw new Error(String(reason || error.stderr?.trim() || error.message).slice(0, 1500));
    }
  }
  throw new Error('找不到 Python。请配置 MMW_PYTHON，并使用提供 python-docx 的 Python 解释器。');
}

export async function checkWordPageProof(bytes, pageLimit) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPageCount();
  if (!pages) throw new Error('DOCX 排版检查 PDF 页树为空');
  if (pages > pageLimit) throw new Error(`DOCX 实际排版 ${pages} 页，超过赛事 ${pageLimit} 页硬上限`);
  return pages;
}
