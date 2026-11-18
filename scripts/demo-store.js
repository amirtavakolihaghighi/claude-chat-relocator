#!/usr/bin/env node
'use strict';
/**
 * Builds a throwaway chat store containing every state the app can report:
 * healthy projects, a missing one, a hidden one, and two that share a folder.
 * One chat shows everything the conversation view can: grouped steps, file
 * changes, an answer in the middle of the chat after a background job, a
 * message typed while Claude worked, a long pause, and a compaction. There
 * are memory files, and an archive holding a chat Claude Code "deleted" and
 * an older version of a memory file.
 *
 * Nothing here touches ~/.claude. The store and the fake projects it points at
 * are written wherever you ask, and deleting those two folders undoes it all.
 *
 *   node scripts/demo-store.js
 *   node scripts/demo-store.js --root D:\Demo
 *
 * Useful for screenshots, for seeing what the badges mean without breaking
 * anything of your own, and for trying a relocation on data you do not care
 * about.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encodeProjectFolder } = require('../server/paths');

// ---- where everything goes ---------------------------------------------
const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;
const ROOT = path.resolve(rootArg || path.join(os.homedir(), 'claude-relocator-demo'));
const STORE = path.join(ROOT, 'store');        // stands in for ~/.claude/projects
const ARCHIVE = path.join(ROOT, 'archive');    // the app's archive, for the demo
const APPDATA = path.join(ROOT, 'app-data');   // the app's own settings, for the demo
const WORK = path.join(ROOT, 'workspace');     // stands in for where projects live

// ---- session content ----------------------------------------------------

let seq = 0;
const uuid = () => {
  const n = (++seq).toString(16).padStart(8, '0');
  return `${n}-1a2b-4c3d-8e4f-000000000000`;
};

const at = (i) => new Date(Date.UTC(2026, 6, 14, 9, i * 7)).toISOString();

function envelope(cwd, sessionId, i) {
  return {
    parentUuid: i === 0 ? null : `${sessionId}#${i - 1}`,
    isSidechain: false,
    uuid: `${sessionId}#${i}`,
    timestamp: at(i),
    userType: 'external',
    entrypoint: 'claude-vscode',
    cwd,
    sessionId,
    version: '2.0.0',
    gitBranch: 'main',
  };
}

const user = (cwd, sid, i, text) => ({
  ...envelope(cwd, sid, i), type: 'user', promptId: `p${i}`,
  message: { role: 'user', content: [{ type: 'text', text }] },
});

const say = (cwd, sid, i, text) => ({
  ...envelope(cwd, sid, i), type: 'assistant', requestId: `r${i}`, effort: 'high',
  message: {
    model: 'claude-opus-5', id: `msg_${i}`, type: 'message', role: 'assistant',
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
    stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
    usage: {
      input_tokens: 12, output_tokens: 180 + i * 40,
      cache_read_input_tokens: 24000 + i * 900, cache_creation_input_tokens: 640,
    },
  },
});

const call = (cwd, sid, i, name, input, id) => ({
  ...envelope(cwd, sid, i), type: 'assistant', requestId: `r${i}`, effort: 'high',
  message: {
    model: 'claude-opus-5', id: `msg_${i}`, type: 'message', role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use', stop_sequence: null, stop_details: null,
    usage: {
      input_tokens: 8, output_tokens: 90 + i * 20,
      cache_read_input_tokens: 24000 + i * 900, cache_creation_input_tokens: 120,
    },
  },
});

const back = (cwd, sid, i, id, content, structured) => ({
  ...envelope(cwd, sid, i), type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  toolUseResult: structured, sourceToolAssistantUUID: `${sid}#${i - 1}`,
});

/** A believable session: prose, a shell command, and a real edit with a diff. */
function session(cwd, title, topic) {
  const sid = uuid();
  const file = path.join(cwd, topic.file);
  const L = [
    user(cwd, sid, 0, topic.ask),
    say(cwd, sid, 1, topic.plan),
    call(cwd, sid, 2, 'Bash', { command: topic.command }, 'toolu_a'),
    back(cwd, sid, 3, 'toolu_a', 'ok', {
      stdout: topic.output, stderr: '', interrupted: false, isImage: false,
    }),
    call(cwd, sid, 4, 'Edit', {
      file_path: file, old_string: topic.before, new_string: topic.after,
    }, 'toolu_b'),
    back(cwd, sid, 5, 'toolu_b', 'edited', {
      filePath: file, oldString: topic.before, newString: topic.after,
      replaceAll: false, userModified: false, originalFile: topic.before + '\n',
      structuredPatch: [{
        oldStart: topic.line, oldLines: topic.before.split('\n').length,
        newStart: topic.line, newLines: topic.after.split('\n').length,
        lines: [
          ...topic.before.split('\n').map((l) => '-' + l),
          ...topic.after.split('\n').map((l) => '+' + l),
        ],
      }],
    }),
    say(cwd, sid, 6, topic.wrap),
    { type: 'ai-title', aiTitle: title, sessionId: sid },
    { type: 'mode', mode: 'auto', sessionId: sid },
  ];
  return { sid, text: L.map((o) => JSON.stringify(o)).join('\n') + '\n' };
}

