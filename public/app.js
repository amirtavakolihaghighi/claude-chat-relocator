'use strict';
/* Claude Chat Relocator - front end.
   Plain DOM, no framework. The server hands over pre-rendered conversation
   HTML, so this file is about navigation, dialogs and the actions. Every
   action that changes something lasting explains itself first: what it does,
   what you will see, and what is good to know (see about() below). */

// ------------------------------------------------------------- helpers ----

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return n;
}

function icon(name, cls = 'i') {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(ns, 'use');
  u.setAttribute('href', '#i-' + name);
  s.appendChild(u);
  return s;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A file path, safe inside a box that trims from the left.
 * Path boxes use `direction: rtl` so a long path loses its start, not the
 * project's name. A path with Persian or Arabic in it would then be reordered
 * and read as nonsense; <bdi dir="ltr"> keeps it left-to-right.
 */
function pathText(p) {
  return el('bdi', { dir: 'ltr', text: p == null ? '' : String(p) });
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || 'Request failed');
    err.data = data;
    err.help = data && data.help;
    err.status = res.status;
    throw err;
  }
  return data;
}

const jpost = (url, body) => api(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

const fmtNum = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many}`;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const days = (now - d) / 86400000;
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today, ' + time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + time;
  if (days < 300) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAgo(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return plural(Math.round(s / 60), 'minute', 'minutes') + ' ago';
  if (s < 86400) return plural(Math.round(s / 3600), 'hour', 'hours') + ' ago';
  return fmtDate(iso);
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

const projName = (p) => (p.projectPath ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName);

function toast(msg, kind = '', title = '', help = null) {
  const t = el('div', { class: 'toast ' + kind },
    title ? el('b', { text: title }) : null,
    el('span', { text: msg }),
    help ? el('div', {}, helpLink(help)) : null);
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, kind === 'err' ? 9000 : help ? 7000 : 4000);
}

function errToast(e, title) { toast(e.message, 'err', title || 'Something went wrong', e.help); }

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// --------------------------------------------------------------- state ----

const state = {
  root: '',
  projects: [],
  counts: {},
  archive: { configured: false, onlyCount: 0 },
  filter: 'all',
  open: new Set(),          // expanded project folders
  current: null,            // { folder, sessionId }
  session: null,
  convoOnly: store.get('ccx-convo') === '1',
  showContext: false,
  searchQuery: '',
  editors: [],              // editors detected on PATH, best first
  memoryCount: null,
};

// ----------------------------------------------------------------- help ---

/* Section names in docs/HELP.md. Each is the heading's text, lower-cased with
   dashes; every message code (W-LIVE, E-TARGET-EXISTS...) is its own heading. */
const HELP = {
  missing: 'folder-missing', hidden: 'hidden-from-vs-code', shared: 'shared-folder',
  archiveOnly: 'archive-only', empty: 'empty-or-no-path',
  relocate: 'relocate', fixName: 'fix-the-name', bulk: 'move-many-projects', open: 'open-in-your-editor',
  zipExport: 'export-to-a-zip', zipImport: 'import-from-a-zip', undo: 'undo-history',
  chat: 'reading-a-chat', answers: 'answers-and-the-pinned-bar', convo: 'conversation-only',
  exports: 'saving-a-chat-as-a-file', search: 'search', details: 'chat-details',
  archive: 'the-archive', setup: 'setting-up-the-archive', autoSave: 'automatic-saving',
  importBackup: 'importing-an-old-backup', restore: 'putting-chats-back', archiveLog: 'what-happened',
  memory: 'memory-files', versions: 'older-versions',
  settings: 'settings', store: 'the-chat-folder', sidebar: 'the-sidebar-and-small-windows',
};

let helpPromise = null;
const loadHelp = () => (helpPromise = helpPromise || api('/api/help'));

function helpLink(anchor, text = 'What does this mean?') {
  return el('button', {
    class: 'helplink', type: 'button', title: 'Open the help at this topic',
    onclick: (e) => { e.stopPropagation(); openHelp(anchor); },
  }, icon('help'), text);
}

/** Help in a side panel, so whatever you were doing stays on screen. */
async function openHelp(anchor) {
  const drawer = $('#drawer');
  const body = $('#drawerBody');
  drawer.hidden = false;
  body.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' })));
  try {
    const help = await loadHelp();
    const doc = el('div', { class: 'helpdoc', html: help.html });
    body.replaceChildren(doc);
    wireHelpLinks(doc, body);
    scrollHelpTo(body, anchor);
    $('#drawerFull').setAttribute('href', '#help' + (anchor ? '/' + anchor : ''));
  } catch (e) {
    body.replaceChildren(el('p', { text: 'The help could not be loaded: ' + e.message }));
  }
}

function scrollHelpTo(container, anchor) {
  if (!anchor) { container.scrollTop = 0; return; }
  const a = String(anchor).toLowerCase();
  const target = container.querySelector('#' + CSS.escape(a)) || container.querySelector(`[data-code="${CSS.escape(a)}"]`);
  if (!target) return;
  target.scrollIntoView({ block: 'start' });
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
}

/** Links to other help sections stay inside the help. */
function wireHelpLinks(doc, container) {
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    scrollHelpTo(container, a.getAttribute('href').slice(1));
  });
  $$('a[href^="#"]', doc).forEach((a) => { a.removeAttribute('target'); a.removeAttribute('rel'); });
}

$('#drawerClose').addEventListener('click', () => { $('#drawer').hidden = true; });
$('#drawerFull').addEventListener('click', () => { $('#drawer').hidden = true; });

/**
 * The "About this action" box every dialog opens with: what it does, what you
 * will see, and what is good to know. Folded away once you have closed it for
 * that dialog, so it informs without nagging.
 */
function about(key, { does, see, know, anchor }) {
  const folded = store.get('ccx-about-' + key) === 'folded';
  const box = el('details', { class: 'about', open: !folded },
    el('summary', {}, icon('help', 'i sm'), 'About this action', icon('chev', 'i sm chev')),
    el('div', { class: 'cols' },
      el('div', { class: 'col' }, el('h5', { text: 'What it does' }), does),
      el('div', { class: 'col' }, el('h5', { text: "What you'll see" }), see),
      el('div', { class: 'col' }, el('h5', { text: 'Good to know' }), know)),
    anchor ? el('div', { class: 'more' }, helpLink(anchor, 'More in the help')) : null);
  box.addEventListener('toggle', () => store.set('ccx-about-' + key, box.open ? null : 'folded'));
  return box;
}

/** A list of messages from the server, each with its code and a help link. */
function messages(kind, texts, codes, title) {
  if (!texts || !texts.length) return document.createDocumentFragment();   // nothing to say: append nothing
  const icn = kind === 'err' ? 'alert' : kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'help';
  return el('div', { class: 'notice-box ' + kind },
    el('div', { class: 'nt' }, icon(icn),
      el('div', {},
        title ? el('b', { text: title }) : null,
        el('ul', {}, ...texts.map((t, i) => el('li', {},
          t, codes && codes[i] ? el('span', { class: 'code-id', text: codes[i] }) : null,
          codes && codes[i] ? helpLink(codes[i].toLowerCase()) : null))))));
}

function noticeBox(kind, title, text, help) {
  return el('div', { class: 'notice-box ' + kind },
    el('div', { class: 'nt' }, icon(kind === 'ok' ? 'check' : kind === 'info' ? 'help' : 'alert'),
      el('div', {}, title ? el('b', { text: title }) : null, text ? el('div', {}, text) : null,
        help ? helpLink(help) : null)));
}

// --------------------------------------------------------------- modals ---

const modalStack = [];

function openModal(node) {
  const rootEl = $('#modalRoot');
  if (modalStack.length) modalStack[modalStack.length - 1].style.display = 'none';
  modalStack.push(node);
  rootEl.appendChild(node);
  rootEl.hidden = false;
  const focusable = node.querySelector('input[type="text"], button.primary, button:not(.x)');
  if (focusable) setTimeout(() => focusable.focus(), 30);
}

function closeModal(node) {
  const target = node || modalStack[modalStack.length - 1];
  if (!target) return;
  const i = modalStack.indexOf(target);
  if (i >= 0) modalStack.splice(i, 1);
  target.remove();
  if (target.onclosed) target.onclosed();
  if (modalStack.length) modalStack[modalStack.length - 1].style.display = '';
  else $('#modalRoot').hidden = true;
}

function modal({ title, sub, body, foot, wide }) {
  const node = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title });
  const close = () => closeModal(node);
  node.appendChild(el('header', {},
    el('div', {}, el('h2', { text: title }), sub ? el('p', {}, sub) : null),
    el('button', { class: 'btn ghost iconbtn x', title: 'Close', onclick: close, type: 'button' }, icon('x'))));
  const bodyEl = el('div', { class: 'mbody' });
  if (body) bodyEl.appendChild(body);
  node.appendChild(bodyEl);
  const footEl = el('div', { class: 'mfoot' });
  (foot || []).forEach((f) => f && footEl.appendChild(f));
  node.appendChild(footEl);
  node.close = close;
  node.bodyEl = bodyEl;
  node.footEl = footEl;
  return node;
}

/** Ask before anything lasting. Resolves true when confirmed. */
function confirmAction({ key, title, sub, does, see, know, anchor, ok = 'Continue', danger = false, extra = null }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; resolve(v); };
    const node = modal({
      title, sub,
      body: el('div', {}, about(key, { does, see, know, anchor }), extra),
      foot: [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { done(false); closeModal(node); } }),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: ok, onclick: () => { done(true); closeModal(node); } }),
      ],
    });
    node.onclosed = () => done(false);
    openModal(node);
  });
}

$('#modalRoot').addEventListener('mousedown', (e) => { if (e.target.id === 'modalRoot') closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modalStack.length) { e.preventDefault(); closeModal(); return; }
    if (!$('#drawer').hidden) { $('#drawer').hidden = true; return; }
    if (rootEl.getAttribute('data-nav') === 'open') { setPanel(false); return; }
    $('#ioMenu').hidden = true;
  }
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !modalStack.length) {
    e.preventDefault(); $('#search').focus();
  }
});

// ------------------------------------------------------- menus (simple) ---

function popMenu(anchorEl, items) {
  document.querySelectorAll('.menu.pop').forEach((m) => m.remove());
  const menu = el('div', { class: 'menu pop' }, ...items.map((it) => it && el('button', {
    type: 'button', disabled: it.disabled,
    onclick: () => { menu.remove(); it.run(); },
  }, icon(it.icon || 'chev'), el('span', {}, el('b', { text: it.label }), it.sub ? el('small', { text: it.sub }) : null))));
  const r = anchorEl.getBoundingClientRect();
  Object.assign(menu.style, { position: 'fixed', top: (r.bottom + 6) + 'px', left: Math.max(10, Math.min(r.left, innerWidth - 350)) + 'px', right: 'auto' });
  document.body.appendChild(menu);
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
  return menu;
}

$('#ioBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#ioMenu').hidden = !$('#ioMenu').hidden;
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menuwrap')) $('#ioMenu').hidden = true;
});
$('#ioMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  $('#ioMenu').hidden = true;
  if (b.dataset.act === 'export-zip') archiveDialog();
  if (b.dataset.act === 'import-zip') importDialog();
});

// ------------------------------------------------------ open in editor ----

async function openInEditor(projectPath, editorId) {
  if (!projectPath) return toast('No project path is recorded for these chats.', 'warn');
  if (!state.editors.length) {
    return toast('No supported editor was found. In VS Code, run "Shell Command: Install \u2018code\u2019 command in PATH" from the command palette, then click Rescan.',
      'err', 'Nothing to open with', 'e-no-editor');
  }
  if (!editorId && state.editors.length > 1) return pickEditorDialog(projectPath);
  try {
    const r = await jpost('/api/fs/open', { path: projectPath, editor: editorId || state.editors[0].id, newWindow: true });
    toast(r.path, 'ok', `Opening in ${r.editor}`);
  } catch (e) { errToast(e, 'Could not open'); }
}

function pickEditorDialog(projectPath) {
  const node = modal({
    title: 'Open in…', sub: projectPath,
    body: el('div', { class: 'maplist' }, ...state.editors.map((ed) => el('button', {
      class: 'maprow', type: 'button', onclick: () => { closeModal(node); openInEditor(projectPath, ed.id); },
    }, el('div', { class: 'mname', text: ed.name }), el('div', { class: 'morig', text: ed.command })))),
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) })],
  });
  openModal(node);
}

/** An "Open" button that is disabled, with the reason, when it cannot work. */
function openButton(p, cls = 'btn sm') {
  const label = state.editors.length === 1 ? `Open in ${state.editors[0].name}` : 'Open project';
  const missing = p.projectPath && !p.projectExists;
  return el('button', {
    class: cls, type: 'button',
    disabled: missing || !p.projectPath || !state.editors.length,
    title: missing ? 'That folder is not on this computer. Relocate these chats first.'
      : !state.editors.length ? 'No supported editor found on this computer'
        : `Open ${p.projectPath} in a new window`,
    onclick: () => openInEditor(p.projectPath),
  }, icon('open', 'i sm'), label);
}

// ---------------------------------------------------------- path picker ---

function pickPath(startPath, title = 'Choose a folder', sub = 'Pick the folder itself, the one you would open in VS Code.') {
  return new Promise((resolve) => {
    let lastParent = null;
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    const list = el('div', { class: 'pickerlist' });
    const cur = el('div', { class: 'cur' }, pathText(startPath || 'This computer'));
    const manual = el('input', { type: 'text', value: startPath || '', placeholder: 'Or type a path', spellcheck: 'false' });
    const up = el('button', { class: 'btn sm', type: 'button', onclick: () => load(lastParent) }, icon('up', 'i sm'), 'Up');

    let loads = 0;
    async function load(p) {
      const mine = ++loads;       // if you click on before a folder has loaded, only the last click counts
      list.replaceChildren(el('div', { class: 'sidenote' }, el('span', { class: 'spin' })));
      try {
        const data = await api('/api/fs/browse?path=' + encodeURIComponent(p == null ? '' : p));
        if (mine !== loads) return;
        lastParent = data.parent;
        up.disabled = data.parent == null;
        cur.replaceChildren(pathText(data.path || 'This computer'));
        manual.value = data.path || '';
        list.replaceChildren();
        if (!data.entries.length) list.appendChild(el('div', { class: 'sidenote', text: 'No folders inside this one.' }));
        for (const entry of data.entries) {
          list.appendChild(el('button', { type: 'button', onclick: () => load(entry.path) }, icon('folder', 'i sm'), el('span', { text: entry.name })));
        }
      } catch (e) {
        if (mine === loads) list.replaceChildren(el('div', { class: 'sidenote', text: e.message }));
      }
    }
    // Answer first, then close: closing reports "cancelled", and the first answer wins.
    const use = () => { const v = manual.value.trim(); done(v || null); closeModal(node); };
    const node = modal({
      title, sub,
      body: el('div', {},
        el('div', { class: 'picker' }, el('div', { class: 'pickerbar' }, up, cur), list),
        el('div', { class: 'field', style: 'margin-top:14px' }, el('label', { text: 'Path' }), el('div', { class: 'inrow' }, manual))),
      foot: [el('div', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { done(null); closeModal(node); } }),
        el('button', { class: 'btn primary', type: 'button', text: 'Use this folder', onclick: use })],
    });
    node.onclosed = () => done(null);
    manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); use(); } });
    openModal(node);
    load(startPath || null);
  });
}

function browseRow(input, opts = {}) {
  return el('div', { class: 'inrow' }, input,
    el('button', {
      class: 'btn', type: 'button',
      onclick: async () => { const p = await pickPath(input.value || opts.start, opts.title, opts.sub); if (p) { input.value = p; input.dispatchEvent(new Event('input')); if (opts.after) opts.after(p); } },
    }, icon('folder', 'i sm'), 'Browse…'));
}

// --------------------------------------------------------------- sidebar --

function issuePills(p) {
  const out = [];
  const pill = (cls, ic, text, title, anchor) => el('button', {
    class: 'pill ' + cls, type: 'button', title: title + ' Click for help.',
    onclick: (e) => { e.stopPropagation(); openHelp(anchor); },
  }, icon(ic), text);
  if (p.issues.includes('orphaned')) out.push(pill('bad', 'alert', 'Folder missing', 'The project folder these chats belong to is not on this computer.', HELP.missing));
  if (p.issues.includes('mismatch')) out.push(pill('warn', 'eyeoff', 'Hidden', 'The chat folder has the wrong name, so VS Code never looks inside it.', HELP.hidden));
  if (p.issues.includes('ambiguous')) out.push(pill('warn', 'layers', 'Shared', 'Chats from two projects ended up in one folder.', HELP.shared));
  if (p.issues.includes('archive-only')) out.push(pill('arch', 'box', 'Archive only', 'Claude Code no longer has these chats. Your archive does.', HELP.archiveOnly));
  if (p.issues.includes('empty')) out.push(pill('neutral', 'help', 'Empty', 'This chat folder has no chats in it.', HELP.empty));
  if (p.issues.includes('unknown-path')) out.push(pill('neutral', 'help', 'No path', 'These chats never recorded which folder they were in.', HELP.empty));
  return out;
}

function visibleProjects() {
  if (state.filter === 'problems') return state.projects.filter((p) => !p.healthy);
  if (state.filter === 'archived') return state.projects.filter((p) => p.archivedCount);
  return state.projects;
}

function renderSidebar() {
  const wrap = $('#projects');
  wrap.replaceChildren();
  const list = visibleProjects();
  if (!list.length) {
    wrap.appendChild(el('div', { class: 'sidenote' },
      state.filter === 'problems' ? 'Every chat folder points at a project that exists. Nothing to fix.'
        : state.filter === 'archived' ? 'Nothing is only in the archive: Claude Code still has every chat you saved.'
          : 'No chat folders found here.'));
    return;
  }

  for (const p of list) {
    const isOpen = state.open.has(p.folderName) || (state.current && state.current.folder === p.folderName);
    const node = el('div', { class: 'proj' + (isOpen ? ' open' : '') });
    node.appendChild(el('button', {
      class: 'head', type: 'button', title: p.projectPath || p.folderName,
      onclick: () => {
        if (node.classList.contains('open')) { state.open.delete(p.folderName); node.classList.remove('open'); }
        else { state.open.add(p.folderName); node.classList.add('open'); }
      },
    }, icon('chev', 'i sm chev'), el('span', { class: 'name', text: projName(p) }), ...issuePills(p), el('span', { class: 'n', text: p.sessions.length })));

    const chats = el('div', { class: 'chats' });
    const sessions = state.filter === 'archived' ? p.sessions.filter((s) => s.archived) : p.sessions;
    for (const s of sessions) {
      const on = state.current && state.current.folder === p.folderName && state.current.sessionId === s.sessionId;
      chats.appendChild(el('a', {
        class: 'chat' + (on ? ' on' : ''), href: chatHash(p.folderName, s.sessionId), title: s.title || s.sessionId,
      },
        el('div', { class: 't', text: s.title || s.sessionId }),
        el('div', { class: 'm' },
          s.archived ? el('span', { class: 'pill arch', title: 'Claude Code deleted this chat; your archive kept it.' }, icon('box'), 'Archived') : null,
          `${fmtDate(s.endedAt)} · ${plural(s.messageCount, 'record', 'records')}`)));
    }
    if (!sessions.length) chats.appendChild(el('div', { class: 'sidenote', text: 'No chats' }));

    const acts = el('div', { class: 'projacts' });
    if (p.archiveOnly) {
      acts.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => restoreDialog(p.sessions.map((s) => ({ folderName: p.folderName, sessionId: s.sessionId, title: s.title }))) }, icon('restore', 'i sm'), 'Put back'));
    } else {
      acts.appendChild(openButton(p));
      acts.appendChild(el('button', { class: 'btn sm', type: 'button', title: 'Point these chats at the folder where the project lives now', onclick: () => relocateDialog(p.folderName) }, 'Relocate…'));
    }
    chats.appendChild(acts);
    node.appendChild(chats);
    wrap.appendChild(node);
  }
}

function renderFilters() {
  const bad = state.projects.filter((p) => !p.healthy).length;
  const archived = state.archive.onlyCount || 0;
  if ((!bad && state.filter === 'problems') || (!archived && state.filter === 'archived')) state.filter = 'all';
  for (const c of $$('#filters button')) {
    c.classList.toggle('on', c.dataset.filter === state.filter);
    if (c.dataset.filter === 'problems') { c.hidden = !bad; c.textContent = `Needs fixing (${bad})`; }
    if (c.dataset.filter === 'archived') { c.hidden = !archived; c.textContent = `Archived (${archived})`; }
  }
  const nav = $('#navArchive');
  nav.textContent = state.archive.configured ? '' : 'not set up';
}

function setNav(view) {
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === view));
}

// ----------------------------------------------------------------- home ---

function homeView() {
  setNav('home');
  state.current = null;
  renderSidebar();
  const c = state.counts;
  const bad = state.projects.filter((p) => !p.healthy && !p.archiveOnly);
  const chats = state.projects.reduce((a, p) => a + (p.archiveOnly ? 0 : p.sessionCount), 0);

  const page = el('div', { class: 'page' });
  page.appendChild(el('h1', { text: 'Your Claude Code chats' }));
  page.appendChild(el('p', { class: 'lede' },
    `${plural(c.total || 0, 'project', 'projects')} and ${plural(chats, 'chat', 'chats')} in Claude Code. `,
    bad.length ? `${plural(bad.length, 'project needs', 'projects need')} fixing before VS Code can show ${bad.length === 1 ? 'its' : 'their'} chats again. Everything else is fine.`
      : 'VS Code can find every one of them.'));

  page.appendChild(el('div', { class: 'tiles' },
    el('div', { class: 'tile' }, el('div', { class: 'lbl' }, icon('folder', 'i sm'), 'Projects'), el('div', { class: 'num', text: fmtNum(c.total) }), el('div', { class: 'sub', text: "folders you've chatted in" })),
    el('div', { class: 'tile' }, el('div', { class: 'lbl' }, icon('chat', 'i sm'), 'Chats'), el('div', { class: 'num', text: fmtNum(chats) }), el('div', { class: 'sub', text: 'in Claude Code right now' })),
    el('button', { class: 'tile' + (bad.length ? ' bad' : ' ok'), type: 'button', onclick: () => { if (bad.length) { state.filter = 'problems'; renderFilters(); renderSidebar(); } } },
      el('div', { class: 'lbl' }, icon(bad.length ? 'alert' : 'check', 'i sm'), 'Need fixing'), el('div', { class: 'num', text: fmtNum(bad.length) }), el('div', { class: 'sub', text: bad.length ? "VS Code can't find their chats" : 'nothing to do' })),
    state.archive.configured
      ? el('button', { class: 'tile arch', type: 'button', onclick: () => { location.hash = '#archive'; } },
        el('div', { class: 'lbl' }, icon('box', 'i sm'), 'Only in your archive'), el('div', { class: 'num', text: fmtNum(state.archive.onlyCount) }), el('div', { class: 'sub', text: 'chats Claude Code no longer has' }))
      : el('button', { class: 'tile warn', type: 'button', onclick: () => { location.hash = '#archive'; } },
        el('div', { class: 'lbl' }, icon('box', 'i sm'), 'Archive'), el('div', { class: 'num', text: 'Off' }), el('div', { class: 'sub', text: 'set it up so nothing is ever lost' }))));

  if (bad.length) {
    page.appendChild(el('h2', { text: 'Needs fixing' }));
    page.appendChild(el('p', { class: 'h2sub', text: "These chats are safe on disk. VS Code just can't find them. Each card says why, and what to do." }));
    for (const p of bad) page.appendChild(issueCard(p));
  }

  const recent = state.projects.flatMap((p) => p.sessions.map((s) => ({ p, s })))
    .sort((a, b) => String(b.s.endedAt || '').localeCompare(String(a.s.endedAt || ''))).slice(0, 12);
  if (recent.length) {
    page.appendChild(el('h2', { text: 'Recent chats' }));
    page.appendChild(el('p', { class: 'h2sub', text: 'Across every project, newest first.' }));
    page.appendChild(el('div', { class: 'list' },
      el('div', { class: 'lhead' }, el('span', { text: 'Chat' }), el('span', { text: 'Project' }), el('span', { class: 'd', text: 'Last active' }), el('span', { class: 'n', text: 'Records' })),
      ...recent.map(({ p, s }) => el('button', { class: 'lrow', type: 'button', onclick: () => { location.hash = chatHash(p.folderName, s.sessionId); } },
        el('span', { class: 't', text: s.title || s.sessionId }),
        el('span', { class: 'p' }, el('span', { text: projName(p) }), s.archived ? el('span', { class: 'pill arch' }, icon('box'), 'Archived') : null),
        el('span', { class: 'd', text: fmtDate(s.endedAt) }),
        el('span', { class: 'n', text: fmtNum(s.messageCount) })))));
  }

  page.appendChild(el('h2', { text: 'All projects' }));
  page.appendChild(el('div', { class: 'list' },
    el('div', { class: 'lhead' }, el('span', { text: 'Project' }), el('span', { text: 'State' }), el('span', { class: 'd', text: 'Last used' }), el('span', { class: 'n', text: 'Chats' })),
    ...state.projects.map((p) => el('button', {
      class: 'lrow', type: 'button', title: p.projectPath || p.folderName,
      onclick: () => { state.open.add(p.folderName); state.filter = 'all'; renderFilters(); renderSidebar(); const first = p.sessions[0]; if (first) location.hash = chatHash(p.folderName, first.sessionId); },
    },
      el('span', { class: 't' }, el('b', { text: projName(p) }), el('div', { class: 'mono', style: 'font-size:12.5px;color:var(--text-3);font-weight:400;overflow:hidden;text-overflow:ellipsis' }, pathText(p.projectPath || '(path not recorded)'))),
      el('span', { class: 'p' }, ...(p.healthy && !p.archiveOnly ? [el('span', { class: 'pill ok' }, icon('check'), 'OK')] : issuePills(p))),
      el('span', { class: 'd', text: fmtDate(p.lastActivity) }),
      el('span', { class: 'n', text: fmtNum(p.sessions.length) })))));

  $('#main').replaceChildren(page);
  $('#main').scrollTop = 0;
}

function issueCard(p) {
  const orphan = p.issues.includes('orphaned');
  const mismatch = p.issues.includes('mismatch');
  const shared = p.issues.includes('ambiguous');
  const kind = orphan ? 'bad' : 'warn';
  const body = el('div', {});
  body.appendChild(el('h3', {}, projName(p), ...issuePills(p), el('span', { class: 'pill neutral', text: plural(p.sessionCount, 'chat', 'chats') })));

  if (orphan) {
    body.appendChild(el('p', { text: "These chats belong to a folder that isn't on this computer any more. If you moved or renamed the project, tell the app where it is now and the chats will follow it." }));
    body.appendChild(el('span', { class: 'path gone' }, pathText(p.projectPath || '(unknown)')));
  }
  if (mismatch) {
    body.appendChild(el('p', { text: 'The chat folder has the wrong name for the path recorded inside it, so VS Code never looks inside. Fixing the name changes nothing inside the chats.' }));
    body.appendChild(el('div', { class: 'arrowline' }, el('span', { class: 'path' }, pathText(p.folderName)), 'should be', el('span', { class: 'path' }, pathText(p.expectedFolderName || '?'))));
  }
  if (shared) {
    body.appendChild(el('p', { text: 'Chats from more than one project landed in this one folder, because their paths turn into the same folder name. Relocating moves only the chats recorded against the first path below.' }));
    for (const c of p.rootCandidates || []) body.appendChild(el('div', {}, el('span', { class: 'path' }, pathText(c.path)), ` · ${plural(c.count, 'record', 'records')}`));
  }
  if (p.issues.includes('unknown-path')) {
    body.appendChild(el('p', { text: "These chats never recorded which folder they were in, so the original path can't be worked out." }));
  }

  body.appendChild(el('div', { class: 'acts' },
    el('button', { class: 'btn primary', type: 'button', onclick: () => relocateDialog(p.folderName) }, 'Relocate…'),
    mismatch && p.expectedFolderName && !orphan ? el('button', { class: 'btn', type: 'button', onclick: () => fixNameOnly(p) }, 'Fix the name') : null,
    el('button', { class: 'btn', type: 'button', onclick: () => { state.open.add(p.folderName); renderSidebar(); } }, 'Show chats'),
    helpLink(orphan ? HELP.missing : mismatch ? HELP.hidden : HELP.shared)));

  return el('div', { class: 'issue ' + kind }, el('div', { class: 'badge-ic' }, icon(orphan ? 'alert' : mismatch ? 'eyeoff' : 'layers')), body);
}

async function fixNameOnly(p) {
  const ok = await confirmAction({
    key: 'fixname', title: 'Fix the folder name', sub: projName(p),
    does: `Renames the chat folder from ${p.folderName} to ${p.expectedFolderName}, the name VS Code looks for.`,
    see: 'The project turns healthy, and its chats appear in VS Code the next time you open that folder.',
    know: 'Nothing inside the chats changes. A full backup is taken first, so Undo history can put it back.',
    anchor: HELP.fixName, ok: 'Fix the name',
  });
  if (!ok) return;
  try {
    const out = await jpost('/api/relocate/apply', { folder: p.folderName, newPath: p.projectPath, backup: true });
    toast(`Renamed to ${out.result.newFolderName}`, 'ok', 'Fixed');
    await refresh();
  } catch (e) { errToast(e, 'Could not fix the name'); }
}

// ------------------------------------------------------------ the chat ---

const chatHash = (folder, id) => `#chat/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`;
let pendingJump = null;
let pinnedEl = null;

