#!/usr/bin/env node
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const P = require('./paths');
const { Store } = require('./store');
const R = require('./render');
const { transcriptCss } = require('./theme');
const RL = require('./relocate');
const { search } = require('./search');
const AR = require('./archive');
const { exportHtml } = require('./exporters/html');
const { exportMarkdown } = require('./exporters/markdown');

const PORT = Number(process.env.PORT || 4317);
const HOST = '127.0.0.1';     // loopback only: this reads and writes your disk

const store = new Store(Store.initialRoot());
const app = express();

app.use(express.json({ limit: '5mb' }));
app.disable('x-powered-by');

/** Wrap an async handler so a thrown error becomes a clean JSON response. */
const route = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (res.headersSent) return;
    res.status(err.status || 500).json({
      error: err.message || 'Internal error',
      plan: err.plan,
    });
  });
};

// ---------------------------------------------------------------- basics ---

app.get('/api/health', (req, res) => res.json({ ok: true, version: require('../package.json').version }));

app.get('/api/root', route((req, res) => {
  res.json({
    root: store.root,
    exists: P.dirExists(store.root),
    default: P.defaultClaudeProjectsDir(),
    appData: P.appDataDir(),
    platform: process.platform,
    home: os.homedir(),
  });
}));

app.post('/api/root', route((req, res) => {
  const dir = String(req.body && req.body.dir || '').trim();
  if (!dir) { const e = new Error('No directory given'); e.status = 400; throw e; }
  res.json({ root: store.setRoot(dir) });
}));

app.get('/api/projects', route((req, res) => {
  const scan = store.scan(req.query.force === '1');
  res.json({
    root: scan.root,
    exists: scan.exists,
    scannedAt: scan.scannedAt,
    counts: {
      total: scan.projects.length,
      healthy: scan.projects.filter((p) => p.healthy).length,
      orphaned: scan.projects.filter((p) => p.issues.includes('orphaned')).length,
      mismatched: scan.projects.filter((p) => p.issues.includes('mismatch')).length,
      ambiguous: scan.projects.filter((p) => p.issues.includes('ambiguous')).length,
    },
    projects: scan.projects.map((p) => ({
      folderName: p.folderName,
      dirPath: p.dirPath,
      projectPath: p.projectPath,
      expectedFolderName: p.expectedFolderName,
      projectExists: p.projectExists,
      folderNameMatchesCwd: p.folderNameMatchesCwd,
      issues: p.issues,
      healthy: p.healthy,
      sessionCount: p.sessionCount,
      totalSize: p.totalSize,
      lastActivity: p.lastActivity,
      sessions: p.sessions.map((s) => ({
        sessionId: s.sessionId, title: s.title, startedAt: s.startedAt,
        endedAt: s.endedAt, messageCount: s.messageCount,
        sizeBytes: s.sizeBytes, unreadable: s.unreadable || null,
      })),
    })),
  });
}));

// -------------------------------------------------------------- sessions ---

app.get('/api/session/:folder/:id', route((req, res) => {
  const { folder, id } = req.params;
  const { session, imageStore } = store.loadSession(folder, id);
  const imageSrc = (ref) => `/api/img/${encodeURIComponent(folder)}/${encodeURIComponent(id)}/${encodeURIComponent(ref)}`;

  const turns = session.turns.map((t) => ({
    i: t.index,
    kind: t.kind,
    category: t.category || null,
    timestamp: t.timestamp || null,
    html: R.renderTurn(t, { imageSrc }),
  }));

  res.json({ session: Store.toClientSession(session), turns });
}));

app.get('/api/session/:folder/:id/meta', route((req, res) => {
  const { session } = store.loadSession(req.params.folder, req.params.id);
  res.json({ session: Store.toClientSession(session) });
}));