/** One chat that shows every part of the conversation view. */
function showcase(cwd) {
  const sid = uuid();
  const t = (min) => new Date(Date.UTC(2026, 6, 15, 13, 0) + min * 60000).toISOString();
  const env = (i, min) => ({ ...envelope(cwd, sid, i), timestamp: t(min) });
  const file = (rel) => path.join(cwd, rel);
  let n = 0;
  let i = 0;
  const L = [];
  const msg = (min, content, stop) => ({
    ...env(i, min), type: 'assistant', requestId: 'q' + i, effort: 'high',
    message: {
      model: 'claude-opus-5', id: 'm' + i++, type: 'message', role: 'assistant', content,
      stop_reason: stop, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 220, cache_read_input_tokens: 30000, cache_creation_input_tokens: 500 },
    },
  });
  const say = (min, text, stop = 'tool_use') => L.push(msg(min, [{ type: 'text', text }], stop));
  const step = (min, name, input, content, structured) => {
    const id = 'toolu_s' + (++n);
    L.push(msg(min, [{ type: 'tool_use', id, name, input }], 'tool_use'));
    L.push({
      ...env(i++, min), type: 'user', toolUseResult: structured,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
    });
  };
  const you = (min, text) => L.push({ ...env(i++, min), type: 'user', message: { role: 'user', content: text } });
  const patch = (line, before, after) => [{ oldStart: line, oldLines: 1, newStart: line, newLines: 1, lines: ['-' + before, '+' + after] }];

  you(0, 'The totals on the monthly summary are off by a few cents. I think rounding happens too early. Can you find where and fix it?');
  say(1, 'Rounding too early would do exactly that: each line rounded, then summed. I will find where amounts are rounded.');
  step(1, 'Grep', { pattern: 'toFixed|Math.round', path: 'src' }, 'src/money.js\nsrc/summary.js', { filenames: ['src/money.js', 'src/summary.js'], numFiles: 2 });
  step(1, 'Read', { file_path: file('src/money.js') }, 'ok', { file: { filePath: file('src/money.js'), content: 'export const round2 = (n) => Math.round(n * 100) / 100;\n', numLines: 1, totalLines: 1 } });
  step(2, 'Read', { file_path: file('src/summary.js') }, 'ok', { file: { filePath: file('src/summary.js'), content: 'const total = lines.map((l) => round2(l.amount)).reduce((a, b) => a + b, 0);\n', numLines: 1, totalLines: 1 } });
  say(3, 'Found it: `summary.js` rounds every line before adding them up. Adding first and rounding once at the end gives the exact total.');
  const before = 'const total = lines.map((l) => round2(l.amount)).reduce((a, b) => a + b, 0);';
  const after = 'const total = round2(lines.reduce((a, l) => a + l.amount, 0));';
  step(4, 'Edit', { file_path: file('src/summary.js'), old_string: before, new_string: after }, 'edited',
    { filePath: file('src/summary.js'), oldString: before, newString: after, structuredPatch: patch(12, before, after) });
  step(5, 'Bash', { command: 'npm test -- summary' }, 'ok',
    { stdout: '  summary\n    ok adds before rounding\n    ok matches the bank statement for July\n\n  2 passing (41ms)', stderr: '', interrupted: false });
  step(5, 'Bash', { command: 'npm test', run_in_background: true }, 'started',
    { stdout: 'Command running in the background with ID: b7', stderr: '', interrupted: false });
  say(6, 'Fixed. **What changed:**\n\n- The monthly summary now adds every amount first and rounds once, so the total matches the bank statement to the cent.\n- The two summary tests pass.\n\nThe full test run is still going in the background; I will check it when it finishes.', 'end_turn');

  L.push({ ...env(i++, 9), type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>\n<task-id>b7</task-id>\n<status>completed</status>\n<summary>Background command "npm test" finished with 1 failing test</summary>\n</task-notification>' } });
  say(9, 'The full run found one failure: an old test still expects the early rounding. Updating it.');
  step(10, 'Edit', { file_path: file('test/summary.test.js'), old_string: 'assert.equal(total, 10.02);', new_string: 'assert.equal(total, 10.01);' }, 'edited',
    { filePath: file('test/summary.test.js'), structuredPatch: patch(30, '  assert.equal(total, 10.02);', '  assert.equal(total, 10.01);') });
  L.push({ ...env(i++, 10), type: 'attachment', attachment: { type: 'queued_command', prompt: 'Also show the total with two decimals in the PDF, please.', commandMode: 'prompt', origin: { kind: 'human' } } });
  step(11, 'Edit', { file_path: file('src/pdf.js'), old_string: 'cell(total)', new_string: 'cell(total.toFixed(2))' }, 'edited',
    { filePath: file('src/pdf.js'), structuredPatch: patch(77, '  cell(total)', '  cell(total.toFixed(2))') });
  step(12, 'Bash', { command: 'npm test' }, 'ok', { stdout: '  48 passing (1.2s)', stderr: '', interrupted: false });
  say(12, 'All 48 tests pass. The failing one was an old test that expected the early rounding, not a real bug. The PDF now always shows two decimals, for example **1,204.50**.', 'end_turn');

  you(58, 'Perfect. One more: can the summary be exported as CSV too? Same columns as the PDF.');
  L.push({ ...env(i++, 59), type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 180000, postTokens: 9000 } });
  L.push({ ...env(i++, 59), type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'This session is being continued from a previous conversation. Summary: the user asked to fix rounding in the monthly summary. Claude moved rounding to after the sum in src/summary.js, updated one test, and made the PDF show two decimals. All 48 tests pass. The user now wants a CSV export of the summary.' } });
  say(60, 'Sure. The PDF builds its rows in one place, so the CSV can reuse them.');
  const csv = ['export function toCsv(rows) {', '  return rows.map((r) => r.join(",")).join("\\n");', '}'];
  step(61, 'Write', { file_path: file('src/csv.js'), content: csv.join('\n') + '\n' }, 'written',
    { filePath: file('src/csv.js'), structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3, lines: csv.map((l) => '+' + l) }] });
  say(62, 'Done. **Export > CSV** now sits next to **Export > PDF** and uses the same rows:\n\n```js\n' + csv.join('\n') + '\n```', 'end_turn');
  L.push({ type: 'ai-title', aiTitle: 'Fix rounding in the monthly summary', sessionId: sid });
  return { sid, text: L.map((o) => JSON.stringify(o)).join('\n') + '\n' };
}