async function openSession(folder, sessionId) {
  setNav(null);
  state.current = { folder, sessionId };
  state.open.add(folder);
  renderSidebar();

  const main = $('#main');
  main.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' }), 'Opening the chat…'));

  let data;
  try {
    data = await api(`/api/session/${encodeURIComponent(folder)}/${encodeURIComponent(sessionId)}`);
  } catch (e) {
    main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message }), e.help ? helpLink(e.help) : null));
    return;
  }
  if (!state.current || state.current.sessionId !== sessionId) return;   // moved on meanwhile

  state.session = data.session;
  const s = data.session;
  if (data.sprite && !document.getElementById('transcriptIcons')) {
    document.body.insertAdjacentHTML('afterbegin', data.sprite.replace('<svg ', '<svg id="transcriptIcons" '));
  }
  const project = state.projects.find((p) => p.folderName === folder);
  const st = s.stats || {};
  const base = `/api/export/${encodeURIComponent(folder)}/${encodeURIComponent(sessionId)}`;
  const qs = () => (state.convoOnly ? '?convo=1' : '');

  // ---- header
  const head = el('div', { class: 'chathead' });
  const inner = el('div', { class: 'in' });
  inner.appendChild(el('div', { class: 'crumb' }, icon('folder', 'i sm'), el('b', { text: project ? projName(project) : folder }), '·',
    el('span', { class: 'mono' }, pathText(s.projectPath || '(project path not recorded)')),
    project && project.issues.includes('orphaned') ? el('span', { class: 'pill bad' }, icon('alert'), 'Folder missing') : null));
  inner.appendChild(el('h1', { text: s.title || sessionId }));
  inner.appendChild(el('div', { class: 'metaline' },
    s.startedAt ? el('span', {}, icon('clock'), fmtDate(s.startedAt) + (s.durationMs ? ' · ' + fmtDuration(s.durationMs) : '')) : null,
    el('span', {}, icon('chat'), `${plural(st.humanTurns || 0, 'message', 'messages')} from you · ${plural(st.answers || 0, 'answer', 'answers')}`),
    st.toolCalls ? el('span', {}, icon('layers'), plural(st.toolCalls, 'step', 'steps')) : null,
    s.fromArchive ? el('span', { class: 'pill arch', title: 'Claude Code deleted this chat. You are reading the copy your archive kept.' }, icon('box'), 'From your archive')
      : s.inArchive ? el('span', { class: 'pill ok', title: 'Your archive holds a copy of this chat.' }, icon('check'), 'Saved in archive') : null));

  const segConvo = el('div', { class: 'segbtns', role: 'group', title: 'Conversation only shows just your messages and Claude\u2019s answers.' },
    el('button', { type: 'button', 'data-mode': 'full', class: state.convoOnly ? '' : 'on' }, 'Full chat'),
    el('button', { type: 'button', 'data-mode': 'convo', class: state.convoOnly ? 'on' : '' }, 'Conversation only'));
  segConvo.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.convoOnly = b.dataset.mode === 'convo';
    store.set('ccx-convo', state.convoOnly ? '1' : null);
    $$('button', segConvo).forEach((x) => x.classList.toggle('on', x === b));
    $('#transcript').classList.toggle('convo-only', state.convoOnly);
    pinnedEl = null; updatePin();
  });

  const exportBtn = el('button', { class: 'btn sm', type: 'button', title: 'Save this chat as a file' }, icon('dl', 'i sm'), 'Export', icon('down', 'i sm caret'));
  exportBtn.addEventListener('click', () => popMenu(exportBtn, [
    { icon: 'dl', label: 'Web page (.html)', sub: 'One file that opens anywhere, offline, and prints to PDF.' + (state.convoOnly ? ' Opens as conversation only.' : ''), run: () => { location.href = base + '.html' + qs(); } },
    { icon: 'dl', label: 'Markdown (.md)', sub: 'Plain text with headings and code.' + (state.convoOnly ? ' Conversation only.' : ''), run: () => { location.href = base + '.md' + qs(); } },
    { icon: 'dl', label: 'The original file (.jsonl)', sub: 'Exactly what Claude Code saved, byte for byte.', run: () => { location.href = base + '.jsonl'; } },
    { icon: 'print', label: 'Print or save as PDF', sub: 'Opens a print-ready page with every step unfolded.', run: () => window.open(`/api/print/${encodeURIComponent(folder)}/${encodeURIComponent(sessionId)}${qs()}`, '_blank') },
    { icon: 'help', label: 'About these formats', run: () => openHelp(HELP.exports) },
  ]));

  const moreBtn = el('button', { class: 'btn sm ghost iconbtn', type: 'button', title: 'More' }, icon('dots'));
  moreBtn.addEventListener('click', () => popMenu(moreBtn, [
    { icon: 'down', label: 'Open every step', run: () => $$('#transcript details').forEach((d) => { d.open = true; }) },
    { icon: 'chev', label: 'Fold every step', run: () => $$('#transcript details').forEach((d) => { d.open = false; }) },
    { icon: 'layers', label: state.showContext ? 'Hide background context' : 'Show background context', sub: 'Things Claude Code adds behind the scenes: open files, reminders, hook output.', run: () => { state.showContext = !state.showContext; $('#transcript').classList.toggle('show-ctx', state.showContext); } },
    !s.fromArchive && project ? { icon: 'move', label: 'Relocate these chats…', sub: 'Point them at the folder where the project lives now.', run: () => relocateDialog(folder) } : null,
    { icon: 'help', label: 'How to read a chat', run: () => openHelp(HELP.chat) },
  ].filter(Boolean)));

  inner.appendChild(el('div', { class: 'chatbar' },
    project && !project.archiveOnly ? openButton(project, 'btn sm primary') : null,
    exportBtn,
    el('button', { class: 'btn sm', type: 'button', onclick: () => statsDialog(s), title: 'Tokens, tools used, files changed, model and more' }, icon('stats', 'i sm'), 'Details'),
    el('div', { class: 'grow' }),
    segConvo,
    moreBtn));
  head.appendChild(inner);

  const pin = el('div', { class: 'pinned off', id: 'pinned' }, el('div', { class: 'in' },
    el('span', { class: 'plabel', id: 'pinLabel' }),
    el('span', { class: 'ptext', id: 'pinText' }),
    el('button', { class: 'btn sm ghost', type: 'button', onclick: jumpToPinned, title: 'Scroll back to this message' }, 'Jump to it')));
  head.appendChild(pin);

  const convo = el('div', { class: 'convo' });
  if (s.fromArchive) {
    convo.appendChild(el('div', { class: 'banner arch' }, icon('box'),
      el('div', {}, el('b', { text: 'Claude Code no longer has this chat.' }), ' You are reading the copy your archive kept. Put it back to see it in VS Code again.',
        el('div', { class: 'acts' },
          el('button', { class: 'btn sm', type: 'button', onclick: () => restoreDialog([{ folderName: folder, sessionId, title: s.title }]) }, icon('restore', 'i sm'), 'Put it back into Claude Code'),
          helpLink(HELP.archiveOnly)))));
  }
  if (s.parseErrors && s.parseErrors.length) {
    convo.appendChild(el('div', { class: 'banner warn' }, icon('alert'),
      el('div', {}, el('b', { text: `${plural(s.parseErrors.length, 'line', 'lines')} of this chat file could not be read, and ${s.parseErrors.length === 1 ? 'was' : 'were'} skipped.` }),
        ' The rest of the chat is intact.', el('div', { class: 'acts' }, helpLink('w-unreadable-lines')))));
  }
  const transcript = el('main', { class: 'transcript' + (state.convoOnly ? ' convo-only' : '') + (state.showContext ? ' show-ctx' : ''), id: 'transcript' });
  convo.appendChild(transcript);
  main.replaceChildren(head, convo);
  main.scrollTop = 0;
  pinnedEl = null;

  // ---- the conversation, added in batches so a huge chat appears at once
  const items = data.items || [];
  let i = 0;
  function chunk() {
    if (!transcript.isConnected) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(i + 25, items.length);
    for (; i < end; i++) {
      const holder = document.createElement('div');
      holder.innerHTML = items[i].html;
      while (holder.firstChild) frag.appendChild(holder.firstChild);
    }
    transcript.appendChild(frag);
    if (i < items.length) requestAnimationFrame(chunk);
    else if (pendingJump != null) { jumpToTurn(pendingJump); pendingJump = null; }
  }
  chunk();
}

