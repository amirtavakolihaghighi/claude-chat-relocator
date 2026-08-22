'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');

/**
 * Relocation: point a chat folder at a project's new location.
 *
 * Two things have to change together, and doing only the first is the mistake
 * that makes chats "load but behave oddly":
 *
 *   1. the folder name under ~/.claude/projects, which the extension computes
 *      from your workspace path and uses to find the chats at all;
 *   2. the `cwd` field stamped on nearly every record inside the .jsonl files.
 *
 * Everything is dry-run first, backed up before a byte is written, and
 * recorded so it can be undone.
 *
 * Historical path references (tool results, edit snippets, backup.realParentDir)
 * are deliberately left alone: they are a truthful record of what happened at
 * the time, not configuration. The plan reports how many there are.
 */

const LIVE_WINDOW_MS = 90 * 1000;   // a file touched this recently may be open

function historyFile() {
  return path.join(P.appDataDir(), 'history.json');
}

function backupsDir() {
  return path.join(P.appDataDir(), 'backups');
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readHistory() {
  try { return JSON.parse(fs.readFileSync(historyFile(), 'utf8')); }
  catch { return []; }
}

function writeHistory(list) {
  ensureDir(P.appDataDir());
  fs.writeFileSync(historyFile(), JSON.stringify(list, null, 2), 'utf8');
}

function pushHistory(entry) {
  const list = readHistory();
  list.unshift(entry);
  writeHistory(list.slice(0, 200));
  return entry;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Rewrite the `cwd` values in one raw JSONL line, touching nothing else.
 *
 * The line is edited as text rather than re-serialised from a parsed object:
 * re-encoding a 5 MB record could silently reformat numbers or drop key order,
 * and this is the user's only copy. A regex finds the encoded string, decodes
 * it to compare against the real value, and swaps in the new one -- so every
 * other byte of the line survives exactly as written.
 */
const CWD_RE = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/g;

function rewriteLineCwd(line, oldRoot, newRoot) {
  let count = 0;
  const out = line.replace(CWD_RE, (whole, jsonStr) => {
    let value;
    try { value = JSON.parse(jsonStr); } catch { return whole; }
    const next = P.replacePrefix(value, oldRoot, newRoot);
    if (next === null) return whole;          // not under the old root: leave it
    count++;
    return '"cwd":' + JSON.stringify(next);
  });
  return { line: out, count };
}

/** Count references to the old path that we are deliberately NOT changing. */
function countHistoricalRefs(text, oldRoot) {
  const needle = P.foldCase(JSON.stringify(oldRoot).slice(1, -1));  // escaped, unquoted
  if (!needle) return 0;
  const hay = P.foldCase(text);
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function listJsonl(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); }
  catch { return []; }
}

/**
 * Work out exactly what a relocation would do, without doing any of it.
 */
function planRelocate(store, folderName, newProjectPathRaw) {
  const project = store.getProject(folderName);
  const newProjectPath = P.normalizePath(newProjectPathRaw);
  const oldProjectPath = project.projectPath;

  const plan = {
    folderName,
    dirPath: project.dirPath,
    oldProjectPath,
    newProjectPath,
    oldFolderName: folderName,
    newFolderName: P.encodeProjectFolder(newProjectPath),
    folderRenameNeeded: false,
    targetFolderExists: false,
    newProjectPathExists: P.dirExists(newProjectPath),
    files: [],
    totalCwdRewrites: 0,
    totalHistoricalRefs: 0,
    liveFiles: [],
    warnings: [],
    errors: [],
  };

  if (!P.looksAbsolute(newProjectPath)) {
    plan.errors.push(`"${newProjectPathRaw}" is not an absolute path. Use something like D:\\Files\\Projects\\MyApp.`);
    plan.ok = false;
    return plan;
  }
  if (!oldProjectPath) {
    plan.errors.push('This folder has no recorded cwd, so there is no old path to rewrite. You can still rename the folder manually.');
  }
  if (!plan.newProjectPathExists) {
    plan.warnings.push(`${newProjectPath} does not exist on disk yet. The rename will still work, but the extension will only load these chats once you open that folder.`);
  }

  // Non-ASCII paths deserve two extra checks. The encoding turns every
  // non-alphanumeric character into a dash, so a Persian, Cyrillic or CJK
  // folder name becomes one dash per character: names get long fast, and two
  // different names of equal length collapse to the same string.
  const storePathLength = store.root.length + 1 + plan.newFolderName.length;
  plan.newFolderNameLength = plan.newFolderName.length;
  plan.storePathLength = storePathLength;
  if (plan.newFolderName.length > 255) {
    plan.errors.push(`The folder name this path produces is ${plan.newFolderName.length} characters, past the 255-character limit for a single folder name. Move the project somewhere less deeply nested.`);
  } else if (P.IS_WIN && storePathLength > 247) {
    // 247 leaves room for a session filename (a 36-char uuid + ".jsonl") to
    // still fit inside the classic 260-character MAX_PATH.
    plan.warnings.push(`The chat folder path would be ${storePathLength} characters. Windows limits paths to 260 unless long paths are enabled, and the session files inside add about 43 more. Consider a shallower location for the project.`);
  }

  // A path that is not NFC-normalised encodes differently from its NFC twin,
  // and the extension encodes whatever string the OS hands it. Typing a path
  // by hand is where the two can drift apart.
  const nfc = newProjectPath.normalize('NFC');
  if (nfc !== newProjectPath && P.encodeProjectFolder(nfc) !== plan.newFolderName) {
    plan.warnings.push('This path contains characters that can be written more than one way in Unicode, and the spelling you gave encodes to a different folder name than its normalised form. Use Browse instead of typing it, so the path is read straight from disk.');
  }

  if (project.issues && project.issues.includes('ambiguous')) {
    const others = (project.rootCandidates || []).map((c) => c.path).join(', ');
    plan.warnings.push(`This one folder holds chats from more than one project (${others}) because their paths encode to the same name. Only chats recorded against ${oldProjectPath} will be repointed; the rest stay behind.`);
  }

  plan.folderRenameNeeded = plan.newFolderName !== folderName;
  if (plan.folderRenameNeeded) {
    const target = path.join(store.root, plan.newFolderName);
    if (P.dirExists(target)) {
      plan.targetFolderExists = true;
      plan.errors.push(`A chat folder named "${plan.newFolderName}" already exists. Another project is already registered at ${newProjectPath}; merging chat folders is not something this tool will do automatically.`);
    }
  } else {
    plan.warnings.push('The folder name is already correct for that path; only the cwd fields inside the files will change.');
  }

  if (oldProjectPath && P.pathsEqual(oldProjectPath, newProjectPath) && !plan.folderRenameNeeded) {
    plan.warnings.push('The new path is the same as the current one. Nothing to do.');
  }

  const now = Date.now();
  for (const name of listJsonl(project.dirPath)) {
    const full = path.join(project.dirPath, name);
    let text, st;
    try {
      st = fs.statSync(full);
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      plan.errors.push(`Cannot read ${name}: ${e.message}`);
      continue;
    }
    if (now - st.mtimeMs < LIVE_WINDOW_MS) {
      plan.liveFiles.push(name);
    }

    let cwdRewrites = 0;
    if (oldProjectPath) {
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (!line || line.indexOf('"cwd"') === -1) continue;
        cwdRewrites += rewriteLineCwd(line, oldProjectPath, newProjectPath).count;
      }
    }
    const historical = oldProjectPath ? countHistoricalRefs(text, oldProjectPath) : 0;

    plan.files.push({
      name,
      sizeBytes: st.size,
      cwdRewrites,
      historicalRefs: Math.max(0, historical - cwdRewrites),
    });
    plan.totalCwdRewrites += cwdRewrites;
    plan.totalHistoricalRefs += Math.max(0, historical - cwdRewrites);
  }

  if (plan.liveFiles.length) {
    plan.warnings.push(`${plan.liveFiles.join(', ')} changed in the last 90 seconds. If that chat is open in VS Code right now, close it first -- the extension may overwrite your changes.`);
  }

  plan.ok = plan.errors.length === 0;
  return plan;
}

