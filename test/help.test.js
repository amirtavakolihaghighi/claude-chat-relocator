'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/*
 * The app links every message and every action to a section of docs/HELP.md.
 * A code or topic without its section is a "What does this mean?" link that
 * leads nowhere, so these tests read the source and the guide side by side.
 */

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Anchor ids the help page gives its headings (same rule as routes-archive.js). */
function anchors() {
  const ids = new Set();
  for (const line of read('docs/HELP.md').split(/\r?\n/)) {
    const m = /^(##|###) (.+)$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/`/g, '');
    const code = /^([EW]-[A-Z0-9-]+)/.exec(text);
    ids.add(code ? code[1].toLowerCase()
      : text.toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }
  return ids;
}

/** Every message code the server can send. */
function serverCodes() {
  const codes = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'server'))) {
    if (!f.endsWith('.js')) continue;
    const src = read('server/' + f);
    for (const m of src.matchAll(/(?:help = |addError\([a-z]+, |addWarning\([a-z]+, |codedError\([^;]*?, \d+, )'([EW]-[A-Z0-9-]+)'/g)) codes.add(m[1]);
  }
  return codes;
}

test('every message code the server sends has its own entry in the help', () => {
  const ids = anchors();
  const codes = serverCodes();
  assert.ok(codes.size > 20, `expected many codes, found ${codes.size}`);
  const missing = [...codes].filter((c) => !ids.has(c.toLowerCase()));
  assert.deepEqual(missing, []);
});

test('every help topic the app links to exists in the help', () => {
  const ids = anchors();
  const app = read('public/app.js');
  const block = /const HELP = \{([\s\S]*?)\};/.exec(app);
  assert.ok(block, 'the HELP table in app.js');
  const topics = [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  // plus the codes and topics the app names directly
  for (const m of app.matchAll(/(?:helpLink|openHelp)\('([a-z0-9-]+)'/g)) topics.push(m[1]);
  for (const m of app.matchAll(/noticeBox\([^)]*?'([ew]-[a-z0-9-]+)'\)/g)) topics.push(m[1]);
  topics.push('getting-started');
  const missing = [...new Set(topics)].filter((t) => !ids.has(t));
  assert.deepEqual(missing, []);
});

test('links inside the help point at sections that exist', () => {
  const ids = anchors();
  const links = [...read('docs/HELP.md').matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 10);
  const broken = [...new Set(links)].filter((l) => !ids.has(l));
  assert.deepEqual(broken, []);
});
