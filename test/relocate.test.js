'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeStore, useTempAppData } = require('../fixtures/store');
const { Store } = require('../server/store');
const RL = require('../server/relocate');
const P = require('../server/paths');

const OLD = 'D:\\Files\\Projects\\Demo';
const NEW = 'E:\\Dev\\Relocated Demo';

function setup(projects) {
  const appData = useTempAppData();
  const store = makeStore(projects || [{ cwd: OLD, sessions: 2 }]);
  return {
    store: new Store(store.root),
    root: store.root,
    cleanup: () => { store.cleanup(); appData.restore(); },
  };
}

function readAll(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

test('planRelocate reports the new name and the work involved', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const plan = RL.planRelocate(s.store, P.encodeProjectFolder(OLD), NEW);

  assert.equal(plan.ok, true);
  assert.equal(plan.newFolderName, 'e--Dev-Relocated-Demo');
  assert.equal(plan.folderRenameNeeded, true);
  assert.ok(plan.totalCwdRewrites > 0);
  assert.equal(plan.files.length, 2);
});

test('a plan changes nothing on disk', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const folder = P.encodeProjectFolder(OLD);
  const before = readAll(path.join(s.root, folder));
  RL.planRelocate(s.store, folder, NEW);
  const after = readAll(path.join(s.root, folder));

  assert.deepEqual(after, before);
});

test('applying renames the folder and rewrites every cwd', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const folder = P.encodeProjectFolder(OLD);
  const { result } = RL.applyRelocate(s.store, folder, NEW);

  assert.equal(result.renamed, true);
  assert.equal(result.newFolderName, 'e--Dev-Relocated-Demo');
  assert.ok(result.cwdRewrites > 0);

  assert.equal(fs.existsSync(path.join(s.root, folder)), false, 'old folder is gone');
  const newDir = path.join(s.root, result.newFolderName);
  assert.ok(fs.existsSync(newDir));

  for (const { text } of readAll(newDir)) {
    for (const line of text.split('\n').filter(Boolean)) {
      const o = JSON.parse(line);           // still valid JSON, line by line
      if (o.cwd) assert.ok(P.isUnder(o.cwd, NEW), `cwd not re-rooted: ${o.cwd}`);
    }
  }
});

test('nothing outside the cwd values is touched', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const folder = P.encodeProjectFolder(OLD);
  const before = readAll(path.join(s.root, folder));
  const { result } = RL.applyRelocate(s.store, folder, NEW);
  const after = readAll(path.join(s.root, result.newFolderName));

  const blank = (t2) => t2.replace(/"cwd":"(?:[^"\\]|\\.)*"/g, '"cwd":<>');
  for (let i = 0; i < before.length; i++) {
    assert.equal(blank(after[i].text), blank(before[i].text),
      'only cwd values may differ after a relocation');
  }
});

test('historical mentions of the old path are left alone', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const folder = P.encodeProjectFolder(OLD);
  const { result } = RL.applyRelocate(s.store, folder, NEW);
  const after = readAll(path.join(s.root, result.newFolderName));

  // The fixture edits "<project>\app.js" via a tool call; that reference is a
  // record of what happened and must survive the move.
  const joined = after.map((f) => f.text).join('');
  assert.ok(joined.includes('app.js'));
  // Accept either separator: the assertion is about the old *directory* still
  // being mentioned, not about which slash the fixture happened to use.
  assert.ok(/Demo(\\{1,2}|\/)app\.js/.test(joined), 'the old file path stays as history');
});

test('undo restores the folder byte for byte', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const folder = P.encodeProjectFolder(OLD);
  const before = readAll(path.join(s.root, folder));

  const { result } = RL.applyRelocate(s.store, folder, NEW);
  RL.undo(s.store, result.id);

  assert.ok(fs.existsSync(path.join(s.root, folder)), 'original folder is back');
  assert.equal(fs.existsSync(path.join(s.root, result.newFolderName)), false);
  assert.deepEqual(readAll(path.join(s.root, folder)), before);
});

test('undo refuses twice', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const { result } = RL.applyRelocate(s.store, P.encodeProjectFolder(OLD), NEW);
  RL.undo(s.store, result.id);
  assert.throws(() => RL.undo(s.store, result.id), /already been undone/);
});