/** The last of your messages or Claude's answers scrolled past stays pinned. */
function updatePin() {
  const pin = $('#pinned');
  const head = $('.chathead');
  if (!pin || !head) return;
  const line = head.getBoundingClientRect().bottom;
  let cur = null;
  for (const n of $$('#transcript [data-special]')) {
    if (!n.offsetParent) continue;          // hidden by Conversation only, or folded
    if (n.getBoundingClientRect().bottom < line) cur = n; else break;
  }
  if (cur === pinnedEl) return;
  pinnedEl = cur;
  if (!cur) { pin.classList.add('off'); return; }
  const you = cur.dataset.special === 'you';
  pin.className = 'pinned ' + (you ? 'you' : 'answer');
  $('#pinLabel').replaceChildren(icon(you ? 'chat' : 'check', 'i sm'), (you ? 'You' : 'Claude\u2019s answer') + (cur.dataset.when ? ' · ' + cur.dataset.when : ''));
  const copy = cur.cloneNode(true);
  copy.querySelectorAll('.final-label, .ql, .more').forEach((n) => n.remove());
  $('#pinText').textContent = copy.textContent.replace(/\s+/g, ' ').trim();
}

function jumpToPinned() {
  if (!pinnedEl) return;
  const head = $('.chathead').getBoundingClientRect();
  $('#main').scrollBy({ top: pinnedEl.getBoundingClientRect().top - head.bottom - 16, behavior: 'smooth' });
}

