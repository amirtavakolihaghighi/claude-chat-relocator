'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const P = require('./paths');

/**
 * The permanent archive.
 *
 * Claude Code deletes chats after `cleanupPeriodDays` (30 by default), and
 * Claude rewrites memory files in place, so a copy-and-overwrite backup keeps
 * losing things. The archive keeps all of it, by three rules:
 *
 *   - a file that only grew (a chat: Claude Code appends to it, and compaction
 *     appends too) replaces the archived copy -- the old copy is the start of
 *     the new one, so nothing is lost and no second copy is needed;
 *   - a file that was rewritten (a memory file Claude tidied, a transcript set
 *     aside) keeps every earlier version, compressed, stored once each;
 *   - a file that disappears from Claude Code stays here, dated.
 *
 * Nothing is ever deleted from the archive.
 *
 * Layout:
 *   <dir>/projects/   the most complete copy of every file, laid out exactly
 *                     like ~/.claude/projects, so the viewer can read it as a
 *                     store and a chat can be copied straight back
 *   <dir>/versions/   earlier versions, gzip, named by their SHA-256
 *   <dir>/index.json  what is held, with hashes, sizes and dates
 *   <dir>/log.jsonl   one line per save: what changed and why
 */

const FORMAT = 1;
const LOCK_STALE_MS = 15 * 60 * 1000;
const MAX_LOGGED_CHANGES = 400;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Every file under `root`, as forward-slash paths relative to it. */
function walk(root) {
  const out = [];
  const visit = (dir, rel) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      // half-finished writes from this app's own relocation and undo steps
      if (name.endsWith('.relocating') || name.includes('.undoing-')) continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      const r = rel ? rel + '/' + name : name;
      if (st.isDirectory()) visit(full, r);
      else if (st.isFile()) out.push(r);
    }
  };
  visit(root, '');
  return out.sort();
}

/** A relative archive path is safe: no escaping, no absolute parts. */
function isSafeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 1000) return false;
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.includes('\\')) return false;
  return rel.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}

/** What kind of Claude Code file a path is, from its place in the tree. */
function kindOf(rel) {
  const parts = rel.split('/');
  if (parts.length === 2 && parts[1].endsWith('.jsonl')) return 'chat';
  if (parts[1] === 'memory') return 'memory';
  if (parts.includes('subagents')) return 'subagent';
  if (parts.includes('tool-results')) return 'tool-result';
  return 'other';
}

class Vault {
  constructor(dir) {
    if (!dir || !P.looksAbsolute(dir)) {
      const e = new Error('The archive needs an absolute folder path.');
      e.status = 400;
      throw e;
    }
    this.dir = P.normalizePath(dir);
  }

  get projectsDir() { return path.join(this.dir, 'projects'); }
  get versionsDir() { return path.join(this.dir, 'versions'); }
  get indexFile() { return path.join(this.dir, 'index.json'); }
  get logFile() { return path.join(this.dir, 'log.jsonl'); }
  get lockFile() { return path.join(this.dir, '.saving'); }
  get pendingFile() { return path.join(this.dir, '.save-again'); }

  exists() { return P.fileExists(this.indexFile); }

  // ------------------------------------------------------------ index ---

  readIndex() {
    try {
      const idx = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (idx && idx.files) return idx;
    } catch { /* new archive */ }
    return { format: FORMAT, createdAt: new Date().toISOString(), lastSaveAt: null, liveRoot: null, files: {} };
  }

