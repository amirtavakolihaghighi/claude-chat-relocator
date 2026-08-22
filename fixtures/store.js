'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Synthetic session fixtures.
 *
 * The tests never read a real ~/.claude/projects tree: they build their own
 * store in a temp directory, so the suite is reproducible on any machine and
 * can never touch someone's actual chat history.
 */

let counter = 0;

/**
 * Join a path the way the fixture's own platform would.
 *
 * `path.join` uses the *host* separator, so a fake Windows cwd would gain a
 * "/" on Linux and a "\" on Windows, and the same fixture would produce
 * different bytes on different CI runners. Follow the separator already in the
 * base instead, so a Windows-shaped fixture stays Windows-shaped everywhere.
 */
function joinLike(base, leaf) {
  const sep = String(base).includes('\\') ? '\\' : '/';
  return String(base).replace(/[\\/]+$/, '') + sep + leaf;
}

function tempDir(label = 'ccr') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function uuid(n) {
  const s = String(n).padStart(8, '0');
  return `${s}-0000-4000-8000-000000000000`;
}

const base = (cwd, sessionId, i) => ({
  parentUuid: i === 0 ? null : `${sessionId}-${i - 1}`,
  isSidechain: false,
  uuid: `${sessionId}-${i}`,
  timestamp: new Date(Date.UTC(2026, 7, 1, 10, i, 0)).toISOString(),
  userType: 'external',
  entrypoint: 'claude-vscode',
  cwd,
  sessionId,
  version: '2.0.0',
  gitBranch: 'main',
});

function userText(cwd, sessionId, i, text) {
  return { ...base(cwd, sessionId, i), type: 'user', promptId: `p${i}`, message: { role: 'user', content: [{ type: 'text', text }] } };
}

function assistantText(cwd, sessionId, i, text) {
  return {
    ...base(cwd, sessionId, i), type: 'assistant', requestId: `r${i}`, effort: 'high',
    message: {
      model: 'claude-opus-5', id: `msg_${i}`, type: 'message', role: 'assistant',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
    },
  };
}

function assistantTool(cwd, sessionId, i, name, input, toolId) {
  return {
    ...base(cwd, sessionId, i), type: 'assistant', requestId: `r${i}`, effort: 'high',
    message: {
      model: 'claude-opus-5', id: `msg_${i}`, type: 'message', role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: toolId, name, input },
      ],
      stop_reason: 'tool_use', stop_sequence: null, stop_details: null,
      usage: { input_tokens: 5, output_tokens: 15, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
    },
  };
}

function toolResult(cwd, sessionId, i, toolId, content, structured) {
  return {
    ...base(cwd, sessionId, i), type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content }] },
    toolUseResult: structured,
    sourceToolAssistantUUID: `${sessionId}-${i - 1}`,
  };
}

/**
 * A session with one exchange, an Edit (so there is a real diff), a shell
 * command, and the ai-title record Claude Code writes.
 */
function sessionLines(cwd, sessionId, { title = 'A test conversation' } = {}) {
  const editFile = joinLike(cwd, 'app.js');
  const lines = [
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-01T10:00:00.000Z', sessionId },
    userText(cwd, sessionId, 0, 'Please fix the bug in `app.js` and run the tests.'),
    assistantText(cwd, sessionId, 1, 'I will look at the file first.\n\n```js\nconst a = 1;\n```'),
    assistantTool(cwd, sessionId, 2, 'Edit', { file_path: editFile, old_string: 'const a = 1;', new_string: 'const a = 2;' }, 'toolu_1'),
    toolResult(cwd, sessionId, 3, 'toolu_1', 'edited', {
      filePath: editFile,
      oldString: 'const a = 1;',
      newString: 'const a = 2;',
      replaceAll: false,
      userModified: false,
      originalFile: 'const a = 1;\n',
      structuredPatch: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
        lines: ['-const a = 1;', '+const a = 2;'],
      }],
    }),
    assistantTool(cwd, sessionId, 4, 'Bash', { command: 'npm test' }, 'toolu_2'),
    toolResult(cwd, sessionId, 5, 'toolu_2', 'ok', {
      stdout: 'all tests passed', stderr: '', interrupted: false, isImage: false,
    }),
    assistantText(cwd, sessionId, 6, 'Fixed and the tests pass.'),
    { type: 'ai-title', aiTitle: title, sessionId },
    { type: 'mode', mode: 'auto', sessionId },
  ];
  return lines.map((o) => JSON.stringify(o)).join('\n') + '\n';
}

/**
 * Build a store on disk.
 * @param {Array<{cwd:string, folderName?:string, sessions?:number, title?:string}>} projects
 * @returns {{root:string, dir:string, cleanup:Function}}
 */
function makeStore(projects) {
  const { encodeProjectFolder } = require('../server/paths');
  const dir = tempDir('ccr-store');
  const root = path.join(dir, 'projects');
  fs.mkdirSync(root, { recursive: true });

  for (const p of projects) {
    const folderName = p.folderName || encodeProjectFolder(p.cwd);
    const folder = path.join(root, folderName);
    fs.mkdirSync(folder, { recursive: true });
    const n = p.sessions == null ? 1 : p.sessions;
    for (let i = 0; i < n; i++) {
      const sid = uuid(++counter);
      fs.writeFileSync(path.join(folder, sid + '.jsonl'),
        sessionLines(p.cwd, sid, { title: p.title || `Chat ${counter}` }), 'utf8');
    }
  }
  return { root, dir, cleanup: () => cleanup(dir) };
}

/** Redirect the app's data directory (backups, history) into a temp folder. */
function useTempAppData() {
  const P = require('../server/paths');
  const dir = tempDir('ccr-appdata');
  const original = P.appDataDir;
  P.appDataDir = () => dir;
  return { dir, restore: () => { P.appDataDir = original; cleanup(dir); } };
}

module.exports = { makeStore, useTempAppData, sessionLines, tempDir, cleanup, uuid };
