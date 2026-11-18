'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paths');

/**
 * Automatic saving, through Claude Code's own hooks.
 *
 * Claude Code can run a command at set moments. Three entries are added to
 * ~/.claude/settings.json, all running server/vault-hook.js:
 *
 *   Stop        after every reply Claude finishes
 *   PreCompact  just before a long chat is compacted
 *   SessionEnd  when a chat is closed
 *
 * The hook starts a save in the background and returns at once, so Claude is
 * never kept waiting. Every other setting and hook in the file is left exactly
 * as it was, and a copy of the file is kept before each change.
 */

const EVENTS = ['Stop', 'PreCompact', 'SessionEnd'];
const MARK = 'vault-hook.js';

function claudeSettingsFile() {
  return process.env.CLAUDE_SETTINGS_FILE || path.join(os.homedir(), '.claude', 'settings.json');
}

/** Forward slashes work in every shell Claude Code may run the hook with. */
const fwd = (p) => String(p).replace(/\\/g, '/');

function hookCommand() {
  return `"${fwd(process.execPath)}" "${fwd(path.join(__dirname, 'vault-hook.js'))}"`;
}

function read() {
  const file = claudeSettingsFile();
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { file, data: {}, raw: null }; }
  let data;
  try { data = JSON.parse(raw); } catch {
    const e = new Error(`${file} is not valid JSON, so it was left alone. Fix it in an editor first.`);
    e.status = 409;
    e.help = 'E-SETTINGS-JSON';
    throw e;
  }
  return { file, data: data && typeof data === 'object' ? data : {}, raw };
}

const ours = (h) => h && typeof h.command === 'string' && h.command.includes(MARK);

/** Which events run our hook, and whether it points at this copy of the app. */
function status() {
  let data, file;
  try { ({ data, file } = read()); } catch (e) { return { file: claudeSettingsFile(), error: e.message, events: [], current: false }; }
  const events = [];
  let current = true;
  for (const ev of EVENTS) {
    const groups = (data.hooks && data.hooks[ev]) || [];
    const mine = groups.flatMap((g) => (g.hooks || []).filter(ours));
    if (mine.length) {
      events.push(ev);
      if (!mine.some((h) => h.command === hookCommand())) current = false;
    }
  }
  return { file, events, installed: events.length === EVENTS.length, current: events.length ? current : false, command: hookCommand() };
}

function backup(raw) {
  if (raw == null) return null;
  const dir = path.join(P.appDataDir(), 'claude-settings-backups');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, raw, 'utf8');
  return f;
}

function strip(data) {
  if (!data.hooks) return;
  for (const ev of EVENTS) {
    const groups = data.hooks[ev];
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) data.hooks[ev] = kept;
    else delete data.hooks[ev];
  }
  if (!Object.keys(data.hooks).length) delete data.hooks;
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.relocator-tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function install() {
  const { file, data, raw } = read();
  const saved = backup(raw);
  strip(data);
  data.hooks = data.hooks || {};
  for (const ev of EVENTS) {
    data.hooks[ev] = (data.hooks[ev] || []).concat([{ hooks: [{ type: 'command', command: hookCommand() }] }]);
  }
  write(file, data);
  return { ...status(), backup: saved };
}

function uninstall() {
  const { file, data, raw } = read();
  const saved = backup(raw);
  strip(data);
  write(file, data);
  return { ...status(), backup: saved };
}

module.exports = { status, install, uninstall, hookCommand, claudeSettingsFile, EVENTS };