const TOPICS = [
  {
    file: 'src/parse.js',
    ask: 'The importer chokes on invoices where the total column is blank. Can you make it skip those rows instead of throwing?',
    plan: 'The parser assumes every row has a total. I will look at how the rows come through first, then guard the conversion.',
    command: 'npm test -- parse',
    output: '  12 passing\n  1 failing\n\n  1) parse\n       skips rows with a blank total:\n     TypeError: Cannot read properties of null (reading "trim")',
    before: 'const total = Number(row.total.trim());',
    after: 'if (!row.total) return null;   // blank total: not a line item\nconst total = Number(row.total.trim());',
    line: 48,
    wrap: 'Fixed. Blank totals are treated as non-line-items and skipped rather than crashing the import. All 13 tests pass now.',
  },
  {
    file: 'styles/layout.css',
    ask: 'The nav overlaps the hero text on phones. Have a look?',
    plan: 'That is almost certainly the fixed positioning on the header with no matching offset on the hero. Let me check the breakpoint.',
    command: 'grep -n "position: fixed" -r styles/',
    output: 'styles/layout.css:22:  position: fixed;\nstyles/layout.css:118:  position: fixed;',
    before: '.hero { padding-top: 0; }',
    after: '.hero { padding-top: var(--nav-height); }',
    line: 118,
    wrap: 'The header is fixed but the hero had no top padding to compensate, so it sat underneath. Now it clears the nav at every width.',
  },
  {
    file: 'lib/report.py',
    ask: 'Weekly report is showing last week twice. Something wrong with the date window.',
    plan: 'Sounds like an inclusive boundary on both ends. Let me confirm how the range is built.',
    command: 'python -m pytest tests/test_report.py -q',
    output: 'F.....\n\nFAILED tests/test_report.py::test_window_excludes_previous_week\n1 failed, 5 passed in 0.42s',
    before: 'start = today - timedelta(days=14)',
    after: 'start = today - timedelta(days=7)',
    line: 31,
    wrap: 'The window was two weeks wide, so the previous week was included alongside the current one. Narrowed to seven days.',
  },
];

