'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { makeStore } = require('../fixtures/store');
const { Store } = require('../server/store');
const P = require('../server/paths');

/**
 * The extension's matching logic, exercised without a running VS Code.
 *
 * `vscode` is a module the editor injects at runtime, so it cannot be required
 * outside the extension host. A resolver hook substitutes a stub, which is
 * enough because the functions under test never touch the VS Code API.
 */
const vscodeStub = {
  window: {
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined,
    withProgress: async (_o, fn) => fn(),
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: () => '' }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: () => {} },
  env: { openExternal: async () => true },
  Uri: { file: (p) => ({ fsPath: p }) },
  StatusBarAlignment: { Right: 2 },
  ProgressLocation: { Notification: 15 },
  ThemeColor: function (id) { this.id = id; },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return originalResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = {
  id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: vscodeStub,
};

const EXT = require('../extension/src/extension');

test.after(() => { Module._resolveFilename = originalResolve; });

test('the extension module loads and exposes an activate function', () => {
  assert.equal(typeof EXT.activate, 'function');
  assert.equal(typeof EXT.deactivate, 'function');
});

test('a workspace with its own chat folder is recognised', (t) => {
  const workspace = process.cwd();
  const built = makeStore([{ cwd: workspace }]);
  t.after(built.cleanup);

  const info = EXT.inspect(new Store(built.root), workspace);

  assert.equal(info.expected, P.encodeProjectFolder(workspace));
  assert.ok(info.project, 'the workspace has a chat folder');
  assert.equal(info.project.sessionCount, 1);
  assert.equal(info.candidates.length, 0, 'nothing to offer when it is already correct');
});

test('an orphan with the same folder name is offered first', (t) => {
  // The workspace is real; the chats are recorded against an old path that
  // shares its final folder name. This is the case the extension exists for.
  const workspace = process.cwd();
  const leaf = path.basename(workspace);
  const built = makeStore([
    { cwd: `D:\\Old\\Location\\${leaf}` },          // gone: same name
    { cwd: 'D:\\Old\\Location\\Something Else' },   // gone: unrelated name
  ]);
  t.after(built.cleanup);

  const info = EXT.inspect(new Store(built.root), workspace);

  assert.equal(info.project, null, 'no folder is registered for this workspace');
  assert.equal(info.candidates.length, 2, 'both orphans are candidates');
  assert.equal(info.candidates[0].sameName, true);
  assert.match(info.candidates[0].projectPath, new RegExp(leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  assert.equal(info.candidates[1].sameName, false);
});

test('projects whose folders still exist are never offered as candidates', (t) => {
  const workspace = process.cwd();
  const built = makeStore([
    { cwd: path.join(workspace, 'server') },   // a real directory in this repo
  ]);
  t.after(built.cleanup);

  const info = EXT.inspect(new Store(built.root), workspace);

  assert.equal(info.project, null);
  assert.equal(info.candidates.length, 0, 'a healthy project is not an orphan');
});

test('relocating an orphan onto the workspace produces the expected folder name', (t) => {
  // The extension hands the workspace path straight to the shared planner,
  // so the name it lands on must be the one the extension looks for.
  const workspace = process.cwd();
  const built = makeStore([{ cwd: 'D:\\Old\\Location\\Whatever' }]);
  t.after(built.cleanup);

  const store = new Store(built.root);
  const info = EXT.inspect(store, workspace);
  assert.equal(info.candidates.length, 1);

  const RL = require('../server/relocate');
  const plan = RL.planRelocate(store, info.candidates[0].folderName, workspace);

  assert.equal(plan.ok, true);
  assert.equal(plan.newFolderName, info.expected,
    'after relocating, the folder is the one the extension computes for this workspace');
});

test('basename handles trailing separators and both slash styles', () => {
  assert.equal(EXT.basename('D:\\Files\\Projects\\MyApp'), 'MyApp');
  assert.equal(EXT.basename('D:\\Files\\Projects\\MyApp\\'), 'MyApp');
  assert.equal(EXT.basename('/home/me/my-app'), 'my-app');
  assert.equal(EXT.basename(''), '');
});

test('the packaged lib copies stay dependency-free', () => {
  // The build script copies four modules into extension/lib. If one of them
  // grows an npm dependency the packaged extension breaks, because
  // node_modules is deliberately not shipped.
  const allowed = new Set(['fs', 'path', 'os', './paths', './parser', './store', './relocate']);
  for (const name of ['paths.js', 'parser.js', 'store.js', 'relocate.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'server', name), 'utf8');
    for (const m of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(allowed.has(m[1]),
        `server/${name} requires "${m[1]}", which the extension cannot resolve`);
    }
  }
});