$('#main').addEventListener('scroll', () => { if ($('#transcript')) updatePin(); }, { passive: true });

function jumpToTurn(index) {
  const node = document.getElementById('t' + index);
  if (!node) return;
  // a search hit may sit inside a folded step: unfold everything around it
  for (let d = node.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  if (node.tagName === 'DETAILS') node.open = true;
  if (state.convoOnly && !node.offsetParent) {
    state.convoOnly = false;
    store.set('ccx-convo', null);
    $('#transcript').classList.remove('convo-only');
    $$('.segbtns button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'full'));
  }
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.add('hit');
  setTimeout(() => node.classList.remove('hit'), 2600);
}

// -------------------------------------------------------------- search ----

let searchTimer = null;

function onSearchInput(e) {
  const q = e.target.value.trim();
  state.searchQuery = q;
  clearTimeout(searchTimer);
  if (!q) { route(); return; }
  searchTimer = setTimeout(() => runSearch(q), 220);
}

async function runSearch(q) {
  setNav(null);
  const main = $('#main');
  main.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' }), 'Searching every chat…'));
  let data;
  try { data = await api('/api/search?q=' + encodeURIComponent(q)); }
  catch (e) { main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message }))); return; }
  if (state.searchQuery !== q) return;

  const page = el('div', { class: 'page' });
  page.appendChild(el('h1', { text: 'Search' }));
  page.appendChild(el('p', { class: 'lede' },
    data.totalMatches
      ? `${plural(data.totalMatches, 'match', 'matches')} in ${plural(data.results.length, 'chat', 'chats')} for \u201C${q}\u201D. Click a line to open the chat there.`
      : `Nothing matched \u201C${q}\u201D in your chats.`, ' ', helpLink(HELP.search, 'Search tips')));
  if (data.error) page.appendChild(noticeBox('err', 'The search could not run', data.error));

  for (const r of data.results) {
    const group = el('div', { class: 'hitgroup' });
    group.appendChild(el('header', {},
      el('h3', { text: r.title || r.sessionId }),
      (r.issues || []).includes('orphaned') ? el('span', { class: 'pill bad' }, icon('alert'), 'Folder missing') : null,
      el('span', { class: 'gmeta', text: `${plural(r.hits.length, 'match', 'matches')} · ${fmtDate(r.endedAt)}` })));
    for (const h of r.hits.slice(0, 12)) {
      const marked = esc(h.text).replace(esc(h.hit), (m) => `<mark>${m}</mark>`);
      group.appendChild(el('button', {
        class: 'hit', type: 'button',
        onclick: () => { pendingJump = h.turnIndex; location.hash = chatHash(r.folderName, r.sessionId); },
      }, el('span', { class: 'hkind', text: kindLabel(h) }), el('span', { class: 'htext', html: marked })));
    }
    if (r.hits.length > 12) group.appendChild(el('div', { class: 'sidenote', style: 'text-align:left;padding:8px 16px', text: `…and ${r.hits.length - 12} more in this chat` }));
    page.appendChild(group);
  }
  main.replaceChildren(page);
  main.scrollTop = 0;
}

function kindLabel(h) {
  return ({ human: 'You', assistant: 'Claude', tool: h.label || 'Step', output: (h.label || 'Step') + ' output', thinking: 'Thinking', system: h.label || 'Note' })[h.kind] || h.kind;
}

// ---------------------------------------------------------- relocation ----

function previewRow(k, ...v) {
  return el('div', { class: 'pr' }, el('span', { class: 'k', text: k }), el('span', {}, ...v));
}

async function relocateDialog(folderName) {
  const project = state.projects.find((p) => p.folderName === folderName);
  if (!project) return;

  const input = el('input', { type: 'text', value: project.projectPath || '', placeholder: 'D:\\Projects\\MyApp', spellcheck: 'false' });
  const preview = el('div');
  const planBox = el('div');
  const applyBtn = el('button', { class: 'btn primary', type: 'button', text: 'Relocate', disabled: true });
  const backupChk = el('input', { type: 'checkbox', checked: true });
  let seq = 0;

  async function check() {
    const v = input.value.trim();
    const my = ++seq;
    preview.replaceChildren();
    planBox.replaceChildren();
    applyBtn.disabled = true;
    if (!v) return;
    let info;
    try { info = await api('/api/fs/exists?path=' + encodeURIComponent(v)); } catch { return; }
    if (my !== seq) return;
    if (!info.absolute) {
      preview.appendChild(messages('err', ['That is not a full path. Start with the drive, like D:\\Projects\\MyApp.'], ['E-NOT-ABSOLUTE'], 'Cannot relocate yet'));
      return;
    }
    let plan;
    try { plan = await jpost('/api/relocate/plan', { folder: folderName, newPath: v }); }
    catch (e) { planBox.replaceChildren(noticeBox('err', 'Could not work out the changes', e.message, e.help)); return; }
    if (my !== seq) return;

    preview.appendChild(el('div', { class: 'preview' },
      previewRow('Chat folder name', el('span', { class: 'arrow' },
        plan.folderRenameNeeded ? [el('span', { class: 'old' }, pathText(project.folderName)), icon('move', 'i sm'), el('span', { class: 'new' }, pathText(plan.newFolderName))]
          : [el('span', {}, pathText(project.folderName)), el('span', { class: 'muted', text: ' (already right)' })])),
      previewRow('Paths inside the chats', plan.totalCwdRewrites && !plan.warningCodes.includes('W-SAME-PATH') ? el('span', {}, el('b', { text: fmtNum(plan.totalCwdRewrites) }), ` updated, in ${plural(plan.files.filter((f) => f.cwdRewrites).length, 'file', 'files')}`) : 'none need changing'),
      plan.totalHistoricalRefs ? previewRow('Old mentions kept', `${fmtNum(plan.totalHistoricalRefs)} left as they are `, helpLink('old-mentions', 'Why?')) : null,
      info.nonAscii && !info.normalizationDiffers ? previewRow('Folder name length', `${info.encodedLength} characters: every non-Latin letter becomes one dash, as VS Code expects`) : null));
    planBox.appendChild(messages('err', plan.errors, plan.errorCodes, 'Cannot relocate'));
    planBox.appendChild(messages('warn', plan.warnings, plan.warningCodes, plan.errors.length ? null : 'Before you go ahead'));
    if (plan.ok) planBox.appendChild(noticeBox('ok', 'Ready to relocate', 'Nothing changes until you press Relocate.'));
    applyBtn.disabled = !plan.ok;
  }

  const node = modal({
    title: 'Relocate chats \u2014 ' + projName(project),
    sub: el('span', {}, `${plural(project.sessionCount, 'chat', 'chats')} · ${fmtBytes(project.totalSize)} · recorded for `, el('span', { class: 'path' + (project.projectExists ? '' : ' gone') }, pathText(project.projectPath || '(none)'))),
    body: el('div', {},
      about('relocate', {
        does: `Moves these ${plural(project.sessionCount, 'chat', 'chats')} over to the folder where the project lives now, so VS Code shows them again when you open that folder.`,
        see: el('span', {}, 'A preview of every change, below. ', el('b', { text: 'Nothing changes until you press Relocate.' }), ' Afterwards the project shows as healthy.'),
        know: 'A full backup is made first, and Undo history can put everything back. Close VS Code windows that have this project open.',
        anchor: HELP.relocate,
      }),
      el('div', { class: 'field' },
        el('label', { text: 'Where is the project now?' }),
        browseRow(input, { start: project.projectPath, title: 'Where is this project now?', after: check }),
        el('div', { class: 'hint', text: 'Pick the project folder itself: the one you open in VS Code.' })),
      preview, planBox),
    foot: [
      el('label', { class: 'check', title: 'Strongly recommended. Without it, Undo history cannot put this back.' }, backupChk, 'Back up first (recommended)'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      applyBtn,
    ],
  });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.replaceChildren(el('span', { class: 'spin' }), ' Relocating');
    try {
      const out = await jpost('/api/relocate/apply', { folder: folderName, newPath: input.value.trim(), backup: backupChk.checked });
      closeModal(node);
      toast(`${out.result.oldFolderName} \u2192 ${out.result.newFolderName}` + (out.result.cwdRewrites ? ` · ${fmtNum(out.result.cwdRewrites)} paths updated` : ''), 'ok', 'Relocated');
      state.current = null;
      location.hash = '#home';
      await refresh();
    } catch (e) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Relocate';
      planBox.replaceChildren(noticeBox('err', 'Relocation stopped', e.message, e.help));
    }
  });

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(check, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  openModal(node);
  check();
}

// ---------------------------------------------------------- bulk remap ----

function bulkDialog() {
  const oldIn = el('input', { type: 'text', placeholder: 'D:\\Files\\Projects', spellcheck: 'false' });
  const newIn = el('input', { type: 'text', placeholder: 'E:\\Dev', spellcheck: 'false' });
  const out = el('div');
  const applyBtn = el('button', { class: 'btn primary', type: 'button', text: 'Relocate them all', disabled: true });

  // a sensible starting point: the deepest folder every project shares
  const paths = state.projects.filter((p) => !p.archiveOnly).map((p) => p.projectPath).filter(Boolean);
  if (paths.length > 1) {
    const split = paths.map((p) => p.split(/[\\/]/));
    const common = [];
    for (let i = 0; i < split[0].length; i++) {
      const seg = split[0][i];
      if (split.every((s) => (s[i] || '').toLowerCase() === seg.toLowerCase())) common.push(seg); else break;
    }
    if (common.length > 1) oldIn.value = common.join('\\');
  }

  async function plan() {
    out.replaceChildren(el('div', { class: 'sidenote' }, el('span', { class: 'spin' })));
    applyBtn.disabled = true;
    if (!oldIn.value.trim() || !newIn.value.trim()) { out.replaceChildren(); return; }
    try {
      const p = await jpost('/api/relocate/bulk/plan', { oldPrefix: oldIn.value.trim(), newPrefix: newIn.value.trim() });
      const box = el('div');
      box.appendChild(messages('err', p.errors, p.errorCodes, 'Cannot move these'));
      if (!p.matches.length) {
        box.appendChild(noticeBox('warn', 'No chats are recorded under that folder', 'Check the old parent folder: it must be where the projects used to be.'));
      } else {
        const blocked = p.matches.filter((m) => !m.ok);
        box.appendChild(blocked.length
          ? noticeBox('err', `${plural(blocked.length, 'project', 'projects')} cannot move`, 'Open each one below for the reason, or relocate it on its own.')
          : noticeBox('ok', `${plural(p.matches.length, 'project', 'projects')} will move`, `${fmtNum(p.totalCwdRewrites)} recorded paths will be updated. Nothing changes until you press the button.`));
        box.appendChild(el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Project' }), el('th', { text: 'New place' }), el('th', { class: 'num', text: 'Paths' }))),
          el('tbody', {}, ...p.matches.map((m) => el('tr', {},
            el('td', { class: 'mono' }, pathText(m.oldProjectPath), m.ok ? null : el('div', { style: 'color:var(--bad);font-family:var(--sans)', text: m.errors[0] })),
            el('td', { class: 'mono' }, el('span', { style: 'color:var(--ok)' }, pathText(m.newProjectPath))),
            el('td', { class: 'num', text: fmtNum(m.totalCwdRewrites) }))))));
      }
      if (p.skipped.length) box.appendChild(el('p', { class: 'muted', style: 'font-size:13.5px', text: `${plural(p.skipped.length, 'project is', 'projects are')} not under that folder and will be left alone.` }));
      out.replaceChildren(box);
      applyBtn.disabled = !(p.ok && p.matches.length);
    } catch (e) {
      out.replaceChildren(noticeBox('err', 'Could not work out the changes', e.message, e.help));
    }
  }

  const node = modal({
    title: 'Move many projects', wide: true,
    sub: 'For when you moved a whole folder of projects, or copied everything to a new computer.',
    body: el('div', {},
      about('bulk', {
        does: 'Every project that used to live under the old folder is relocated to the same place under the new one, in one go.',
        see: 'A table of every project that will move, and where to. Nothing changes until you press the button.',
        know: 'Each project gets its own backup and its own Undo entry. A batch where two projects would land on one name is refused before anything runs.',
        anchor: HELP.bulk,
      }),
      el('div', { class: 'field' }, el('label', { text: 'Where the projects used to be' }), browseRow(oldIn, { title: 'Where did the projects use to be?', after: plan })),
      el('div', { class: 'field' }, el('label', { text: 'Where they are now' }), browseRow(newIn, { title: 'Where are the projects now?', after: plan }),
        el('div', { class: 'hint', text: 'Sub-folders are kept: D:\\Old\\Work\\App moves to E:\\New\\Work\\App.' })),
      out),
    foot: [el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', { class: 'btn', type: 'button', text: 'Preview', onclick: plan }),
      applyBtn],
  });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.replaceChildren(el('span', { class: 'spin' }), ' Working');
    try {
      const r = await jpost('/api/relocate/bulk/apply', { oldPrefix: oldIn.value.trim(), newPrefix: newIn.value.trim(), backup: true });
      closeModal(node);
      toast(`${plural(r.results.length, 'project', 'projects')} relocated.`, 'ok', 'Done');
      location.hash = '#home';
      await refresh();
    } catch (e) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Relocate them all';
      out.replaceChildren(noticeBox('err', 'Stopped', e.message, e.help));
    }
  });
  let t = null;
  for (const i of [oldIn, newIn]) i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(plan, 350); });
  openModal(node);
}