app.get('/api/img/:folder/:id/:ref', route((req, res) => {
  const { mediaType, buffer } = store.getImage(req.params.folder, req.params.id, req.params.ref);
  res.setHeader('Content-Type', mediaType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
}));

// --------------------------------------------------------------- exports ---

function safeFileName(s) {
  return String(s || 'chat').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'chat';
}

app.get('/api/export/:folder/:id.:fmt', route((req, res) => {
  const { folder, id, fmt } = req.params;
  const { session, imageStore } = store.loadSession(folder, id);
  const base = safeFileName(session.title) + ' - ' + id.slice(0, 8);
  const opts = {
    includeSystem: req.query.system !== '0',
    includeTools: req.query.tools !== '0',
    expandTools: req.query.expand === '1',
  };

  if (fmt === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.html"`);
    return res.send(exportHtml(session, imageStore, opts));
  }
  if (fmt === 'md') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.md"`);
    return res.send(exportMarkdown(session, imageStore, opts));
  }
  if (fmt === 'jsonl') {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.jsonl"`);
    return res.send(fs.readFileSync(store.sessionPath(folder, id)));
  }
  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    return res.send(JSON.stringify({ ...Store.toClientSession(session), turns: session.turns }, null, 2));
  }
  const e = new Error(`Unknown format "${fmt}". Use html, md, jsonl or json.`);
  e.status = 400;
  throw e;
}));

/** Same HTML as the export, rendered inline so the browser can print it. */
app.get('/api/print/:folder/:id', route((req, res) => {
  const { session, imageStore } = store.loadSession(req.params.folder, req.params.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(exportHtml(session, imageStore, { includeSystem: req.query.system !== '0', expandTools: true }));
}));

// ------------------------------------------------------------ relocation ---

app.post('/api/relocate/plan', route((req, res) => {
  const { folder, newPath } = req.body || {};
  res.json(RL.planRelocate(store, String(folder || ''), String(newPath || '')));
}));

app.post('/api/relocate/apply', route((req, res) => {
  const { folder, newPath, backup } = req.body || {};
  const out = RL.applyRelocate(store, String(folder || ''), String(newPath || ''), { backup: backup !== false });
  res.json(out);
}));

app.post('/api/relocate/bulk/plan', route((req, res) => {
  const { oldPrefix, newPrefix } = req.body || {};
  res.json(RL.planBulk(store, String(oldPrefix || ''), String(newPrefix || '')));
}));

app.post('/api/relocate/bulk/apply', route((req, res) => {
  const { oldPrefix, newPrefix, backup } = req.body || {};
  res.json(RL.applyBulk(store, String(oldPrefix || ''), String(newPrefix || ''), { backup: backup !== false }));
}));

app.get('/api/history', route((req, res) => res.json({ history: RL.history(), backupsDir: RL.backupsDir() })));
app.post('/api/history/:id/undo', route((req, res) => res.json({ entry: RL.undo(store, req.params.id) })));
app.post('/api/history/:id/forget', route((req, res) => res.json({ entry: RL.forgetBackup(req.params.id) })));

// ---------------------------------------------------------------- search ---

app.get('/api/search', route((req, res) => {
  res.json(search(store, {
    query: req.query.q,
    regex: req.query.regex === '1',
    caseSensitive: req.query.case === '1',
    wholeWord: req.query.word === '1',
    folder: req.query.folder || null,
    sessionId: req.query.session || null,
    kinds: req.query.kinds ? String(req.query.kinds).split(',').filter(Boolean) : null,
    limit: Number(req.query.limit) || 300,
  }));
}));

// -------------------------------------------------------------- archives ---

app.get('/api/archive/export', route((req, res) => {
  const folders = req.query.folders ? String(req.query.folders).split(',').filter(Boolean) : [];
  const { buffer, filename } = AR.exportArchive(store, folders);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

app.post('/api/archive/inspect',
  express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '2gb' }),
  route((req, res) => {
    if (!req.body || !req.body.length) {
      const e = new Error('No file received'); e.status = 400; throw e;
    }
    res.json(AR.inspectArchive(store, req.body));
  }));

app.post('/api/archive/apply', route((req, res) => {
  const { stagingId, mappings } = req.body || {};
  res.json(AR.applyImport(store, String(stagingId || ''), mappings || []));
}));

// ------------------------------------------------------- path browsing -----

app.get('/api/fs/browse', route((req, res) => {
  const raw = String(req.query.path || '').trim();

  // No path on Windows means "show me the drives".
  if (!raw && P.IS_WIN) {
    const drives = [];
    for (let c = 65; c <= 90; c++) {
      const d = String.fromCharCode(c) + ':\\';
      if (P.dirExists(d)) drives.push({ name: d, path: d, isDir: true });
    }
    return res.json({ path: '', parent: null, entries: drives, isRoot: true });
  }

  const dir = P.normalizePath(raw || os.homedir());
  if (!P.dirExists(dir)) {
    const e = new Error(`Not a directory: ${dir}`); e.status = 404; throw e;
  }

  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('$')) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).isDirectory()) entries.push({ name, path: full, isDir: true });
    } catch { /* permission denied: skip quietly */ }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parent = path.dirname(dir);
  res.json({
    path: dir,
    parent: parent && parent !== dir ? parent : (P.IS_WIN ? '' : null),
    entries,
    isRoot: false,
  });
}));

