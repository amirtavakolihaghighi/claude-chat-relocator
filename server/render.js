'use strict';
const { marked } = require('marked');
const hljs = require('highlight.js');
const { basename } = require('./parser');

/**
 * Renders parsed transcript turns to HTML. One implementation feeds both the
 * live viewer and the self-contained HTML export, so what you read on screen
 * and what you export are guaranteed identical.
 */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) { return escapeHtml(s); }

/** Map a file extension to a highlight.js language name. */
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', jsonl: 'json',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', sql: 'sql', php: 'php', swift: 'swift',
  kt: 'kotlin', dart: 'dart', lua: 'lua', r: 'r', pl: 'perl',
};

function langForFile(filePath) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(filePath || ''));
  if (!m) return null;
  return EXT_LANG[m[1].toLowerCase()] || null;
}

function highlight(code, lang) {
  const text = String(code == null ? '' : code);
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value; }
    catch { /* fall through to plain */ }
  }
  return escapeHtml(text);
}

// ---- markdown ------------------------------------------------------------
// Raw HTML in a transcript is shown as literal text, never injected: these are
// other people's messages and model output, and this viewer is not a browser.
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) { return escapeHtml(text); },
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0];
      const cls = language ? ` class="language-${escapeAttr(language)}"` : '';
      return `<div class="codewrap"><div class="codebar"><span>${escapeHtml(language || 'text')}</span>`
        + `<button class="copy" type="button" data-copy>Copy</button></div>`
        + `<pre><code${cls}>${highlight(text, language)}</code></pre></div>`;
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const safe = /^(https?:|mailto:|#|\/)/i.test(String(href || '')) ? href : '#';
      const t = title ? ` title="${escapeAttr(title)}"` : '';
      return `<a href="${escapeAttr(safe)}"${t} target="_blank" rel="noreferrer noopener">${inner}</a>`;
    },
  },
});

function md(text) {
  if (!text) return '';
  try { return marked.parse(String(text)); }
  catch { return `<p>${escapeHtml(text)}</p>`; }
}

// ---- pieces --------------------------------------------------------------

function codeBlock(text, lang, label) {
  const bar = label
    ? `<div class="codebar"><span>${escapeHtml(label)}</span><button class="copy" type="button" data-copy>Copy</button></div>`
    : '';
  return `<div class="codewrap">${bar}<pre><code>${highlight(text, lang)}</code></pre></div>`;
}

/** Render a structuredPatch as a real unified diff. */
function renderDiff(patch) {
  const rows = [];
  for (const hunk of patch || []) {
    rows.push(`<div class="hunk">@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@</div>`);
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const line of hunk.lines || []) {
      const ch = line[0];
      const body = line.slice(1);
      let cls = 'ctx', ln = '', rn = '';
      if (ch === '+') { cls = 'add'; rn = newNo++; }
      else if (ch === '-') { cls = 'del'; ln = oldNo++; }
      else { ln = oldNo++; rn = newNo++; }
      rows.push(
        `<div class="dl ${cls}">`
        + `<span class="no">${ln}</span><span class="no">${rn}</span>`
        + `<span class="sig">${ch === '+' ? '+' : ch === '-' ? '-' : ' '}</span>`
        + `<span class="txt">${escapeHtml(body)}</span></div>`
      );
    }
  }
  return `<div class="diff">${rows.join('')}</div>`;
}

function renderTodos(todos) {
  const icon = { completed: '&#10003;', in_progress: '&#9679;', pending: '&#9675;' };
  const items = (todos || []).map((t) => {
    const st = t.status || 'pending';
    const label = st === 'in_progress' && t.activeForm ? t.activeForm : (t.content || '');
    return `<li class="todo ${escapeAttr(st)}"><span class="tick">${icon[st] || '&#9675;'}</span>${escapeHtml(label)}</li>`;
  }).join('');
  return `<ul class="todos">${items}</ul>`;
}

/**
 * @param {object} opts.imageSrc  (ref, mediaType) => src string. Lets the live
 *   view lazy-load images by URL while the export inlines them as data URIs.
 */
