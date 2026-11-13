import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function statOrMissing(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

/**
 * Add bundled TeX dependencies to generated template/paper roots, without replacing
 * any existing entry. All report paths are workspace-relative (forward slashes).
 * Symlinks/junctions are never traversed, including in bundled package sources.
 */
export async function syncTexDependencies({ workspaceDir, assetsDir }) {
  const workspace = path.resolve(workspaceDir);
  const source = path.resolve(assetsDir, 'tex-deps');
  const copied = [];
  const preserved = new Set();
  const skipped = [];
  const relative = (file) => path.relative(workspace, file).split(path.sep).join('/') || '.';
  const skip = (file, reason) => skipped.push({ path: relative(file), reason });
  const result = () => ({ copied, preserved: [...preserved], skipped });

  const workspaceStat = await statOrMissing(workspace);
  if (!workspaceStat?.isDirectory() || workspaceStat.isSymbolicLink()) {
    skip(workspace, 'workspace is missing or is not a real directory');
    return result();
  }
  const sourceStat = await statOrMissing(source);
  if (!sourceStat) return result();
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    skip(source, 'dependency source is not a real directory');
    return result();
  }

  // Check each existing ancestor rather than recursive mkdir/cp, which can follow
  // a custom symlink or a junction. A conflicting file blocks only its subtree.
  async function ensureDirectory(directory, create = false) {
    const rel = path.relative(workspace, directory);
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) {
      skip(directory, 'destination is outside the workspace');
      return false;
    }
    let current = workspace;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let info = await statOrMissing(current);
      if (!info && create) {
        try {
          await mkdir(current);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        info = await statOrMissing(current);
      }
      if (!info) return false;
      if (info.isSymbolicLink() || !info.isDirectory()) {
        preserved.add(relative(current));
        skip(current, 'existing destination is not a real directory');
        return false;
      }
    }
    return true;
  }

  async function copyMissing(src, target) {
    if (!(await ensureDirectory(path.dirname(target), true))) return;
    if (await statOrMissing(target)) {
      preserved.add(relative(target));
      return;
    }
    try {
      // Exclusive creation also preserves entries created since the lstat check.
      await copyFile(src, target, constants.COPYFILE_EXCL);
      copied.push(relative(target));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      preserved.add(relative(target));
    }
  }

  const roots = [];
  const templates = path.join(workspace, '_templates');
  if (await ensureDirectory(templates)) {
    for (const entry of await readdir(templates, { withFileTypes: true })) {
      const dir = path.join(templates, entry.name);
      if (entry.isSymbolicLink()) {
        preserved.add(relative(dir));
        skip(dir, 'template directory is a symlink');
      } else if (entry.isDirectory() && await ensureDirectory(dir)) {
        roots.push(dir);
      }
    }
  }
  const paper = path.join(workspace, 'paper');
  if (await ensureDirectory(paper)) roots.push(paper);
  if (!roots.length) return result();

  async function inventory(directory, base = directory, files = [], directories = []) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const info = await statOrMissing(full);
      if (info?.isSymbolicLink()) {
        skip(full, 'dependency source is a symlink');
      } else if (info?.isDirectory()) {
        directories.push(path.relative(base, full));
        await inventory(full, base, files, directories);
      } else if (info?.isFile()) {
        files.push(path.relative(base, full));
      }
    }
    return { files, directories };
  }

  async function runtimeFiles(packageDir, files) {
    const fallback = files.filter((file) => path.dirname(file) === '.' && /\.sty$/i.test(file));
    if (!files.includes('PROVENANCE.json')) return fallback;
    const manifest = path.join(packageDir, 'PROVENANCE.json');
    let provenance;
    try {
      provenance = JSON.parse(await readFile(manifest, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      skip(manifest, 'invalid dependency provenance JSON');
      return [];
    }
    if (!Object.hasOwn(provenance ?? {}, 'runtime_files')) return fallback;
    if (!Array.isArray(provenance.runtime_files)) {
      skip(manifest, 'runtime_files must be an array');
      return [];
    }
    const runtime = new Set();
    for (const name of provenance.runtime_files) {
      // Restrict portable basenames, including on Windows (no drive names, ADS,
      // separators or traversal). Only inventoried regular root files qualify.
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) || name.includes('..')) {
        skip(manifest, `invalid runtime filename: ${JSON.stringify(name)}`);
      } else if (!files.includes(name)) {
        skip(path.join(packageDir, name), 'runtime file is missing or is not a regular root file');
      } else {
        runtime.add(name);
      }
    }
    return [...runtime];
  }

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const packageDir = path.join(source, entry.name);
    const packageStat = await statOrMissing(packageDir);
    if (packageStat?.isSymbolicLink()) {
      skip(packageDir, 'dependency package is a symlink');
      continue;
    }
    if (!packageStat?.isDirectory()) continue;
    const { files, directories } = await inventory(packageDir);
    const runtime = await runtimeFiles(packageDir, files);
    for (const root of roots) {
      for (const file of runtime) await copyMissing(path.join(packageDir, file), path.join(root, file));
      const provenance = path.join(root, 'third-party', 'tex', entry.name);
      if (!(await ensureDirectory(provenance, true))) continue;
      for (const directory of directories) await ensureDirectory(path.join(provenance, directory), true);
      for (const file of files) await copyMissing(path.join(packageDir, file), path.join(provenance, file));
    }
  }
  return result();
}
