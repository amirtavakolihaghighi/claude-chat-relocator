'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, cleanup } = require('../fixtures/store');
const { Vault, isSafeRel, kindOf } = require('../server/vault');

/** A tiny ~/.claude/projects-shaped tree: { 'folder/file': 'text', ... } */
function tree(files, root = path.join(tempDir('ccr-src'), 'projects')) {
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return root;
}

function setup(t, files) {
  const src = tree(files);
  const vaultDir = path.join(tempDir('ccr-vault'), 'archive');
  t.after(() => { cleanup(path.dirname(src)); cleanup(path.dirname(vaultDir)); });
  return { src, vault: new Vault(vaultDir), vaultDir };
}

const write = (root, rel, text, when) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  if (when) fs.utimesSync(f, when, when);
};
const held = (vault, rel) => fs.readFileSync(vault.currentPath(rel), 'utf8');

test('the first save copies every file and keeps its date', (t) => {
  const { src, vault } = setup(t, {
    'd--Work-app/s1.jsonl': '{"a":1}\n',
    'd--Work-app/s1/subagents/agent-x.jsonl': '{"b":2}\n',
    'd--Work-app/memory/MEMORY.md': '- note\n',
  });
  const old = new Date('2026-09-01T10:00:00Z');
  fs.utimesSync(path.join(src, 'd--Work-app', 's1.jsonl'), old, old);

  const r = vault.save(src);
  assert.equal(r.counts.added, 3);
  assert.equal(held(vault, 'd--Work-app/s1/subagents/agent-x.jsonl'), '{"b":2}\n');
  const st = fs.statSync(vault.currentPath('d--Work-app/s1.jsonl'));
  assert.equal(Math.round(st.mtimeMs / 1000), Math.round(old.getTime() / 1000));
});

test('a chat that only grew replaces the archived copy without keeping a second one', (t) => {
  const { src, vault } = setup(t, { 'p/s.jsonl': 'line1\n' });
  vault.save(src);
  write(src, 'p/s.jsonl', 'line1\nline2\n', new Date(Date.now() + 5000));

  const r = vault.save(src);
  assert.equal(r.counts.grew, 1);
  assert.equal(held(vault, 'p/s.jsonl'), 'line1\nline2\n');
  assert.equal(vault.versionsOf('p/s.jsonl').versions.length, 0);
});

test('a rewritten memory file keeps its old wording as a readable version', (t) => {
  const { src, vault } = setup(t, { 'p/memory/notes.md': '- keep buttons big\n- icons outline only\n' });
  vault.save(src);
  write(src, 'p/memory/notes.md', '- buttons 44px\n', new Date(Date.now() + 5000));

  const r = vault.save(src);
  assert.equal(r.counts.versioned, 1);
  assert.equal(held(vault, 'p/memory/notes.md'), '- buttons 44px\n');
  const v = vault.versionsOf('p/memory/notes.md');
  assert.equal(v.versions.length, 1);
  assert.equal(vault.readText('p/memory/notes.md', v.versions[0].sha256), '- keep buttons big\n- icons outline only\n');
});

test('a chat deleted from Claude Code stays in the archive and is dated', (t) => {
  const { src, vault } = setup(t, { 'p/old.jsonl': 'x\n', 'p/new.jsonl': 'y\n' });
  vault.save(src);
  fs.rmSync(path.join(src, 'p', 'old.jsonl'));

  const r = vault.save(src);
  assert.equal(r.counts.gone, 1);
  assert.equal(held(vault, 'p/old.jsonl'), 'x\n');
  assert.ok(vault.versionsOf('p/old.jsonl').goneFromLiveAt);
  assert.deepEqual(vault.archiveOnlyChats(src).map((c) => c.sessionId), ['old']);
});

test('a chat that comes back is no longer marked as gone', (t) => {
  const { src, vault } = setup(t, { 'p/s.jsonl': 'x\n' });
  vault.save(src);
  fs.rmSync(path.join(src, 'p', 's.jsonl'));
  vault.save(src);
  write(src, 'p/s.jsonl', 'x\n');

  const r = vault.save(src);
  assert.equal(r.counts.back, 1);
  assert.equal(vault.versionsOf('p/s.jsonl').goneFromLiveAt, null);
});

test('importing an older, shorter copy of a chat changes nothing', (t) => {
  const { src, vault } = setup(t, { 'p/s.jsonl': 'a\nb\nc\n' });
  vault.save(src);
  const backup = tree({ 'p/s.jsonl': 'a\nb\n' });
  t.after(() => cleanup(path.dirname(backup)));

  const r = vault.save(backup, { mode: 'import' });
  assert.equal(r.counts.kept, 1);
  assert.equal(held(vault, 'p/s.jsonl'), 'a\nb\nc\n');
  assert.equal(vault.versionsOf('p/s.jsonl').versions.length, 0);
});

test('importing an older rewritten file keeps it as a version, not as the current copy', (t) => {
  const { src, vault } = setup(t, { 'p/memory/m.md': 'new wording\n' });
  vault.save(src);
  const backup = tree({ 'p/memory/m.md': 'old wording that was dropped\n' });
  t.after(() => cleanup(path.dirname(backup)));
  const past = new Date(Date.now() - 86400000 * 5);
  fs.utimesSync(path.join(backup, 'p', 'memory', 'm.md'), past, past);

  vault.save(backup, { mode: 'import' });
  assert.equal(held(vault, 'p/memory/m.md'), 'new wording\n');
  const v = vault.versionsOf('p/memory/m.md');
  assert.equal(vault.readText('p/memory/m.md', v.versions[0].sha256), 'old wording that was dropped\n');
});

