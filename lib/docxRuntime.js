import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir } from 'node:fs/promises';
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

// Copy into old, pre-start workspaces that are switched from PDF to Word.
// Gates always use the bundled checker, even if the workspace copy was edited.
export async function ensureDocxTools(workspace, assetsDir) {
  const dir = path.join(workspace, '_utils');
  await mkdir(dir, { recursive: true });
  if (!(await lstat(dir)).isDirectory()) throw new Error('DOCX 工具目录 _utils 必须是实际目录');
  const target = path.join(dir, helper);
  try {
    await copyFile(path.join(assetsDir, 'utils', helper), target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await lstat(target)).isFile()) throw new Error(`_utils/${helper} 必须是实际文件`);
  }
}

export function docxArgs(switches) {
  const competition = Object.hasOwn(COMPETITIONS, switches.competition) ? switches.competition : 'generic';
  return ['--language', switches.language === 'en' ? 'en' : 'zh', '--competition', competition,
    '--page-limit', String(docxPageLimit({ competition }))];
}

export async function inspectDocx(workspace, switches, command, signal) {
  const nodePath = process.env.DSH_NODE_EXECUTABLE || process.execPath;
  const python = process.platform === 'win32' ? 'python.exe' : 'bin/python3';
  const bundledPython = path.resolve(path.dirname(nodePath), '..', '..', 'python', python);
  const desktopPython = process.env.DSH_HOME && path.join(process.env.DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', python);
  const candidates = process.env.MMW_PYTHON ? [process.env.MMW_PYTHON] : [desktopPython, bundledPython, 'python3', 'python'].filter(Boolean);
  for (const executable of candidates) {
    if (signal?.aborted) throw new Error('DOCX 验收已取消');
    try {
      // Do not resolve modules/executables from the paper workspace. Arguments never enter a shell.
      const { stdout } = await exec(executable, ['-I', '-X', 'utf8', bundledHelper, command,
        '--workspace', workspace, ...docxArgs(switches)], { cwd: path.dirname(bundledHelper), windowsHide: true,
        timeout: 90_000, maxBuffer: 1024 * 1024, signal });
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