/**
 * Carry out a planned relocation. Backs the whole folder up first.
 */
function applyRelocate(store, folderName, newProjectPathRaw, opts = {}) {
  const plan = planRelocate(store, folderName, newProjectPathRaw);
  if (!plan.ok) {
    const err = new Error(plan.errors[0]);
    err.status = 400;
    err.plan = plan;
    throw err;
  }

  const project = store.getProject(folderName);
  const oldDir = project.dirPath;
  const newDir = path.join(store.root, plan.newFolderName);
  const id = `${stamp()}__${folderName}`.slice(0, 180);

  // ---- 1. back up the whole folder, subdirectories included --------------
  let backupDir = null;
  if (opts.backup !== false) {
    backupDir = path.join(backupsDir(), id);
    ensureDir(path.dirname(backupDir));
    fs.cpSync(oldDir, backupDir, { recursive: true });
  }

  const result = {
    id,
    folderName,
    oldFolderName: folderName,
    newFolderName: plan.newFolderName,
    oldProjectPath: plan.oldProjectPath,
    newProjectPath: plan.newProjectPath,
    backupDir,
    filesRewritten: [],
    cwdRewrites: 0,
    renamed: false,
    at: new Date().toISOString(),
    root: store.root,
  };

  // ---- 2. rewrite cwd in place, one file at a time via a temp file --------
  if (plan.oldProjectPath && !P.pathsEqual(plan.oldProjectPath, plan.newProjectPath)) {
    for (const f of plan.files) {
      if (!f.cwdRewrites) continue;
      const full = path.join(oldDir, f.name);
      const tmp = full + '.relocating';
      const text = fs.readFileSync(full, 'utf8');
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const lines = text.split(/\r?\n/);
      let n = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i] || lines[i].indexOf('"cwd"') === -1) continue;
        const r = rewriteLineCwd(lines[i], plan.oldProjectPath, plan.newProjectPath);
        lines[i] = r.line;
        n += r.count;
      }
      fs.writeFileSync(tmp, lines.join(eol), 'utf8');
      fs.renameSync(tmp, full);
      result.filesRewritten.push({ name: f.name, cwdRewrites: n });
      result.cwdRewrites += n;
    }
  }

  // ---- 3. rename the folder ---------------------------------------------
  if (plan.folderRenameNeeded) {
    fs.renameSync(oldDir, newDir);
    result.renamed = true;
  }

  store.invalidateAll();
  pushHistory(result);
  return { result, plan };
}

