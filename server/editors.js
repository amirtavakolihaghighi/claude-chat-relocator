'use strict';
const { execFile } = require('child_process');
const P = require('./paths');

/**
 * Opening a project in an editor.
 *
 * The editor is chosen from a fixed list and looked up on PATH -- the request
 * names an id like "vscode", never a command to run. Combined with execFile
 * (which takes an argument array and never goes through a shell), there is no
 * way for a path or an editor name to turn into an arbitrary command.
 */

const EDITORS = [
  // The VS Code family all share the same CLI, including the window flags.
  { id: 'vscode', name: 'VS Code', commands: ['code'], newWindow: '-n', reuse: '-r' },
  { id: 'vscode-insiders', name: 'VS Code Insiders', commands: ['code-insiders'], newWindow: '-n', reuse: '-r' },
  { id: 'cursor', name: 'Cursor', commands: ['cursor'], newWindow: '-n', reuse: '-r' },
  { id: 'windsurf', name: 'Windsurf', commands: ['windsurf'], newWindow: '-n', reuse: '-r' },
  { id: 'vscodium', name: 'VSCodium', commands: ['codium'], newWindow: '-n', reuse: '-r' },
  { id: 'zed', name: 'Zed', commands: ['zed'], newWindow: null, reuse: null },
  { id: 'sublime', name: 'Sublime Text', commands: ['subl'], newWindow: '-n', reuse: null },
  { id: 'webstorm', name: 'WebStorm', commands: ['webstorm'], newWindow: null, reuse: null },
  { id: 'idea', name: 'IntelliJ IDEA', commands: ['idea'], newWindow: null, reuse: null },
];

let cache = null;
let cachedAt = 0;
const CACHE_MS = 60 * 1000;

/** Is `cmd` on PATH? Uses the OS's own lookup rather than guessing at paths. */
function onPath(cmd) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, [cmd], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout).trim().length > 0);
    });
  });
}

/** Editors actually installed, in the order listed above. */
async function detect(force) {
  if (!force && cache && Date.now() - cachedAt < CACHE_MS) return cache;

  const found = [];
  await Promise.all(EDITORS.map(async (e) => {
    for (const cmd of e.commands) {
      if (await onPath(cmd)) {
        found.push({ id: e.id, name: e.name, command: cmd, supportsNewWindow: !!e.newWindow });
        return;
      }
    }
  }));

  // Promise.all resolves out of order; restore the declared preference.
  found.sort((a, b) => EDITORS.findIndex((e) => e.id === a.id) - EDITORS.findIndex((e) => e.id === b.id));
  cache = found;
  cachedAt = Date.now();
  return found;
}

/**
 * Launch an editor on a folder.
 * @param {string} dir        must be an existing directory
 * @param {string} editorId   an id from EDITORS; defaults to the first found
 * @param {boolean} newWindow open a separate window rather than reusing one
 */
async function open(dir, editorId, newWindow = true) {
  const target = P.normalizePath(dir);
  if (!P.dirExists(target)) {
    const err = new Error(`That folder is not on this machine any more: ${target}`);
    err.status = 404;
    throw err;
  }

  const available = await detect();
  if (!available.length) {
    const err = new Error('No supported editor was found on your PATH. In VS Code, run "Shell Command: Install \'code\' command in PATH" from the command palette.');
    err.status = 400;
    throw err;
  }

  const picked = editorId
    ? available.find((e) => e.id === editorId)
    : available[0];
  if (!picked) {
    const err = new Error(`"${editorId}" is not installed or is not a supported editor.`);
    err.status = 400;
    throw err;
  }

  const spec = EDITORS.find((e) => e.id === picked.id);
  const args = [];
  if (newWindow && spec.newWindow) args.push(spec.newWindow);
  else if (!newWindow && spec.reuse) args.push(spec.reuse);
  args.push(target);

  // On Windows these CLIs are .cmd shims, which execFile refuses to run
  // directly (Node blocks .cmd/.bat without a shell, CVE-2024-27980). Going
  // through `cmd /d /c` runs the shim while still passing arguments as an
  // array, so Node quotes them -- unlike `shell: true`, which concatenates
  // them unescaped and would let a path containing shell characters break out.
  // On macOS and Linux the CLI is a script with a shebang, which execFile runs
  // directly.
  const [command, argv] = process.platform === 'win32'
    ? ['cmd', ['/d', '/c', picked.command, ...args]]
    : [picked.command, args];

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (msg) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error(msg), { status: 500 }));
    };

    let child;
    try {
      child = execFile(command, argv, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        if (settled) return;
        if (err) {
          const detail = String(stderr || err.message).trim().split('\n')[0];
          return fail(`${picked.name} could not be started: ${detail}`);
        }
        settled = true;
        resolve({ editor: picked.name, path: target, newWindow: newWindow && !!spec.newWindow });
      });
    } catch (e) {
      // Some spawn failures throw synchronously rather than calling back.
      return fail(`${picked.name} could not be started: ${e.code || e.message}`);
    }
    child.on('error', (err) => fail(`${picked.name} could not be started: ${err.code || err.message}`));
    // The editor must outlive this request without keeping the server alive.
    child.unref();
  });
}

module.exports = { detect, open, EDITORS };