test('a name collision is refused rather than merged', (t) => {
  const s = setup([{ cwd: OLD }, { cwd: 'D:\\Files\\Projects\\Other' }]);
  t.after(s.cleanup);

  assert.throws(
    () => RL.applyRelocate(s.store, P.encodeProjectFolder(OLD), 'D:\\Files\\Projects\\Other'),
    /already exists/,
  );
  // Both folders survive untouched.
  assert.ok(fs.existsSync(path.join(s.root, P.encodeProjectFolder(OLD))));
  assert.ok(fs.existsSync(path.join(s.root, P.encodeProjectFolder('D:\\Files\\Projects\\Other'))));
});

test('a relative path is rejected', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const plan = RL.planRelocate(s.store, P.encodeProjectFolder(OLD), '..\\Somewhere');
  assert.equal(plan.ok, false);
  assert.match(plan.errors[0], /absolute path/);
});

test('fixing only the folder name rewrites no cwd values', (t) => {
  const appData = useTempAppData();
  const built = makeStore([{ cwd: OLD, folderName: 'renamed-by-hand' }]);
  t.after(() => { built.cleanup(); appData.restore(); });
  const store = new Store(built.root);

  const project = store.getProject('renamed-by-hand');
  assert.ok(project.issues.includes('mismatch'));

  const { result } = RL.applyRelocate(store, 'renamed-by-hand', OLD);
  assert.equal(result.cwdRewrites, 0);
  assert.equal(result.newFolderName, P.encodeProjectFolder(OLD));
});

test('bulk remap re-roots every project under a prefix', (t) => {
  const s = setup([
    { cwd: 'D:\\Files\\Projects\\Alpha' },
    { cwd: 'D:\\Files\\Projects\\Beta\\nested' },
    { cwd: 'C:\\Elsewhere\\Gamma' },
  ]);
  t.after(s.cleanup);

  const plan = RL.planBulk(s.store, 'D:\\Files\\Projects', 'E:\\Dev');
  assert.equal(plan.ok, true);
  assert.equal(plan.matches.length, 2);
  assert.equal(plan.skipped.length, 1);

  const names = plan.matches.map((m) => m.newFolderName).sort();
  assert.deepEqual(names, ['e--Dev-Alpha', 'e--Dev-Beta-nested']);

  RL.applyBulk(s.store, 'D:\\Files\\Projects', 'E:\\Dev');
  assert.ok(fs.existsSync(path.join(s.root, 'e--Dev-Alpha')));
  assert.ok(fs.existsSync(path.join(s.root, 'e--Dev-Beta-nested')));
  assert.ok(fs.existsSync(path.join(s.root, P.encodeProjectFolder('C:\\Elsewhere\\Gamma'))));
});

test('a bulk remap that would collide is refused before anything runs', (t) => {
  // Two Persian names of equal length encode to the same folder.
  const s = setup([
    { cwd: 'D:\\Work\\کوییز' },
    { cwd: 'D:\\Work\\سلامت', folderName: 'second-folder' },
  ]);
  t.after(s.cleanup);

  const plan = RL.planBulk(s.store, 'D:\\Work', 'E:\\Work');
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join(' '), /would both become/);
  assert.throws(() => RL.applyBulk(s.store, 'D:\\Work', 'E:\\Work'));
});

test('Persian paths relocate correctly', (t) => {
  const persianOld = 'C:\\Work\\کوییز\\4- Working';
  const persianNew = 'E:\\Backup\\کوییز\\4- Working';
  const s = setup([{ cwd: persianOld }]);
  t.after(s.cleanup);

  const folder = P.encodeProjectFolder(persianOld);
  const { result } = RL.applyRelocate(s.store, folder, persianNew);

  assert.equal(result.newFolderName, P.encodeProjectFolder(persianNew));
  const after = readAll(path.join(s.root, result.newFolderName));
  for (const line of after[0].text.split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    if (o.cwd) assert.match(o.cwd, /Backup/);
  }
});

test('an over-long folder name is rejected', (t) => {
  const s = setup();
  t.after(s.cleanup);

  const deep = 'C:\\' + Array.from({ length: 40 }, (_, i) => `segment-number-${i}`).join('\\');
  const plan = RL.planRelocate(s.store, P.encodeProjectFolder(OLD), deep);
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join(' '), /255-character limit/);
});
