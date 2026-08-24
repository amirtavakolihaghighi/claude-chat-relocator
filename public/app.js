'use strict';
/* Claude Chat Relocator - front end.
   Plain DOM, no framework. The server hands over pre-rendered transcript HTML,
   so this file is concerned with navigation, dialogs and the relocation flows. */

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
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A file path, safe to drop into a right-to-left-truncating box.
 *
 * Path fields use `direction: rtl` so long paths lose their beginning rather
 * than their end -- you want to see the project, not the drive letter. But a
 * path containing Persian, Arabic or Hebrew text would then be reordered by
 * the bidi algorithm and read as nonsense. <bdi dir="ltr"> isolates the path
 * so it always renders left-to-right, while the box still trims from the left.
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
    err.status = res.status;
    throw err;
  }
  return data;
}

const jpost = (url, body) => api(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function fmtNum(n) { return Number(n || 0).toLocaleString(); }

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const days = (Date.now() - d) / 86400000;
  if (days < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 300) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

function toast(msg, kind = '', title = '') {
  const t = el('div', { class: 'toast ' + kind },
    title ? el('b', { text: title }) : null,
    el('span', { text: msg }));
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, kind === 'err' ? 7000 : 4000);
}

// --------------------------------------------------------------- state ----

const state = {
  root: '',
  projects: [],
  counts: {},
  filter: 'all',
  open: new Set(),          // expanded project folders
  current: null,            // { folder, sessionId }
  session: null,
  showContext: false,
  searchQuery: '',
  editors: [],              // editors detected on PATH, best first
};

// ------------------------------------------------------ open in editor ----

/**
 * Open a project folder in an editor. With one editor installed this is a
 * single click; with several, it asks which. A folder that is not on this
 * machine cannot be opened, and the button says so rather than failing.
 */
async function openInEditor(projectPath, editorId) {
  if (!projectPath) return toast('No project path is recorded for these chats.', 'warn');
  if (!state.editors.length) {
    return toast(
      'No supported editor was found on your PATH. In VS Code, run "Shell Command: Install ‘code’ command in PATH" from the command palette, then rescan.',
      'err', 'Nothing to open with');
  }
  if (!editorId && state.editors.length > 1) return pickEditorDialog(projectPath);

  try {
    const r = await jpost('/api/fs/open', { path: projectPath, editor: editorId || state.editors[0].id, newWindow: true });
    toast(`${r.path}`, 'ok', `Opening in ${r.editor}`);
  } catch (e) {
    toast(e.message, 'err', 'Could not open');
  }
}

function pickEditorDialog(projectPath) {
  const node = modal({
    title: 'Open in…',
    sub: projectPath,
    body: el('div', { class: 'maplist' },
      ...state.editors.map((ed) => el('button', {
        class: 'maprow', type: 'button',
        style: 'text-align:left;cursor:pointer;width:100%',
        onclick: () => { closeModal(node); openInEditor(projectPath, ed.id); },
      },
        el('div', { class: 'mname', text: ed.name }),
        el('div', { class: 'morig', text: ed.command })))),
    foot: [el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) })],
  });
  openModal(node);
}

/** An "Open" button, disabled with a reason when the folder is not there. */
function openButton(p, cls = 'btn tiny') {
  const label = state.editors.length === 1 ? `Open in ${state.editors[0].name}` : 'Open project';
  const missing = p.projectPath && !p.projectExists;
  return el('button', {
    class: cls,
    type: 'button',
    text: state.editors.length ? label : 'Open project',
    disabled: missing || !p.projectPath || !state.editors.length,
    title: missing
      ? 'That folder is not on this machine. Relocate these chats first.'
      : !state.editors.length ? 'No supported editor found on your PATH'
        : `Open ${p.projectPath} in a new window`,
    onclick: () => openInEditor(p.projectPath),
  });
}

// --------------------------------------------------------------- modals ---

const modalStack = [];

function openModal(node) {
  const rootEl = $('#modalRoot');
  if (modalStack.length) modalStack[modalStack.length - 1].style.display = 'none';
  modalStack.push(node);
  rootEl.appendChild(node);
  rootEl.hidden = false;
  const focusable = node.querySelector('input, button.primary, button');
  if (focusable) setTimeout(() => focusable.focus(), 30);
}

function closeModal(node) {
  const target = node || modalStack[modalStack.length - 1];
  if (!target) return;
  const i = modalStack.indexOf(target);
  if (i >= 0) modalStack.splice(i, 1);
  target.remove();
  if (modalStack.length) modalStack[modalStack.length - 1].style.display = '';
  else $('#modalRoot').hidden = true;
}

function modal({ title, sub, body, foot, wide }) {
  const node = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  const close = () => closeModal(node);
  node.appendChild(el('header', {},
    el('div', {},
      el('h2', { text: title }),
      sub ? el('p', { text: sub }) : null),
    el('button', { class: 'x', title: 'Close', onclick: close, type: 'button', html: '&times;' })));
  const bodyEl = el('div', { class: 'mbody' });
  if (body) bodyEl.appendChild(body);
  node.appendChild(bodyEl);
  const footEl = el('div', { class: 'mfoot' });
  if (foot) foot.forEach((f) => footEl.appendChild(f));
  node.appendChild(footEl);
  node.close = close;
  node.bodyEl = bodyEl;
  node.footEl = footEl;
  return node;
}

$('#modalRoot').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modalRoot') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) { e.preventDefault(); closeModal(); }
  if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !modalStack.length) {
    e.preventDefault(); $('#search').focus();
  }
});

// ---------------------------------------------------------- path picker ---