// ------------------------------------------------------- zip in and out ---

function archiveDialog() {
  const live = state.projects.filter((p) => !p.archiveOnly);
  const checks = live.map((p) => ({ p, input: el('input', { type: 'checkbox', checked: true }) }));
  const node = modal({
    title: 'Export chats to a zip',
    sub: 'To carry chats to another computer.',
    body: el('div', {},
      about('zipexport', {
        does: 'Packs the chosen projects\u2019 chats into one zip file, with a note of where each project lived on this computer.',
        see: 'Your browser downloads the zip. Nothing on this computer changes.',
        know: 'On the other computer, use Import / Export \u2192 Import, and say where each project lives there. The zip holds your chats in plain text: keep it private.',
        anchor: HELP.zipExport,
      }),
      el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' },
        el('button', { class: 'btn sm', type: 'button', text: 'All', onclick: () => checks.forEach((c) => { c.input.checked = true; }) }),
        el('button', { class: 'btn sm', type: 'button', text: 'None', onclick: () => checks.forEach((c) => { c.input.checked = false; }) })),
      el('div', { class: 'maplist' }, ...checks.map(({ p, input }) => el('label', { class: 'maprow', style: 'display:flex;gap:12px;align-items:center;cursor:pointer' },
        input, el('div', { style: 'min-width:0' }, el('div', { class: 'mname', text: projName(p) }),
          el('div', { class: 'morig' }, pathText(p.projectPath || p.folderName), ` · ${plural(p.sessionCount, 'chat', 'chats')} · ${fmtBytes(p.totalSize)}`)))))),
    foot: [el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', {
        class: 'btn primary', type: 'button', text: 'Download the zip',
        onclick: () => {
          const picked = checks.filter((c) => c.input.checked).map((c) => c.p.folderName);
          if (!picked.length) return toast('Choose at least one project.', 'warn');
          closeModal(node);
          location.href = '/api/archive/export' + (picked.length === live.length ? '' : '?folders=' + encodeURIComponent(picked.join(',')));
          toast('Building the zip. The download starts in a moment.', '', 'Export');
        },
      })],
  });
  openModal(node);
}

function importDialog() {
  const file = el('input', { type: 'file', accept: '.zip,application/zip' });
  const out = el('div');
  const nextBtn = el('button', { class: 'btn primary', type: 'button', text: 'Read the zip', disabled: true });
  file.addEventListener('change', () => { nextBtn.disabled = !file.files.length; });

  const node = modal({
    title: 'Import chats from a zip', wide: true,
    sub: 'From a zip this app made on another computer, or any zip of chat folders.',
    body: el('div', {},
      about('zipimport', {
        does: 'Reads the zip, then puts each project\u2019s chats into Claude Code\u2019s folder under the right name for where that project lives on this computer.',
        see: 'First a list of the projects in the zip, with the path each had before. You say where each one is now, then press Import.',
        know: 'A project that already has chats here is skipped, never merged. Projects you do not need can be skipped too.',
        anchor: HELP.zipImport,
      }),
      el('div', { class: 'field' }, el('label', { text: 'The zip file' }), file), out),
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }), nextBtn],
  });

  nextBtn.addEventListener('click', async () => {
    if (!file.files.length) return;
    nextBtn.disabled = true;
    nextBtn.replaceChildren(el('span', { class: 'spin' }), ' Reading');
    try {
      const info = await api('/api/archive/inspect', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file.files[0] });
      showImportMapping(node, info);
    } catch (e) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Read the zip';
      out.replaceChildren(noticeBox('err', 'Could not read that zip', e.message, e.help));
    }
  });
  openModal(node);
}

function showImportMapping(node, info) {
  const rows = info.projects.map((p) => {
    const input = el('input', { type: 'text', value: p.suggestedPath || p.originalPath || '', spellcheck: 'false' });
    const skip = el('input', { type: 'checkbox', checked: p.collides });
    const row = el('div', { class: 'maprow' + (p.collides ? ' skip' : '') },
      el('div', { class: 'mtop' },
        el('span', { class: 'mname', text: p.originalPath ? p.originalPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName }),
        el('span', { class: 'pill neutral', text: plural(p.sessionCount, 'chat', 'chats') }),
        p.collides ? el('span', { class: 'pill warn', title: 'A chat folder with this name already exists here. It is skipped so nothing gets mixed.' }, icon('alert'), 'Already here') : null,
        el('label', { class: 'check', style: 'margin-left:auto' }, skip, 'Skip')),
      el('div', { class: 'morig' }, 'was: ', pathText(p.originalPath || 'unknown')),
      el('div', { style: 'margin-top:8px' }, browseRow(input, { title: 'Where does this project live on this computer?' })));
    skip.addEventListener('change', () => row.classList.toggle('skip', skip.checked));
    return { p, input, skip, row };
  });

  node.bodyEl.replaceChildren(
    info.manifest
      ? noticeBox('info', `From ${info.manifest.sourceHost || 'another computer'}, exported ${fmtDate(info.manifest.exportedAt)}`, 'Say where each project lives on this computer now.')
      : noticeBox('warn', 'This zip has no note of the original paths', 'They were worked out from the chats themselves. Check each one below.', 'import-from-a-zip'),
    el('div', { class: 'maplist' }, ...rows.map((r) => r.row)));
  node.footEl.replaceChildren(
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
    el('button', {
      class: 'btn primary', type: 'button', text: 'Import',
      onclick: async function () {
        this.disabled = true;
        this.replaceChildren(el('span', { class: 'spin' }), ' Importing');
        try {
          const r = await jpost('/api/archive/apply', {
            stagingId: info.stagingId,
            mappings: rows.map(({ p, input, skip }) => ({ folderName: p.folderName, originalPath: p.originalPath, newProjectPath: input.value.trim(), skip: skip.checked })),
          });
          closeModal(node);
          if (r.results.length) toast(`${plural(r.results.length, 'project', 'projects')} imported.`, 'ok', 'Import complete');
          r.errors.forEach((e) => toast(e, 'err', 'Skipped'));
          await refresh();
        } catch (e) {
          this.disabled = false;
          this.textContent = 'Import';
          node.bodyEl.prepend(noticeBox('err', 'Import stopped', e.message, e.help));
        }
      },
    }));
}

// -------------------------------------------------------------- history ---

function historyDialog() {
  const body = el('div', {}, el('div', { class: 'sidenote' }, el('span', { class: 'spin' })));
  const node = modal({
    title: 'Undo history',
    sub: 'Every relocation, newest first.',
    body: el('div', {},
      about('undo', {
        does: 'Undo puts a relocated chat folder back exactly as it was before, from the backup taken at the time.',
        see: 'Each relocation with its old and new folder name. Undone ones are greyed out.',
        know: 'Deleting a backup frees disk space, but that relocation can then no longer be undone.',
        anchor: HELP.undo,
      }), body),
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => closeModal(node) })],
  });
  openModal(node);

  async function load() {
    let data;
    try { data = await api('/api/history'); }
    catch (e) { body.replaceChildren(noticeBox('err', 'Could not read the history', e.message)); return; }
    if (!data.history.length) { body.replaceChildren(el('div', { class: 'sidenote', text: 'Nothing has been relocated yet.' })); return; }
    body.replaceChildren(...data.history.map((h) => el('div', { class: 'hentry' + (h.undoneAt ? ' undone' : '') },
      el('div', { class: 'htop' },
        el('b', { text: h.newProjectPath ? h.newProjectPath.split(/[\\/]/).filter(Boolean).pop() : h.folderName }),
        h.undoneAt ? el('span', { class: 'pill neutral', text: 'undone' }) : null,
        el('span', { class: 'hwhen', text: fmtDate(h.at) })),
      el('div', { class: 'harrow' }, h.oldFolderName, ' \u2192 ', el('span', { class: 'to', text: h.newFolderName })),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px', text: `${plural(h.cwdRewrites, 'path', 'paths')} updated` + (h.backupDir ? '' : ' · backup deleted') }),
      el('div', { style: 'margin-top:9px;display:flex;gap:6px' },
        !h.undoneAt && h.backupDir ? el('button', {
          class: 'btn sm', type: 'button',
          onclick: async () => {
            const ok = await confirmAction({
              key: 'undo-one', title: 'Undo this relocation?', sub: `${h.newFolderName} \u2192 ${h.oldFolderName}`,
              does: 'Puts the chat folder back exactly as it was before the relocation, from its backup.',
              see: 'The project returns to its old name and path in the list.',
              know: 'Close VS Code windows that have this project open first. Anything added to these chats since the relocation is replaced by the backup.',
              anchor: HELP.undo, ok: 'Undo',
            });
            if (!ok) return;
            try { await jpost(`/api/history/${encodeURIComponent(h.id)}/undo`, {}); toast('Put back from the backup.', 'ok', 'Undone'); await refresh(); await load(); }
            catch (e) { errToast(e, 'Undo failed'); }
          },
        }, icon('undo', 'i sm'), 'Undo') : null,
        h.backupDir ? el('button', {
          class: 'btn sm danger', type: 'button',
          onclick: async () => {
            const ok = await confirmAction({
              key: 'forget', title: 'Delete this backup?', sub: h.backupDir,
              does: 'Deletes the copy of the chat folder taken before this relocation.',
              see: 'The entry stays in the history, marked "backup deleted", without an Undo button.',
              know: 'This cannot be reversed: the relocation can never be undone afterwards.',
              anchor: HELP.undo, ok: 'Delete the backup', danger: true,
            });
            if (!ok) return;
            try { await jpost(`/api/history/${encodeURIComponent(h.id)}/forget`, {}); await load(); }
            catch (e) { errToast(e); }
          },
        }, 'Delete backup') : null))));
  }
  load();
}

// -------------------------------------------------------------- details ---

function statsDialog(s) {
  const st = s.stats || {};
  const tk = st.tokens || {};
  const tools = Object.entries(st.tools || {}).sort((a, b) => b[1] - a[1]);
  const models = Object.keys(st.models || {}).filter((m) => m && m !== '<synthetic>');
  const readout = (k, v) => el('tr', {}, el('td', { text: k }), el('td', { class: 'mono' }, pathText(v)));
  const node = modal({
    title: 'Chat details', sub: s.title,
    body: el('div', {},
      el('div', { class: 'tiles' },
        el('div', { class: 'tile' }, el('div', { class: 'lbl', text: 'Your messages' }), el('div', { class: 'num', text: fmtNum(st.humanTurns) })),
        el('div', { class: 'tile' }, el('div', { class: 'lbl', text: "Claude's answers" }), el('div', { class: 'num', text: fmtNum(st.answers) })),
        el('div', { class: 'tile' }, el('div', { class: 'lbl', text: 'Steps' }), el('div', { class: 'num', text: fmtNum(st.toolCalls) })),
        el('div', { class: 'tile' + (st.apiErrors ? ' warn' : '') }, el('div', { class: 'lbl', text: 'Connection problems' }), el('div', { class: 'num', text: fmtNum(st.apiErrors) }))),
      el('table', { class: 'tbl' }, el('tbody', {},
        readout('Chat id', s.sessionId),
        readout('Project', s.projectPath || '(none)'),
        models.length ? readout('Model', models.join(', ')) : null,
        s.gitBranch ? readout('Git branch', s.gitBranch) : null,
        readout('Duration', fmtDuration(s.durationMs) || '\u2014'),
        readout('File size', fmtBytes(s.sizeBytes)),
        typeof st.costUSD === 'number' ? readout('Cost Claude Code recorded', '$' + st.costUSD.toFixed(2) + ' (what it would cost at API prices)') : null,
        st.compactions ? readout('Compactions', String(st.compactions)) : null,
        readout('Thinking', `${fmtNum(st.thinkingBlocks)} time(s)` + (st.redactedThinking ? ', the text of it is not saved' : '')))),
      el('h3', { style: 'font-size:15px;margin:18px 0 6px', text: 'Tokens' }),
      el('table', { class: 'tbl' }, el('tbody', {},
        el('tr', {}, el('td', { text: 'Written by Claude' }), el('td', { class: 'num', text: fmtNum(tk.output) })),
        el('tr', {}, el('td', { text: 'Read fresh' }), el('td', { class: 'num', text: fmtNum(tk.input) })),
        el('tr', {}, el('td', { text: 'Read from cache' }), el('td', { class: 'num', text: fmtNum(tk.cacheRead) })),
        el('tr', {}, el('td', { text: 'Written to cache' }), el('td', { class: 'num', text: fmtNum(tk.cacheCreation) })))),
      tools.length ? el('h3', { style: 'font-size:15px;margin:18px 0 6px', text: 'Tools used' }) : null,
      tools.length ? el('table', { class: 'tbl' }, el('tbody', {}, ...tools.map(([n, c]) => el('tr', {}, el('td', { text: n }), el('td', { class: 'num', text: fmtNum(c) }))))) : null,
      st.filesTouched && st.filesTouched.length ? el('h3', { style: 'font-size:15px;margin:18px 0 6px', text: `Files changed (${st.filesTouched.length})` }) : null,
      st.filesTouched && st.filesTouched.length ? el('ul', { class: 'filelist' }, ...st.filesTouched.slice(0, 80).map((f) => el('li', { text: f.path }))) : null),
    foot: [helpLink(HELP.details, 'What these mean'), el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => closeModal(node) })],
  });
  openModal(node);
}

