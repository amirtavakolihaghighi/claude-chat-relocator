'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { makeStore } = require('../fixtures/store');
const { parseSessionFile } = require('../server/parser');
const R = require('../server/render');
const { exportHtml } = require('../server/exporters/html');
const { exportMarkdown } = require('../server/exporters/markdown');

function load(cwd = 'D:\\Files\\Projects\\Demo') {
  const store = makeStore([{ cwd, title: 'Rendering test' }]);
  const folder = fs.readdirSync(store.root)[0];
  const dir = path.join(store.root, folder);
  const file = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.jsonl')));
  return { ...parseSessionFile(file), cleanup: store.cleanup };
}

const opts = { imageSrc: (ref) => '/img/' + ref };

test('markdown renders, and raw HTML in a message is escaped not injected', () => {
  const out = R.md('Hello <img src=x onerror=alert(1)> and <script>bad()</script>');
  assert.ok(!/<img/i.test(out), 'no live img tag');
  assert.ok(!/<script/i.test(out), 'no live script tag');
  assert.match(out, /&lt;img/);
});

test('code fences are highlighted and labelled', () => {
  const out = R.md('```js\nconst a = 1 < 2;\n```');
  assert.match(out, /class="language-js"/);
  assert.match(out, /hljs-keyword/);
  assert.match(out, /&lt;/, 'the less-than stays escaped');
});

test('an unknown fence language still renders safely', () => {
  const out = R.md('```not-a-real-language\n<b>x</b>\n```');
  assert.match(out, /&lt;b&gt;/);
});

test('a diff renders add and remove rows', (t) => {
  const s = load();
  t.after(s.cleanup);

  const edit = s.session.turns.flatMap((x) => x.blocks || [])
    .find((b) => b.type === 'tool' && b.name === 'Edit');
  const html = R.renderToolCard(edit, opts);

  assert.match(html, /class="dl del"/);
  assert.match(html, /class="dl add"/);
  assert.match(html, /pill add">\+1/);
  assert.match(html, /pill del">-1/);
});

test('every turn renders to an article with a stable anchor', (t) => {
  const s = load();
  t.after(s.cleanup);

  s.session.turns.forEach((turn, i) => {
    const html = R.renderTurn(turn, opts);
    assert.match(html, /^<article class="turn /);
    assert.match(html, new RegExp(`id="t${turn.index}"`));
    assert.equal(turn.index, i);
  });
});

test('the HTML export is a complete self-contained document', (t) => {
  const s = load();
  t.after(s.cleanup);

  const html = exportHtml(s.session, s.imageStore, {});

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<title>Rendering test<\/title>/);
  assert.match(html, /<style>/, 'styles are inlined');

  // No external asset may be referenced: no CDN scripts, stylesheets or images.
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+href="https?:/i.test(html), false);
  assert.equal(/<img[^>]+src="https?:/i.test(html), false);
});

test('the HTML export keeps the project path visible', (t) => {
  const s = load();
  t.after(s.cleanup);
  const html = exportHtml(s.session, s.imageStore, {});
  assert.ok(html.includes('Demo'));
});

test('a Persian project path is escaped safely into the export', (t) => {
  const s = load('C:\\Work\\کوییز');
  t.after(s.cleanup);
  const html = exportHtml(s.session, s.imageStore, {});
  assert.match(html, /کوییز/);
});

test('the markdown export carries metadata, prose and a diff fence', (t) => {
  const s = load();
  t.after(s.cleanup);

  const md = exportMarkdown(s.session, s.imageStore, {});

  assert.match(md, /^# Rendering test/m);
  assert.match(md, /\*\*Project:\*\*/);
  assert.match(md, /^## You/m);
  assert.match(md, /^## Claude/m);
  assert.match(md, /```diff/);
  assert.match(md, /-const a = 1;/);
  assert.match(md, /\+const a = 2;/);
});

test('markdown fences grow to survive backticks in the content', () => {
  const s = load();
  s.cleanup();
  // A tool result containing a fence must not break out of its own block.
  const fake = {
    turns: [{
      kind: 'assistant', index: 0, blocks: [{
        type: 'tool', name: 'Bash', summary: 'x', input: { command: 'echo hi' },
        result: { kind: 'shell', stdout: '```\nnested fence\n```', stderr: '' },
      }],
    }],
    stats: { models: {} }, sessionId: 's', title: 't',
  };
  const md = exportMarkdown(fake, new Map(), {});
  assert.match(md, /````/, 'the wrapping fence is longer than the nested one');
});

test('tool summaries stay on one line', (t) => {
  const s = load();
  t.after(s.cleanup);
  for (const b of s.session.turns.flatMap((x) => x.blocks || [])) {
    if (b.type !== 'tool') continue;
    assert.equal(b.summary.includes('\n'), false, `${b.name} summary must be single-line`);
  }
});
