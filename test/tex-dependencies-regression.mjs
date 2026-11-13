// Offline fixtures only: real CTAN packages and TeX installations are not required.
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { syncTexDependencies } from '../lib/texDependencies.js';
import { refreshBundledChecks, scaffoldWorkspace, syncTemplates } from '../lib/scaffold.js';
import { normalizeSwitches } from '../lib/switches.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'mmw-tex-deps-'));
const assets = path.join(root, 'assets');
const pkg = 'fixture-package';
const styles = { 'fixture.sty': '% fixture dependency\n', 'fixture-extra.STY': '% second dependency\n' };
const sources = {
  ...styles,
  'LICENSE.txt': 'Fixture license for offline redistribution.\n',
  'source/fixture.dtx': '% complete fixture source\n',
  'source/fixture.ins': '% complete fixture installer\n',
  'source/nested/private.sty': '% nested file stays in provenance only\n',
  'doc/README.txt': 'Fixture documentation.\n',
};
let groups = 0;
function pass(name) { groups++; console.log(`PASS ${name}`); }
async function put(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
async function text(file) { return readFile(file, 'utf8'); }
async function absent(file) { await assert.rejects(lstat(file), { code: 'ENOENT' }); }
async function assertDependency(destination) {
  for (const [name, expected] of Object.entries(styles)) assert.equal(await text(path.join(destination, name)), expected);
  for (const [name, expected] of Object.entries(sources)) {
    assert.equal(await text(path.join(destination, 'third-party', 'tex', pkg, name)), expected);
  }
  assert.ok((await lstat(path.join(destination, 'third-party', 'tex', pkg, 'empty'))).isDirectory());
  await absent(path.join(destination, 'private.sty'));
}
async function directoryLink(target, link) {
  await mkdir(path.dirname(link), { recursive: true });
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

try {
  for (const [name, content] of Object.entries(sources)) await put(path.join(assets, 'tex-deps', pkg, name), content);
  await mkdir(path.join(assets, 'tex-deps', pkg, 'empty'));
  // Template fixtures exercise real scaffold selection without copying repository assets.
  for (const skill of ['论文撰写English', '论文撰写']) {
    for (const template of ['mcm', 'apmcm', 'default']) {
      await put(path.join(assets, 'skills', skill, 'templates', template, 'main.tex'), `% ${template}\n`);
    }
  }
  await put(path.join(assets, 'utils', 'fixture.txt'), 'fixture helper\n');

  for (const competition of ['mcm', 'apmcm']) {
    const workspace = path.join(root, `new-${competition}`);
    const switches = normalizeSwitches({ competition }).switches;
    await scaffoldWorkspace({ workspaceDir: workspace, assetsDir: assets, inputFiles: [], switches, steps: [], title: competition });
    for (const template of ['mcm', 'apmcm', 'default']) await assertDependency(path.join(workspace, '_templates', template));
    await absent(path.join(workspace, 'paper'));
  }
  pass('new MCM/APMCM scaffold roots include styles and complete offline source/license trees');

  const direct = path.join(root, 'direct-sync');
  await mkdir(direct);
  const templateInfo = await syncTemplates({ workspaceDir: direct, assetsDir: assets, switches: normalizeSwitches({ competition: 'generic' }).switches });
  assert.ok(templateInfo.texDependencyInfo.copied.includes('_templates/default/fixture.sty'));
  await assertDependency(path.join(direct, '_templates', 'default'));
  pass('syncTemplates reports dependency copies for default and all actual template subdirectories');

  const legacy = path.join(root, 'legacy');
  await put(path.join(legacy, 'paper', 'main.tex'), '% existing paper\n');
  await put(path.join(legacy, '_templates', 'custom-template', 'main.tex'), '% custom template\n');
  await put(path.join(legacy, '_templates', 'notes.txt'), 'do not treat a file as a template');
  const refreshed = await refreshBundledChecks(legacy, assets);
  assert.ok(refreshed.copied.includes('paper/fixture.sty'));
  await assertDependency(path.join(legacy, 'paper'));
  await assertDependency(path.join(legacy, '_templates', 'custom-template'));
  assert.equal(await text(path.join(legacy, '_templates', 'notes.txt')), 'do not treat a file as a template');
  assert.equal(await text(path.join(legacy, 'paper', 'main.tex')), '% existing paper\n');
  await absent(path.join(legacy, '_utils'));
  pass('refreshBundledChecks repairs existing paper and custom templates even without _utils');

  // Keep customized runtime styles, provenance, and unrelated files byte-for-byte.
  await put(path.join(legacy, 'paper', 'fixture.sty'), 'user runtime override\n');
  await put(path.join(legacy, 'paper', 'third-party', 'tex', pkg, 'LICENSE.txt'), 'user license note\n');
  const repeat = await syncTexDependencies({ workspaceDir: legacy, assetsDir: assets });
  assert.equal(repeat.copied.length, 0);
  assert.ok(repeat.preserved.includes('paper/fixture.sty'));
  assert.ok(repeat.preserved.includes(`paper/third-party/tex/${pkg}/LICENSE.txt`));
  assert.equal(await text(path.join(legacy, 'paper', 'fixture.sty')), 'user runtime override\n');
  assert.equal(await text(path.join(legacy, 'paper', 'third-party', 'tex', pkg, 'LICENSE.txt')), 'user license note\n');
  assert.deepEqual(await syncTexDependencies({ workspaceDir: legacy, assetsDir: assets }), repeat);
  pass('custom files survive and repeated synchronization is idempotent');

  const conflicts = path.join(root, 'conflicts');
  await mkdir(path.join(conflicts, '_templates', 'directory-style', 'fixture.sty'), { recursive: true });
  await put(path.join(conflicts, '_templates', 'directory-style', 'fixture.sty', 'keep.txt'), 'custom directory');
  await put(path.join(conflicts, '_templates', 'blocked-provenance', 'third-party'), 'custom blocking file');
  await put(path.join(conflicts, '_templates', 'blocked-source', 'third-party', 'tex', pkg, 'source'), 'custom source file');
  await mkdir(path.join(conflicts, '_templates', 'directory-license', 'third-party', 'tex', pkg, 'LICENSE.txt'), { recursive: true });
  await put(path.join(conflicts, 'paper'), 'custom paper file');
  const conflictInfo = await syncTexDependencies({ workspaceDir: conflicts, assetsDir: assets });
  assert.ok(conflictInfo.preserved.includes('_templates/directory-style/fixture.sty'));
  assert.ok(conflictInfo.preserved.includes('_templates/blocked-provenance/third-party'));
  assert.ok(conflictInfo.preserved.includes(`_templates/blocked-source/third-party/tex/${pkg}/source`));
  assert.ok(conflictInfo.preserved.includes(`_templates/directory-license/third-party/tex/${pkg}/LICENSE.txt`));
  assert.ok(conflictInfo.preserved.includes('paper'));
  assert.equal(await text(path.join(conflicts, '_templates', 'directory-style', 'fixture.sty', 'keep.txt')), 'custom directory');
  assert.equal(await text(path.join(conflicts, '_templates', 'blocked-provenance', 'third-party')), 'custom blocking file');
  assert.equal(await text(path.join(conflicts, '_templates', 'blocked-source', 'third-party', 'tex', pkg, 'source')), 'custom source file');
  assert.equal(await text(path.join(conflicts, '_templates', 'blocked-source', 'third-party', 'tex', pkg, 'LICENSE.txt')), sources['LICENSE.txt']);
  assert.equal(await text(path.join(conflicts, '_templates', 'blocked-provenance', 'fixture.sty')), styles['fixture.sty']);
  assert.ok((await lstat(path.join(conflicts, '_templates', 'directory-license', 'third-party', 'tex', pkg, 'LICENSE.txt'))).isDirectory());
  assert.equal(await text(path.join(conflicts, 'paper')), 'custom paper file');
  pass('file/directory collisions are preserved while independent files continue to sync');

  const outside = path.join(root, 'outside');
  const linked = path.join(root, 'links');
  await mkdir(outside);
  await put(path.join(outside, 'sentinel.txt'), 'outside is untouched\n');
  await mkdir(path.join(linked, '_templates'), { recursive: true });
  await directoryLink(outside, path.join(linked, '_templates', 'escaped-template'));
  await directoryLink(outside, path.join(linked, 'paper'));
  for (const [template, relative] of [
    ['blocked-third-party', 'third-party'],
    ['blocked-tex', 'third-party/tex'],
    ['blocked-package', `third-party/tex/${pkg}`],
    ['blocked-source', `third-party/tex/${pkg}/source`],
    ['blocked-style', 'fixture.sty'],
  ]) {
    await directoryLink(outside, path.join(linked, '_templates', template, relative));
  }
  const danglingTarget = path.join(root, 'does-not-exist');
  await directoryLink(danglingTarget, path.join(linked, '_templates', 'dangling-style', 'fixture.sty'));
  const linkInfo = await syncTexDependencies({ workspaceDir: linked, assetsDir: assets });
  assert.ok(linkInfo.skipped.length >= 6);
  assert.ok(linkInfo.preserved.includes('_templates/dangling-style/fixture.sty'));
  assert.ok((await lstat(path.join(linked, '_templates', 'blocked-style', 'fixture.sty'))).isSymbolicLink());
  assert.ok((await lstat(path.join(linked, '_templates', 'dangling-style', 'fixture.sty'))).isSymbolicLink());
  assert.equal(await text(path.join(linked, '_templates', 'blocked-source', 'third-party', 'tex', pkg, 'LICENSE.txt')), sources['LICENSE.txt']);
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  await absent(danglingTarget);

  const linkedTemplates = path.join(root, 'linked-templates');
  await mkdir(linkedTemplates);
  await directoryLink(outside, path.join(linkedTemplates, '_templates'));
  assert.equal((await syncTexDependencies({ workspaceDir: linkedTemplates, assetsDir: assets })).copied.length, 0);
  const linkedWorkspace = path.join(root, 'linked-workspace');
  await directoryLink(outside, linkedWorkspace);
  assert.equal((await syncTexDependencies({ workspaceDir: linkedWorkspace, assetsDir: assets })).copied.length, 0);
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  pass('workspace/template/paper/provenance links and dangling collisions never escape the workspace');

  // Malformed bundled assets must not import external content either.
  await directoryLink(outside, path.join(assets, 'tex-deps', 'linked-package'));
  await directoryLink(outside, path.join(assets, 'tex-deps', pkg, 'external-source'));
  await directoryLink(outside, path.join(assets, 'tex-deps', pkg, 'external.sty'));
  const sourceLinks = path.join(root, 'source-links');
  await mkdir(path.join(sourceLinks, 'paper'), { recursive: true });
  const sourceInfo = await syncTexDependencies({ workspaceDir: sourceLinks, assetsDir: assets });
  assert.equal(sourceInfo.skipped.filter(item => item.reason.includes('symlink')).length, 3);
  await assertDependency(path.join(sourceLinks, 'paper'));
  await absent(path.join(sourceLinks, 'paper', 'external.sty'));
  await absent(path.join(sourceLinks, 'paper', 'third-party', 'tex', 'linked-package'));
  await absent(path.join(sourceLinks, 'paper', 'third-party', 'tex', pkg, 'external-source'));
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  pass('source package and nested symlinks cannot import files from outside the bundle');

  const runtimeAssets = path.join(root, 'runtime-assets');
  const runtimePackage = path.join(runtimeAssets, 'tex-deps', 'runtime-fixture');
  await put(path.join(runtimePackage, 'runtime.sty'), '% runtime sty');
  await put(path.join(runtimePackage, 'runtime.tex'), '% runtime tex');
  await put(path.join(runtimePackage, 'ignored.sty'), '% source-only sty');
  await put(path.join(runtimePackage, 'source', 'nested.tex'), '% nested source');
  await put(path.join(runtimePackage, 'LICENSE.txt'), 'runtime fixture license');
  await mkdir(path.join(runtimePackage, 'directory.tex'));
  await directoryLink(outside, path.join(runtimePackage, 'linked.tex'));
  const runtimeManifest = {
    runtime_files: ['runtime.sty', 'runtime.tex', 'runtime.tex', '../escape.tex', 'source/nested.tex', '..\\escape.tex',
      'C:\\escape.tex', 'C:escape.tex', '/escape.tex', 'bad..tex', '', 'missing.tex', 'directory.tex', 'linked.tex', 17, null],
  };
  await put(path.join(runtimePackage, 'PROVENANCE.json'), JSON.stringify(runtimeManifest));
  const runtimeWorkspace = path.join(root, 'runtime-manifest');
  await mkdir(path.join(runtimeWorkspace, 'paper'), { recursive: true });
  await mkdir(path.join(runtimeWorkspace, '_templates', 'mcm'), { recursive: true });
  const runtimeInfo = await syncTexDependencies({ workspaceDir: runtimeWorkspace, assetsDir: runtimeAssets });
  for (const destination of [path.join(runtimeWorkspace, 'paper'), path.join(runtimeWorkspace, '_templates', 'mcm')]) {
    assert.equal(await text(path.join(destination, 'runtime.sty')), '% runtime sty');
    assert.equal(await text(path.join(destination, 'runtime.tex')), '% runtime tex');
    await absent(path.join(destination, 'ignored.sty'));
    await absent(path.join(destination, 'escape.tex'));
    await absent(path.join(destination, 'missing.tex'));
    await absent(path.join(destination, 'directory.tex'));
    await absent(path.join(destination, 'linked.tex'));
    assert.equal(await text(path.join(destination, 'third-party', 'tex', 'runtime-fixture', 'ignored.sty')), '% source-only sty');
    assert.equal(await text(path.join(destination, 'third-party', 'tex', 'runtime-fixture', 'LICENSE.txt')), 'runtime fixture license');
    assert.deepEqual(JSON.parse(await text(path.join(destination, 'third-party', 'tex', 'runtime-fixture', 'PROVENANCE.json'))), runtimeManifest);
  }
  assert.ok(runtimeInfo.skipped.some(item => item.reason.startsWith('invalid runtime filename:')));
  assert.ok(runtimeInfo.skipped.some(item => item.reason.includes('not a regular root file')));
  assert.equal(runtimeInfo.copied.filter(file => file === 'paper/runtime.tex').length, 1);
  await absent(path.join(runtimeWorkspace, 'escape.tex'));
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  assert.equal((await syncTexDependencies({ workspaceDir: runtimeWorkspace, assetsDir: runtimeAssets })).copied.length, 0);
  pass('manifest runtime_files includes tex files, deduplicates names and rejects traversal, missing files and links');

  await put(path.join(runtimePackage, 'PROVENANCE.json'), JSON.stringify({ fixture: true }));
  const fallbackWorkspace = path.join(root, 'manifest-fallback');
  await mkdir(path.join(fallbackWorkspace, 'paper'), { recursive: true });
  await syncTexDependencies({ workspaceDir: fallbackWorkspace, assetsDir: runtimeAssets });
  assert.equal(await text(path.join(fallbackWorkspace, 'paper', 'runtime.sty')), '% runtime sty');
  assert.equal(await text(path.join(fallbackWorkspace, 'paper', 'ignored.sty')), '% source-only sty');
  await absent(path.join(fallbackWorkspace, 'paper', 'runtime.tex'));
  pass('a provenance manifest without runtime_files retains root-sty compatibility fallback');

  const empty = path.join(root, 'empty');
  await mkdir(empty);
  assert.deepEqual(await syncTexDependencies({ workspaceDir: empty, assetsDir: assets }), { copied: [], preserved: [], skipped: [] });
  await absent(path.join(empty, 'paper'));
  await absent(path.join(empty, '_templates'));
  const missingAssets = path.join(root, 'missing-assets');
  assert.deepEqual(await syncTexDependencies({ workspaceDir: legacy, assetsDir: missingAssets }), { copied: [], preserved: [], skipped: [] });
  pass('missing assets or generated roots are a no-op and do not create paper');
  const realAssets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
  const actualWorkspace = path.join(root, 'actual-bundled-packages');
  await mkdir(path.join(actualWorkspace, 'paper'), { recursive: true });
  const actualSync = await syncTexDependencies({ workspaceDir: actualWorkspace, assetsDir: realAssets });
  assert.deepEqual(actualSync.skipped, []);
  for (const name of ['xpatch', 'xstring', 'carlisle', 'mweights', 'fontaxes']) {
    const packageDir = path.join(realAssets, 'tex-deps', name);
    const manifest = JSON.parse(await text(path.join(packageDir, 'PROVENANCE.json')));
    assert.equal(manifest.name, name);
    assert.match(manifest.archive_sha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.license.startsWith('LPPL'));
    assert.ok(manifest.runtime_files.length > 0);
    for (const [file, expected] of Object.entries(manifest.files)) {
      const original = await readFile(path.join(packageDir, file));
      assert.equal(createHash('sha256').update(original).digest('hex'), expected, `${name}/${file} differs from recorded upstream bytes`);
      assert.deepEqual(await readFile(path.join(actualWorkspace, 'paper/third-party/tex', name, file)), original);
    }
    for (const file of manifest.runtime_files) {
      assert.ok(Object.hasOwn(manifest.files, file));
      assert.deepEqual(await readFile(path.join(actualWorkspace, 'paper', file)), await readFile(path.join(packageDir, file)));
    }
  }
  pass('real bundled TeX packages match provenance hashes and ship runtime, complete sources and licenses together');
  console.log(`TEX DEPENDENCY REGRESSIONS PASS (${groups} groups)`);
} finally {
  // Only delete the exact temporary root allocated by this suite.
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('mmw-tex-deps-'));
  await rm(root, { recursive: true, force: true });
}