/** Modal directory browser. Resolves to an absolute path, or null if cancelled. */
function pickPath(startPath, title = 'Choose a folder') {
  return new Promise((resolve) => {
    let current = startPath || '';
    const list = el('div', { class: 'pickerlist' });
    const cur = el('div', { class: 'cur' }, pathText(current || 'This computer'));
    const manual = el('input', { type: 'text', value: current || '', placeholder: 'Or type a path' });

    const up = el('button', { class: 'btn tiny', type: 'button', text: 'Up', onclick: () => load(lastParent) });
    let lastParent = null;

    async function load(p) {
      list.replaceChildren(el('div', { class: 'sidenote', html: '<span class="spin"></span>' }));
      try {
        const data = await api('/api/fs/browse?path=' + encodeURIComponent(p == null ? '' : p));
        current = data.path;
        lastParent = data.parent;
        up.disabled = data.parent == null;
        cur.replaceChildren(pathText(data.path || 'This computer'));
        manual.value = data.path || '';
        list.replaceChildren();
        if (!data.entries.length) {
          list.appendChild(el('div', { class: 'sidenote', text: 'No sub-folders here.' }));
        }
        for (const entry of data.entries) {
          list.appendChild(el('button', {
            type: 'button',
            onclick: () => load(entry.path),
          }, el('span', { class: 'ic', html: '&#128193;' }), el('span', { text: entry.name })));
        }
      } catch (e) {
        list.replaceChildren(el('div', { class: 'sidenote', text: e.message }));
      }
    }

    const node = modal({
      title,
      sub: 'Pick the folder your project lives in now.',
      body: el('div', {},
        el('div', { class: 'picker' },
          el('div', { class: 'pickerbar' }, up, cur),
          list),
        el('div', { class: 'field', style: 'margin-top:14px;margin-bottom:0' },
          el('label', { text: 'Path' }),
          el('div', { class: 'row' }, manual))),
      foot: [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { closeModal(node); resolve(null); } }),
        el('button', {
          class: 'btn primary', type: 'button', text: 'Use this folder',
          onclick: () => { const v = manual.value.trim(); closeModal(node); resolve(v || null); },
        }),
      ],
    });

    manual.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const v = manual.value.trim(); closeModal(node); resolve(v || null); }
    });

    openModal(node);
    load(startPath || null);
  });
}

// ------------------------------------------------------------- sidebar ----

function issueBadges(p) {
  const out = [];
  if (p.issues.includes('orphaned')) out.push(el('span', { class: 'badge orphan', text: 'missing' }));
  if (p.issues.includes('mismatch')) out.push(el('span', { class: 'badge mismatch', text: 'hidden' }));
  if (p.issues.includes('ambiguous')) out.push(el('span', { class: 'badge mismatch', text: 'shared' }));
  if (p.issues.includes('empty')) out.push(el('span', { class: 'badge empty', text: 'empty' }));
  if (p.issues.includes('unknown-path')) out.push(el('span', { class: 'badge empty', text: 'no path' }));
  return out;
}

function renderSidebar() {
  const wrap = $('#projects');
  wrap.replaceChildren();

  let list = state.projects;
  if (state.filter === 'problems') list = list.filter((p) => !p.healthy);

  if (!list.length) {
    wrap.appendChild(el('div', { class: 'sidenote' },
      state.filter === 'problems'
        ? 'Every chat folder points at a project that exists. Nothing to fix.'
        : 'No chat folders found in this store.'));
    return;
  }

  for (const p of list) {
    const isOpen = state.open.has(p.folderName);
    const node = el('div', { class: 'proj' + (isOpen ? ' open' : '') + (p.healthy ? '' : ' bad') });

    node.appendChild(el('button', {
      class: 'projhead', type: 'button',
      onclick: () => {
        if (state.open.has(p.folderName)) state.open.delete(p.folderName);
        else state.open.add(p.folderName);
        renderSidebar();
      },
    },
      el('div', { class: 'projtop' },
        el('span', { class: 'projname', text: p.projectPath ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName }),
        ...issueBadges(p),
        el('span', { class: 'projcount', text: p.sessionCount })),
      el('div', { class: 'projpath', title: p.projectPath || p.folderName }, pathText(p.projectPath || p.folderName))));

    const sessions = el('div', { class: 'sessions' });
    for (const s of p.sessions) {
      const on = state.current && state.current.folder === p.folderName && state.current.sessionId === s.sessionId;
      sessions.appendChild(el('button', {
        class: 'sess' + (on ? ' on' : ''), type: 'button',
        onclick: () => openSession(p.folderName, s.sessionId),
      },
        el('div', { class: 'sesstitle', title: s.title, text: s.title || s.sessionId }),
        el('div', { class: 'sessmeta', text: `${fmtDate(s.endedAt)} · ${fmtNum(s.messageCount)} msgs · ${fmtBytes(s.sizeBytes)}` })));
    }
    if (!p.sessions.length) sessions.appendChild(el('div', { class: 'sidenote', text: 'No sessions' }));

    sessions.appendChild(el('div', { style: 'padding:6px 12px 2px 24px;display:flex;gap:5px;flex-wrap:wrap' },
      openButton(p),
      el('button', { class: 'btn tiny', type: 'button', text: 'Relocate…', onclick: () => relocateDialog(p.folderName) }),
      el('button', { class: 'btn tiny', type: 'button', text: 'Archive', onclick: () => downloadArchive([p.folderName]) })));

    node.appendChild(sessions);
    wrap.appendChild(node);
  }
}

function renderFilters() {
  const bad = state.projects.filter((p) => !p.healthy).length;
  // Once everything is fixed the problems filter disappears, so don't leave it
  // selected and showing an empty list.
  if (!bad && state.filter === 'problems') state.filter = 'all';
  const chips = $$('#filters .chip');
  chips.forEach((c) => c.classList.toggle('on', c.dataset.filter === state.filter));
  const problemChip = chips.find((c) => c.dataset.filter === 'problems');
  if (problemChip) {
    problemChip.innerHTML = 'Needs attention' + (bad ? ` <span class="n">${bad}</span>` : '');
    problemChip.style.display = bad ? '' : 'none';
  }
}

// ----------------------------------------------------------- dashboard ----

