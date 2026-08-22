'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeStore } = require('../fixtures/store');
const { parseSessionFile, peekSessionFile } = require('../server/parser');

function firstSession(root) {
  const folder = fs.readdirSync(root)[0];
  const dir = path.join(root, folder);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl'));
  return path.join(dir, file);
}

test('parses a session into chat turns', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo', title: 'Fix the bug' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));

  assert.equal(session.title, 'Fix the bug');
  assert.equal(session.projectPath, 'D:\\Files\\Projects\\Demo'.replace(/\\/g, path.sep));
  assert.equal(session.folderNameMatchesCwd, true);
  assert.equal(session.parseErrors.length, 0);
  assert.equal(session.stats.humanTurns, 1);
  assert.equal(session.stats.toolCalls, 2);
  assert.equal(session.gitBranch, 'main');
});

test('a tool result is folded into its tool call, not shown as a user turn', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));

  // Only the genuine human message counts as a user turn.
  const humans = session.turns.filter((x) => x.kind === 'human');
  assert.equal(humans.length, 1);
  assert.match(humans[0].blocks[0].text, /fix the bug/i);

  const tools = session.turns.flatMap((x) => (x.blocks || []).filter((b) => b.type === 'tool'));
  assert.equal(tools.length, 2);
  for (const tool of tools) {
    assert.notEqual(tool.result.kind, 'pending', `${tool.name} should have its result attached`);
  }
});

test('an Edit result becomes a diff with add and remove counts', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));
  const edit = session.turns.flatMap((x) => x.blocks || []).find((b) => b.type === 'tool' && b.name === 'Edit');

  assert.equal(edit.result.kind, 'diff');
  assert.equal(edit.result.added, 1);
  assert.equal(edit.result.removed, 1);
  assert.match(edit.summary, /app\.js/);
});

test('a shell result keeps stdout and stderr apart', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));
  const bash = session.turns.flatMap((x) => x.blocks || []).find((b) => b.type === 'tool' && b.name === 'Bash');

  assert.equal(bash.result.kind, 'shell');
  assert.equal(bash.result.stdout, 'all tests passed');
  assert.equal(bash.summary, 'npm test');
});

test('empty thinking blocks are counted but produce no bubble of their own', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));

  // Claude Code records a signature but not the reasoning text.
  assert.ok(session.stats.thinkingBlocks > 0);
  assert.equal(session.stats.thinkingBlocks, session.stats.redactedThinking);

  // No assistant turn consists solely of a redacted thought.
  for (const turn of session.turns.filter((x) => x.kind === 'assistant')) {
    const substantive = turn.blocks.some((b) => b.type === 'text' || b.type === 'tool');
    assert.ok(substantive, 'assistant turns must carry visible content');
  }
});

test('token usage is summed across assistant messages', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));
  assert.ok(session.stats.tokens.output > 0);
  assert.ok(session.stats.tokens.cacheRead > 0);
});

test('a corrupt line is skipped and reported, not fatal', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  const file = firstSession(store.root);
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text + '{ this is not json\n', 'utf8');

  const { session } = parseSessionFile(file);
  assert.equal(session.parseErrors.length, 1);
  assert.ok(session.turns.length > 0, 'the rest of the chat still parses');
});

test('the project root is the cwd that encodes to the folder name', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo' }]);
  t.after(store.cleanup);

  // Add a deeper cwd, as happens when a tool runs in a sub-directory.
  const file = firstSession(store.root);
  const extra = JSON.stringify({
    type: 'user', uuid: 'x-1', timestamp: '2026-08-01T11:00:00.000Z',
    cwd: 'D:\\Files\\Projects\\Demo\\src', sessionId: 's', version: '2.0.0',
    message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  });
  fs.appendFileSync(file, extra + '\n', 'utf8');

  const { session } = parseSessionFile(file);
  assert.equal(session.projectPath, 'D:\\Files\\Projects\\Demo'.replace(/\\/g, path.sep));
  assert.ok(session.cwds.length > 1, 'the sub-directory cwd is still recorded');
});

test('peekSessionFile reads the header without building turns', (t) => {
  const store = makeStore([{ cwd: 'D:\\Files\\Projects\\Demo', title: 'Quick look' }]);
  t.after(store.cleanup);

  const peek = peekSessionFile(firstSession(store.root));
  assert.equal(peek.title, 'Quick look');
  assert.ok(peek.messageCount > 0);
  assert.ok(peek.startedAt);
  assert.equal(peek.turns, undefined);
});

test('Persian project paths survive parsing intact', (t) => {
  const store = makeStore([{ cwd: 'C:\\Work\\کوییز\\4- Working' }]);
  t.after(store.cleanup);

  const { session } = parseSessionFile(firstSession(store.root));
  assert.equal(session.folderNameMatchesCwd, true);
  assert.match(session.projectPath, /کوییز/);
});
