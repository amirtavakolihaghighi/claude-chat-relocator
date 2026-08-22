'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const P = require('./paths');
const { rewriteLineCwd } = require('./relocate');
const { peekSessionFile } = require('./parser');

/**
 * Portable archives: move chats between machines without losing the thread
 * back to their project.
 *
 * A .zip carries the chat folders verbatim plus a manifest recording the
 * absolute project path each one belonged to. On the far side the importer
 * shows those original paths, you say where each project lives now, and the
 * folder is rebuilt under the correctly encoded name with its cwd fields
 * rewritten -- the same operation as a local relocation, just sourced from a zip.
 */

const MANIFEST = 'claude-chats-manifest.json';
const FORMAT = 1;

function stagingDir() {
  return path.join(P.appDataDir(), 'staging');
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

function addFolder(zip, dir, zipPath) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) addFolder(zip, full, zipPath + '/' + name);
    else zip.addFile(zipPath + '/' + name, fs.readFileSync(full));
  }
}

/**
 * Build a zip of one or more chat folders.
 * @param {string[]} folderNames  empty/omitted means every project
 */
function exportArchive(store, folderNames) {
  const scan = store.scan();
  const wanted = folderNames && folderNames.length
    ? scan.projects.filter((p) => folderNames.includes(p.folderName))
    : scan.projects;

  if (!wanted.length) {
    const err = new Error('No matching chat folders to export');
    err.status = 400;
    throw err;
  }

  const zip = new AdmZip();
  const manifest = {
    format: FORMAT,
    app: 'claude-chat-relocator',
    exportedAt: new Date().toISOString(),
    sourceHost: os.hostname(),
    sourcePlatform: process.platform,
    sourceRoot: store.root,
    encodingRule: "lowercase the drive letter, then replace every non-alphanumeric character with '-'",
    projects: [],
  };

  for (const p of wanted) {
    addFolder(zip, p.dirPath, 'projects/' + p.folderName);
    manifest.projects.push({
      folderName: p.folderName,
      projectPath: p.projectPath,
      folderNameMatchesCwd: p.folderNameMatchesCwd,
      sessionCount: p.sessionCount,
      totalSize: p.totalSize,
      lastActivity: p.lastActivity,
      sessions: p.sessions.map((s) => ({
        sessionId: s.sessionId, title: s.title,
        startedAt: s.startedAt, endedAt: s.endedAt,
        messageCount: s.messageCount, sizeBytes: s.sizeBytes,
      })),
    });
  }

  zip.addFile(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.addFile('README.txt', Buffer.from(
    [
      'Claude Code chat archive',
      '',
      'Each folder under projects/ is a chat folder from ~/.claude/projects.',
      'Its name encodes the absolute path of the project it belongs to:',
      'the drive letter is lowercased and every non-alphanumeric character',
      'becomes a dash, so',
      '',
      '    D:\\Files\\Projects\\My_App  ->  d--Files-Projects-My-App',
      '',
      'That encoding is one-way, so ' + MANIFEST + ' records the real path for',
      'each folder. Import this zip with Claude Chat Relocator, tell it where',
      'each project lives on this machine, and it will rebuild the folders with',
      'the right names and rewrite the cwd fields inside the .jsonl files.',
      '',
      'To do it by hand instead: copy a folder into ~/.claude/projects, rename it',
      'using the rule above for the new path, and search-replace the old cwd',
      'value inside every .jsonl.',
    ].join('\n'), 'utf8'));

  return {
    buffer: zip.toBuffer(),
    filename: `claude-chats-${wanted.length === 1 ? wanted[0].folderName : 'all-' + wanted.length}-${new Date().toISOString().slice(0, 10)}.zip`,
    manifest,
  };
}

function readManifest(zip) {
  const entry = zip.getEntry(MANIFEST);
  if (!entry) return null;
  try { return JSON.parse(zip.readAsText(entry)); }
  catch { return null; }
}

/**
 * Stage an uploaded zip and describe what importing it would do.
 * Works with archives this tool wrote and with a hand-made zip of chat folders.
 */
function inspectArchive(store, buffer) {
  let zip;
  try { zip = new AdmZip(buffer); }
  catch (e) {
    const err = new Error('That file is not a readable zip archive');
    err.status = 400;
    throw err;
  }

  const id = 'import-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const stage = path.join(stagingDir(), id);
  ensureDir(stage);
  zip.extractAllTo(stage, true);

  const manifest = readManifest(zip);

  // Chat folders are either under projects/ (our format) or at the top level.
  let base = path.join(stage, 'projects');
  if (!P.dirExists(base)) base = stage;

  const scan = store.scan();
  const existing = new Set(scan.projects.map((p) => p.folderName));

  const projects = [];
  for (const name of fs.readdirSync(base)) {
    const dir = path.join(base, name);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    if (!files.length) continue;

    // Prefer the manifest's recorded path; otherwise recover it from the files.
    const fromManifest = manifest && (manifest.projects || []).find((p) => p.folderName === name);
    let originalPath = fromManifest ? fromManifest.projectPath : null;
    const sessions = [];
    const cwdCounts = new Map();

    for (const f of files) {
      let peek;
      try { peek = peekSessionFile(path.join(dir, f)); } catch { continue; }
      sessions.push({
        sessionId: peek.sessionId, title: peek.title,
        startedAt: peek.startedAt, endedAt: peek.endedAt,
        messageCount: peek.messageCount, sizeBytes: peek.sizeBytes,
      });
      for (const c of peek.cwds) cwdCounts.set(c.path, (cwdCounts.get(c.path) || 0) + c.count);
    }

    const cwds = [...cwdCounts.entries()].map(([p, count]) => ({ path: p, count }))
      .sort((a, b) => b.count - a.count);
    if (!originalPath) {
      const match = cwds.find((c) => P.encodeProjectFolder(c.path) === name);
      originalPath = match ? match.path : (cwds.sort((a, b) => a.path.length - b.path.length)[0] || {}).path || null;
    }
    originalPath = originalPath ? P.normalizePath(originalPath) : null;

    // A sensible default target: same path if it exists here, else same leaf
    // name under this machine's home directory.
    let suggestedPath = originalPath;
    if (originalPath && !P.dirExists(originalPath)) {
      const leaf = originalPath.split(/[\\/]/).filter(Boolean).pop();
      const guess = leaf ? path.join(os.homedir(), leaf) : null;
      if (guess && P.dirExists(guess)) suggestedPath = P.normalizePath(guess);
    }

    projects.push({
      folderName: name,
      originalPath,
      suggestedPath,
      originalPathExists: originalPath ? P.dirExists(originalPath) : false,
      collides: existing.has(name),
      sessionCount: files.length,
      sessions: sessions.sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || ''))),
      cwds,
    });
  }

  if (!projects.length) {
    fs.rmSync(stage, { recursive: true, force: true });
    const err = new Error('No chat folders found in that archive. Expected folders containing .jsonl session files.');
    err.status = 400;
    throw err;
  }

  return {
    stagingId: id,
    hasManifest: !!manifest,
    manifest: manifest ? {
      exportedAt: manifest.exportedAt, sourceHost: manifest.sourceHost,
      sourcePlatform: manifest.sourcePlatform, sourceRoot: manifest.sourceRoot,
    } : null,
    projects,
  };
}