function renderDashboard() {
  const main = $('#main');
  const c = state.counts;
  const bad = state.projects.filter((p) => !p.healthy);

  const sheet = el('div', { class: 'sheet dash' });
  sheet.appendChild(el('h1', { text: 'Your Claude chats' }));
  sheet.appendChild(el('p', { class: 'lede' },
    'Every folder below is a project Claude Code has chats for. ',
    'The folder name is derived from the project\u2019s absolute path, so moving a project ',
    'breaks the link \u2014 relocating a folder here rebuilds it.'));

  sheet.appendChild(el('div', { class: 'cards' },
    el('div', { class: 'card' }, el('div', { class: 'num', text: fmtNum(c.total) }), el('div', { class: 'lbl', text: 'projects' })),
    el('div', { class: 'card' }, el('div', { class: 'num', text: fmtNum(state.projects.reduce((a, p) => a + p.sessionCount, 0)) }), el('div', { class: 'lbl', text: 'chats' })),
    el('div', { class: 'card' + (c.orphaned ? ' bad' : '') }, el('div', { class: 'num', text: fmtNum(c.orphaned) }), el('div', { class: 'lbl', text: 'project folder missing' })),
    el('div', { class: 'card' + (c.mismatched ? ' warn' : '') }, el('div', { class: 'num', text: fmtNum(c.mismatched) }), el('div', { class: 'lbl', text: 'hidden from the extension' })),
    // Only worth a card when it happens; most stores never see this one.
    c.ambiguous ? el('div', { class: 'card warn' }, el('div', { class: 'num', text: fmtNum(c.ambiguous) }), el('div', { class: 'lbl', text: 'sharing a folder' })) : null));

  if (bad.length) {
    sheet.appendChild(el('h2', { text: 'Needs attention' }));
    sheet.appendChild(el('p', { class: 'sub' },
      'These chats still exist, but the path they were recorded against no longer does. ',
      'Point each one at the project\u2019s new location and the extension will find them again.'));

    for (const p of bad) {
      const orphan = p.issues.includes('orphaned');
      const mismatch = p.issues.includes('mismatch');
      const node = el('div', { class: 'problem' + (orphan ? '' : ' mismatch') });
      node.appendChild(el('div', { class: 'ptop' },
        el('span', { class: 'pname', text: p.projectPath ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName }),
        ...issueBadges(p),
        el('span', { style: 'margin-left:auto;font-size:11px;color:var(--text-faint)', text: `${p.sessionCount} chat${p.sessionCount === 1 ? '' : 's'}` })));

      if (orphan) {
        node.appendChild(el('div', { class: 'pdesc' }, 'The project folder is gone from this machine:'));
        node.appendChild(el('div', { class: 'ppath gone' }, pathText(p.projectPath || '(unknown)')));
      }
      if (mismatch) {
        node.appendChild(el('div', { class: 'pdesc' },
          'The chat folder name doesn\u2019t match the path recorded inside it, so the extension will never look here. ',
          `It should be named ${p.expectedFolderName || '?'}.`));
        node.appendChild(el('div', { class: 'ppath' }, pathText(p.folderName)));
      }
      if (p.issues.includes('unknown-path')) {
        node.appendChild(el('div', { class: 'pdesc' }, 'No cwd was recorded in these files, so the original path can\u2019t be recovered automatically.'));
      }
      if (p.issues.includes('ambiguous')) {
        node.appendChild(el('div', { class: 'pdesc' },
          'Chats from more than one project share this folder \u2014 their paths encode to the same name. ',
          'This happens when folder names differ only in non-Latin characters of the same length. ',
          'Relocating moves only the chats recorded against the path below.'));
        for (const c of p.rootCandidates || []) {
          node.appendChild(el('div', { class: 'ppath' }, pathText(c.path), ` \u00b7 ${fmtNum(c.count)} records`));
        }
      }

      node.appendChild(el('div', { style: 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap' },
        el('button', { class: 'btn primary', type: 'button', text: 'Relocate…', onclick: () => relocateDialog(p.folderName) }),
        mismatch && p.expectedFolderName ? el('button', {
          class: 'btn', type: 'button', text: 'Fix the name only',
          onclick: () => applyRelocate(p.folderName, p.projectPath, true),
        }) : null,
        el('button', { class: 'btn', type: 'button', text: 'Open chats', onclick: () => { state.open.add(p.folderName); renderSidebar(); } }),
        openButton(p, 'btn')));

      sheet.appendChild(node);
    }
  }

  sheet.appendChild(el('h2', { text: 'All projects' }));
  const rows = state.projects.map((p) => el('tr', {},
    el('td', {}, el('b', { text: p.projectPath ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName }),
      el('div', { class: 'mono', style: 'color:var(--text-faint)', text: p.projectPath || '(unknown path)' })),
    el('td', { class: 'num', text: p.sessionCount }),
    el('td', { class: 'num', text: fmtBytes(p.totalSize) }),
    el('td', { text: fmtDate(p.lastActivity) }),
    el('td', {}, p.healthy ? el('span', { style: 'color:var(--ok)', text: 'ok' }) : el('span', {}, ...issueBadges(p))),
    el('td', {}, el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap' },
      openButton(p),
      el('button', { class: 'btn tiny', type: 'button', text: 'Relocate…', onclick: () => relocateDialog(p.folderName) })))));

  sheet.appendChild(el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {},
      el('th', { text: 'Project' }), el('th', { class: 'num', text: 'Chats' }),
      el('th', { class: 'num', text: 'Size' }), el('th', { text: 'Last used' }),
      el('th', { text: 'State' }), el('th', {}))),
    el('tbody', {}, ...rows)));

  main.replaceChildren(sheet);
}

// ------------------------------------------------------------- session ----