  writeIndex(idx) {
    ensureDir(this.dir);
    const tmp = this.indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(idx), 'utf8');
    fs.renameSync(tmp, this.indexFile);
  }

  appendLog(entry) {
    ensureDir(this.dir);
    fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf8');
  }

  readLog(limit = 50) {
    let text = '';
    try { text = fs.readFileSync(this.logFile, 'utf8'); } catch { return []; }
    const lines = text.split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { out.push(JSON.parse(lines[i])); } catch { /* a torn last line */ }
    }
    return out;
  }

  writeReadme() {
    const f = path.join(this.dir, 'ABOUT THIS FOLDER.txt');
    if (P.fileExists(f)) return;
    fs.writeFileSync(f, [
      'Claude Code chat archive, kept by Claude Chat Relocator.',
      '',
      'projects/   the most complete copy of every chat and memory file, laid out',
      '            exactly like ~/.claude/projects. You can copy a chat folder',
      '            back by hand if you ever need to.',
      'versions/   earlier versions of files that were rewritten (mostly memory',
      '            files), gzip-compressed and named by their SHA-256.',
      'index.json  what is held, with sizes, dates and hashes.',
      'log.jsonl   one line per save: what changed and why.',
      '',
      'Nothing in here is ever deleted by the app. Your chats are private:',
      'do not put this folder anywhere public.',
      '',
    ].join('\r\n'), 'utf8');
  }

  // ------------------------------------------------------------ files ---

  currentPath(rel) { return path.join(this.projectsDir, ...rel.split('/')); }

  versionPath(hash) { return path.join(this.versionsDir, hash.slice(0, 2), hash + '.gz'); }

  /** Write the archive's current copy, temp file then rename, keeping the source's date. */
  writeCurrent(rel, buf, mtime) {
    const dest = this.currentPath(rel);
    ensureDir(path.dirname(dest));
    const tmp = dest + '.archiving';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    if (mtime) fs.utimesSync(dest, mtime, mtime);
    return fs.statSync(dest).mtimeMs;
  }

  storeVersion(buf) {
    const hash = sha256(buf);
    const f = this.versionPath(hash);
    if (!P.fileExists(f)) {
      ensureDir(path.dirname(f));
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, zlib.gzipSync(buf));
      fs.renameSync(tmp, f);
    }
    return hash;
  }

  readVersion(hash) {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      const e = new Error('Not a version id'); e.status = 400; throw e;
    }
    return zlib.gunzipSync(fs.readFileSync(this.versionPath(hash)));
  }

  /** Does the archived copy of `rel` start with exactly these bytes? */
  currentStartsWith(rel, buf) {
    let fd;
    try {
      fd = fs.openSync(this.currentPath(rel), 'r');
      const head = Buffer.alloc(buf.length);
      const n = fs.readSync(fd, head, 0, buf.length, 0);
      return n === buf.length && head.equals(buf);
    } catch { return false; }
    finally { if (fd != null) fs.closeSync(fd); }
  }

  /**
   * Bring the index entry back in line with the file on disk, if they drifted
   * (a save interrupted between writing the file and writing the index).
   */
  heal(entry, rel) {
    let st;
    try { st = fs.statSync(this.currentPath(rel)); } catch { return null; }
    if (st.size === entry.size && st.mtimeMs === entry.mtimeMs) return entry;
    const buf = fs.readFileSync(this.currentPath(rel));
    entry.sha256 = sha256(buf);
    entry.size = buf.length;
    entry.mtimeMs = st.mtimeMs;
    return entry;
  }

  // ------------------------------------------------------------- lock ---

  acquireLock() {
    ensureDir(this.dir);
    try {
      fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return true;
    } catch {
      let age = Infinity;
      try { age = Date.now() - fs.statSync(this.lockFile).mtimeMs; } catch { /* vanished */ }
      if (age > LOCK_STALE_MS) {
        try { fs.rmSync(this.lockFile, { force: true }); } catch { /* raced */ }
        return this.acquireLock();
      }
      return false;
    }
  }

  releaseLock() {
    try { fs.rmSync(this.lockFile, { force: true }); } catch { /* already gone */ }
  }

  // ------------------------------------------------------------- save ---

  /**
   * Save everything under `sourceRoot` into the archive.
   *
   * @param {string} sourceRoot  a ~/.claude/projects-shaped folder
   * @param {object} opts
   *   mode   'live'   -- Claude Code's own folder: files missing from it are
   *                     marked as gone (never deleted here);
   *          'import' -- an old backup: nothing is marked gone, and when a file
   *                     differs from what is held, the newer one becomes the
   *                     current copy and the other is kept as a version.
   *   label  shown in the log
   *   busy   'queue' (default) leaves a note so the running save goes again;
   *          'fail' throws instead
   */
  save(sourceRoot, opts = {}) {
    const mode = opts.mode === 'import' ? 'import' : 'live';
    const root = P.normalizePath(sourceRoot);
    if (!P.dirExists(root)) {
      const e = new Error(`No such folder: ${root}`); e.status = 400; throw e;
    }
    if (P.isUnder(root, this.dir) || P.isUnder(this.dir, root)) {
      const e = new Error('The archive cannot be inside the folder it saves, or the other way round.');
      e.status = 400; e.help = 'E-ARCHIVE-INSIDE'; throw e;
    }

    if (!this.acquireLock()) {
      if (opts.busy === 'fail') {
        const e = new Error('A save is already running. Try again in a moment.'); e.status = 409; e.help = 'E-ARCHIVE-BUSY'; throw e;
      }
      try { fs.writeFileSync(this.pendingFile, String(Date.now())); } catch { /* best effort */ }
      return { busy: true };
    }

    try {
      let result = this._save(root, mode, opts.label);
      // Saves asked for while this one ran (the hook fires after every reply).
      for (let again = 0; again < 3 && P.fileExists(this.pendingFile); again++) {
        fs.rmSync(this.pendingFile, { force: true });
        const next = this._save(root, mode, opts.label);
        for (const k of Object.keys(result.counts)) result.counts[k] += next.counts[k];
        result.changes = result.changes.concat(next.changes).slice(0, MAX_LOGGED_CHANGES);
      }
      return result;
    } finally {
      this.releaseLock();
    }
  }

  _save(root, mode, label) {
    const idx = this.readIndex();
    if (mode === 'live' && !idx.liveRoot) idx.liveRoot = root;
    const isLiveRoot = mode === 'live' && P.pathsEqual(idx.liveRoot, root);
    const now = new Date().toISOString();

    ensureDir(this.projectsDir);
    this.writeReadme();

    const counts = { added: 0, grew: 0, versioned: 0, kept: 0, unchanged: 0, gone: 0, back: 0, failed: 0 };
    const changes = [];
    const note = (rel, action, extra) => {
      if (changes.length < MAX_LOGGED_CHANGES) changes.push({ rel, action, ...(extra || {}) });
    };
    let dirty = 0;
    const checkpoint = () => { if (++dirty % 25 === 0) this.writeIndex(idx); };

    const seen = new Set();
    for (const rel of walk(root)) {
      seen.add(rel);
      const full = path.join(root, ...rel.split('/'));
      let st;
      try { st = fs.statSync(full); } catch { continue; }

      let entry = idx.files[rel];
      // Fast path: Claude Code's copy has not moved since the last save.
      if (entry && isLiveRoot && entry.live && entry.live.size === st.size && entry.live.mtimeMs === st.mtimeMs) {
        if (entry.goneFromLiveAt) { entry.goneFromLiveAt = null; counts.back++; note(rel, 'back'); checkpoint(); }
        counts.unchanged++;
        continue;
      }

      let buf;
      try { buf = fs.readFileSync(full); } catch (e) {
        counts.failed++; note(rel, 'failed', { reason: e.code || e.message }); continue;
      }
      const hash = sha256(buf);

      if (entry && !this.heal(entry, rel)) entry = null;   // archived copy went missing: take it again

      if (!entry) {
        const mtimeMs = this.writeCurrent(rel, buf, st.mtime);
        idx.files[rel] = entry = {
          sha256: hash, size: buf.length, mtimeMs, sourceMtimeMs: st.mtimeMs,
          firstSeenAt: now, updatedAt: now, versions: [],
        };
        counts.added++; note(rel, 'added', { size: buf.length });
      } else if (hash === entry.sha256 || entry.versions.some((v) => v.sha256 === hash)) {
        counts.unchanged++;
      } else if (buf.length > entry.size && sha256(buf.subarray(0, entry.size)) === entry.sha256) {
        // Only grew: what we hold is the start of this file.
        entry.mtimeMs = this.writeCurrent(rel, buf, st.mtime);
        entry.sha256 = hash; entry.size = buf.length; entry.sourceMtimeMs = st.mtimeMs; entry.updatedAt = now;
        counts.grew++; note(rel, 'grew', { size: buf.length });
      } else if (buf.length < entry.size && this.currentStartsWith(rel, buf)) {
        // A shorter copy of what we already hold (an older backup, or a file
        // cut short). Everything in it is already here.
        counts.kept++; note(rel, 'kept-longer', { size: buf.length, heldSize: entry.size });
      } else {
        // Rewritten. Keep both: the newer becomes current, the other a version.
        const sourceNewer = st.mtimeMs >= (entry.sourceMtimeMs || entry.mtimeMs);
        if (sourceNewer) {
          const old = fs.readFileSync(this.currentPath(rel));
          const oldHash = this.storeVersion(old);
          entry.versions.push({ sha256: oldHash, size: old.length, mtimeMs: entry.sourceMtimeMs || entry.mtimeMs, keptAt: now });
          entry.mtimeMs = this.writeCurrent(rel, buf, st.mtime);
          entry.sha256 = hash; entry.size = buf.length; entry.sourceMtimeMs = st.mtimeMs; entry.updatedAt = now;
        } else {
          this.storeVersion(buf);
          entry.versions.push({ sha256: hash, size: buf.length, mtimeMs: st.mtimeMs, keptAt: now });
        }
        counts.versioned++; note(rel, 'versioned', { newer: sourceNewer ? 'incoming' : 'held' });
      }

      if (isLiveRoot) {
        entry.live = { size: st.size, mtimeMs: st.mtimeMs };
        if (entry.goneFromLiveAt) { entry.goneFromLiveAt = null; counts.back++; note(rel, 'back'); }
      }
      checkpoint();
    }

    // Files Claude Code no longer has. They stay; we only note when they went.
    if (isLiveRoot) {
      for (const [rel, entry] of Object.entries(idx.files)) {
        if (seen.has(rel) || !entry.live || entry.goneFromLiveAt) continue;
        entry.goneFromLiveAt = now;
        counts.gone++; note(rel, 'gone');
      }
    }

    idx.lastSaveAt = now;
    if (mode === 'import') {
      idx.imports = (idx.imports || []).concat([{ at: now, source: root }]);
    }
    this.writeIndex(idx);

    const result = { at: now, mode, source: root, label: label || null, counts, changes };
    const changed = counts.added + counts.grew + counts.versioned + counts.gone + counts.back + counts.failed + counts.kept;
    if (changed || mode === 'import') this.appendLog(result);
    return result;
  }

  // ---------------------------------------------------------- reading ---

  status(liveRoot) {
    const idx = this.readIndex();
    const files = Object.entries(idx.files);
    let chats = 0, memory = 0, sizeBytes = 0, withVersions = 0, versions = 0, archiveOnly = 0, gone = 0;
    for (const [rel, e] of files) {
      const k = kindOf(rel);
      if (k === 'chat') chats++;
      if (k === 'memory') memory++;
      sizeBytes += e.size || 0;
      if (e.versions.length) { withVersions++; versions += e.versions.length; }
      if (e.goneFromLiveAt) gone++;
      if (k === 'chat' && liveRoot && !P.fileExists(path.join(liveRoot, ...rel.split('/')))) archiveOnly++;
    }
    return {
      dir: this.dir,
      exists: this.exists(),
      createdAt: idx.createdAt,
      lastSaveAt: idx.lastSaveAt,
      liveRoot: idx.liveRoot,
      imports: idx.imports || [],
      files: files.length, chats, memory, sizeBytes,
      filesWithVersions: withVersions, versions, archiveOnly, gone,
      saving: P.fileExists(this.lockFile),
    };
  }

  /** Chats held here that are not in `liveRoot` -- deleted from Claude Code, or never there. */
  archiveOnlyChats(liveRoot) {
    const idx = this.readIndex();
    const out = [];
    for (const [rel, e] of Object.entries(idx.files)) {
      if (kindOf(rel) !== 'chat') continue;
      if (P.fileExists(path.join(liveRoot, ...rel.split('/')))) continue;
      const [folderName, file] = rel.split('/');
      out.push({
        folderName, sessionId: file.replace(/\.jsonl$/, ''), rel,
        file: this.currentPath(rel), size: e.size,
        goneFromLiveAt: e.goneFromLiveAt || null, firstSeenAt: e.firstSeenAt,
      });
    }
    return out;
  }

  /** The held copy plus every earlier version of one file. */
  versionsOf(rel) {
    if (!isSafeRel(rel)) { const e = new Error('Bad path'); e.status = 400; throw e; }
    const entry = this.readIndex().files[rel];
    if (!entry) return null;
    return {
      rel, kind: kindOf(rel),
      current: { sha256: entry.sha256, size: entry.size, mtimeMs: entry.sourceMtimeMs || entry.mtimeMs, updatedAt: entry.updatedAt },
      versions: entry.versions.slice().sort((a, b) => a.mtimeMs - b.mtimeMs),
      firstSeenAt: entry.firstSeenAt,
      goneFromLiveAt: entry.goneFromLiveAt || null,
    };
  }

  /** The text of one version of a file; `hash` omitted means the current copy. */
  readText(rel, hash) {
    if (!isSafeRel(rel)) { const e = new Error('Bad path'); e.status = 400; throw e; }
    const entry = this.readIndex().files[rel];
    if (!entry) { const e = new Error('Not in the archive'); e.status = 404; throw e; }
    if (!hash || hash === entry.sha256) return fs.readFileSync(this.currentPath(rel), 'utf8');
    if (!entry.versions.some((v) => v.sha256 === hash)) {
      const e = new Error('No such version of that file'); e.status = 404; throw e;
    }
    return this.readVersion(hash).toString('utf8');
  }

  /** Every memory file the archive holds, grouped by project folder. */
  memoryFiles() {
    const idx = this.readIndex();
    const out = [];
    for (const [rel, e] of Object.entries(idx.files)) {
      if (kindOf(rel) !== 'memory') continue;
      out.push({ rel, folderName: rel.split('/')[0], name: rel.split('/').slice(2).join('/'), size: e.size, versions: e.versions.length, goneFromLiveAt: e.goneFromLiveAt || null });
    }
    return out;
  }

  // ---------------------------------------------------------- restore ---

  /**
   * Copy chats back into Claude Code's folder so VS Code lists them again.
   * Restores the chat file and everything filed under it (subagent chats,
   * saved tool output). Never overwrites a file that is already there.
   *
   * @param {string} liveRoot
   * @param {Array<{folderName, sessionId}>|null} which  null means every chat missing from liveRoot
   */
  restore(liveRoot, which) {
    const root = P.normalizePath(liveRoot);
    if (!P.dirExists(root)) { const e = new Error(`No such folder: ${root}`); e.status = 400; throw e; }
    const idx = this.readIndex();
    const wanted = which
      ? new Set(which.map((w) => `${w.folderName}/${w.sessionId}`))
      : null;

    const restored = [];
    const skipped = [];
    for (const rel of Object.keys(idx.files)) {
      if (kindOf(rel) !== 'chat') continue;
      const key = rel.replace(/\.jsonl$/, '');
      if (wanted && !wanted.has(key)) continue;
      const dest = path.join(root, ...rel.split('/'));
      if (P.fileExists(dest)) { if (wanted) skipped.push({ rel, reason: 'already in Claude Code' }); continue; }

      // the chat itself, then whatever sits in its own folder
      const parts = [rel, ...Object.keys(idx.files).filter((r) => r.startsWith(key + '/'))];
      let files = 0;
      for (const r of parts) {
        const to = path.join(root, ...r.split('/'));
        if (P.fileExists(to)) continue;
        const from = this.currentPath(r);
        if (!P.fileExists(from)) continue;
        ensureDir(path.dirname(to));
        const tmp = to + '.restoring';
        fs.copyFileSync(from, tmp);
        fs.renameSync(tmp, to);
        const st = fs.statSync(from);
        fs.utimesSync(to, st.atime, st.mtime);
        files++;
      }
      const [folderName, file] = rel.split('/');
      restored.push({ folderName, sessionId: file.replace(/\.jsonl$/, ''), files });
    }

    if (restored.length) {
      this.appendLog({
        at: new Date().toISOString(), mode: 'restore', source: root,
        counts: { restored: restored.length },
        changes: restored.slice(0, MAX_LOGGED_CHANGES).map((r) => ({ rel: `${r.folderName}/${r.sessionId}.jsonl`, action: 'restored' })),
      });
    }
    return { restored, skipped };
  }
}

module.exports = { Vault, walk, kindOf, isSafeRel, sha256 };