/**
 * Bulk remap: "everything that used to live under X now lives under Y".
 * This is the answer to moving a whole projects directory or a whole machine.
 */
function planBulk(store, oldPrefixRaw, newPrefixRaw) {
  const oldPrefix = P.normalizePath(oldPrefixRaw);
  const newPrefix = P.normalizePath(newPrefixRaw);
  const out = { oldPrefix, newPrefix, matches: [], skipped: [], errors: [] };

  if (!P.looksAbsolute(oldPrefix) || !P.looksAbsolute(newPrefix)) {
    out.errors.push('Both the old and new prefix must be absolute paths.');
    return out;
  }

  const scan = store.scan();
  for (const p of scan.projects) {
    if (!p.projectPath) { out.skipped.push({ folderName: p.folderName, reason: 'no recorded path' }); continue; }
    const next = P.replacePrefix(p.projectPath, oldPrefix, newPrefix);
    if (next === null) { out.skipped.push({ folderName: p.folderName, reason: 'not under the old prefix', projectPath: p.projectPath }); continue; }
    const plan = planRelocate(store, p.folderName, next);
    out.matches.push(plan);
  }

  // A remap that would land two folders on the same name must be caught here,
  // before any of them runs and leaves the batch half-applied.
  const byTarget = new Map();
  for (const m of out.matches) {
    const list = byTarget.get(m.newFolderName) || [];
    list.push(m.folderName);
    byTarget.set(m.newFolderName, list);
  }
  for (const [target, sources] of byTarget) {
    if (sources.length > 1) {
      out.errors.push(`${sources.join(' and ')} would both become "${target}". Resolve those individually.`);
    }
  }

  out.ok = out.errors.length === 0 && out.matches.every((m) => m.ok);
  out.totalCwdRewrites = out.matches.reduce((a, m) => a + m.totalCwdRewrites, 0);
  return out;
}

function applyBulk(store, oldPrefix, newPrefix, opts = {}) {
  const plan = planBulk(store, oldPrefix, newPrefix);
  if (!plan.ok) {
    const err = new Error(plan.errors[0] || 'One or more folders cannot be relocated; review the plan.');
    err.status = 400;
    err.plan = plan;
    throw err;
  }
  const results = [];
  for (const m of plan.matches) {
    results.push(applyRelocate(store, m.folderName, m.newProjectPath, opts).result);
  }
  return { plan, results };
}

/** Put a relocation back the way it was, from its backup. */
function undo(store, id) {
  const list = readHistory();
  const entry = list.find((e) => e.id === id);
  if (!entry) {
    const err = new Error('No such operation in history');
    err.status = 404;
    throw err;
  }
  if (entry.undoneAt) {
    const err = new Error('That operation has already been undone');
    err.status = 400;
    throw err;
  }
  if (!entry.backupDir || !P.dirExists(entry.backupDir)) {
    const err = new Error('The backup for that operation is gone, so it cannot be undone automatically');
    err.status = 400;
    throw err;
  }

  const currentDir = path.join(entry.root, entry.newFolderName);
  const originalDir = path.join(entry.root, entry.oldFolderName);

  if (P.dirExists(originalDir) && P.normalizePath(originalDir) !== P.normalizePath(currentDir)) {
    const err = new Error(`"${entry.oldFolderName}" exists again; remove or rename it before undoing.`);
    err.status = 400;
    throw err;
  }

  // Park the relocated folder aside, restore the backup, then drop the parked copy.
  const parked = currentDir + '.undoing-' + Date.now();
  if (P.dirExists(currentDir)) fs.renameSync(currentDir, parked);
  fs.cpSync(entry.backupDir, originalDir, { recursive: true });
  if (P.dirExists(parked)) fs.rmSync(parked, { recursive: true, force: true });

  entry.undoneAt = new Date().toISOString();
  writeHistory(list);
  store.invalidateAll();
  return entry;
}

function history() {
  return readHistory();
}

/** Delete a backup the user no longer wants to keep. */
function forgetBackup(id) {
  const list = readHistory();
  const entry = list.find((e) => e.id === id);
  if (!entry) {
    const err = new Error('No such operation in history');
    err.status = 404;
    throw err;
  }
  if (entry.backupDir && P.dirExists(entry.backupDir)) {
    fs.rmSync(entry.backupDir, { recursive: true, force: true });
  }
  entry.backupDir = null;
  entry.backupRemovedAt = new Date().toISOString();
  writeHistory(list);
  return entry;
}

module.exports = {
  planRelocate, applyRelocate, planBulk, applyBulk,
  undo, history, forgetBackup, backupsDir, rewriteLineCwd,
};