// ---- the projects, and the state each one demonstrates ------------------

const PLAN = [
  { name: 'invoice-parser', title: 'Skip invoice rows with a blank total', topic: 0, state: 'healthy', showcase: true },
  { name: 'portfolio-site', title: 'Fix nav overlapping the hero on mobile', topic: 1, state: 'healthy' },
  { name: 'weekly-reports', title: 'Correct the date window in the weekly report', topic: 2, state: 'healthy' },
  { name: 'telemetry-dashboard', title: 'Add p95 latency to the overview panel', topic: 0, state: 'missing' },
  { name: 'legacy-importer', title: 'Port the CSV importer off the old schema', topic: 2, state: 'hidden' },
  { name: 'کوییز', title: 'Add a timer to the quiz screen', topic: 1, state: 'shared-a' },
  { name: 'سلامت', title: 'Track daily step count', topic: 0, state: 'shared-b' },
];

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function build() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(STORE, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });

  const report = [];

  for (const p of PLAN) {
    const projectPath = path.join(WORK, p.name);
    const topic = TOPICS[p.topic];

    // Every project except the "missing" one really exists on disk.
    if (p.state !== 'missing') {
      fs.mkdirSync(path.join(projectPath, path.dirname(topic.file)), { recursive: true });
      fs.writeFileSync(path.join(projectPath, topic.file), topic.after + '\n', 'utf8');
    }

    // "hidden" is a folder somebody renamed by hand, so the name no longer
    // encodes the path recorded inside it and the extension cannot find it.
    let folderName = encodeProjectFolder(projectPath);
    if (p.state === 'hidden') folderName = 'old-backup-of-' + p.name;

    // The two "shared" projects deliberately land in one folder: equal-length
    // non-Latin names encode identically.
    const { sid, text } = session(projectPath, p.title, topic);
    write(path.join(STORE, folderName, sid + '.jsonl'), text);

    if (p.showcase) {
      const sc = showcase(projectPath);
      write(path.join(STORE, folderName, sc.sid + '.jsonl'), sc.text);
      write(path.join(STORE, folderName, 'memory', 'MEMORY.md'),
        '- [User profile](user-profile.md): prefers plain explanations\n- [Money rules](money-rules.md): round once, at the end\n');
      write(path.join(STORE, folderName, 'memory', 'user-profile.md'),
        '# User profile\n\n- Prefers plain explanations, with the technical detail after.\n- Wants every change tested before it is called done.\n');
      write(path.join(STORE, folderName, 'memory', 'money-rules.md'),
        '# Money rules\n\n- Keep amounts as numbers until the very end.\n- Round once, after adding up.\n');
    }

    report.push({ ...p, projectPath, folderName });
  }

  return report;
}