// -------------------------------------------------------------- archive ---

async function archiveView() {
  setNav('archive');
  state.current = null;
  renderSidebar();
  const main = $('#main');
  main.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' })));
  let v;
  try { v = await api('/api/vault'); }
  catch (e) { main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message }))); return; }

  const page = el('div', { class: 'page' });
  page.appendChild(el('h1', { text: 'Archive' }));
  page.appendChild(el('p', { class: 'lede' },
    'A permanent copy of every chat and memory file. It keeps what Claude Code deletes after 30 days, and every older version of a memory file. Nothing in it is ever thrown away. ',
    helpLink(HELP.archive, 'How it works')));

  if (!v.configured) {
    page.appendChild(archiveSetup(v));
    main.replaceChildren(page);
    return;
  }

  const s = v.status;
  const auto = v.hooks && v.hooks.installed;
  page.appendChild(el('div', { class: 'statusbar' },
    el('span', { class: 'dot' + (s.saving ? ' warn' : auto ? '' : ' off') }),
    el('div', { class: 'st' },
      el('b', { text: s.saving ? 'Saving now…' : s.lastSaveAt ? 'Up to date' : 'Not saved yet' }),
      el('span', { text: `Last saved ${fmtAgo(s.lastSaveAt)} · ${auto ? 'saves automatically after every reply' : 'automatic saving is off'}` })),
    el('div', { class: 'grow' }),
    el('span', { class: 'path', title: s.dir }, pathText(s.dir)),
    el('button', { class: 'btn', type: 'button', onclick: () => settingsDialog() }, icon('gear', 'i sm'), 'Settings'),
    el('button', { class: 'btn primary', type: 'button', onclick: saveNow }, icon('box', 'i sm'), 'Save now')));

  if (v.errors && v.errors.length) {
    page.appendChild(noticeBox('warn', 'An automatic save had a problem', v.errors[0], 'e-auto-save-failed'));
  }
  if (!auto) {
    page.appendChild(el('div', { class: 'banner warn' }, icon('alert'), el('div', {},
      el('b', { text: 'Automatic saving is off.' }), ' The archive only changes when you press Save now. Turn it on so every reply is kept as it happens.',
      el('div', { class: 'acts' }, el('button', { class: 'btn sm primary', type: 'button', onclick: () => toggleAutoSave(true) }, 'Turn on automatic saving'), helpLink(HELP.autoSave)))));
  }

  page.appendChild(el('div', { class: 'tiles' },
    el('div', { class: 'tile' }, el('div', { class: 'lbl' }, icon('chat', 'i sm'), 'Chats kept'), el('div', { class: 'num', text: fmtNum(s.chats) }), el('div', { class: 'sub', text: fmtBytes(s.sizeBytes) + ' in all' })),
    el('div', { class: 'tile arch' }, el('div', { class: 'lbl' }, icon('box', 'i sm'), 'Only in the archive'), el('div', { class: 'num', text: fmtNum(s.archiveOnly) }), el('div', { class: 'sub', text: 'Claude Code no longer has these' })),
    el('button', { class: 'tile', type: 'button', onclick: () => { location.hash = '#memory'; } }, el('div', { class: 'lbl' }, icon('brain', 'i sm'), 'Memory files'), el('div', { class: 'num', text: fmtNum(s.memory) }), el('div', { class: 'sub', text: `${plural(s.filesWithVersions, 'file has', 'files have')} older versions` })),
    el('div', { class: 'tile' }, el('div', { class: 'lbl' }, icon('layers', 'i sm'), 'Everything'), el('div', { class: 'num', text: fmtNum(s.files) }), el('div', { class: 'sub', text: 'files, with helper chats and saved output' }))));

  page.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:-14px 0 30px' },
    el('button', { class: 'btn', type: 'button', onclick: importBackupDialog }, icon('dl', 'i sm'), 'Import an old backup folder…'),
    s.archiveOnly ? el('button', { class: 'btn', type: 'button', onclick: () => restoreDialog(null) }, icon('restore', 'i sm'), `Put all ${fmtNum(s.archiveOnly)} back into Claude Code…`) : null));

  const only = state.projects.flatMap((p) => p.sessions.filter((x) => x.archived).map((x) => ({ p, s: x })));
  if (only.length) {
    page.appendChild(el('h2', { text: 'Chats only your archive has' }));
    page.appendChild(el('p', { class: 'h2sub' }, 'Claude Code deleted these, or never had them on this computer. You can read them here, or put them back so VS Code lists them again. ', helpLink(HELP.restore)));
    page.appendChild(el('div', { class: 'list' }, ...only.slice(0, 200).map(({ p, s: x }) => el('div', { class: 'lrow' },
      el('a', { class: 't', href: chatHash(p.folderName, x.sessionId), style: 'color:inherit;text-decoration:none' }, x.title || x.sessionId),
      el('span', { class: 'p', text: projName(p) }),
      el('span', { class: 'd', text: fmtDate(x.endedAt) }),
      el('span', { class: 'n' }, el('button', { class: 'btn sm', type: 'button', onclick: () => restoreDialog([{ folderName: p.folderName, sessionId: x.sessionId, title: x.title }]) }, 'Put back'))))));
  }

  page.appendChild(el('h2', {}, 'What happened ', helpLink(HELP.archiveLog, 'How to read this')));
  page.appendChild(el('p', { class: 'h2sub', text: 'Every save that changed something, newest first. Saves where nothing changed are not listed.' }));
  page.appendChild(v.log.length ? el('div', { class: 'list' }, ...v.log.map(logRow)) : el('p', { class: 'muted', text: 'Nothing yet.' }));

  main.replaceChildren(page);
}

function logRow(e) {
  const c = e.counts || {};
  const bits = [];
  if (e.mode === 'restore') bits.push(`put ${plural(c.restored || 0, 'chat', 'chats')} back into Claude Code`);
  if (c.added) bits.push(`${fmtNum(c.added)} new`);
  if (c.grew) bits.push(`${plural(c.grew, 'file grew', 'files grew')}`);
  if (c.versioned) bits.push(`${plural(c.versioned, 'file was', 'files were')} rewritten (old version kept)`);
  if (c.kept) bits.push(`${plural(c.kept, 'shorter copy', 'shorter copies')} ignored (already held in full)`);
  if (c.gone) bits.push(`${plural(c.gone, 'file', 'files')} deleted from Claude Code (still kept here)`);
  if (c.back) bits.push(`${plural(c.back, 'file', 'files')} back in Claude Code`);
  if (c.failed) bits.push(`${plural(c.failed, 'file', 'files')} could not be read`);
  const title = e.mode === 'import' ? `Imported ${e.label || 'a backup folder'}` : e.mode === 'restore' ? 'Put chats back' : e.label === 'automatic' ? 'Automatic save' : 'Saved';
  const ic = e.mode === 'import' ? 'dl' : e.mode === 'restore' ? 'restore' : c.gone || c.versioned ? 'box' : 'check';
  const names = (e.changes || []).filter((x) => x.action !== 'grew').slice(0, 4).map((x) => x.rel.split('/').slice(-1)[0]);
  return el('div', { class: 'logrow' },
    el('span', { class: 'ic' }, icon(ic, 'i sm')),
    el('div', {}, el('b', { text: title }), ' \u2014 ', bits.join(', ') || 'no changes',
      names.length ? el('small', { text: names.join(', ') + ((e.changes || []).length > 4 ? ', …' : '') }) : null),
    el('span', { class: 'when', text: fmtDate(e.at) }));
}

function archiveSetup(v) {
  const input = el('input', { type: 'text', value: v.suggestedDir, spellcheck: 'false' });
  const auto = el('input', { type: 'checkbox', checked: true });
  const backups = el('input', { type: 'text', placeholder: 'Optional: a folder where you copied chats by hand', spellcheck: 'false' });
  const status = el('div');
  const go = el('button', { class: 'btn primary', type: 'button' }, icon('box', 'i sm'), 'Create the archive');
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.replaceChildren(noticeBox('info', 'Working…', 'Copying every chat and memory file. A large store can take a minute.'));
    try {
      await jpost('/api/vault/location', { dir: input.value.trim() });
      const r = await jpost('/api/vault/save', {});
      if (backups.value.trim()) await jpost('/api/vault/import', { dir: backups.value.trim() });
      if (auto.checked) await jpost('/api/vault/hooks', { enable: true });
      toast(`${fmtNum(r.counts.added)} files saved.`, 'ok', 'Archive created');
      await refresh();
      archiveView();
    } catch (e) {
      go.disabled = false;
      status.replaceChildren(noticeBox('err', 'Could not set up the archive', e.message, e.help));
    }
  });
  return el('div', { class: 'setup' },
    el('h2', { text: 'Set up your archive' }),
    about('setup', {
      does: 'Copies every chat and memory file into a folder you choose, and from then on keeps adding to it. Nothing is ever deleted from it.',
      see: 'The archive fills in a few seconds to a minute. Chats Claude Code deletes later still appear, marked "Archived".',
      know: 'Pick a folder on another drive if you can, and never a public or shared one: your chats are private. Automatic saving adds a small entry to Claude Code\u2019s settings; it can be turned off at any time.',
      anchor: HELP.setup,
    }),
    el('div', { class: 'field' }, el('label', { text: 'Where should the archive live?' }), browseRow(input, { title: 'Choose a folder for the archive', sub: 'An empty folder, or one that already holds an archive.' }),
      el('div', { class: 'hint', text: 'A new folder is created if it does not exist.' })),
    el('div', { class: 'field' }, el('label', { text: 'Old backup to take in (optional)' }), browseRow(backups, { title: 'Where are your old copies?', sub: 'A folder shaped like .claude\\projects: one folder per project inside.' }),
      el('div', { class: 'hint', text: 'Chats in it that Claude Code already deleted come back into the archive. Nothing in that folder is changed.' })),
    el('label', { class: 'check', style: 'margin:4px 0 16px' }, auto, 'Save automatically after every Claude reply (recommended)'),
    status, go);
}

async function saveNow() {
  try {
    const r = await jpost('/api/vault/save', {});
    const c = r.counts;
    const changed = c.added + c.grew + c.versioned + c.gone;
    toast(changed ? `${fmtNum(c.added)} new, ${fmtNum(c.grew)} grew, ${fmtNum(c.versioned)} with an older version kept, ${fmtNum(c.gone)} deleted from Claude Code.` : 'Nothing had changed.', 'ok', 'Saved');
    await refresh();
    if (location.hash.startsWith('#archive')) archiveView();
  } catch (e) { errToast(e, 'Could not save'); }
}

async function importBackupDialog() {
  const input = el('input', { type: 'text', spellcheck: 'false', placeholder: 'D:\\Backups\\projects - copy' });
  const status = el('div');
  const go = el('button', { class: 'btn primary', type: 'button', text: 'Import it' });
  const node = modal({
    title: 'Import an old backup folder',
    body: el('div', {},
      about('importbackup', {
        does: 'Takes in a folder of chats you copied by hand earlier. Anything the archive does not have yet is added: chats, memory files, older versions.',
        see: 'A summary of what was added. Chats Claude Code deleted appear in the archive, marked "Archived".',
        know: 'The folder you import is only read, never changed. A shorter copy of a chat is ignored when the archive already holds the full one, and a different version of a memory file is kept beside the current one.',
        anchor: HELP.importBackup,
      }),
      el('div', { class: 'field' }, el('label', { text: 'The backup folder' }), browseRow(input, { title: 'Where is the backup?', sub: 'The folder that holds one folder per project, like .claude\\projects.' })),
      status),
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }), go],
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.replaceChildren(noticeBox('info', 'Importing…', 'Reading every file. This can take a minute.'));
    try {
      const r = await jpost('/api/vault/import', { dir: input.value.trim() });
      const c = r.counts;
      closeModal(node);
      toast(`${fmtNum(c.added)} new files, ${fmtNum(c.versioned)} older versions kept, ${fmtNum(c.kept)} shorter copies ignored.`, 'ok', 'Imported');
      await refresh();
      archiveView();
    } catch (e) {
      go.disabled = false;
      status.replaceChildren(noticeBox('err', 'Could not import', e.message, e.help));
    }
  });
  openModal(node);
}

