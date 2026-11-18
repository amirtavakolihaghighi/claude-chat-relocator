'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, cleanup, useTempAppData } = require('../fixtures/store');
const H = require('../server/hooks');

/** Point the hook installer at a throwaway settings file. */
function settingsWith(t, content) {
  const dir = tempDir('ccr-claude');
  const file = path.join(dir, 'settings.json');
  if (content !== undefined) fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  const was = process.env.CLAUDE_SETTINGS_FILE;
  process.env.CLAUDE_SETTINGS_FILE = file;
  const app = useTempAppData();
  t.after(() => {
    if (was === undefined) delete process.env.CLAUDE_SETTINGS_FILE; else process.env.CLAUDE_SETTINGS_FILE = was;
    app.restore();
    cleanup(dir);
  });
  return { file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), app };
}

const notifier = { hooks: [{ type: 'command', command: 'powershell -File notify.ps1' }] };

test('installing adds the archive hook to all three events and keeps your other hooks', (t) => {
  const s = settingsWith(t, { model: 'opus', cleanupPeriodDays: 36500, hooks: { Stop: [notifier] } });
  const r = H.install();

  assert.equal(r.installed, true);
  const data = s.read();
  assert.equal(data.model, 'opus');
  assert.equal(data.cleanupPeriodDays, 36500);
  assert.deepEqual(data.hooks.Stop[0], notifier);
  for (const ev of H.EVENTS) {
    assert.ok(data.hooks[ev].some((g) => g.hooks.some((h) => h.command.includes('vault-hook.js'))), ev);
  }
});

test('installing twice does not add the hook twice', (t) => {
  const s = settingsWith(t, {});
  H.install();
  H.install();
  const stop = s.read().hooks.Stop;
  assert.equal(stop.flatMap((g) => g.hooks).filter((h) => h.command.includes('vault-hook.js')).length, 1);
});

test('removing takes out only the archive hook', (t) => {
  const s = settingsWith(t, { hooks: { Stop: [notifier] } });
  H.install();
  const r = H.uninstall();

  assert.equal(r.installed, false);
  assert.deepEqual(s.read().hooks, { Stop: [notifier] });
});

test('a settings file that is not valid JSON is never overwritten', (t) => {
  const s = settingsWith(t, '{ "model": "opus", ');
  assert.throws(() => H.install(), /not valid JSON/);
  assert.equal(fs.readFileSync(s.file, 'utf8'), '{ "model": "opus", ');
});

test('a copy of the settings file is kept before every change', (t) => {
  const s = settingsWith(t, { model: 'opus' });
  const r = H.install();
  assert.ok(r.backup && fs.existsSync(r.backup));
  assert.deepEqual(JSON.parse(fs.readFileSync(r.backup, 'utf8')), { model: 'opus' });
  assert.ok(r.backup.startsWith(s.app.dir));
});

test('the hook command runs this copy of the app with forward slashes', () => {
  const cmd = H.hookCommand();
  assert.ok(!cmd.includes('\\'));
  assert.match(cmd, /server\/vault-hook\.js"$/);
});