async function openSession(folder, sessionId) {
  state.current = { folder, sessionId };
  renderSidebar();

  const main = $('#main');
  main.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'spin' })));

  let data;
  try {
    data = await api(`/api/session/${encodeURIComponent(folder)}/${encodeURIComponent(sessionId)}`);
  } catch (e) {
    main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message })));
    return;
  }

  state.session = data.session;
  const s = data.session;
  const project = state.projects.find((p) => p.folderName === folder);

  const sheet = el('div', { class: 'sheet' });

  // --- header ---
  const head = el('div', { class: 'chathead' });
  head.appendChild(el('h1', { text: s.title || sessionId }));

  const pathRow = el('div', { class: 'chatpath' }, pathText(s.projectPath || '(project path not recorded)'));
  if (project && !project.projectExists) pathRow.appendChild(el('span', { class: 'warnflag', text: '· folder missing' }));
  if (project && !project.folderNameMatchesCwd) pathRow.appendChild(el('span', { class: 'warnflag', text: '· hidden from the extension' }));
  head.appendChild(pathRow);

  const st = s.stats || {};
  const facts = [
    ['Started', fmtDate(s.startedAt)],
    ['Duration', fmtDuration(s.durationMs)],
    ['You', fmtNum(st.humanTurns)],
    ['Claude', fmtNum(st.assistantTurns)],
    ['Tools', fmtNum(st.toolCalls)],
    ['Output tokens', fmtNum(st.tokens && st.tokens.output)],
    st.apiErrors ? ['API errors', fmtNum(st.apiErrors)] : null,
  ].filter(Boolean).filter(([, v]) => v);
  head.appendChild(el('ul', { class: 'facts' },
    ...facts.map(([k, v]) => el('li', { class: 'fact' }, k + ' ', el('b', { text: v })))));

  const base = `/api/export/${encodeURIComponent(folder)}/${encodeURIComponent(sessionId)}`;
  head.appendChild(el('div', { class: 'chatactions' },
    el('button', { class: 'btn', type: 'button', text: 'Expand all', onclick: () => $$('.transcript details').forEach((d) => (d.open = true)) }),
    el('button', { class: 'btn', type: 'button', text: 'Collapse all', onclick: () => $$('.transcript details').forEach((d) => (d.open = false)) }),
    el('label', { class: 'checkline', style: 'margin-left:6px' },
      el('input', {
        type: 'checkbox', checked: state.showContext,
        onchange: (e) => { state.showContext = e.target.checked; applyContextFilter(); },
      }), 'Show context events'),
    el('div', { class: 'spacer' }),
    project ? openButton(project, 'btn') : null,
    el('button', { class: 'btn', type: 'button', text: 'Stats', onclick: () => statsDialog(s) }),
    el('div', { class: 'sep' }),
    el('a', { class: 'btn', href: base + '.html', download: '', text: 'HTML' }),
    el('a', { class: 'btn', href: base + '.md', download: '', text: 'Markdown' }),
    el('a', { class: 'btn', href: base + '.jsonl', download: '', text: 'Raw' }),
    el('button', {
      class: 'btn', type: 'button', text: 'Print / PDF',
      onclick: () => window.open(`/api/print/${encodeURIComponent(folder)}/${encodeURIComponent(sessionId)}`, '_blank'),
    }),
    el('div', { class: 'sep' }),
    el('button', { class: 'btn primary', type: 'button', text: 'Relocate…', onclick: () => relocateDialog(folder) })));

  sheet.appendChild(head);

  if (s.parseErrors && s.parseErrors.length) {
    sheet.appendChild(el('div', { class: 'alert warn' },
      `${s.parseErrors.length} line(s) in this file could not be parsed and were skipped. The rest of the chat is intact.`));
  }

  const transcript = el('main', { class: 'transcript', id: 'transcript' });
  sheet.appendChild(transcript);
  main.replaceChildren(sheet);
  main.scrollTop = 0;

  // --- transcript, appended in chunks so a 600-turn chat stays responsive ---
  const turns = data.turns;
  let i = 0;
  function chunk() {
    const frag = document.createDocumentFragment();
    const end = Math.min(i + 40, turns.length);
    for (; i < end; i++) {
      const holder = el('div');
      holder.innerHTML = turns[i].html;
      while (holder.firstChild) frag.appendChild(holder.firstChild);
    }
    transcript.appendChild(frag);
    applyContextFilter();
    if (i < turns.length) requestAnimationFrame(chunk);
    else if (pendingJump != null) { jumpToTurn(pendingJump); pendingJump = null; }
  }
  chunk();
}

let pendingJump = null;

function applyContextFilter() {
  $$('#transcript .turn.system[data-cat="context"]').forEach((n) => {
    n.style.display = state.showContext ? '' : 'none';
  });
}

function jumpToTurn(index) {
  const node = document.getElementById('t' + index);
  if (!node) return;
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
  if (!q) {
    if (state.current) openSession(state.current.folder, state.current.sessionId);
    else renderDashboard();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 220);
}

async function runSearch(q) {
  const main = $('#main');
  main.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'spin' })));
  let data;
  try {
    data = await api('/api/search?q=' + encodeURIComponent(q));
  } catch (e) {
    main.replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message })));
    return;
  }

  const sheet = el('div', { class: 'sheet dash' });
  sheet.appendChild(el('h1', { text: 'Search' }));
  sheet.appendChild(el('p', { class: 'lede' },
    data.totalMatches
      ? `${fmtNum(data.totalMatches)} match${data.totalMatches === 1 ? '' : 'es'} across ${data.results.length} chat${data.results.length === 1 ? '' : 's'}.`
      : `Nothing matched \u201C${q}\u201D.`));

  if (data.error) sheet.appendChild(el('div', { class: 'alert err', text: data.error }));

  for (const r of data.results) {
    const group = el('div', { class: 'hitgroup' });
    group.appendChild(el('header', {},
      el('h3', { text: r.title || r.sessionId }),
      ...(r.issues || []).includes('orphaned') ? [el('span', { class: 'badge orphan', text: 'missing' })] : [],
      el('span', { class: 'gmeta', text: `${r.hits.length} hit${r.hits.length === 1 ? '' : 's'} · ${fmtDate(r.endedAt)}` })));

    for (const h of r.hits.slice(0, 12)) {
      const marked = esc(h.text).replace(esc(h.hit), (m) => `<mark>${m}</mark>`);
      group.appendChild(el('button', {
        class: 'hit', type: 'button',
        onclick: () => {
          pendingJump = h.turnIndex;
          openSession(r.folderName, r.sessionId);
        },
      },
        el('span', { html: `<span class="hkind">${esc(h.label || h.kind)}</span><span class="htext">${marked}</span>` })));
    }
    if (r.hits.length > 12) {
      group.appendChild(el('div', { style: 'padding:7px 13px;font-size:11.5px;color:var(--text-faint)', text: `…${r.hits.length - 12} more in this chat` }));
    }
    sheet.appendChild(group);
  }

  main.replaceChildren(sheet);
}

// ---------------------------------------------------------- relocation ----