/**
 * Finish an import.
 * @param {Array} mappings  [{ folderName, newProjectPath, skip }]
 */
function applyImport(store, stagingId, mappings) {
  if (!P.isSafeFolderName(stagingId) || !stagingId.startsWith('import-')) {
    const err = new Error('Invalid staging id');
    err.status = 400;
    throw err;
  }
  const stage = path.join(stagingDir(), stagingId);
  if (!P.dirExists(stage)) {
    const err = new Error('That upload has expired. Choose the zip again.');
    err.status = 410;
    throw err;
  }

  let base = path.join(stage, 'projects');
  if (!P.dirExists(base)) base = stage;

  const results = [];
  const errors = [];

  for (const m of mappings || []) {
    if (!m || m.skip) continue;
    const srcDir = path.join(base, m.folderName);
    if (!P.dirExists(srcDir)) { errors.push(`${m.folderName}: not in the archive`); continue; }

    const newPath = P.normalizePath(m.newProjectPath);
    if (!P.looksAbsolute(newPath)) { errors.push(`${m.folderName}: "${m.newProjectPath}" is not an absolute path`); continue; }

    const newFolderName = P.encodeProjectFolder(newPath);
    const destDir = path.join(store.root, newFolderName);
    if (P.dirExists(destDir)) {
      errors.push(`${m.folderName}: a chat folder for ${newPath} already exists here (${newFolderName}). Rename or remove it first.`);
      continue;
    }

    // Rewrite cwd while the folder is still staged, so a failure never leaves
    // a half-rewritten folder inside the live store.
    const oldPath = m.originalPath ? P.normalizePath(m.originalPath) : null;
    let rewrites = 0;
    if (oldPath && !P.pathsEqual(oldPath, newPath)) {
      for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.jsonl'))) {
        const full = path.join(srcDir, f);
        const text = fs.readFileSync(full, 'utf8');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i] || lines[i].indexOf('"cwd"') === -1) continue;
          const r = rewriteLineCwd(lines[i], oldPath, newPath);
          lines[i] = r.line;
          rewrites += r.count;
        }
        fs.writeFileSync(full, lines.join(eol), 'utf8');
      }
    }

    ensureDir(store.root);
    fs.cpSync(srcDir, destDir, { recursive: true });
    results.push({
      folderName: m.folderName,
      newFolderName,
      newProjectPath: newPath,
      oldProjectPath: oldPath,
      cwdRewrites: rewrites,
      projectExists: P.dirExists(newPath),
    });
  }

  fs.rmSync(stage, { recursive: true, force: true });
  store.invalidateAll();
  return { results, errors };
}

/** Drop staged uploads older than a day. */
function cleanStaging(maxAgeMs = 24 * 3600 * 1000) {
  const dir = stagingDir();
  if (!P.dirExists(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true });
        n++;
      }
    } catch { /* already gone */ }
  }
  return n;
}

module.exports = { exportArchive, inspectArchive, applyImport, cleanStaging, MANIFEST };