app.get('/api/fs/exists', route((req, res) => {
  const p = P.normalizePath(String(req.query.path || ''));
  const encoded = p ? P.encodeProjectFolder(p) : null;
  const nfc = p.normalize('NFC');
  res.json({
    path: p,
    exists: P.dirExists(p),
    absolute: P.looksAbsolute(p),
    encoded,
    // Non-ASCII paths: how long the resulting name is, whether it is spelled
    // in a way that encodes differently from its normalised form, and how much
    // of the name is dashes (a hint that it is mostly non-ASCII).
    encodedLength: encoded ? encoded.length : 0,
    storePathLength: encoded ? store.root.length + 1 + encoded.length : 0,
    normalizationDiffers: nfc !== p && P.encodeProjectFolder(nfc) !== encoded,
    nonAscii: /[^\x00-\x7F]/.test(p),
  });
}));

/** Reveal a folder in the OS file manager. */
app.post('/api/fs/reveal', route((req, res) => {
  const p = P.normalizePath(String(req.body && req.body.path || ''));
  if (!P.dirExists(p)) { const e = new Error('No such directory'); e.status = 404; throw e; }
  const cmd = process.platform === 'win32' ? 'explorer'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [p], () => { /* explorer exits non-zero even on success */ });
  res.json({ ok: true });
}));

// ----------------------------------------------------------------- static --

app.get('/transcript.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.send(transcriptCss());
});

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No such endpoint' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Anything that reaches here -- a malformed JSON body, an unexpected throw --
// must still answer in JSON. Express's default handler renders an HTML page,
// which a fetch() caller cannot make sense of.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const msg = err.type === 'entity.parse.failed'
    ? 'The request body was not valid JSON.'
    : err.message || 'Internal error';
  res.status(status).json({ error: msg });
});

// ------------------------------------------------------------------ boot ---

AR.cleanStaging();

const server = app.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  Claude Chat Relocator');
  console.log('  ' + url);
  console.log('');
  console.log('  store   : ' + store.root + (P.dirExists(store.root) ? '' : '   (not found -- pick another in the app)'));
  console.log('  backups : ' + RL.backupsDir());
  console.log('');
  console.log('  Ctrl+C to stop.');
  console.log('');

  if (process.env.NO_OPEN !== '1') {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    execFile(cmd, args, () => { /* opening a browser is a nicety, not a requirement */ });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Start with a different one:\n    PORT=4400 npm start\n`);
    process.exit(1);
  }
  throw err;
});
