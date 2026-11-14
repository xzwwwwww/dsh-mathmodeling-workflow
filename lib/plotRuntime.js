import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PLOT_RUNTIME_EXPORTS = [
  'setup_style', 'save_fig', 'nature_palette', 'nature_markers', 'set_paper_placement',
  'dynamic_limits', 'draw_vector_heatmap', 'declutter_axes', 'uncertainty_band',
  'auto_legend', 'shared_legend', 'consolidate_shared_legends',
];

export function missingPlotExports(source) {
  // Check declarations without importing Python or requiring matplotlib in the Host.
  const declarations = new Set([...source.matchAll(/^(?:async\s+)?def\s+(\w+)\s*\(/gm)].map((m) => m[1]));
  const aliases = [...source.matchAll(/^(\w+)\s*=\s*(\w+)\s*(?:#.*)?$/gm)];
  for (let i = 0; i < aliases.length; i++) {
    for (const match of aliases) if (declarations.has(match[2])) declarations.add(match[1]);
  }
  return PLOT_RUNTIME_EXPORTS.filter((name) => !declarations.has(name));
}

export async function ensurePlotRuntime(workspace, assetsDir) {
  const sourcePath = path.join(assetsDir, 'utils', 'plot_utils.py');
  const source = await readFile(sourcePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (source === null) return { skipped: true }; // minimal fixture bundles without plotting
  const bundledMissing = missingPlotExports(source);
  if (bundledMissing.length) throw new Error(`插件随包 plot_utils.py 缺少绘图接口：${bundledMissing.join('、')}；请更新插件，不能派发不匹配的绘图提示`);
  const dir = path.join(workspace, '_utils');
  const info = await lstat(dir).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('拒绝更新绘图工具：_utils 不是实际工作区目录');
  if (!info) await mkdir(dir);
  const target = path.join(dir, 'plot_utils.py');
  const targetInfo = await lstat(target).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
  if (targetInfo && (!targetInfo.isFile() || targetInfo.isSymbolicLink())) throw new Error('拒绝更新绘图工具：plot_utils.py 不是实际文件');
  if (!targetInfo) {
    const tmp = path.join(dir, `.plot_utils.${randomUUID()}.tmp`);
    try { await copyFile(sourcePath, tmp); await rename(tmp, target); }
    finally { await rm(tmp, { force: true }); }
    return { copied: true };
  }
  const current = await readFile(target, 'utf8');
  const missing = missingPlotExports(current);
  if (!missing.length) return { compatible: true };
  // The fingerprint migration in scaffold handles known released files first.
  // Unknown customized files stay intact; provide an inspectable official replacement.
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 12);
  let replacement = path.join(dir, `plot_utils.bundled-${digest}.py`);
  try { await writeFile(replacement, source, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await lstat(replacement);
    if (!existing.isFile() || existing.isSymbolicLink() || await readFile(replacement, 'utf8') !== source) {
      replacement = path.join(dir, `plot_utils.bundled-${digest}-${randomUUID()}.py`);
      await writeFile(replacement, source, { encoding: 'utf8', flag: 'wx' });
    }
  }
  const error = new Error(`工作区自定义 plot_utils.py 缺少接口：${missing.join('、')}。原文件已保留；完整新版位于 ${replacement}，请合并新增接口后再派发，不能绕过检查或伪造同名空函数。`);
  error.code = 'PLOT_RUNTIME_INCOMPATIBLE';
  throw error;
}