function renderToolResult(res, opts) {
  if (!res) return '';
  switch (res.kind) {
    case 'pending':
      return `<div class="res none">No result recorded (session ended before the tool returned).</div>`;
    case 'none':
      return `<div class="res none">No output.</div>`;
    case 'diff': {
      const head = `<div class="reshead">${escapeHtml(res.filePath || '')}`
        + ` <span class="pill add">+${res.added}</span><span class="pill del">-${res.removed}</span></div>`;
      return `<div class="res">${head}${renderDiff(res.patch)}</div>`;
    }
    case 'shell': {
      const parts = [];
      if (res.stdout) parts.push(codeBlock(res.stdout, 'accesslog', 'stdout'));
      if (res.stderr) parts.push(`<div class="stderr">${codeBlock(res.stderr, 'accesslog', 'stderr')}</div>`);
      if (res.interrupted) parts.push(`<div class="note warn">Interrupted</div>`);
      if (!parts.length) parts.push(`<div class="res none">Completed with no output.</div>`);
      return `<div class="res">${parts.join('')}</div>`;
    }
    case 'todos':
      return `<div class="res">${renderTodos(res.todos)}</div>`;
    case 'file': {
      const head = res.filePath
        ? `<div class="reshead">${escapeHtml(res.filePath)}${res.numLines ? ` <span class="pill">${res.numLines} lines</span>` : ''}</div>`
        : '';
      return `<div class="res">${head}${codeBlock(res.content || '', langForFile(res.filePath), basename(res.filePath))}</div>`;
    }
    case 'list': {
      const items = (res.items || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('');
      const more = res.total && res.total > (res.items || []).length
        ? `<div class="note">${res.total - res.items.length} more not shown</div>` : '';
      return `<div class="res"><ul class="filelist">${items}</ul>${more}</div>`;
    }
    case 'images': {
      const imgs = (res.images || []).map((im) => {
        const src = opts.imageSrc(im.ref, im.mediaType);
        return `<figure class="shot"><img loading="lazy" src="${escapeAttr(src)}" alt="tool screenshot"></figure>`;
      }).join('');
      const txt = res.text ? codeBlock(res.text, null) : '';
      return `<div class="res">${imgs}${txt}</div>`;
    }
    case 'text':
      return `<div class="res">${codeBlock(res.text, null)}</div>`;
    case 'json':
      return `<div class="res">${codeBlock(JSON.stringify(res.json, null, 2), 'json')}</div>`;
    default:
      return '';
  }
}

/** The tool call's own arguments, shown above its result. */
function renderToolInput(name, input) {
  if (input == null) return '';
  if (name === 'Bash' || name === 'PowerShell') {
    return codeBlock(input.command || '', name === 'PowerShell' ? 'powershell' : 'bash', name === 'PowerShell' ? 'powershell' : 'bash');
  }
  if (name === 'Write') {
    return codeBlock(input.content || '', langForFile(input.file_path), basename(input.file_path));
  }
  if (name === 'Edit') {
    const o = input.old_string != null ? codeBlock(input.old_string, null, 'replace') : '';
    const n = input.new_string != null ? codeBlock(input.new_string, null, 'with') : '';
    return o + n;
  }
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    return renderTodos(input.todos);
  }
  const keys = Object.keys(input);
  if (!keys.length) return '';
  if (keys.length === 1 && typeof input[keys[0]] === 'string' && input[keys[0]].length < 200) {
    return `<div class="kv"><b>${escapeHtml(keys[0])}</b><span>${escapeHtml(input[keys[0]])}</span></div>`;
  }
  return codeBlock(JSON.stringify(input, null, 2), 'json', 'input');
}

const TOOL_ICON = {
  Read: '&#128196;', Write: '&#128221;', Edit: '&#9998;', Bash: '&#9002;',
  PowerShell: '&#9002;', Grep: '&#128269;', Glob: '&#128269;', TodoWrite: '&#9745;',
  WebSearch: '&#127760;', WebFetch: '&#127760;', Task: '&#129302;', Agent: '&#129302;',
  Skill: '&#10024;', Artifact: '&#128196;', AskUserQuestion: '&#10068;',
};