test('importing a newer rewritten file makes it current and keeps the old one', (t) => {
  const { src, vault } = setup(t, { 'p/memory/m.md': 'held\n' });
  const past = new Date(Date.now() - 86400000 * 5);
  fs.utimesSync(path.join(src, 'p', 'memory', 'm.md'), past, past);
  vault.save(src);
  const backup = tree({ 'p/memory/m.md': 'newer elsewhere\n' });
  t.after(() => cleanup(path.dirname(backup)));

  vault.save(backup, { mode: 'import' });
  assert.equal(held(vault, 'p/memory/m.md'), 'newer elsewhere\n');
  assert.equal(vault.readText('p/memory/m.md', vault.versionsOf('p/memory/m.md').versions[0].sha256), 'held\n');
});

test('an import never marks anything as gone from Claude Code', (t) => {
  const { src, vault } = setup(t, { 'p/a.jsonl': 'a\n' });
  vault.save(src);
  const backup = tree({ 'p/b.jsonl': 'b\n' });
  t.after(() => cleanup(path.dirname(backup)));

  const r = vault.save(backup, { mode: 'import' });
  assert.equal(r.counts.gone, 0);
  assert.equal(vault.versionsOf('p/a.jsonl').goneFromLiveAt, null);
});

test('restore puts a missing chat back with its own folder, and leaves existing files alone', (t) => {
  const { src, vault } = setup(t, {
    'p/gone.jsonl': 'chat\n',
    'p/gone/subagents/agent-1.jsonl': 'helper\n',
    'p/here.jsonl': 'archived text\n',
  });
  vault.save(src);
  fs.rmSync(path.join(src, 'p', 'gone.jsonl'));
  fs.rmSync(path.join(src, 'p', 'gone'), { recursive: true });
  write(src, 'p/here.jsonl', 'archived text\nand more\n');

  const r = vault.restore(src, null);
  assert.deepEqual(r.restored.map((x) => x.sessionId), ['gone']);
  assert.equal(fs.readFileSync(path.join(src, 'p', 'gone', 'subagents', 'agent-1.jsonl'), 'utf8'), 'helper\n');
  assert.equal(fs.readFileSync(path.join(src, 'p', 'here.jsonl'), 'utf8'), 'archived text\nand more\n');
});

test('restore keeps the chat\'s original date, so it sorts where it belongs', (t) => {
  const { src, vault } = setup(t, { 'p/s.jsonl': 'x\n' });
  const old = new Date('2026-09-02T08:00:00Z');
  fs.utimesSync(path.join(src, 'p', 's.jsonl'), old, old);
  vault.save(src);
  fs.rmSync(path.join(src, 'p', 's.jsonl'));

  vault.restore(src, [{ folderName: 'p', sessionId: 's' }]);
  const st = fs.statSync(path.join(src, 'p', 's.jsonl'));
  assert.equal(Math.round(st.mtimeMs / 1000), Math.round(old.getTime() / 1000));
});

test('a save asked for while another runs is queued, then done by the running one', (t) => {
  const { src, vault } = setup(t, { 'p/s.jsonl': 'x\n' });
  assert.ok(vault.acquireLock());
  const r = vault.save(src);
  assert.equal(r.busy, true);
  assert.ok(fs.existsSync(vault.pendingFile));
  vault.releaseLock();

  const done = vault.save(src);
  assert.equal(done.counts.added, 1);
  assert.ok(!fs.existsSync(vault.pendingFile));
});

test('a save interrupted before the index was written is healed on the next one', (t) => {
  const { src, vault } = setup(t, { 'p/memory/m.md': 'one\n' });
  vault.save(src);
  const staleIndex = fs.readFileSync(vault.indexFile, 'utf8');
  write(src, 'p/memory/m.md', 'two\n', new Date(Date.now() + 5000));
  vault.save(src);
  fs.writeFileSync(vault.indexFile, staleIndex);      // as if the index write never happened

  vault.save(src);
  assert.equal(held(vault, 'p/memory/m.md'), 'two\n');
  // "two" is the current copy; nothing pretends it was an older version
  assert.ok(!vault.versionsOf('p/memory/m.md').versions.some((v) => vault.readText('p/memory/m.md', v.sha256) === 'two\n'));
});

test('the archive refuses to live inside the folder it saves', (t) => {
  const { src } = setup(t, { 'p/s.jsonl': 'x\n' });
  const inside = new Vault(path.join(src, 'archive'));
  assert.throws(() => inside.save(src), /cannot be inside/);
});

test('archive paths cannot climb out of the archive', () => {
  assert.equal(isSafeRel('p/memory/m.md'), true);
  for (const bad of ['../x', 'p/../../x', '/etc/passwd', 'C:/x', 'p\\x', '', 'p//x']) {
    assert.equal(isSafeRel(bad), false, bad);
  }
});

test('files are told apart by where they sit in the tree', () => {
  assert.equal(kindOf('p/abc.jsonl'), 'chat');
  assert.equal(kindOf('p/memory/MEMORY.md'), 'memory');
  assert.equal(kindOf('p/abc/subagents/a.jsonl'), 'subagent');
  assert.equal(kindOf('p/abc/tool-results/t.txt'), 'tool-result');
});
