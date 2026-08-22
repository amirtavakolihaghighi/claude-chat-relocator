'use strict';
const fs = require('fs');
const path = require('path');
const { parseSessionFile, peekSessionFile } = require('./parser');
const P = require('./paths');

/**
 * Owns the view of a ~/.claude/projects tree: which projects exist, whether
 * their project folder is still on disk, and a small cache of parsed sessions.
 *
 * Two distinct failure modes are surfaced, and they are not the same thing:
 *
 *   orphaned  - the project directory the chats point at is gone (you moved or
 *               renamed it). The extension still lists the chats, but under a
 *               workspace you can no longer open.
 *   mismatch  - the folder name no longer encodes the recorded cwd (someone
 *               renamed the chat folder by hand). The extension computes the
 *               name from your workspace path, so it will never look here --
 *               these chats are invisible until the name is fixed.
 */

const MAX_CACHED_SESSIONS = 6;

class Store {
  constructor(rootDir) {
    this.root = P.normalizePath(rootDir || P.defaultClaudeProjectsDir());
    this._scan = null;
    this._scanKey = null;
    this._sessions = new Map();   // key -> { key, session, imageStore }
  }

  setRoot(dir, { remember = true } = {}) {
    const next = P.normalizePath(dir);
    if (!P.dirExists(next)) {
      const err = new Error(`Not a directory: ${next}`);
      err.status = 400;
      throw err;
    }
    this.root = next;
    this.invalidateAll();
    if (remember) Store.saveRoot(next);
    return this.root;
  }

  /**
   * Remember a non-default store between runs. Someone inspecting a folder
   * restored from an old machine should not have to re-point the app on every
   * restart; pointing back at the default clears the override.
   */
  static settingsFile() {
    return path.join(P.appDataDir(), 'settings.json');
  }

  static saveRoot(dir) {
    try {
      const isDefault = P.pathsEqual(dir, P.defaultClaudeProjectsDir());
      fs.mkdirSync(P.appDataDir(), { recursive: true });
      const current = Store.readSettings();
      if (isDefault) delete current.root;
      else current.root = dir;
      fs.writeFileSync(Store.settingsFile(), JSON.stringify(current, null, 2), 'utf8');
    } catch { /* a read-only home just means the choice is not remembered */ }
  }

  static readSettings() {
    try { return JSON.parse(fs.readFileSync(Store.settingsFile(), 'utf8')) || {}; }
    catch { return {}; }
  }

  /** Where to start: explicit env var, then a remembered choice, then default. */
  static initialRoot() {
    if (process.env.CLAUDE_PROJECTS_DIR) return process.env.CLAUDE_PROJECTS_DIR;
    const saved = Store.readSettings().root;
    if (saved && P.dirExists(saved)) return saved;
    return P.defaultClaudeProjectsDir();
  }

  invalidateAll() {
    this._scan = null;
    this._scanKey = null;
    this._sessions.clear();
  }