async function restoreDialog(which) {
  const count = which ? which.length : state.archive.onlyCount;
  const ok = await confirmAction({
    key: 'restore', title: which && which.length === 1 ? 'Put this chat back into Claude Code?' : `Put ${plural(count, 'chat', 'chats')} back into Claude Code?`,
    sub: which && which.length === 1 ? which[0].title : null,
    does: 'Copies the chat from your archive back into Claude Code\u2019s folder, with any helper chats and saved output that belong to it.',
    see: 'VS Code lists the chat again the next time you open its project (or reload the window), and you can carry on with it there.',
    know: 'Files already in Claude Code are never overwritten. With the "keep chats" setting at its default of 30 days, Claude Code would delete an old chat again; the archive keeps its copy either way.',
    anchor: HELP.restore, ok: 'Put back',
  });
  if (!ok) return;
  try {
    const r = await jpost('/api/vault/restore', { sessions: which ? which.map((w) => ({ folderName: w.folderName, sessionId: w.sessionId })) : null });
    toast(`${plural(r.restored.length, 'chat', 'chats')} put back.`, 'ok', 'Done');
    await refresh();
    if (state.current) openSession(state.current.folder, state.current.sessionId);
    else if (location.hash.startsWith('#archive')) archiveView();
  } catch (e) { errToast(e, 'Could not put it back'); }
}

async function toggleAutoSave(enable) {
  const ok = await confirmAction({
    key: enable ? 'autosave-on' : 'autosave-off',
    title: enable ? 'Turn on automatic saving?' : 'Turn off automatic saving?',
    does: enable
      ? 'Adds an entry to Claude Code\u2019s settings so that after every reply, before a compaction and when a chat closes, the archive saves what changed.'
      : 'Removes that entry from Claude Code\u2019s settings. Nothing else in the settings is touched.',
    see: enable ? 'Nothing visible in VS Code. The Archive page shows "saves automatically", and the last-saved time keeps moving.'
      : 'The archive only changes when you press Save now.',
    know: enable ? 'The save runs in the background and never slows Claude down. Your other hooks stay. A copy of the settings file is kept first.'
      : 'Chats Claude Code deletes before your next Save now are not caught.',
    anchor: HELP.autoSave, ok: enable ? 'Turn on' : 'Turn off', danger: !enable,
  });
  if (!ok) return;
  try {
    await jpost('/api/vault/hooks', { enable });
    toast(enable ? 'Every reply will be saved to the archive.' : 'Automatic saving is off.', 'ok', enable ? 'Automatic saving on' : 'Automatic saving off');
    if (location.hash.startsWith('#archive')) archiveView();
  } catch (e) { errToast(e, 'Could not change the setting'); }
}

// --------------------------------------------------------------- memory ---

/** A small line diff, enough for memory files (a few hundred lines at most). */
function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  const n = x.length, m = y.length;
  if (n * m > 4e6) return [...x.map((t) => ['gone', t]), ...y.map((t) => ['new', t])];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push(['same', x[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(['gone', x[i++]]);
    else out.push(['new', y[j++]]);
  }
  while (i < n) out.push(['gone', x[i++]]);
  while (j < m) out.push(['new', y[j++]]);
  return out;
}

async function memoryView(folder, name) {
  setNav('memory');
  state.current = null;
  renderSidebar();
  const main = $('#main');
  // Already on this page and only switching files: swap the file on the right and
  // leave everything else alone, so neither scrollbar jumps back to the top.
  const here = $('#memoryPage');
  if (here && here._pick && folder && name) { here._pick(folder, name); return; }
  if (!here) main.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' })));
  let data;
  try { data = await api('/api/memory'); }
  catch (e) { main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message }))); return; }
  state.memoryCount = data.projects.reduce((a, p) => a + p.files.length, 0);
  $('#navMemory').textContent = state.memoryCount ? fmtNum(state.memoryCount) : '';

  if (!folder && data.projects.length) { folder = data.projects[0].folderName; name = data.projects[0].files[0].name; }
  const listEl = el('div', { class: 'memlist' });
  const fileButtons = [];
  const keyOf = (fo, na) => fo + '\n' + na;
  for (const p of data.projects) {
    listEl.appendChild(el('h5', { title: p.projectPath || p.folderName, text: p.projectPath ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName }));
    for (const f of p.files) {
      const b = el('button', {
        type: 'button', class: p.folderName === folder && f.name === name ? 'on' : '',
        onclick: () => { location.hash = `#memory/${encodeURIComponent(p.folderName)}/${encodeURIComponent(f.name)}`; },
        title: f.inClaude ? f.name : f.name + ' \u2014 only in your archive',
      }, el('span', { class: 'nm', text: f.name }),
        f.versions ? el('span', { class: 'pill arch', title: `${f.versions} older version(s) in your archive` }, icon('layers'), String(f.versions)) : null,
        !f.inClaude ? el('span', { class: 'pill arch', title: 'Only in your archive' }, icon('box')) : null);
      b.dataset.key = keyOf(p.folderName, f.name);
      fileButtons.push(b);
      listEl.appendChild(b);
    }
  }

  const view = el('div', { class: 'memview' }, el('div', { class: 'empty', style: 'min-height:200px' }, data.projects.length ? el('span', { class: 'spin' }) : 'No memory files yet.'));
  const page = el('div', { class: 'page', id: 'memoryPage' },
    el('h1', { text: 'Memory files' }),
    el('p', { class: 'lede' }, 'The notes Claude keeps between chats: who you are, how you like to work, the state of each project. Claude rewrites them as it learns, so your archive keeps every earlier version. ', helpLink(HELP.memory, 'More about memory')),
    el('div', { class: 'memgrid' }, listEl, view));
  page._pick = async (fo, na) => {
    for (const b of fileButtons) b.classList.toggle('on', b.dataset.key === keyOf(fo, na));
    await showMemoryFile(view, fo, na);
    // A long file you had scrolled down in: show the new file from its top, but
    // never move the page when its top is already on screen.
    const gap = view.getBoundingClientRect().top - main.getBoundingClientRect().top;
    if (gap < 0) main.scrollBy({ top: gap - 16 });
  };
  main.replaceChildren(page);
  if (folder && name) showMemoryFile(view, folder, name);
}

const NOTE_KINDS = { user: 'About you', feedback: 'Feedback', project: 'Project note', reference: 'Reference' };

/** The settings block at the top of a memory file, as a small quiet box. */
function memoryNote(meta) {
  const kind = meta.type ? (NOTE_KINDS[String(meta.type).toLowerCase()] || meta.type) : null;
  return el('div', { class: 'memnote' },
    kind || meta.name ? el('div', { class: 'notehead' }, kind ? el('span', { class: 'pill neutral' }, icon('pin'), kind) : null, meta.name ? el('b', { text: meta.name }) : null) : null,
    meta.description ? el('p', { class: 'desc', text: meta.description }) : null,
    meta.rest.length ? el('details', { title: 'Claude Code’s own bookkeeping. You can ignore it.' },
      el('summary', { text: 'Technical details' }),
      el('div', { class: 'tech' }, ...meta.rest.map(([k, v]) => el('div', { text: `${k}: ${v}` })))) : null);
}

async function showMemoryFile(view, folder, name) {
  const mine = view._seq = (view._seq || 0) + 1;   // a slower, older click must not overwrite a newer one
  let f;
  try { f = await api(`/api/memory/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`); }
  catch (e) { if (mine === view._seq) view.replaceChildren(el('div', { class: 'empty', text: e.message })); return; }
  if (mine !== view._seq) return;
  const versions = (f.versions && f.versions.versions) || [];
  const content = el('div', { class: 'prose', html: f.html });
  const noteSlot = el('div');
  // a version's note, or none (the comparison shows the raw lines, settings and all)
  const setNote = (meta) => noteSlot.replaceChildren(...(meta ? [memoryNote(meta)] : []));
  setNote(f.meta);
  const tabs = el('div', { class: 'vtabs' });
  const show = async (btn, hash, compare) => {
    $$('button', tabs).forEach((b) => b.classList.toggle('on', b === btn));
    if (!hash && !compare) { content.className = 'prose'; content.innerHTML = f.html; setNote(f.meta); return; }
    try {
      if (compare) {
        const older = await api(`/api/memory/version?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}&v=${versions[versions.length - 1].sha256}`);
        content.className = 'vdiff';
        content.replaceChildren(...lineDiff(older.text, f.text).map(([k, t]) => el('div', { class: k, text: t || ' ' })));
        setNote(null);
      } else {
        const v = await api(`/api/memory/version?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}&v=${hash}`);
        content.className = 'prose';
        content.innerHTML = v.html;
        setNote(v.meta);
      }
    } catch (e) { content.replaceChildren(el('p', { text: e.message })); }
  };
  if (versions.length) {
    tabs.appendChild(el('span', { class: 'muted', style: 'font-size:13px;margin-right:4px', text: 'Versions:' }));
    for (const v of versions) {
      const b = el('button', { type: 'button', text: fmtDate(new Date(v.mtimeMs).toISOString()), title: `${fmtBytes(v.size)} \u2014 kept ${fmtDate(v.keptAt)}` });
      b.addEventListener('click', () => show(b, v.sha256));
      tabs.appendChild(b);
    }
    const cur = el('button', { type: 'button', class: 'on', text: 'Current' });
    cur.addEventListener('click', () => show(cur, null));
    tabs.appendChild(cur);
    const cmp = el('button', { type: 'button', text: 'What changed', title: 'Lines removed (red) and added (green) since the last older version' });
    cmp.addEventListener('click', () => show(cmp, null, true));
    tabs.appendChild(cmp);
    tabs.appendChild(helpLink(HELP.versions, 'About versions'));
  }
  // replaceChildren() prints a null as the word "null", so only pass real nodes.
  view.replaceChildren(
    el('header', {}, icon('brain'), el('b', { text: name }),
      f.source === 'archive' ? el('span', { class: 'pill arch' }, icon('box'), 'Only in your archive') : el('span', { class: 'pill ok' }, icon('check'), 'In Claude Code'),
      versions.length ? el('span', { class: 'pill neutral', text: plural(versions.length, 'older version', 'older versions') }) : null),
    ...(versions.length ? [tabs] : []),
    noteSlot,
    content);
}

// ----------------------------------------------------------------- help ---

async function helpView(anchor) {
  setNav('help');
  state.current = null;
  renderSidebar();
  $('#drawer').hidden = true;
  const main = $('#main');
  main.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' })));
  let help;
  try { help = await loadHelp(); }
  catch (e) { main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: 'The help could not be loaded: ' + e.message }))); return; }
  const doc = el('div', { class: 'helpdoc', html: help.html });
  const toc = el('nav', { class: 'helptoc' }, ...help.toc.map((t) => el('a', { href: '#help/' + t.id, text: t.title })));
  main.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'helpgrid' }, toc, doc)));
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', '#help/' + a.getAttribute('href').slice(1));
    scrollHelpTo(main, a.getAttribute('href').slice(1));
  });
  $$('a[href^="#"]', doc).forEach((a) => { a.removeAttribute('target'); a.removeAttribute('rel'); });
  toc.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', a.getAttribute('href'));
    scrollHelpTo(main, a.getAttribute('href').slice(6));
  });
  if (anchor) scrollHelpTo(main, anchor); else main.scrollTop = 0;
}

// ------------------------------------------------------------- settings ---

async function settingsDialog() {
  const [root, v] = await Promise.all([api('/api/root'), api('/api/vault').catch(() => null)]);
  const theme = store.get('ccx-theme') || 'system';
  const themeSel = el('select', { style: 'height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;background:var(--surface)' },
    ...[['system', 'Follow Windows (light or dark)'], ['light', 'Always light'], ['dark', 'Always dark']].map(([k, t]) => el('option', { value: k, selected: k === theme }, t)));
  themeSel.addEventListener('change', () => setTheme(themeSel.value));
  const auto = v && v.hooks && v.hooks.installed;
  const node = modal({
    title: 'Settings',
    body: el('div', {},
      el('div', { class: 'settings-sec' },
        el('h3', { text: 'Chat folder' }),
        el('p', {}, 'Where Claude Code keeps its chats. Normally you never change this; point it somewhere else only to read a copy. ', helpLink(HELP.store)),
        el('div', { class: 'arrowline' }, el('span', { class: 'path' }, pathText(root.root)),
          el('button', { class: 'btn sm', type: 'button', onclick: () => { closeModal(node); rootDialog(); } }, 'Change…'))),
      el('div', { class: 'settings-sec' },
        el('h3', { text: 'Archive' }),
        v && v.configured
          ? el('div', {},
            el('p', {}, 'Your permanent copy. ', helpLink(HELP.archive)),
            el('div', { class: 'arrowline' }, el('span', { class: 'path' }, pathText(v.status.dir)),
              el('button', { class: 'btn sm', type: 'button', onclick: () => jpost('/api/fs/reveal', { path: v.status.dir }).catch((e) => errToast(e)) }, 'Show in Explorer'),
              el('button', { class: 'btn sm', type: 'button', onclick: () => { closeModal(node); moveArchiveDialog(v.status.dir); } }, 'Use another folder…')),
            el('p', { style: 'margin-top:12px' }, auto ? 'Saves automatically after every Claude reply.' : 'Automatic saving is off.'),
            el('button', { class: 'btn sm' + (auto ? ' danger' : ' primary'), type: 'button', onclick: () => { closeModal(node); toggleAutoSave(!auto); } }, auto ? 'Turn off automatic saving' : 'Turn on automatic saving'))
          : el('div', {}, el('p', { text: 'Not set up yet.' }), el('a', { class: 'btn sm primary', href: '#archive', onclick: () => closeModal(node) }, 'Set up the archive'))),
      el('div', { class: 'settings-sec' },
        el('h3', { text: 'Appearance' }),
        el('p', { text: 'Light or dark. Exported chats follow the same choice when you open them in this browser.' }),
        themeSel,
        el('p', { style: 'margin-top:14px' }, 'The sidebar can be dragged wider or narrower, shrunk to icons, or closed. ', helpLink(HELP.sidebar, 'How the sidebar works')),
        el('button', { class: 'btn sm', type: 'button', title: 'Sets the sidebar to open at its usual width. Nothing else changes.', onclick: () => { resetSidebar(); toast('The sidebar is back to its usual size.', 'ok'); } }, 'Put the sidebar back to its usual size'))),
    foot: [helpLink(HELP.settings, 'About settings'), el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => closeModal(node) })],
  });
  openModal(node);
}

