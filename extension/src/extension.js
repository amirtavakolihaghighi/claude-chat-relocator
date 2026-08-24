'use strict';
const vscode = require('vscode');
const path = require('path');
const { P, Store, RL } = require('./lib');

/**
 * The one thing an extension can do that the web app cannot: it knows which
 * project you have open. So it can notice, at the moment you open a workspace,
 * that Claude Code has chats for it recorded under a path that no longer
 * exists -- and offer to repoint them right there.
 *
 * Everything destructive goes through the same planner the web app uses, so a
 * relocation from here is dry-run first, backed up, and undoable.
 */

let statusItem = null;
const alreadyOffered = new Set();   // one prompt per workspace per session

function storeRoot() {
  const configured = vscode.workspace.getConfiguration('claudeChats').get('storePath');
  return (configured && String(configured).trim()) || P.defaultClaudeProjectsDir();
}

function openStore() {
  const root = storeRoot();
  if (!P.dirExists(root)) return null;
  return new Store(root);
}

function workspaceFolders() {
  return (vscode.workspace.workspaceFolders || [])
    .filter((f) => f.uri.scheme === 'file')
    .map((f) => f.uri.fsPath);
}

function basename(p) {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

/**
 * What does the store say about this workspace?
 * Returns { folderName, project|null, candidates[] }.
 */
function inspect(store, workspacePath) {
  const expected = P.encodeProjectFolder(workspacePath);
  const scan = store.scan(true);
  const project = scan.projects.find((p) => p.folderName === expected) || null;

  // Chat folders that point at somewhere no longer on this machine are the
  // ones that might belong here. Same-named folders come first.
  const leaf = basename(workspacePath).toLowerCase();
  const candidates = scan.projects
    .filter((p) => p.folderName !== expected && p.projectPath && !p.projectExists)
    .map((p) => ({ ...p, sameName: basename(p.projectPath).toLowerCase() === leaf }))
    .sort((a, b) => (b.sameName - a.sameName)
      || String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')));

  return { expected, project, candidates };
}

function describe(p) {
  const chats = `${p.sessionCount} chat${p.sessionCount === 1 ? '' : 's'}`;
  return `${basename(p.projectPath)} — ${chats}, last used ${p.lastActivity ? new Date(p.lastActivity).toLocaleDateString() : 'unknown'}`;
}

// ---------------------------------------------------------------- actions ---

/**
 * Relocate one chat folder onto this workspace, showing the plan first.
 */
async function relocate(store, project, workspacePath) {
  let plan;
  try {
    plan = RL.planRelocate(store, project.folderName, workspacePath);
  } catch (e) {
    return vscode.window.showErrorMessage(`Could not plan the relocation: ${e.message}`);
  }

  if (!plan.ok) {
    return vscode.window.showErrorMessage(`Cannot relocate: ${plan.errors[0]}`);
  }

  const detail = [
    `From:  ${plan.oldProjectPath}`,
    `To:    ${plan.newProjectPath}`,
    '',
    plan.folderRenameNeeded
      ? `The chat folder will be renamed to ${plan.newFolderName}.`
      : 'The folder name is already correct.',
    plan.totalCwdRewrites
      ? `${plan.totalCwdRewrites} recorded path${plan.totalCwdRewrites === 1 ? '' : 's'} will be rewritten across ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}.`
      : 'No recorded paths need rewriting.',
    '',
    'The whole folder is backed up first, and this can be undone.',
    ...(plan.warnings.length ? ['', ...plan.warnings.map((w) => `Note: ${w}`)] : []),
  ].join('\n');

  const go = await vscode.window.showWarningMessage(
    `Relocate ${project.sessionCount} chat${project.sessionCount === 1 ? '' : 's'} to this workspace?`,
    { modal: true, detail },
    'Relocate',
  );
  if (go !== 'Relocate') return;

  let result;
  try {
    result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Relocating chats…' },
      async () => RL.applyRelocate(store, project.folderName, workspacePath, { backup: true }).result,
    );
  } catch (e) {
    return vscode.window.showErrorMessage(`Relocation failed: ${e.message}`);
  }

  const choice = await vscode.window.showInformationMessage(
    `Relocated ${project.sessionCount} chat${project.sessionCount === 1 ? '' : 's'} to this workspace. `
    + `Reload the window for Claude Code to pick them up.`,
    'Reload Window', 'Undo',
  );

  if (choice === 'Reload Window') {
    vscode.commands.executeCommand('workbench.action.reloadWindow');
  } else if (choice === 'Undo') {
    try {
      RL.undo(store, result.id);
      vscode.window.showInformationMessage('Relocation undone. The folder is back as it was.');
    } catch (e) {
      vscode.window.showErrorMessage(`Could not undo: ${e.message}`);
    }
  }
  refreshStatus();
}

/** Offer the candidates for this workspace and relocate the chosen one. */
async function relocateHere(silentIfNothing) {
  const folders = workspaceFolders();
  if (!folders.length) {
    if (!silentIfNothing) vscode.window.showInformationMessage('Open a folder first — there is no workspace to relocate chats to.');
    return;
  }
  const workspacePath = folders[0];

  const store = openStore();
  if (!store) {
    return vscode.window.showWarningMessage(`No Claude chat store at ${storeRoot()}. Set "claudeChats.storePath" if it lives elsewhere.`);
  }

  const { project, candidates } = inspect(store, workspacePath);
  if (project) {
    const go = await vscode.window.showInformationMessage(
      `This workspace already has ${project.sessionCount} chat${project.sessionCount === 1 ? '' : 's'}. Relocate a different folder here anyway?`,
      'Choose a folder', 'Cancel');
    if (go !== 'Choose a folder') return;
  }

  if (!candidates.length) {
    return vscode.window.showInformationMessage('No orphaned chat folders were found — every folder in the store points at a project that exists.');
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((p) => ({
      label: basename(p.projectPath),
      description: p.sameName ? '$(check) same folder name' : '',
      detail: `${p.sessionCount} chat${p.sessionCount === 1 ? '' : 's'} · recorded at ${p.projectPath}`,
      project: p,
    })),
    { title: 'Which chats belong to this workspace?', placeHolder: workspacePath, matchOnDetail: true },
  );
  if (!picked) return;

  await relocate(store, picked.project, workspacePath);
}

// ---------------------------------------------------------------- status ---

function refreshStatus() {
  const show = vscode.workspace.getConfiguration('claudeChats').get('showStatusBar');
  if (!statusItem) return;
  if (!show) return statusItem.hide();

  const folders = workspaceFolders();
  const store = folders.length ? openStore() : null;
  if (!store) return statusItem.hide();

  let info;
  try { info = inspect(store, folders[0]); }
  catch { return statusItem.hide(); }

  if (info.project) {
    statusItem.text = `$(comment-discussion) ${info.project.sessionCount}`;
    statusItem.tooltip = `${info.project.sessionCount} Claude chat(s) for this workspace.\nClick to check.`;
    statusItem.backgroundColor = undefined;
  } else if (info.candidates.length) {
    statusItem.text = `$(warning) Claude chats`;
    statusItem.tooltip = 'Claude has chats that may belong to this workspace but are recorded elsewhere.\nClick to fix.';
    statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusItem.text = `$(comment-discussion) 0`;
    statusItem.tooltip = 'No Claude chats recorded for this workspace.';
    statusItem.backgroundColor = undefined;
  }
  statusItem.show();
}

/** The startup check: only speaks up when something looks wrong. */
async function checkWorkspace(manual) {
  const folders = workspaceFolders();
  if (!folders.length) {
    if (manual) vscode.window.showInformationMessage('Open a folder first.');
    return;
  }
  const workspacePath = folders[0];

  const store = openStore();
  if (!store) {
    if (manual) vscode.window.showWarningMessage(`No Claude chat store at ${storeRoot()}.`);
    return;
  }

  let info;
  try { info = inspect(store, workspacePath); }
  catch (e) {
    if (manual) vscode.window.showErrorMessage(`Could not read the chat store: ${e.message}`);
    return;
  }
  refreshStatus();

  if (info.project) {
    if (manual) {
      vscode.window.showInformationMessage(
        `${info.project.sessionCount} Claude chat${info.project.sessionCount === 1 ? '' : 's'} for this workspace, in ${info.project.folderName}.`);
    }
    return;
  }

  if (!info.candidates.length) {
    if (manual) vscode.window.showInformationMessage('No Claude chats are recorded for this workspace, and nothing orphaned looks like it belongs here.');
    return;
  }

  // Only nag once per workspace per session.
  if (!manual && alreadyOffered.has(workspacePath)) return;
  alreadyOffered.add(workspacePath);

  const best = info.candidates[0];
  const many = info.candidates.length > 1;
  const message = best.sameName
    ? `Claude has ${best.sessionCount} chat${best.sessionCount === 1 ? '' : 's'} for a project called "${basename(best.projectPath)}", recorded at a path that no longer exists. Do they belong to this workspace?`
    : `No Claude chats are recorded for this workspace, but ${info.candidates.length} chat folder${many ? 's' : ''} point at ${many ? 'paths' : 'a path'} that no longer exist.`;

  const buttons = best.sameName ? ['Relocate them here', 'Choose…', 'Not now'] : ['Choose…', 'Not now'];
  const choice = await vscode.window.showInformationMessage(message, ...buttons);

  if (choice === 'Relocate them here') await relocate(store, best, workspacePath);
  else if (choice === 'Choose…') await relocateHere(false);
}

async function revealFolder() {
  const folders = workspaceFolders();
  if (!folders.length) return vscode.window.showInformationMessage('Open a folder first.');
  const store = openStore();
  if (!store) return vscode.window.showWarningMessage(`No Claude chat store at ${storeRoot()}.`);

  const { expected, project } = inspect(store, folders[0]);
  if (!project) {
    return vscode.window.showWarningMessage(`No chat folder named ${expected} exists yet for this workspace.`);
  }
  await vscode.env.openExternal(vscode.Uri.file(project.dirPath));
}

async function undoLast() {
  const store = openStore();
  if (!store) return vscode.window.showWarningMessage(`No Claude chat store at ${storeRoot()}.`);

  const entry = RL.history().find((h) => !h.undoneAt && h.backupDir);
  if (!entry) return vscode.window.showInformationMessage('There is no relocation left to undo.');

  const go = await vscode.window.showWarningMessage(
    `Undo the relocation of ${entry.oldFolderName}?`,
    { modal: true, detail: `It was renamed to ${entry.newFolderName} and ${entry.cwdRewrites} recorded path(s) were rewritten.\n\nThe folder will be restored from its backup exactly as it was.` },
    'Undo',
  );
  if (go !== 'Undo') return;

  try {
    RL.undo(store, entry.id);
    vscode.window.showInformationMessage('Relocation undone.');
    refreshStatus();
  } catch (e) {
    vscode.window.showErrorMessage(`Could not undo: ${e.message}`);
  }
}

// ------------------------------------------------------------- lifecycle ---

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'claudeChats.check';
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeChats.check', () => checkWorkspace(true)),
    vscode.commands.registerCommand('claudeChats.relocateHere', () => relocateHere(false)),
    vscode.commands.registerCommand('claudeChats.revealFolder', revealFolder),
    vscode.commands.registerCommand('claudeChats.undoLast', undoLast),
    vscode.workspace.onDidChangeWorkspaceFolders(() => checkWorkspace(false)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeChats')) refreshStatus();
    }),
  );

  refreshStatus();
  if (vscode.workspace.getConfiguration('claudeChats').get('checkOnStartup')) {
    // Let the window settle before saying anything.
    setTimeout(() => checkWorkspace(false).catch(() => {}), 1500);
  }
}

function deactivate() {}

// `inspect` and `basename` are exported so the matching logic can be tested
// without a running VS Code. Only activate/deactivate are used by the host.
module.exports = { activate, deactivate, inspect, basename };