  /** Cheap signature of the tree, so a rescan is skipped when nothing moved. */
  _treeKey() {
    if (!P.dirExists(this.root)) return 'missing';
    const parts = [];
    for (const name of fs.readdirSync(this.root).sort()) {
      const dir = path.join(this.root, name);
      let st;
      try { st = fs.statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;
      parts.push(name + ':' + st.mtimeMs);
      try {
        for (const f of fs.readdirSync(dir).sort()) {
          if (!f.endsWith('.jsonl')) continue;
          const fst = fs.statSync(path.join(dir, f));
          parts.push(f + ':' + fst.mtimeMs + ':' + fst.size);
        }
      } catch { /* unreadable folder: signature just omits it */ }
    }
    return parts.join('|');
  }

  scan(force) {
    const key = this._treeKey();
    if (!force && this._scan && this._scanKey === key) return this._scan;

    const projects = [];
    if (!P.dirExists(this.root)) {
      this._scan = { root: this.root, exists: false, projects, scannedAt: new Date().toISOString() };
      this._scanKey = key;
      return this._scan;
    }

    for (const folderName of fs.readdirSync(this.root)) {
      const dir = path.join(this.root, folderName);
      let st;
      try { st = fs.statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;

      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      } catch { /* keep the project listed but empty */ }

      const sessions = [];
      const cwdCounts = new Map();
      let totalSize = 0;
      let lastActivity = null;

      for (const f of files) {
        const full = path.join(dir, f);
        let peek;
        try { peek = peekSessionFile(full); }
        catch (e) { sessions.push({ sessionId: path.basename(f, '.jsonl'), file: full, unreadable: String(e.message) }); continue; }
        totalSize += peek.sizeBytes;
        for (const c of peek.cwds) cwdCounts.set(c.path, (cwdCounts.get(c.path) || 0) + c.count);
        const act = peek.endedAt || peek.mtime;
        if (!lastActivity || act > lastActivity) lastActivity = act;
        sessions.push(peek);
      }

      sessions.sort((a, b) => String(b.endedAt || b.mtime || '').localeCompare(String(a.endedAt || a.mtime || '')));

      const cwds = [...cwdCounts.entries()]
        .map(([p, count]) => ({ path: p, count }))
        .sort((a, b) => b.count - a.count);

      // The project root is the cwd that encodes back to this folder name.
      // More than one distinct path can encode to the same name -- the rule
      // collapses every non-alphanumeric character to a dash, so two projects
      // whose names differ only in non-ASCII characters of equal length (very
      // easy with Persian, Cyrillic or CJK folder names) land in one folder.
      // Case-only variants of the same path are not ambiguity; Claude Code
      // records both "D:\..." and "d:\..." for a single project.
      const rootCandidates = cwds.filter((c) => P.encodeProjectFolder(c.path) === folderName);
      const distinctRoots = [...new Map(
        rootCandidates.map((c) => [P.foldCase(P.normalizePath(c.path)), c])
      ).values()];

      let rootCwd = rootCandidates[0];
      const matches = rootCandidates.length > 0;
      if (!rootCwd) rootCwd = [...cwds].sort((a, b) => a.path.length - b.path.length)[0];

      const projectPath = rootCwd ? P.normalizePath(rootCwd.path) : null;
      const issues = [];
      if (!files.length) issues.push('empty');
      if (!projectPath) issues.push('unknown-path');
      else {
        if (!P.dirExists(projectPath)) issues.push('orphaned');
        if (!matches) issues.push('mismatch');
        if (distinctRoots.length > 1) issues.push('ambiguous');
      }

      projects.push({
        folderName,
        dirPath: dir,
        projectPath,
        expectedFolderName: projectPath ? P.encodeProjectFolder(projectPath) : null,
        projectExists: projectPath ? P.dirExists(projectPath) : false,
        folderNameMatchesCwd: matches,
        rootCandidates: distinctRoots.map((c) => ({ path: P.normalizePath(c.path), count: c.count })),
        issues,
        healthy: issues.length === 0,
        sessionCount: files.length,
        totalSize,
        lastActivity,
        cwds,
        sessions,
      });
    }

    projects.sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')));
    this._scan = { root: this.root, exists: true, projects, scannedAt: new Date().toISOString() };
    this._scanKey = key;
    return this._scan;
  }

  getProject(folderName) {
    const scan = this.scan();
    const p = scan.projects.find((x) => x.folderName === folderName);
    if (!p) {
      const err = new Error(`No such project folder: ${folderName}`);
      err.status = 404;
      throw err;
    }
    return p;
  }

  sessionPath(folderName, sessionId) {
    if (!P.isSafeFolderName(folderName) || !P.isSafeFolderName(sessionId)) {
      const err = new Error('Invalid folder or session id');
      err.status = 400;
      throw err;
    }
    const full = path.join(this.root, folderName, sessionId + '.jsonl');
    if (!P.isUnder(full, this.root)) {
      const err = new Error('Path escapes the project root');
      err.status = 400;
      throw err;
    }
    if (!P.fileExists(full)) {
      const err = new Error(`No such session: ${sessionId}`);
      err.status = 404;
      throw err;
    }
    return full;
  }

  /** Parse a session, reusing the cached result while the file is unchanged. */
  loadSession(folderName, sessionId) {
    const full = this.sessionPath(folderName, sessionId);
    const st = fs.statSync(full);
    const key = `${full}|${st.mtimeMs}|${st.size}`;

    const hit = this._sessions.get(key);
    if (hit) {
      this._sessions.delete(key);
      this._sessions.set(key, hit);      // refresh LRU position
      return hit;
    }

    const parsed = parseSessionFile(full);
    const entry = { key, session: parsed.session, imageStore: parsed.imageStore };
    this._sessions.set(key, entry);
    while (this._sessions.size > MAX_CACHED_SESSIONS) {
      this._sessions.delete(this._sessions.keys().next().value);
    }
    return entry;
  }

  getImage(folderName, sessionId, ref) {
    const { imageStore } = this.loadSession(folderName, sessionId);
    const img = imageStore.get(ref);
    if (!img) {
      const err = new Error('No such image');
      err.status = 404;
      throw err;
    }
    return { mediaType: img.mediaType, buffer: Buffer.from(img.data, 'base64') };
  }

  /** Strip server-only payloads before the transcript goes over the wire. */
  static toClientSession(session) {
    return {
      sessionId: session.sessionId,
      folderName: session.folderName,
      title: session.title,
      projectPath: session.projectPath,
      cwds: session.cwds,
      gitBranch: session.gitBranch,
      versions: session.versions,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      sizeBytes: session.sizeBytes,
      folderNameMatchesCwd: session.folderNameMatchesCwd,
      parseErrors: session.parseErrors,
      stats: session.stats,
      turnCount: session.turns.length,
    };
  }
}

module.exports = { Store };