function readoutLine(k, v, cls) {
  return el('div', { class: 'line' },
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v ' + (cls || '') }, pathText(v)));
}

async function relocateDialog(folderName) {
  const project = state.projects.find((p) => p.folderName === folderName);
  if (!project) return;

  const input = el('input', {
    type: 'text', value: project.projectPath || '',
    placeholder: 'D:\\Files\\Projects\\MyApp', spellcheck: 'false',
  });
  const preview = el('div', { class: 'readout' });
  const planBox = el('div');
  const applyBtn = el('button', { class: 'btn primary', type: 'button', text: 'Relocate', disabled: true });
  const backupChk = el('input', { type: 'checkbox', checked: true });

  let currentPlan = null;

  async function refreshPreview() {
    const v = input.value.trim();
    preview.replaceChildren();
    planBox.replaceChildren();
    applyBtn.disabled = true;
    currentPlan = null;
    if (!v) return;

    let info;
    try { info = await api('/api/fs/exists?path=' + encodeURIComponent(v)); }
    catch { return; }

    preview.appendChild(readoutLine('Chat folder', project.folderName, 'old'));
    preview.appendChild(readoutLine('becomes', info.encoded || '?', info.encoded === project.folderName ? 'same' : 'new'));
    preview.appendChild(readoutLine('Project', info.path, info.exists ? 'new' : 'old'));
    if (!info.absolute) {
      preview.appendChild(el('div', { class: 'alert err', style: 'margin:10px 0 0', text: 'That is not an absolute path.' }));
      return;
    }
    if (!info.exists) {
      preview.appendChild(el('div', { class: 'alert warn', style: 'margin:10px 0 0', text: 'No folder exists at that path yet.' }));
    }
    // Non-Latin paths turn one character into one dash, so names grow fast and
    // near-identical names can collide. Say so while they are still typing.
    if (info.normalizationDiffers) {
      preview.appendChild(el('div', { class: 'alert warn', style: 'margin:10px 0 0' },
        'Some characters here can be written more than one way in Unicode, and the spelling you typed produces a different folder name than its normalised form. Use Browse so the path is read straight from disk.'));
    }
    if (info.encodedLength > 255) {
      preview.appendChild(el('div', { class: 'alert err', style: 'margin:10px 0 0' },
        `That path produces a ${info.encodedLength}-character folder name, past the 255-character limit.`));
    } else if (info.storePathLength > 247) {
      preview.appendChild(el('div', { class: 'alert warn', style: 'margin:10px 0 0' },
        `The chat folder path would be ${info.storePathLength} characters. Windows caps paths at 260 unless long paths are enabled, and session files add about 43 more.`));
    } else if (info.nonAscii) {
      preview.appendChild(el('div', { class: 'alert info', style: 'margin:10px 0 0' },
        `Non-Latin characters each become one dash, so this name is ${info.encodedLength} characters. That is expected and matches what the extension computes.`));
    }
  }

  async function runPlan() {
    const v = input.value.trim();
    if (!v) return;
    planBox.replaceChildren(el('div', { class: 'sidenote', html: '<span class="spin"></span>' }));
    try {
      const plan = await jpost('/api/relocate/plan', { folder: folderName, newPath: v });
      currentPlan = plan;
      planBox.replaceChildren(renderPlan(plan));
      applyBtn.disabled = !plan.ok;
    } catch (e) {
      planBox.replaceChildren(el('div', { class: 'alert err', text: e.message }));
    }
  }

  function renderPlan(plan) {
    const box = el('div');
    if (plan.errors.length) {
      box.appendChild(el('div', { class: 'alert err' },
        el('b', { text: 'Cannot relocate' }),
        el('ul', {}, ...plan.errors.map((x) => el('li', { text: x })))));
    }
    if (plan.warnings.length) {
      box.appendChild(el('div', { class: 'alert warn' },
        el('ul', {}, ...plan.warnings.map((x) => el('li', { text: x })))));
    }
    if (!plan.errors.length) {
      const bits = [];
      if (plan.folderRenameNeeded) bits.push(`rename the folder to ${plan.newFolderName}`);
      if (plan.totalCwdRewrites) bits.push(`rewrite ${fmtNum(plan.totalCwdRewrites)} cwd value${plan.totalCwdRewrites === 1 ? '' : 's'} across ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}`);
      box.appendChild(el('div', { class: 'alert ok' },
        el('b', { text: 'Ready' }),
        el('div', { text: bits.length ? 'This will ' + bits.join(', and ') + '.' : 'Nothing needs to change.' })));
      if (plan.totalHistoricalRefs) {
        box.appendChild(el('div', { class: 'alert info' },
          `${fmtNum(plan.totalHistoricalRefs)} other mention${plan.totalHistoricalRefs === 1 ? '' : 's'} of the old path (inside tool output and edit snippets) stay as they are \u2014 they are a record of what happened at the time, not settings.`));
      }
    }
    return box;
  }

  const node = modal({
    title: 'Relocate chats',
    sub: 'Point this chat folder at wherever the project lives now. The folder is renamed and the paths recorded inside are updated to match.',
    body: el('div', {},
      el('div', { class: 'readout' },
        readoutLine('Folder', project.folderName),
        readoutLine('Recorded path', project.projectPath || '(none)', project.projectExists ? '' : 'old'),
        readoutLine('Chats', `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}, ${fmtBytes(project.totalSize)}`)),
      el('div', { class: 'field' },
        el('label', { text: 'New project location' }),
        el('div', { class: 'row' },
          input,
          el('button', {
            class: 'btn', type: 'button', text: 'Browse…',
            onclick: async () => {
              const p = await pickPath(project.projectPath, 'Where is this project now?');
              if (p) { input.value = p; refreshPreview(); runPlan(); }
            },
          })),
        el('div', { class: 'hint' }, 'The chat folder name is derived from this path: the drive letter is lowercased and every non-alphanumeric character becomes a dash.')),
      preview,
      planBox),
    foot: [
      el('label', { class: 'checkline' }, backupChk, 'Back up first'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', { class: 'btn', type: 'button', text: 'Preview changes', onclick: runPlan }),
      applyBtn,
    ],
  });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<span class="spin"></span> Relocating';
    try {
      const out = await jpost('/api/relocate/apply', {
        folder: folderName, newPath: input.value.trim(), backup: backupChk.checked,
      });
      closeModal(node);
      toast(
        `${out.result.oldFolderName} \u2192 ${out.result.newFolderName}` +
        (out.result.cwdRewrites ? ` · ${fmtNum(out.result.cwdRewrites)} paths updated` : ''),
        'ok', 'Relocated');
      state.current = null;
      await refresh();
    } catch (e) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Relocate';
      planBox.replaceChildren(el('div', { class: 'alert err', text: e.message }));
    }
  });

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(refreshPreview, 200); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPlan(); } });

  openModal(node);
  refreshPreview();
}

/** Rename-only fix for a folder whose name no longer matches its recorded cwd. */
async function applyRelocate(folderName, targetPath, silent) {
  try {
    const out = await jpost('/api/relocate/apply', { folder: folderName, newPath: targetPath, backup: true });
    toast(`Renamed to ${out.result.newFolderName}`, 'ok', 'Fixed');
    await refresh();
  } catch (e) {
    toast(e.message, 'err', 'Could not fix');
  }
}

// ---------------------------------------------------------- bulk remap ----

