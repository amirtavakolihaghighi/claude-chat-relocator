'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const R = require('./render');
const { Store } = require('./store');
const { Vault, kindOf, isSafeRel } = require('./vault');
const { peekSessionFile } = require('./parser');
const H = require('./hooks');

/**
 * HTTP routes for the archive, memory files and the help pages, plus the
 * merge that lets chats which exist only in the archive appear in the
 * project list beside the ones Claude Code still has.
 */

/** The configured archive, or null when none has been set up yet. */
function currentVault() {
  const dir = Store.readSettings().vaultDir;
  if (!dir) return null;
  try { return new Vault(dir); } catch { return null; }
}

/** Keep the store reading archived chats from wherever the archive now is. */
function syncStore(store) {
  const v = currentVault();
  store.archiveRoot = v && P.dirExists(v.projectsDir) ? v.projectsDir : null;
  return v;
}

const peekCache = new Map();   // file -> { key, peek }
function peekCached(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.size}|${st.mtimeMs}`;
  const hit = peekCache.get(file);
  if (hit && hit.key === key) return hit.peek;
  let peek;
  try { peek = peekSessionFile(file); } catch { return null; }
  peekCache.set(file, { key, peek });
  return peek;
}

/**
 * Add chats that are only in the archive to a /api/projects payload: into
 * their project when Claude Code still has the folder, or as a project of
 * their own, marked "archive only", when it does not.
 */
function mergeArchived(store, payload) {
  const v = syncStore(store);
  payload.archive = { configured: !!v, onlyCount: 0 };
  if (!v || !v.exists()) return payload;

  const byFolder = new Map(payload.projects.map((p) => [p.folderName, p]));
  for (const c of v.archiveOnlyChats(store.root)) {
    const peek = peekCached(c.file);
    if (!peek) continue;
    const sess = {
      sessionId: c.sessionId, title: peek.title, startedAt: peek.startedAt, endedAt: peek.endedAt,
      messageCount: peek.messageCount, sizeBytes: peek.sizeBytes, unreadable: null,
      archived: true, goneFromLiveAt: c.goneFromLiveAt,
    };
    let p = byFolder.get(c.folderName);
    if (!p) {
      const match = (peek.cwds || []).find((x) => P.encodeProjectFolder(x.path) === c.folderName)
        || (peek.cwds || [])[0];
      const projectPath = match ? P.normalizePath(match.path) : null;
      p = {
        folderName: c.folderName, dirPath: path.join(v.projectsDir, c.folderName), projectPath,
        expectedFolderName: projectPath ? P.encodeProjectFolder(projectPath) : null,
        projectExists: projectPath ? P.dirExists(projectPath) : false,
        folderNameMatchesCwd: true, issues: ['archive-only'], healthy: true,
        archiveOnly: true, sessionCount: 0, totalSize: 0, lastActivity: null, sessions: [],
      };
      byFolder.set(c.folderName, p);
      payload.projects.push(p);
    }
    p.sessions.push(sess);
    p.archivedCount = (p.archivedCount || 0) + 1;
    if (p.archiveOnly) {
      p.sessionCount++;
      p.totalSize += sess.sizeBytes || 0;
    }
    const act = sess.endedAt || null;
    if (act && (!p.lastActivity || act > p.lastActivity)) p.lastActivity = act;
    payload.archive.onlyCount++;
  }
  for (const p of payload.projects) {
    p.sessions.sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));
  }
  payload.projects.sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')));
  return payload;
}

function needVault() {
  const v = currentVault();
  if (!v) {
    const e = new Error('No archive is set up yet. Choose a folder for it on the Archive page.');
    e.status = 409;
    e.help = 'E-ARCHIVE-NONE';
    throw e;
  }
  return v;
}

function lastErrors(n = 5) {
  try {
    const lines = fs.readFileSync(path.join(P.appDataDir(), 'archive-errors.log'), 'utf8').trim().split('\n');
    return lines.slice(-n).reverse();
  } catch { return []; }
}

// ----------------------------------------------------------------- memory --

/** Memory files from Claude Code's folder and from the archive, merged. */
function memoryList(store, v) {
  const projects = new Map();
  const scan = store.scan();
  const pathOf = new Map(scan.projects.map((p) => [p.folderName, p.projectPath]));
  const get = (folderName) => {
    if (!projects.has(folderName)) projects.set(folderName, { folderName, projectPath: pathOf.get(folderName) || null, files: new Map() });
    return projects.get(folderName);
  };

  if (P.dirExists(store.root)) {
    for (const folderName of fs.readdirSync(store.root)) {
      const dir = path.join(store.root, folderName, 'memory');
      if (!P.dirExists(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (!st.isFile()) continue;
        get(folderName).files.set(name, { name, size: st.size, mtime: st.mtime.toISOString(), inClaude: true, versions: 0 });
      }
    }
  }
  if (v && v.exists()) {
    for (const m of v.memoryFiles()) {
      const p = get(m.folderName);
      const f = p.files.get(m.name) || { name: m.name, size: m.size, mtime: null, inClaude: false, versions: 0 };
      f.versions = m.versions;
      f.archived = true;
      p.files.set(m.name, f);
    }
  }
  return [...projects.values()]
    .map((p) => ({ ...p, files: [...p.files.values()].sort((a, b) => (a.name === 'MEMORY.md' ? -1 : b.name === 'MEMORY.md' ? 1 : a.name.localeCompare(b.name))) }))
    .filter((p) => p.files.length)
    .sort((a, b) => (a.projectPath || a.folderName).localeCompare(b.projectPath || b.folderName));
}

function memoryRel(folder, name) {
  if (!P.isSafeFolderName(folder) || !P.isSafeFolderName(name)) {
    const e = new Error('Invalid memory file'); e.status = 400; throw e;
  }
  return `${folder}/memory/${name}`;
}

// ------------------------------------------------------------------- help --

/** GitHub's heading anchors: lower case, punctuation dropped, each space a dash. */
function githubSlug(text) {
  return String(text).toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function decodeEntities(s) {
  return String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

let helpCache = null;
function helpPage() {
  const file = path.join(__dirname, '..', 'docs', 'HELP.md');
  const st = fs.statSync(file);
  if (helpCache && helpCache.mtimeMs === st.mtimeMs) return helpCache.page;
  const text = fs.readFileSync(file, 'utf8');
  const toc = [];
  const html = R.md(text).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (all, level, inner) => {
    // The same ids GitHub gives these headings, so a link like
    // [W-LIVE](#w-live-a-chat-changed-...) works in both places. A message's
    // heading can also be found by its code alone, from the app's links.
    const plain = decodeEntities(inner.replace(/<[^>]+>/g, ''));
    const id = githubSlug(plain);
    const code = /^([EW]-[A-Z0-9-]+)/.exec(plain);
    if (level === '2') toc.push({ id, title: plain });
    return `<h${level} id="${id}"${code ? ` data-code="${code[1].toLowerCase()}"` : ''}>${inner}</h${level}>`;
  });
  // links to another section, [text](#anchor), are kept inside the help page by the app
  const page = { html, toc };
  helpCache = { mtimeMs: st.mtimeMs, page };
  return page;
}

// ----------------------------------------------------------------- routes --

function register(app, store, route) {
  syncStore(store);

  app.get('/api/vault', route((req, res) => {
    const v = syncStore(store);
    res.json({
      configured: !!v,
      status: v ? v.status(store.root) : null,
      log: v ? v.readLog(30) : [],
      hooks: H.status(),
      errors: lastErrors(),
      suggestedDir: path.join(P.appDataDir(), 'archive'),
    });
  }));

  app.post('/api/vault/location', route((req, res) => {
    const dir = String((req.body && req.body.dir) || '').trim();
    const v = new Vault(dir);
    if (P.isUnder(v.dir, store.root) || P.isUnder(store.root, v.dir)) {
      const e = new Error('The archive cannot be inside Claude Code\'s chat folder, or the other way round.');
      e.status = 400; e.help = 'E-ARCHIVE-INSIDE'; throw e;
    }
    fs.mkdirSync(v.dir, { recursive: true });
    Store.updateSettings({ vaultDir: v.dir });
    syncStore(store);
    res.json({ dir: v.dir });
  }));

  app.post('/api/vault/save', route((req, res) => {
    const v = needVault();
    const r = v.save(store.root, { mode: 'live', label: 'Save now', busy: 'fail' });
    syncStore(store);
    store.invalidateAll();
    res.json(r);
  }));

  app.post('/api/vault/import', route((req, res) => {
    const v = needVault();
    const dir = P.normalizePath(String((req.body && req.body.dir) || ''));
    if (!P.dirExists(dir)) { const e = new Error(`No such folder: ${dir}`); e.status = 400; throw e; }
    if (P.pathsEqual(dir, store.root)) {
      const e = new Error('That is Claude Code\'s own chat folder. Use Save now for it; Import is for old copies.');
      e.status = 400; e.help = 'E-ARCHIVE-OWN'; throw e;
    }
    const r = v.save(dir, { mode: 'import', label: path.basename(dir), busy: 'fail' });
    syncStore(store);
    res.json(r);
  }));

  app.post('/api/vault/restore', route((req, res) => {
    const v = needVault();
    const which = Array.isArray(req.body && req.body.sessions) ? req.body.sessions
      .filter((s) => s && P.isSafeFolderName(s.folderName) && P.isSafeFolderName(s.sessionId)) : null;
    const r = v.restore(store.root, which && which.length ? which : null);
    store.invalidateAll();
    res.json(r);
  }));

  app.post('/api/vault/hooks', route((req, res) => {
    needVault();
    res.json(req.body && req.body.enable === false ? H.uninstall() : H.install());
  }));

  app.get('/api/vault/text', route((req, res) => {
    const v = needVault();
    const rel = String(req.query.rel || '');
    if (!isSafeRel(rel)) { const e = new Error('Bad path'); e.status = 400; throw e; }
    const text = v.readText(rel, req.query.v ? String(req.query.v) : null);
    res.json({ rel, kind: kindOf(rel), text });
  }));

  app.get('/api/memory', route((req, res) => {
    res.json({ projects: memoryList(store, syncStore(store)) });
  }));

  app.get('/api/memory/file', route((req, res) => {
    const folder = String(req.query.folder || '');
    const name = String(req.query.name || '');
    const rel = memoryRel(folder, name);
    const v = syncStore(store);
    const live = path.join(store.root, folder, 'memory', name);
    let text = null;
    let source = 'claude';
    if (P.fileExists(live)) text = fs.readFileSync(live, 'utf8');
    else if (v && v.exists()) { text = v.readText(rel); source = 'archive'; }
    if (text == null) { const e = new Error('No such memory file'); e.status = 404; throw e; }
    const versions = v && v.exists() ? v.versionsOf(rel) : null;
    const note = R.memoryNote(text);
    res.json({ folder, name, rel, source, text, html: note.html, meta: note.meta, versions });
  }));

  app.get('/api/memory/version', route((req, res) => {
    const v = needVault();
    const rel = memoryRel(String(req.query.folder || ''), String(req.query.name || ''));
    const text = v.readText(rel, String(req.query.v || ''));
    const note = R.memoryNote(text);
    res.json({ rel, text, html: note.html, meta: note.meta });
  }));

  app.get('/api/help', route((req, res) => res.json(helpPage())));
}

module.exports = { register, mergeArchived, currentVault, syncStore, memoryList };