function moveArchiveDialog(current) {
  const input = el('input', { type: 'text', value: current, spellcheck: 'false' });
  const node = modal({
    title: 'Use another archive folder',
    body: el('div', {},
      about('archive-folder', {
        does: 'Points the app at a different archive folder. The old folder is left exactly as it is.',
        see: 'The Archive page shows what the new folder holds. An empty folder starts a new archive on the next save.',
        know: 'To move your archive, close the app, move the whole folder in Explorer, then choose its new place here.',
        anchor: HELP.setup,
      }),
      el('div', { class: 'field' }, el('label', { text: 'Archive folder' }), browseRow(input, { title: 'Choose the archive folder' }))),
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', {
        class: 'btn primary', type: 'button', text: 'Use this folder',
        onclick: async () => {
          try { await jpost('/api/vault/location', { dir: input.value.trim() }); closeModal(node); toast('Archive folder changed.', 'ok'); await refresh(); location.hash = '#archive'; archiveView(); }
          catch (e) { errToast(e, 'Could not use that folder'); }
        },
      })],
  });
  openModal(node);
}

async function rootDialog() {
  const info = await api('/api/root');
  const input = el('input', { type: 'text', value: info.root, spellcheck: 'false' });
  const node = modal({
    title: 'Chat folder',
    body: el('div', {},
      about('root', {
        does: 'Reads chats from another folder instead of Claude Code\u2019s own, for example a copy restored from an old computer.',
        see: 'The project list switches to whatever that folder holds.',
        know: 'Relocating works on whichever folder is chosen here. The choice is remembered until you switch back to the default.',
        anchor: HELP.store,
      }),
      el('div', { class: 'field' }, el('label', { text: 'Folder' }), browseRow(input, { title: 'Choose a chat folder', sub: 'A folder shaped like .claude\\projects: one folder per project inside.' }),
        el('div', { class: 'hint' }, 'Claude Code\u2019s own: ', el('code', { text: info.default })))),
    foot: [
      el('button', { class: 'btn', type: 'button', text: 'Use Claude Code\u2019s own', onclick: () => { input.value = info.default; } }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', {
        class: 'btn primary', type: 'button', text: 'Use this folder',
        onclick: async function () {
          this.disabled = true;
          try { await jpost('/api/root', { dir: input.value.trim() }); closeModal(node); state.current = null; await refresh(); location.hash = '#home'; toast('Now reading ' + input.value.trim(), 'ok', 'Chat folder changed'); }
          catch (e) { this.disabled = false; errToast(e, 'Could not use that folder'); }
        },
      })],
  });
  openModal(node);
}

function setTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  store.set('ccx-theme', t === 'light' || t === 'dark' ? t : null);
}

function toggleTheme() {
  const now = document.documentElement.getAttribute('data-theme');
  const dark = now ? now === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(dark ? 'light' : 'dark');
}

// ---------------------------------------------------------------- layout --
/* The sidebar. A wide window keeps it beside the page: as wide as you drag it,
   narrowed to an icon strip, or closed. A narrow window (tablet, phone) slides
   it over the page instead, and closes it again once you have picked something.
   What you chose is remembered in this browser, so each computer keeps its own. */

const SIDE = { min: 220, max: 560, usual: 300 };
const rootEl = document.documentElement;
const wideMQ = matchMedia('(min-width: 900px)');
let sideLast = store.get('ccx-side-last') === 'compact' ? 'compact' : 'open';   // what "show" brings back

const sideMode = () => rootEl.getAttribute('data-side') || 'open';
const sideNow = () => Math.round($('#sidebar').getBoundingClientRect().width);

function syncLayout() {
  const wide = wideMQ.matches;
  const mode = sideMode();
  const shown = wide ? mode !== 'closed' : rootEl.getAttribute('data-nav') === 'open';
  const t = $('#navToggle');
  t.setAttribute('aria-expanded', String(shown));
  t.title = shown ? 'Hide the sidebar' : 'Show the sidebar';
  $('#compactBtn').title = mode === 'compact' ? 'Make the sidebar wide again' : 'Make the sidebar narrow: icons only';
  const r = $('#sideResizer');
  r.setAttribute('aria-valuemin', SIDE.min); r.setAttribute('aria-valuemax', SIDE.max);
  if (shown && wide && mode === 'open') r.setAttribute('aria-valuenow', sideNow());
}

function setSide(mode) {
  if (mode === 'open') rootEl.removeAttribute('data-side'); else rootEl.setAttribute('data-side', mode);
  store.set('ccx-side', mode === 'open' ? null : mode);
  if (mode !== 'closed') { sideLast = mode; store.set('ccx-side-last', mode === 'compact' ? 'compact' : null); }
  syncLayout();
}

function resetSidebar() {
  rootEl.style.removeProperty('--side-w-user');
  store.set('ccx-side-w', null);
  setSide('open');
}

function setSideWidth(px, save) {
  const w = Math.round(Math.min(SIDE.max, Math.max(SIDE.min, px)));
  rootEl.style.setProperty('--side-w-user', w + 'px');
  if (save) store.set('ccx-side-w', w === SIDE.usual ? null : String(w));
  syncLayout();
}

/** Narrow windows: show or hide the sliding panel. */
function setPanel(open) {
  if (open) rootEl.setAttribute('data-nav', 'open'); else rootEl.removeAttribute('data-nav');
  syncLayout();
  if (open) { const first = $('#sidebar .nav a'); if (first) first.focus(); }
  else if ($('#sidebar').contains(document.activeElement)) $('#navToggle').focus();
}

function toggleSidebar() {
  if (wideMQ.matches) setSide(sideMode() === 'closed' ? sideLast : 'closed');
  else setPanel(rootEl.getAttribute('data-nav') !== 'open');
}

function initLayout() {
  $('#navToggle').addEventListener('click', toggleSidebar);
  $('#compactBtn').addEventListener('click', () => setSide(sideMode() === 'compact' ? 'open' : 'compact'));
  $('#railProjects').addEventListener('click', () => setSide('open'));
  $('#scrim').addEventListener('click', () => setPanel(false));
  wideMQ.addEventListener('change', () => { setPanel(false); syncLayout(); });

  // buttons that live in the sidebar on a phone press the real ones in the top bar
  $('#sidebar').addEventListener('click', (e) => {
    const proxy = e.target.closest('[data-proxy]');
    if (proxy) { const target = $(proxy.dataset.proxy); if (target) target.click(); }
    if (!wideMQ.matches && e.target.closest('a[href], [data-proxy], .btn, .storebtn')) setPanel(false);
  });

  // the drag handle
  const rz = $('#sideResizer');
  rz.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    rz.setPointerCapture(e.pointerId);
    rootEl.classList.add('resizing');
  });
  rz.addEventListener('pointermove', (e) => {
    if (rootEl.classList.contains('resizing')) setSideWidth(e.clientX - $('#sidebar').getBoundingClientRect().left, false);
  });
  const endDrag = () => {
    if (!rootEl.classList.contains('resizing')) return;
    rootEl.classList.remove('resizing');
    setSideWidth(sideNow(), true);
  };
  rz.addEventListener('pointerup', endDrag);
  rz.addEventListener('pointercancel', endDrag);
  rz.addEventListener('dblclick', () => { rootEl.style.removeProperty('--side-w-user'); store.set('ccx-side-w', null); syncLayout(); });   // width only
  rz.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 64 : 16;
    const to = e.key === 'ArrowLeft' ? sideNow() - step : e.key === 'ArrowRight' ? sideNow() + step
      : e.key === 'Home' ? SIDE.min : e.key === 'End' ? SIDE.max : null;
    if (to == null) return;
    e.preventDefault();
    setSideWidth(to, true);
  });
  syncLayout();
}

// ---------------------------------------------------------------- router --

function route() {
  const h = decodeURIComponent(location.hash || '#home');
  const [view, ...rest] = h.slice(1).split('/');
  if (state.searchQuery && view !== 'chat') { runSearch(state.searchQuery); return; }
  if (view === 'chat' && rest.length >= 2) {
    const [folder, ...id] = rest;
    if (!state.current || state.current.folder !== folder || state.current.sessionId !== id.join('/')) openSession(folder, id.join('/'));
    return;
  }
  if (view === 'archive') return archiveView();
  if (view === 'memory') return memoryView(rest[0], rest.slice(1).join('/'));
  if (view === 'help') return helpView(rest[0]);
  return homeView();
}

window.addEventListener('hashchange', () => {
  if (state.searchQuery && location.hash.startsWith('#chat')) { /* keep the query; leaving search for a result */ }
  else if (state.searchQuery) { state.searchQuery = ''; $('#search').value = ''; }
  if (rootEl.getAttribute('data-nav') === 'open') setPanel(false);   // picked something: get the panel out of the way
  route();
});

// ----------------------------------------------------------------- boot ---

async function refresh() {
  const [data, eds] = await Promise.all([
    api('/api/projects?force=1'),
    state.editors.length ? Promise.resolve({ editors: state.editors }) : api('/api/editors').catch(() => ({ editors: [] })),
  ]);
  state.editors = eds.editors || [];
  state.root = data.root;
  state.projects = data.projects;
  state.counts = data.counts;
  state.archive = data.archive || { configured: false, onlyCount: 0 };
  $('#rootPath').replaceChildren(pathText(data.root));
  $('#rootPath').setAttribute('title', data.root);
  renderFilters();
  renderSidebar();
  if (!data.exists) {
    $('#main').replaceChildren(el('div', { class: 'empty' },
      el('p', { text: 'There is no chat folder at ' + data.root }),
      el('button', { class: 'btn primary', type: 'button', text: 'Choose a folder…', onclick: rootDialog }),
      helpLink(HELP.store)));
    return false;
  }
  if (state.current && !state.projects.some((p) => p.folderName === state.current.folder)) state.current = null;
  return true;
}

function init() {
  initLayout();
  $('#search').addEventListener('input', onSearchInput);
  $('#rootBtn').addEventListener('click', rootDialog);
  $('#bulkBtn').addEventListener('click', bulkDialog);
  $('#historyBtn').addEventListener('click', historyDialog);
  $('#settingsBtn').addEventListener('click', () => settingsDialog().catch((e) => errToast(e)));
  $('#helpBtn').addEventListener('click', () => openHelp(currentHelpTopic()));
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#refreshBtn').addEventListener('click', () => refresh().then(() => { toast('Looked again.', 'ok'); if (!state.current) route(); }));
  $$('#filters button').forEach((c) => c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    renderFilters();
    renderSidebar();
  }));

  // copy buttons and "show the whole message" inside the conversation
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-copy],[data-more]') : null;
    if (!t) return;
    if (t.hasAttribute('data-more')) {
      const bub = t.closest('.bubble');
      const on = bub.classList.toggle('expanded');
      t.textContent = on ? 'Show less' : 'Show the whole message';
      return;
    }
    const wrap = t.closest('.codewrap');
    const code = wrap && wrap.querySelector('code');
    if (!code) return;
    navigator.clipboard.writeText(code.innerText).then(() => {
      const was = t.textContent;
      t.textContent = 'Copied';
      setTimeout(() => { t.textContent = was; }, 1200);
    }, () => toast('Could not copy to the clipboard.', 'err'));
  });

  refresh().then((ok) => { if (ok !== false) route(); }).catch((e) => {
    $('#main').replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message })));
  });
  api('/api/memory').then((d) => {
    const n = d.projects.reduce((a, p) => a + p.files.length, 0);
    $('#navMemory').textContent = n ? fmtNum(n) : '';
  }).catch(() => {});
}

/** The help button opens at whatever you are looking at. */
function currentHelpTopic() {
  const v = (location.hash || '#home').slice(1).split('/')[0];
  return ({ chat: HELP.chat, archive: HELP.archive, memory: HELP.memory, help: null, home: 'getting-started' })[v] || 'getting-started';
}

init();