async function bulkDialog() {
  const oldIn = el('input', { type: 'text', placeholder: 'D:\\Files\\Projects', spellcheck: 'false' });
  const newIn = el('input', { type: 'text', placeholder: 'E:\\Dev', spellcheck: 'false' });
  const out = el('div');
  const applyBtn = el('button', { class: 'btn primary', type: 'button', text: 'Apply to all', disabled: true });

  // A sensible default: the deepest folder every project currently shares.
  const paths = state.projects.map((p) => p.projectPath).filter(Boolean);
  if (paths.length > 1) {
    const split = paths.map((p) => p.split(/[\\/]/));
    const common = [];
    for (let i = 0; i < split[0].length; i++) {
      const seg = split[0][i];
      if (split.every((s) => (s[i] || '').toLowerCase() === seg.toLowerCase())) common.push(seg);
      else break;
    }
    if (common.length > 1) oldIn.value = common.join('\\');
  }

  async function plan() {
    out.replaceChildren(el('div', { class: 'sidenote', html: '<span class="spin"></span>' }));
    applyBtn.disabled = true;
    try {
      const p = await jpost('/api/relocate/bulk/plan', { oldPrefix: oldIn.value.trim(), newPrefix: newIn.value.trim() });
      const box = el('div');
      if (p.errors.length) {
        box.appendChild(el('div', { class: 'alert err' }, el('ul', {}, ...p.errors.map((x) => el('li', { text: x })))));
      }
      if (!p.matches.length) {
        box.appendChild(el('div', { class: 'alert warn', text: 'No chat folders are recorded under that prefix.' }));
      } else {
        box.appendChild(el('div', { class: 'alert ok' },
          `${p.matches.length} folder${p.matches.length === 1 ? '' : 's'} will move, rewriting ${fmtNum(p.totalCwdRewrites)} recorded paths.`));
        box.appendChild(el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Chat folder' }), el('th', { text: 'New name' }), el('th', { class: 'num', text: 'Paths' }))),
          el('tbody', {}, ...p.matches.map((m) => el('tr', {},
            el('td', { class: 'mono' }, m.oldFolderName, el('div', { style: 'color:var(--text-faint)', text: m.oldProjectPath })),
            el('td', { class: 'mono' }, el('b', { text: m.newFolderName }), el('div', { style: 'color:var(--ok)', text: m.newProjectPath })),
            el('td', { class: 'num', text: fmtNum(m.totalCwdRewrites) }))))));
      }
      if (p.skipped.length) {
        box.appendChild(el('div', { style: 'margin-top:10px;font-size:11.5px;color:var(--text-faint)' },
          `${p.skipped.length} folder${p.skipped.length === 1 ? '' : 's'} left alone (not under that prefix).`));
      }
      out.replaceChildren(box);
      applyBtn.disabled = !(p.ok && p.matches.length);
    } catch (e) {
      out.replaceChildren(el('div', { class: 'alert err', text: e.message }));
    }
  }

  const node = modal({
    title: 'Bulk remap',
    wide: true,
    sub: 'You moved a whole projects directory, or copied everything to a new machine. Give the old and new parent folder and every chat underneath is repointed at once.',
    body: el('div', {},
      el('div', { class: 'field' },
        el('label', { text: 'Old parent folder' }),
        el('div', { class: 'row' }, oldIn,
          el('button', { class: 'btn', type: 'button', text: 'Browse…', onclick: async () => { const p = await pickPath(oldIn.value); if (p) oldIn.value = p; } }))),
      el('div', { class: 'field' },
        el('label', { text: 'New parent folder' }),
        el('div', { class: 'row' }, newIn,
          el('button', { class: 'btn', type: 'button', text: 'Browse…', onclick: async () => { const p = await pickPath(newIn.value); if (p) newIn.value = p; } })),
        el('div', { class: 'hint' }, 'Sub-paths are preserved: a project two levels down keeps its position under the new parent.')),
      out),
    foot: [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', { class: 'btn', type: 'button', text: 'Preview', onclick: plan }),
      applyBtn,
    ],
  });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<span class="spin"></span> Working';
    try {
      const r = await jpost('/api/relocate/bulk/apply', { oldPrefix: oldIn.value.trim(), newPrefix: newIn.value.trim(), backup: true });
      closeModal(node);
      toast(`${r.results.length} folder(s) relocated.`, 'ok', 'Bulk remap done');
      state.current = null;
      await refresh();
    } catch (e) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply to all';
      out.replaceChildren(el('div', { class: 'alert err', text: e.message }));
    }
  });

  openModal(node);
}

// ------------------------------------------------------------- archives ---

function downloadArchive(folders) {
  const q = folders && folders.length ? '?folders=' + encodeURIComponent(folders.join(',')) : '';
  window.location.href = '/api/archive/export' + q;
  toast('Building the archive… your download will start shortly.', '', 'Archive');
}

function archiveDialog() {
  const checks = state.projects.map((p) => ({
    p, input: el('input', { type: 'checkbox', checked: true }),
  }));
  const node = modal({
    title: 'Export a portable archive',
    sub: 'A zip of the chat folders plus a manifest recording each project\u2019s absolute path. Import it on another machine and the folders are rebuilt with the right names.',
    body: el('div', {},
      el('div', { style: 'display:flex;gap:6px;margin-bottom:12px' },
        el('button', { class: 'btn tiny', type: 'button', text: 'All', onclick: () => checks.forEach((c) => (c.input.checked = true)) }),
        el('button', { class: 'btn tiny', type: 'button', text: 'None', onclick: () => checks.forEach((c) => (c.input.checked = false)) })),
      el('div', { class: 'maplist' },
        ...checks.map(({ p, input }) => el('label', { class: 'maprow', style: 'display:flex;gap:10px;align-items:center;cursor:pointer' },
          input,
          el('div', { style: 'min-width:0' },
            el('div', { class: 'mname', text: p.projectPath ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() : p.folderName }),
            el('div', { class: 'morig' }, pathText(p.projectPath || p.folderName), ` · ${p.sessionCount} chats · ${fmtBytes(p.totalSize)}`)))))),
    foot: [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', {
        class: 'btn primary', type: 'button', text: 'Download zip',
        onclick: () => {
          const picked = checks.filter((c) => c.input.checked).map((c) => c.p.folderName);
          if (!picked.length) return toast('Nothing selected.', 'warn');
          closeModal(node);
          downloadArchive(picked.length === state.projects.length ? [] : picked);
        },
      }),
    ],
  });
  openModal(node);
}