function renderToolCard(block, opts) {
  const res = block.result || {};
  const badges = [];
  if (res.kind === 'diff') badges.push(`<span class="pill add">+${res.added}</span><span class="pill del">-${res.removed}</span>`);
  if (res.isError) badges.push('<span class="pill err">error</span>');
  if (res.kind === 'shell' && res.interrupted) badges.push('<span class="pill warn">interrupted</span>');
  if (res.kind === 'images') badges.push(`<span class="pill">${res.images.length} image${res.images.length > 1 ? 's' : ''}</span>`);

  const body = renderToolInput(block.name, block.input) + renderToolResult(res, opts);
  const icon = TOOL_ICON[block.name] || '&#9881;';
  return `<details class="tool${res.isError ? ' iserr' : ''}">`
    + `<summary><span class="ticon">${icon}</span><span class="tname">${escapeHtml(block.name)}</span>`
    + `<span class="tsum">${escapeHtml(block.summary || '')}</span>${badges.join('')}</summary>`
    + `<div class="tbody">${body}</div></details>`;
}

function renderBlocks(blocks, opts) {
  return (blocks || []).map((b) => {
    if (b.type === 'text') return `<div class="prose">${md(b.text)}</div>`;
    if (b.type === 'thinking') {
      if (b.redacted) return `<div class="thought redacted" title="Claude Code stores a signature but not the reasoning text">Thought for a moment</div>`;
      return `<details class="thought"><summary>Thinking</summary><div class="prose">${md(b.text)}</div></details>`;
    }
    if (b.type === 'tool') return renderToolCard(b, opts);
    return '';
  }).join('');
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function renderTurn(turn, opts) {
  const time = turn.timestamp ? `<time datetime="${escapeAttr(turn.timestamp)}">${escapeHtml(fmtTime(turn.timestamp))}</time>` : '';

  if (turn.kind === 'human') {
    return `<article class="turn human" id="t${turn.index}" data-i="${turn.index}">`
      + `<div class="who">You${time}</div>`
      + `<div class="bubble">${renderBlocks(turn.blocks, opts)}</div></article>`;
  }

  if (turn.kind === 'assistant') {
    const meta = [];
    if (turn.model && turn.model !== '<synthetic>') meta.push(escapeHtml(turn.model));
    if (turn.effort) meta.push(escapeHtml(turn.effort));
    if (turn.skill) meta.push('skill: ' + escapeHtml(turn.skill));
    return `<article class="turn assistant" id="t${turn.index}" data-i="${turn.index}">`
      + `<div class="who">Claude<span class="meta">${meta.join(' · ')}</span>${time}</div>`
      + `<div class="bubble">${renderBlocks(turn.blocks, opts)}</div></article>`;
  }

  // system
  const cat = turn.category || 'context';
  const detail = turn.detail ? `<span class="sdetail">${escapeHtml(turn.detail)}</span>` : '';
  let body = '';
  if (turn.code && turn.text) body = codeBlock(turn.text, null);
  else if (turn.text) body = `<div class="stext">${escapeHtml(turn.text)}</div>`;
  const collapsible = cat === 'context' || (turn.text && turn.text.length > 200);
  const inner = `<span class="slabel">${escapeHtml(turn.label || cat)}</span>${detail}${time}`;
  if (collapsible && body) {
    return `<article class="turn system ${escapeAttr(cat)}" id="t${turn.index}" data-i="${turn.index}" data-cat="${escapeAttr(cat)}">`
      + `<details><summary>${inner}</summary>${body}</details></article>`;
  }
  return `<article class="turn system ${escapeAttr(cat)}" id="t${turn.index}" data-i="${turn.index}" data-cat="${escapeAttr(cat)}">`
    + `<div class="sline">${inner}</div>${body}</article>`;
}

function renderTranscript(session, opts) {
  return session.turns.map((t) => renderTurn(t, opts)).join('\n');
}

module.exports = {
  escapeHtml, escapeAttr, md, codeBlock, highlight, langForFile,
  renderDiff, renderTodos, renderToolCard, renderBlocks, renderTurn,
  renderTranscript, fmtTime,
};
