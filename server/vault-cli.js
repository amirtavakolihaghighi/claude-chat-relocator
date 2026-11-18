#!/usr/bin/env node
'use strict';
/*
 * The archive from the command line, and the worker behind automatic saving.
 *
 *   node server/vault-cli.js use <folder>      keep the archive in <folder>
 *   node server/vault-cli.js save              save Claude Code's chats now
 *   node server/vault-cli.js import <folder>   take in an old backup folder
 *   node server/vault-cli.js restore           put chats Claude Code deleted back
 *   node server/vault-cli.js status
 *
 * With --from-hook (how Claude Code's hook runs it) it prints nothing and
 * writes any failure to ~/.claude-chat-relocator/archive-errors.log instead.
 */
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { Store } = require('./store');
const { Vault } = require('./vault');

const args = process.argv.slice(2);
const cmd = args[0];
const fromHook = args.includes('--from-hook');
const say = (...m) => { if (!fromHook) console.log(...m); };

function vaultDir() {
  return Store.readSettings().vaultDir || null;
}

function logFailure(err) {
  try {
    const f = path.join(P.appDataDir(), 'archive-errors.log');
    fs.mkdirSync(P.appDataDir(), { recursive: true });
    fs.appendFileSync(f, `${new Date().toISOString()}  ${cmd}  ${err && err.message}\n`, 'utf8');
  } catch { /* nowhere left to report it */ }
}

function summary(r) {
  if (r.busy) return 'Another save is running; it will pick up these changes too.';
  const c = r.counts;
  const bits = [];
  if (c.added) bits.push(`${c.added} new`);
  if (c.grew) bits.push(`${c.grew} grew`);
  if (c.versioned) bits.push(`${c.versioned} rewritten (old version kept)`);
  if (c.kept) bits.push(`${c.kept} shorter copies ignored (already held in full)`);
  if (c.gone) bits.push(`${c.gone} deleted from Claude Code (kept here)`);
  if (c.back) bits.push(`${c.back} back in Claude Code`);
  if (c.failed) bits.push(`${c.failed} could not be read`);
  return bits.length ? bits.join(', ') : 'Nothing changed.';
}

function main() {
  const liveRoot = Store.initialRoot();

  if (cmd === 'use') {
    const dir = args[1];
    if (!dir || !P.looksAbsolute(dir)) throw new Error('Give the archive an absolute folder path.');
    const v = new Vault(dir);
    fs.mkdirSync(v.dir, { recursive: true });
    Store.updateSettings({ vaultDir: v.dir });
    say(`The archive now lives in ${v.dir}`);
    return;
  }

  const dir = vaultDir();
  if (!dir) {
    if (fromHook) return;   // not set up yet: nothing to do, and nothing to complain about
    throw new Error('No archive folder is set. Run: node server/vault-cli.js use <folder>');
  }
  const vault = new Vault(dir);

  if (cmd === 'save') {
    const r = vault.save(liveRoot, { mode: 'live', label: fromHook ? 'automatic' : 'command line' });
    say(summary(r));
  } else if (cmd === 'import') {
    const src = args[1];
    if (!src) throw new Error('Which folder? node server/vault-cli.js import <folder>');
    const r = vault.save(src, { mode: 'import', label: path.basename(src), busy: 'fail' });
    say(summary(r));
  } else if (cmd === 'restore') {
    const r = vault.restore(liveRoot, null);
    say(r.restored.length
      ? `Put back ${r.restored.length} chat(s):\n` + r.restored.map((x) => `  ${x.folderName}/${x.sessionId}  (${x.files} file${x.files === 1 ? '' : 's'})`).join('\n')
      : 'Every archived chat is already in Claude Code.');
  } else if (cmd === 'status') {
    const s = vault.status(liveRoot);
    say(JSON.stringify(s, null, 2));
  } else {
    say('Usage: node server/vault-cli.js use <folder> | save | import <folder> | restore | status');
    process.exitCode = 2;
  }
}

try {
  main();
} catch (err) {
  if (fromHook) logFailure(err);
  else { console.error(err.message); process.exitCode = 1; }
}
if (fromHook) process.exitCode = 0;