function importDialog() {
  const file = el('input', { type: 'file', accept: '.zip,application/zip' });
  const out = el('div');
  const nextBtn = el('button', { class: 'btn primary', type: 'button', text: 'Inspect archive', disabled: true });

  file.addEventListener('change', () => { nextBtn.disabled = !file.files.length; });

  const node = modal({
    title: 'Import chats from an archive',
    wide: true,
    sub: 'Pick a zip made by this tool \u2014 or any zip of chat folders. You\u2019ll be shown the path each project had on its old machine and asked where it lives now.',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Archive' }), el('div', { class: 'row' }, file)),
      out),
    foot: [el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }), nextBtn],
  });

  nextBtn.addEventListener('click', async () => {
    if (!file.files.length) return;
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<span class="spin"></span> Reading';
    try {
      const info = await api('/api/archive/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file.files[0],
      });
      showImportMapping(node, info);
    } catch (e) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Inspect archive';
      out.replaceChildren(el('div', { class: 'alert err', text: e.message }));
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
        el('span', { style: 'font-size:11px;color:var(--text-faint)', text: `${p.sessionCount} chat${p.sessionCount === 1 ? '' : 's'}` }),
        p.collides ? el('span', { class: 'badge mismatch', text: 'already here' }) : null,
        el('label', { class: 'checkline', style: 'margin-left:auto' }, skip, 'Skip')),
      el('div', { class: 'morig' }, 'was: ', pathText(p.originalPath || 'unknown')),
      el('div', { class: 'row', style: 'margin-top:8px' },
        input,
        el('button', {
          class: 'btn', type: 'button', text: 'Browse…',
          onclick: async () => { const v = await pickPath(input.value); if (v) input.value = v; },
        })));
    skip.addEventListener('change', () => row.classList.toggle('skip', skip.checked));
    return { p, input, skip, row };
  });

  const body = el('div', {});
  if (info.manifest) {
    body.appendChild(el('div', { class: 'alert info' },
      `Archive from ${info.manifest.sourceHost || 'another machine'} (${info.manifest.sourcePlatform || '?'}), exported ${fmtDate(info.manifest.exportedAt)}.`));
  } else {
    body.appendChild(el('div', { class: 'alert warn' },
      'No manifest in this zip, so the original paths were recovered from the cwd fields inside the chat files.'));
  }
  body.appendChild(el('div', { class: 'maplist' }, ...rows.map((r) => r.row)));

  node.bodyEl.replaceChildren(body);
  node.footEl.replaceChildren(
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
    el('button', {
      class: 'btn primary', type: 'button', text: 'Import',
      onclick: async function () {
        this.disabled = true;
        this.innerHTML = '<span class="spin"></span> Importing';
        try {
          const r = await jpost('/api/archive/apply', {
            stagingId: info.stagingId,
            mappings: rows.map(({ p, input, skip }) => ({
              folderName: p.folderName,
              originalPath: p.originalPath,
              newProjectPath: input.value.trim(),
              skip: skip.checked,
            })),
          });
          closeModal(node);
          if (r.results.length) toast(`${r.results.length} project(s) imported.`, 'ok', 'Import complete');
          if (r.errors.length) r.errors.forEach((e) => toast(e, 'err', 'Skipped'));
          await refresh();
        } catch (e) {
          this.disabled = false;
          this.textContent = 'Import';
          node.bodyEl.prepend(el('div', { class: 'alert err', text: e.message }));
        }
      },
    }));
}

// -------------------------------------------------------------- history ---

async function historyDialog() {
  const body = el('div', {}, el('div', { class: 'sidenote', html: '<span class="spin"></span>' }));
  const node = modal({
    title: 'Relocation history',
    sub: 'Every relocation is backed up before it runs. Undo restores the folder exactly as it was.',
    body,
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => closeModal(node) })],
  });
  openModal(node);

  async function load() {
    let data;
    try { data = await api('/api/history'); }
    catch (e) { body.replaceChildren(el('div', { class: 'alert err', text: e.message })); return; }

    if (!data.history.length) {
      body.replaceChildren(el('div', { class: 'sidenote', text: 'Nothing relocated yet.' }));
      return;
    }

    body.replaceChildren(...data.history.map((h) => el('div', { class: 'hentry' + (h.undoneAt ? ' undone' : '') },
      el('div', { class: 'htop' },
        el('b', { text: h.newProjectPath ? h.newProjectPath.split(/[\\/]/).filter(Boolean).pop() : h.folderName }),
        h.undoneAt ? el('span', { class: 'badge empty', text: 'undone' }) : null,
        el('span', { class: 'hwhen', text: fmtDate(h.at) })),
      el('div', { class: 'harrow' }, h.oldFolderName, ' \u2192 ', el('span', { class: 'to', text: h.newFolderName })),
      el('div', { style: 'font-size:11.5px;color:var(--text-faint);margin-top:4px' },
        `${fmtNum(h.cwdRewrites)} paths rewritten` + (h.backupDir ? '' : ' · backup removed')),
      el('div', { style: 'margin-top:9px;display:flex;gap:6px' },
        !h.undoneAt && h.backupDir ? el('button', {
          class: 'btn tiny', type: 'button', text: 'Undo',
          onclick: async function () {
            this.disabled = true;
            try {
              await jpost(`/api/history/${encodeURIComponent(h.id)}/undo`, {});
              toast('Restored from backup.', 'ok', 'Undone');
              state.current = null;
              await refresh();
              await load();
            } catch (e) { this.disabled = false; toast(e.message, 'err', 'Undo failed'); }
          },
        }) : null,
        h.backupDir ? el('button', {
          class: 'btn tiny danger', type: 'button', text: 'Delete backup',
          onclick: async function () {
            if (!confirm('Delete this backup? The relocation can no longer be undone.')) return;
            try { await jpost(`/api/history/${encodeURIComponent(h.id)}/forget`, {}); await load(); }
            catch (e) { toast(e.message, 'err'); }
          },
        }) : null))));
  }
  load();
}

// ---------------------------------------------------------------- stats ---