const built = build();

/**
 * A demo archive: everything saved, then one project "deleted by Claude Code"
 * and a memory file rewritten, so the archive shows rescued chats and an older
 * version. Uses the app's own archive code, on demo folders only.
 */
function buildArchive() {
  const { Vault } = require('../server/vault');
  const v = new Vault(ARCHIVE);
  const reports = built.find((b) => b.name === 'weekly-reports');
  const memory = path.join(STORE, built.find((b) => b.showcase).folderName, 'memory', 'money-rules.md');
  const earlier = new Date(Date.UTC(2026, 6, 15, 9));
  fs.utimesSync(memory, earlier, earlier);
  v.save(STORE, { mode: 'live', label: 'demo' });
  fs.writeFileSync(memory, '# Money rules\n\n- Round once, after adding up.\n- Show money with two decimals everywhere.\n', 'utf8');
  fs.rmSync(path.join(STORE, reports.folderName), { recursive: true, force: true });
  v.save(STORE, { mode: 'live', label: 'demo' });
  write(path.join(APPDATA, 'settings.json'), JSON.stringify({ vaultDir: ARCHIVE }, null, 2));
  write(path.join(ROOT, 'claude-settings.json'), '{}\n');
}
buildArchive();

const sharedFolder = built.find((b) => b.state === 'shared-a').folderName;
const sharedAlso = built.find((b) => b.state === 'shared-b').folderName;

console.log('');
console.log('  Demo store built. Nothing in ~/.claude was touched.');
console.log('');
console.log('  store     : ' + STORE);
console.log('  workspace : ' + WORK);
console.log('');
console.log('  What the dashboard will show:');
console.log('');
for (const b of built) {
  const label = {
    healthy: 'ok',
    missing: 'MISSING   - the project folder does not exist',
    hidden: 'HIDDEN    - folder renamed by hand, extension cannot find it',
    'shared-a': 'SHARED    - two projects, one folder name',
    'shared-b': 'SHARED    - (the other half of the pair)',
  }[b.state];
  console.log(`    ${b.name.padEnd(22)} ${label}`);
}
if (sharedFolder === sharedAlso) {
  console.log('');
  console.log(`    both non-Latin projects encode to:  ${sharedFolder}`);
}
console.log('');
console.log('  archive   : ' + ARCHIVE);
console.log('              (weekly-reports was "deleted" from the store, so only the archive has it)');
console.log('');
console.log('  Start the app against it, with its own settings, so your real ones are left alone:');
console.log('');
const env = { CLAUDE_PROJECTS_DIR: STORE, CLAUDE_RELOCATOR_DATA: APPDATA, CLAUDE_SETTINGS_FILE: path.join(ROOT, 'claude-settings.json') };
console.log(process.platform === 'win32'
  ? '    ' + Object.entries(env).map(([k, v]) => `set "${k}=${v}"`).join(' && ') + ' && npm start'
  : '    ' + Object.entries(env).map(([k, v]) => `${k}="${v}"`).join(' ') + ' npm start');
console.log('');
console.log('  When you are done, delete this one folder:');
console.log('');
console.log('    ' + ROOT);
console.log('');
