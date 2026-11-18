'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, cleanup } = require('../fixtures/store');
const { parseSessionFile } = require('../server/parser');
const V = require('../server/view');
const { exportMarkdown } = require('../server/exporters/markdown');

/*
 * How records become a conversation: which messages are yours, which replies
 * are Claude's answers, and what is neither.
 */

const CWD = 'D:\\Work\\shop';
let t = 0;
const at = () => new Date(Date.UTC(2026, 7, 1, 10, 0, t++)).toISOString();
const base = (o) => ({ cwd: CWD, sessionId: 's1', uuid: 'u' + t, timestamp: at(), ...o });
const you = (content) => base({ type: 'user', message: { role: 'user', content } });
const ai = (content, stop, id) => base({
  type: 'assistant', message: { id: id || 'm' + t, model: 'claude-opus-5', role: 'assistant', content, stop_reason: stop, usage: {} },
});
const say = (text, stop = 'tool_use', id) => ai([{ type: 'text', text }], stop, id);
const tool = (id, name, input) => ai([{ type: 'tool_use', id, name, input }], 'tool_use');
const result = (id, structured) => base({ type: 'user', toolUseResult: structured, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

function load(t0, records) {
  const dir = tempDir('ccr-view');
  t0.after(() => cleanup(dir));
  const f = path.join(dir, 'd--Work-shop', 's1.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return parseSessionFile(f);
}
const html = (session) => V.renderItems(session, { imageSrc: () => '' }).map((x) => x.html).join('');
const count = (h, re) => (h.match(re) || []).length;

test('only replies Claude finished with end_turn are marked as answers', (t) => {
  const { session } = load(t, [
    you('Fix the cart total.'),
    say('Let me look at the cart first.'),                 // a note on the way: tool_use
    tool('a', 'Read', { file_path: 'cart.js' }), result('a', { file: { filePath: 'cart.js', content: 'x', numLines: 1 } }),
    say('Fixed: the total now includes tax.', 'end_turn'),
  ]);
  const h = html(session);
  assert.equal(count(h, /data-special="answer"/g), 1);
  assert.match(h, /class="prose final"[^>]*>[\s\S]*Fixed: the total/);
  assert.equal(session.stats.answers, 1);
});

test('an answer in the middle of a chat, before a background job reports back, is still an answer', (t) => {
  const { session } = load(t, [
    you('Run the tests.'),
    say('Started them in the background. Done for now.', 'end_turn'),
    base({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification><summary>tests finished</summary></task-notification>' } }),
    say('All green.', 'end_turn'),
  ]);
  const h = html(session);
  assert.equal(count(h, /data-special="answer"/g), 2);
  assert.match(h, /class="event job"/);
  assert.equal(session.stats.humanTurns, 1, 'the job report is not counted as you');
});

test('a message you typed while Claude was working counts as yours; a helper report does not', (t) => {
  const { session } = load(t, [
    you('Start.'),
    tool('a', 'Bash', { command: 'npm test' }), result('a', { stdout: 'ok', stderr: '' }),
    base({ type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'Also update the readme.' }], commandMode: 'prompt', origin: { kind: 'human' } } }),
    base({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'report', origin: { kind: 'peer', name: 'helper', body: 'done' } } }),
    say('Both done.', 'end_turn'),
  ]);
  const h = html(session);
  assert.equal(count(h, /data-special="you"/g), 2);
  assert.match(h, /class="queued"[\s\S]*Also update the readme/);
  assert.match(h, /A helper agent reported back/);
  assert.equal(session.stats.humanTurns, 2);
});

test('the compaction summary is shown as an event, never as a message from you', (t) => {
  const { session } = load(t, [
    you('Hello.'),
    say('Hi.', 'end_turn'),
    base({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } }),
    base({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Summary of the chat so far.' } }),
  ]);
  const h = html(session);
  assert.equal(count(h, /data-special="you"/g), 1);
  assert.match(h, /class="event compact"/);
  assert.match(h, /class="event compact-summary"[\s\S]*Summary of the chat so far/);
  assert.equal(session.stats.compactions, 1);
});

test('notices Claude Code writes as if Claude said them are not answers', (t) => {
  const { session } = load(t, [
    you('Go.'),
    base({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit" }], stop_reason: 'stop_sequence' } }),
  ]);
  const h = html(session);
  assert.equal(count(h, /data-special="answer"/g), 0);
  assert.match(h, /Claude Code notice/);
});

test('one answer written as several records reads as one answer', (t) => {
  const { session } = load(t, [
    you('Explain.'),
    say('First part.', 'end_turn', 'same'),
    say('Second part.', 'end_turn', 'same'),
  ]);
  const h = html(session);
  assert.equal(count(h, /data-special="answer"/g), 1);
  assert.match(h, /First part[\s\S]*Second part/);
});

test('a run of tool calls folds into one line that says what happened, and file edits stay as cards', (t) => {
  const patch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }];
  const { session } = load(t, [
    you('Go.'),
    tool('r1', 'Read', { file_path: 'a.js' }), result('r1', { file: { filePath: 'a.js', content: 'a', numLines: 1 } }),
    tool('g1', 'Grep', { pattern: 'x' }), result('g1', { filenames: ['a.js'], numFiles: 1 }),
    tool('b1', 'Bash', { command: 'ls' }), result('b1', { stdout: 'a.js', stderr: '' }),
    tool('e1', 'Edit', { file_path: 'a.js', old_string: 'a', new_string: 'b' }), result('e1', { filePath: 'a.js', structuredPatch: patch }),
    say('Done.', 'end_turn'),
  ]);
  const h = html(session);
  assert.equal(count(h, /<details class="steps">/g), 1);
  assert.match(h, /Ran commands<\/b> &mdash; 3 steps/);
  assert.match(h, /read 1 file[\s\S]*ran 1 command[\s\S]*searched once/);
  assert.equal(count(h, /class="card edit"/g), 1);
});

test('every record that can be jumped to has one anchor, and no anchor is used twice', (t) => {
  const { session } = load(t, [
    you('One.'), say('a'), tool('x', 'Bash', { command: 'ls' }), result('x', { stdout: '', stderr: '' }), say('b', 'end_turn'),
    you('Two.'), say('c', 'end_turn'),
  ]);
  const ids = [...html(session).matchAll(/ id="(t\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const turn of session.turns) assert.ok(ids.includes('t' + turn.index), `turn ${turn.index} (${turn.kind}) can be reached`);
});

test('pasted text loses its wrapper tags and is marked as pasted', (t) => {
  const { session } = load(t, [you('<pasted_content id="x1">\nmy notes\n</pasted_content id="x1">')]);
  const h = html(session);
  assert.ok(!h.includes('pasted_content'));
  assert.match(h, /class="chip"[^>]*>[\s\S]*pasted/);
  assert.match(h, /my notes/);
});

test('a name you gave the chat wins over the automatic title', (t) => {
  const { session } = load(t, [
    you('hi'),
    { type: 'ai-title', aiTitle: 'Automatic', sessionId: 's1' },
    { type: 'custom-title', customTitle: 'My own name', sessionId: 's1' },
  ]);
  assert.equal(session.title, 'My own name');
});

test('a long pause between messages is marked', (t) => {
  const recs = [you('Morning.'), say('Hi.', 'end_turn')];
  const later = you('Afternoon.');
  later.timestamp = new Date(Date.parse(recs[1].timestamp) + 3 * 3600 * 1000).toISOString();
  const { session } = load(t, [...recs, later]);
  assert.match(html(session), /class="divider">3 hours later/);
});

test('the conversation-only Markdown keeps your messages and the answers, and nothing else', (t) => {
  const { session, imageStore } = load(t, [
    you('Question?'),
    say('Thinking out loud.'),
    tool('a', 'Bash', { command: 'secret-step' }), result('a', { stdout: 'x', stderr: '' }),
    say('The answer.', 'end_turn'),
  ]);
  const md = exportMarkdown(session, imageStore, { conversationOnly: true });
  assert.match(md, /Question\?/);
  assert.match(md, /✓ Answer[\s\S]*The answer\./);
  assert.ok(!md.includes('Thinking out loud'));
  assert.ok(!md.includes('secret-step'));
});