function statsDialog(s) {
  const st = s.stats || {};
  const tk = st.tokens || {};
  const tools = Object.entries(st.tools || {}).sort((a, b) => b[1] - a[1]);
  const models = Object.keys(st.models || {}).filter((m) => m && m !== '<synthetic>');

  const node = modal({
    title: 'Session statistics',
    sub: s.title,
    body: el('div', {},
      el('div', { class: 'cards' },
        el('div', { class: 'card' }, el('div', { class: 'num', text: fmtNum(st.humanTurns) }), el('div', { class: 'lbl', text: 'your messages' })),
        el('div', { class: 'card' }, el('div', { class: 'num', text: fmtNum(st.assistantTurns) }), el('div', { class: 'lbl', text: 'replies' })),
        el('div', { class: 'card' }, el('div', { class: 'num', text: fmtNum(st.toolCalls) }), el('div', { class: 'lbl', text: 'tool calls' })),
        el('div', { class: 'card' + (st.apiErrors ? ' bad' : '') }, el('div', { class: 'num', text: fmtNum(st.apiErrors) }), el('div', { class: 'lbl', text: 'api errors' }))),

      el('h2', { style: 'font-size:14px;margin:18px 0 8px', text: 'Tokens' }),
      el('table', { class: 'tbl' }, el('tbody', {},
        el('tr', {}, el('td', { text: 'Output' }), el('td', { class: 'num', text: fmtNum(tk.output) })),
        el('tr', {}, el('td', { text: 'Input' }), el('td', { class: 'num', text: fmtNum(tk.input) })),
        el('tr', {}, el('td', { text: 'Cache reads' }), el('td', { class: 'num', text: fmtNum(tk.cacheRead) })),
        el('tr', {}, el('td', { text: 'Cache writes' }), el('td', { class: 'num', text: fmtNum(tk.cacheCreation) })))),

      tools.length ? el('h2', { style: 'font-size:14px;margin:18px 0 8px', text: 'Tools used' }) : null,
      tools.length ? el('table', { class: 'tbl' }, el('tbody', {},
        ...tools.map(([n, c]) => el('tr', {}, el('td', { text: n }), el('td', { class: 'num', text: fmtNum(c) }))))) : null,

      el('h2', { style: 'font-size:14px;margin:18px 0 8px', text: 'Details' }),
      el('div', { class: 'readout' },
        readoutLine('Session', s.sessionId),
        readoutLine('Project', s.projectPath || '(none)'),
        models.length ? readoutLine('Model', models.join(', ')) : null,
        s.gitBranch ? readoutLine('Branch', s.gitBranch) : null,
        readoutLine('Duration', fmtDuration(s.durationMs) || '\u2014'),
        readoutLine('File size', fmtBytes(s.sizeBytes)),
        readoutLine('Thinking', `${fmtNum(st.thinkingBlocks)} block(s)` + (st.redactedThinking ? ' \u2014 text not stored on disk' : ''))),

      st.filesTouched && st.filesTouched.length ? el('div', {},
        el('h2', { style: 'font-size:14px;margin:18px 0 8px', text: `Files changed (${st.filesTouched.length})` }),
        el('ul', { class: 'filelist' }, ...st.filesTouched.slice(0, 60).map((f) => el('li', { text: f.path })))) : null),
    foot: [el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => closeModal(node) })],
  });
  openModal(node);
}

// ----------------------------------------------------------------- root ---

async function rootDialog() {
  const info = await api('/api/root');
  const input = el('input', { type: 'text', value: info.root, spellcheck: 'false' });
  const node = modal({
    title: 'Chat store location',
    sub: 'Normally ~/.claude/projects. Point this somewhere else to work on a copy \u2014 for example a folder restored from an old machine.',
    body: el('div', {},
      el('div', { class: 'field' },
        el('label', { text: 'Folder' }),
        el('div', { class: 'row' }, input,
          el('button', { class: 'btn', type: 'button', text: 'Browse…', onclick: async () => { const p = await pickPath(input.value); if (p) input.value = p; } })),
        el('div', { class: 'hint' }, 'Default: ', el('code', { text: info.default })),
        el('div', { class: 'hint' }, 'Backups are kept in ', el('code', { text: info.appData }))),
      el('div', { style: 'display:flex;gap:6px' },
        el('button', { class: 'btn tiny', type: 'button', text: 'Use default', onclick: () => { input.value = info.default; } }),
        el('button', { class: 'btn tiny', type: 'button', text: 'Open in file manager', onclick: () => jpost('/api/fs/reveal', { path: input.value }).catch((e) => toast(e.message, 'err')) }))),
    foot: [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => closeModal(node) }),
      el('button', {
        class: 'btn primary', type: 'button', text: 'Use this folder',
        onclick: async function () {
          this.disabled = true;
          try {
            await jpost('/api/root', { dir: input.value.trim() });
            closeModal(node);
            state.current = null;
            await refresh();
            toast('Store changed.', 'ok');
          } catch (e) { this.disabled = false; toast(e.message, 'err'); }
        },
      }),
    ],
  });
  openModal(node);
}

// ----------------------------------------------------------------- boot ---

async function refresh() {
  const [data, eds] = await Promise.all([
    api('/api/projects?force=1'),
    api('/api/editors').catch(() => ({ editors: [] })),
  ]);
  state.editors = eds.editors || [];
  state.root = data.root;
  state.projects = data.projects;
  state.counts = data.counts;
  $('#rootPath').replaceChildren(pathText(data.root));
  $('#rootPath').setAttribute('title', data.root);

  renderFilters();
  renderSidebar();

  if (!data.exists) {
    $('#main').replaceChildren(el('div', { class: 'empty' },
      el('p', { text: 'No chat store at ' + data.root }),
      el('button', { class: 'btn primary', type: 'button', text: 'Choose a folder…', onclick: rootDialog })));
    return;
  }
  if (state.current) {
    const still = state.projects.some((p) => p.folderName === state.current.folder);
    if (!still) state.current = null;
  }
  if (state.current) openSession(state.current.folder, state.current.sessionId);
  else if (!state.searchQuery) renderDashboard();
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('ccx-theme'); } catch {}
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const root = document.documentElement;
  const now = root.getAttribute('data-theme');
  const next = now === 'dark' ? 'light' : now === 'light' ? '' : 'dark';
  if (next) root.setAttribute('data-theme', next);
  else root.removeAttribute('data-theme');
  try { next ? localStorage.setItem('ccx-theme', next) : localStorage.removeItem('ccx-theme'); } catch {}
}

function init() {
  initTheme();
  $('#search').addEventListener('input', onSearchInput);
  $('#rootBtn').addEventListener('click', rootDialog);
  $('#bulkBtn').addEventListener('click', bulkDialog);
  $('#importBtn').addEventListener('click', importDialog);
  $('#exportAllBtn').addEventListener('click', archiveDialog);
  $('#historyBtn').addEventListener('click', historyDialog);
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#refreshBtn').addEventListener('click', () => refresh().then(() => toast('Rescanned.', 'ok')));
  $$('#filters .chip').forEach((c) => c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    renderFilters();
    renderSidebar();
  }));

  // Copy buttons inside rendered transcripts.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.hasAttribute('data-copy')) return;
    const wrap = t.closest('.codewrap');
    const code = wrap && wrap.querySelector('code');
    if (!code) return;
    navigator.clipboard.writeText(code.innerText).then(() => {
      const was = t.textContent;
      t.textContent = 'Copied';
      setTimeout(() => { t.textContent = was; }, 1200);
    }, () => toast('Could not copy to the clipboard.', 'err'));
  });

  refresh().catch((e) => {
    $('#main').replaceChildren(el('div', { class: 'empty' }, el('p', { text: e.message })));
  });
}

init();
