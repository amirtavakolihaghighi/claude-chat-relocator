'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeStore, useTempAppData } = require('./helpers');
const { Store } = require('../server/store');
const AR = require('../server/archive');
const P = require('../server/paths');

const A = 'D:\\Files\\Projects\\Alpha';
const B = 'C:\\Work\\کوییز';

function setup(projects) {
  const appData = useTempAppData();
  const built = makeStore(projects);
  return {
    store: new Store(built.root),
    root: built.root,
    cleanup: () => { built.cleanup(); appData.restore(); },
  };
}

test('exporting produces a zip with a manifest of real paths', (t) => {
  const s = setup([{ cwd: A }, { cwd: B }]);
  t.after(s.cleanup);

  const { buffer, filename, manifest } = AR.exportArchive(s.store, []);

  assert.ok(buffer.length > 0);
  assert.match(filename, /\.zip$/);
  assert.equal(manifest.projects.length, 2);

  const paths = manifest.projects.map((p) => p.projectPath).sort();
  assert.deepEqual(paths, [P.normalizePath(B), P.normalizePath(A)].sort());
});

test('inspecting an archive recovers each project’s original path', (t) => {
  const s = setup([{ cwd: A }]);
  t.after(s.cleanup);

  const { buffer } = AR.exportArchive(s.store, []);
  const info = AR.inspectArchive(s.store, buffer);
  t.after(() => { try { fs.rmSync(path.join(P.appDataDir(), 'staging'), { recursive: true, force: true }); } catch {} });

  assert.equal(info.hasManifest, true);
  assert.equal(info.projects.length, 1);
  assert.equal(info.projects[0].originalPath, P.normalizePath(A));
  assert.equal(info.projects[0].collides, true, 'it is already in this store');
});

test('importing onto a new path rebuilds the folder name and rewrites cwd', (t) => {
  const s = setup([{ cwd: A }]);
  t.after(s.cleanup);

  const { buffer } = AR.exportArchive(s.store, []);

  // Empty the store, as if this were a different machine.
  fs.rmSync(s.root, { recursive: true, force: true });
  fs.mkdirSync(s.root, { recursive: true });
  s.store.invalidateAll();

  const info = AR.inspectArchive(s.store, buffer);
  const out = AR.applyImport(s.store, info.stagingId, [{
    folderName: info.projects[0].folderName,
    originalPath: info.projects[0].originalPath,
    newProjectPath: 'E:\\Imported\\Alpha',
    skip: false,
  }]);

  assert.equal(out.errors.length, 0);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].newFolderName, 'e--Imported-Alpha');
  assert.ok(out.results[0].cwdRewrites > 0);

  const dir = path.join(s.root, 'e--Imported-Alpha');
  assert.ok(fs.existsSync(dir));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      const o = JSON.parse(line);
      if (o.cwd) assert.ok(P.isUnder(o.cwd, 'E:\\Imported\\Alpha'), o.cwd);
    }
  }
});

test('a skipped project is not imported', (t) => {
  const s = setup([{ cwd: A }]);
  t.after(s.cleanup);

  const { buffer } = AR.exportArchive(s.store, []);
  fs.rmSync(s.root, { recursive: true, force: true });
  fs.mkdirSync(s.root, { recursive: true });
  s.store.invalidateAll();

  const info = AR.inspectArchive(s.store, buffer);
  const out = AR.applyImport(s.store, info.stagingId, [{
    folderName: info.projects[0].folderName,
    originalPath: info.projects[0].originalPath,
    newProjectPath: 'E:\\Imported\\Alpha',
    skip: true,
  }]);

  assert.equal(out.results.length, 0);
  assert.equal(fs.readdirSync(s.root).length, 0);
});

test('importing over an existing folder is refused', (t) => {
  const s = setup([{ cwd: A }]);
  t.after(s.cleanup);

  const { buffer } = AR.exportArchive(s.store, []);
  const info = AR.inspectArchive(s.store, buffer);
  const out = AR.applyImport(s.store, info.stagingId, [{
    folderName: info.projects[0].folderName,
    originalPath: info.projects[0].originalPath,
    newProjectPath: A,          // already present in this store
    skip: false,
  }]);

  assert.equal(out.results.length, 0);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /already exists/);
});

test('Persian project paths survive an archive round trip', (t) => {
  const s = setup([{ cwd: B }]);
  t.after(s.cleanup);

  const { buffer } = AR.exportArchive(s.store, []);
  fs.rmSync(s.root, { recursive: true, force: true });
  fs.mkdirSync(s.root, { recursive: true });
  s.store.invalidateAll();

  const info = AR.inspectArchive(s.store, buffer);
  assert.match(info.projects[0].originalPath, /کوییز/);

  const target = 'E:\\Backup\\کوییز';
  const out = AR.applyImport(s.store, info.stagingId, [{
    folderName: info.projects[0].folderName,
    originalPath: info.projects[0].originalPath,
    newProjectPath: target,
    skip: false,
  }]);

  assert.equal(out.errors.length, 0);
  assert.equal(out.results[0].newFolderName, P.encodeProjectFolder(target));
});

test('a staging id cannot escape the staging directory', (t) => {
  const s = setup([{ cwd: A }]);
  t.after(s.cleanup);

  assert.throws(() => AR.applyImport(s.store, '../../etc', []), /Invalid staging id/);
  assert.throws(() => AR.applyImport(s.store, 'not-an-import-id', []), /Invalid staging id/);
});

test('a file that is not a zip is rejected clearly', (t) => {
  const s = setup([{ cwd: A }]);
  t.after(s.cleanup);

  assert.throws(
    () => AR.inspectArchive(s.store, Buffer.from('this is plainly not a zip file')),
    /not a readable zip/,
  );
});
