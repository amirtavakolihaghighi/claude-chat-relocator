#!/usr/bin/env node
'use strict';
/**
 * Builds a throwaway chat store containing every state the app can report:
 * healthy projects, a missing one, a hidden one, and two that share a folder.
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
  { name: 'invoice-parser', title: 'Skip invoice rows with a blank total', topic: 0, state: 'healthy' },
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

    report.push({ ...p, projectPath, folderName });
  }

  return report;
}

const built = build();

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
console.log('  Start the app against it:');
console.log('');
console.log(process.platform === 'win32'
  ? `    set CLAUDE_PROJECTS_DIR=${STORE}&& npm start`
  : `    CLAUDE_PROJECTS_DIR="${STORE}" npm start`);
console.log('');
console.log('  Or start normally and use the store picker in the top bar.');
console.log('');
console.log('  When you are done, delete this one folder:');
console.log('');
console.log('    ' + ROOT);
console.log('');
