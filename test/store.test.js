'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeStore, useTempAppData } = require('../fixtures/store');
const { Store } = require('../server/store');
const P = require('../server/paths');

test('a healthy project reports no issues', (t) => {
  const built = makeStore([{ cwd: process.cwd() }]);   // a path that really exists
  t.after(built.cleanup);

  const store = new Store(built.root);
  const p = store.scan(true).projects[0];

  assert.deepEqual(p.issues, []);
  assert.equal(p.healthy, true);
  assert.equal(p.projectExists, true);
  assert.equal(p.folderNameMatchesCwd, true);
});

test('a project whose folder is gone is flagged as orphaned', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Definitely Not Here 9f2c' }]);
  t.after(built.cleanup);

  const p = new Store(built.root).scan(true).projects[0];
  assert.ok(p.issues.includes('orphaned'));
  assert.equal(p.projectExists, false);
});

test('a hand-renamed folder is flagged as a mismatch with the name it should have', (t) => {
  const cwd = process.cwd();
  const built = makeStore([{ cwd, folderName: 'renamed-by-hand' }]);
  t.after(built.cleanup);

  const p = new Store(built.root).scan(true).projects[0];
  assert.ok(p.issues.includes('mismatch'));
  assert.equal(p.folderNameMatchesCwd, false);
  assert.equal(p.expectedFolderName, P.encodeProjectFolder(cwd));
});

test('two projects sharing one encoded name are flagged as ambiguous', (t) => {
  // Equal-length Persian names encode identically.
  const A = 'C:\\Work\\کوییز';
  const B = 'C:\\Work\\سلامت';
  assert.equal(P.encodeProjectFolder(A), P.encodeProjectFolder(B));

  const built = makeStore([{ cwd: A }]);
  t.after(built.cleanup);

  // Drop a second session recorded against the other project into that folder.
  const folder = path.join(built.root, P.encodeProjectFolder(A));
  const { sessionLines } = require('../fixtures/store');
  fs.writeFileSync(path.join(folder, 'aaaaaaaa-0000-4000-8000-000000000000.jsonl'),
    sessionLines(B, 'aaaaaaaa-0000-4000-8000-000000000000', {}), 'utf8');

  const p = new Store(built.root).scan(true).projects[0];
  assert.ok(p.issues.includes('ambiguous'));
  assert.equal(p.rootCandidates.length, 2);
});

test('drive-letter case variants of one path are not ambiguous', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(built.cleanup);

  const folder = path.join(built.root, 'd--Files-Projects-Demo');
  const { sessionLines } = require('../fixtures/store');
  fs.writeFileSync(path.join(folder, 'bbbbbbbb-0000-4000-8000-000000000000.jsonl'),
    sessionLines('d:\\Files\\Projects\\Demo', 'bbbbbbbb-0000-4000-8000-000000000000', {}), 'utf8');

  const p = new Store(built.root).scan(true).projects[0];
  assert.equal(p.issues.includes('ambiguous'), false);
  assert.equal(p.rootCandidates.length, 1);
});

test('an empty folder is reported without crashing the scan', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(built.cleanup);

  fs.mkdirSync(path.join(built.root, 'an-empty-folder'));
  const scan = new Store(built.root).scan(true);
  const empty = scan.projects.find((x) => x.folderName === 'an-empty-folder');

  assert.ok(empty.issues.includes('empty'));
  assert.equal(scan.projects.length, 2);
});

test('session paths cannot escape the store root', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(built.cleanup);
  const store = new Store(built.root);

  assert.throws(() => store.sessionPath('..', 'x'), /Invalid folder/);
  assert.throws(() => store.sessionPath('a/b', 'x'), /Invalid folder/);
  assert.throws(() => store.sessionPath('d--Files-Projects-Demo', '../../secret'), /Invalid folder/);
});

test('a parsed session is cached until the file changes', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(built.cleanup);
  const store = new Store(built.root);

  const folder = 'd--Files-Projects-Demo';
  const sid = fs.readdirSync(path.join(built.root, folder))[0].replace('.jsonl', '');

  const a = store.loadSession(folder, sid);
  const b = store.loadSession(folder, sid);
  assert.equal(a, b, 'same object returned from cache');

  // Touching the file must invalidate it.
  const file = path.join(built.root, folder, sid + '.jsonl');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  const c = store.loadSession(folder, sid);
  assert.notEqual(a, c, 'a changed file is re-parsed');
});

test('setting the root to a non-directory is rejected', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(built.cleanup);
  const store = new Store(built.root);

  assert.throws(() => store.setRoot(path.join(built.root, 'nope-not-here')), /Not a directory/);
});

test('toClientSession strips the turns and keeps the summary', (t) => {
  const built = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  const appData = useTempAppData();
  t.after(() => { built.cleanup(); appData.restore(); });

  const store = new Store(built.root);
  const folder = 'd--Files-Projects-Demo';
  const sid = fs.readdirSync(path.join(built.root, folder))[0].replace('.jsonl', '');
  const { session } = store.loadSession(folder, sid);

  const client = Store.toClientSession(session);
  assert.equal(client.turns, undefined);
  assert.equal(client.turnCount, session.turns.length);
  assert.ok(client.stats);
  assert.ok(client.title);
});
