'use strict';
const { marked } = require('marked');
const R = require('./render');

/**
 * The conversation view: what you read in the app and in an HTML export.
 *
 * Claude Code writes one record per content block, so one reply from Claude
 * is often dozens of records: a sentence, ten tool calls, another sentence.
 * Showing each record as its own message made long chats unreadable. Here the
 * records between two of your messages become one reply: Claude's words read
 * as prose, runs of tool calls fold into one line that says what happened,
 * and file edits stay visible as change cards.
 *
 * Two kinds of message are marked as special, for the pinned bar and the
 * "Conversation only" view: yours, and Claude's finishing answers. An answer
 * is a reply the API recorded with stop_reason "end_turn" -- Claude finished
 * and handed the chat back. Notes written mid-task stop with "tool_use", so
 * this is exact, not a guess from the wording.
 */

const { escapeHtml, escapeAttr, md, codeBlock, renderDiff, renderToolInput, renderToolResult, basename, fmtTime } = R;

const ICON_PATHS = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  term: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4"/><path d="M12 17h.01"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 10v4"/><path d="M12 17.5h.01"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  chat: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  clip: '<path d="M8 4h8v3H8z"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
};

/** One sprite per page; each icon is then a short <use> reference. */
const ICON_SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">'
  + Object.entries(ICON_PATHS).map(([k, p]) => `<symbol id="ti-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</symbol>`).join('')
  + '</svg>';

const icon = (name) => `<svg class="ti" aria-hidden="true"><use href="#ti-${name}"/></svg>`;

const TOOL_KIND = {
  Read: 'read', NotebookRead: 'read',
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Bash: 'run', PowerShell: 'run', BashOutput: 'run', KillShell: 'run', Monitor: 'run',
  Grep: 'search', Glob: 'search', ToolSearch: 'search',
  WebSearch: 'web', WebFetch: 'web',
  Task: 'agent', Agent: 'agent', SendMessage: 'agent',
  TodoWrite: 'todo', AskUserQuestion: 'ask', Skill: 'skill',
};
const VERB = {
  Read: 'Read', NotebookRead: 'Read', Edit: 'Edited', MultiEdit: 'Edited', Write: 'Wrote', NotebookEdit: 'Edited',
  Bash: 'Ran', PowerShell: 'Ran', BashOutput: 'Checked', KillShell: 'Stopped', Monitor: 'Watched',
  Grep: 'Searched', Glob: 'Listed', ToolSearch: 'Looked up',
  WebSearch: 'Web search', WebFetch: 'Read page', Task: 'Helper', Agent: 'Helper', SendMessage: 'Messaged',
  TodoWrite: 'To-dos', AskUserQuestion: 'Asked you', Skill: 'Skill',
};
const KIND_ICON = { read: 'file', edit: 'pencil', run: 'term', search: 'search', web: 'globe', agent: 'bot', todo: 'list', ask: 'question', skill: 'spark', other: 'tool' };

const toolKind = (name) => TOOL_KIND[name] || 'other';

/** "mcp__blender__execute_code" reads better as "blender: execute code". */
function toolLabel(name) {
  if (VERB[name]) return VERB[name];
  const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
  if (m) return `${m[1].replace(/[-_]/g, ' ')}: ${m[2].replace(/_/g, ' ')}`;
  return String(name || 'Tool');
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function clock(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function timeTag(iso) {
  if (!iso) return '';
  return `<time datetime="${escapeAttr(iso)}" title="${escapeAttr(fmtTime(iso))}">${escapeHtml(clock(iso))}</time>`;
}

/** Markdown for your own messages, where one line break is meant as one. */
function mdUser(text) {
  if (!text) return '';
  try { return marked.parse(String(text), { breaks: true }); }
  catch { return `<p>${escapeHtml(text)}</p>`; }
}

function firstLineOf(s) {
  const t = String(s || '').split(/\r?\n/).find((l) => l.trim()) || '';
  return t.length > 300 ? t.slice(0, 299) + '…' : t;
}

// ------------------------------------------------------------------ steps --

function stepBadge(b) {
  const r = b.result || {};
  if (r.isError) return '<span class="bad">failed</span>';
  if (r.kind === 'pending') return '<span class="muted">no result</span>';
  if (r.kind === 'diff') return `<span class="plus">+${r.added}</span><span class="minus">&minus;${r.removed}</span>`;
  if (r.kind === 'shell' && r.interrupted) return '<span class="warn">stopped</span>';
  if (r.kind === 'shell') return `<span class="good">${icon('check')}</span>`;
  if (r.kind === 'file' && r.numLines) return `<span class="muted">${r.numLines} lines</span>`;
  if (r.kind === 'list') return `<span class="muted">${plural(r.total || 0, 'match', 'matches')}</span>`;
  if (r.kind === 'images') return `<span class="muted">${plural(r.images.length, 'image', 'images')}</span>`;
  return '';
}

function renderStep(b, anchor, opts) {
  const body = renderToolInput(b.name, b.input) + renderToolResult(b.result || {}, opts);
  return `<details class="step${(b.result && b.result.isError) ? ' iserr' : ''}"${anchor || ''}>`
    + `<summary><span class="sic">${icon(KIND_ICON[toolKind(b.name)])}</span>`
    + `<span class="verb">${escapeHtml(toolLabel(b.name))}</span>`
    + `<span class="what">${escapeHtml(b.summary || '')}</span>`
    + `<span class="res">${stepBadge(b)}</span></summary>`
    + `<div class="sbody">${body}</div></details>`;
}

/** A run of tool calls, folded into one line that says what happened. */
function renderSteps(steps, opts) {
  const tools = steps.filter((s) => s.b);
  const rows = steps.map((s) => (s.b ? renderStep(s.b, s.anchor, opts) : s.html)).join('');
  if (!tools.length) return rows;
  if (tools.length === 1) return `<div class="steps single">${rows}</div>`;

  const n = { read: 0, edit: 0, run: 0, search: 0, web: 0, agent: 0, todo: 0, ask: 0, skill: 0, other: 0 };
  let failed = 0;
  for (const { b } of tools) {
    n[toolKind(b.name)]++;
    if (b.result && b.result.isError) failed++;
  }
  const tags = [];
  if (n.read) tags.push(`read ${plural(n.read, 'file', 'files')}`);
  if (n.edit) tags.push(`edited ${plural(n.edit, 'file', 'files')}`);
  if (n.run) tags.push(`ran ${plural(n.run, 'command', 'commands')}`);
  if (n.search) tags.push(`searched ${n.search === 1 ? 'once' : n.search + ' times'}`);
  if (n.web) tags.push(plural(n.web, 'web look-up', 'web look-ups'));
  if (n.agent) tags.push(plural(n.agent, 'helper', 'helpers'));
  if (n.todo) tags.push('updated to-dos');
  if (n.other + n.skill + n.ask) tags.push(plural(n.other + n.skill + n.ask, 'other step', 'other steps'));
  const title = n.edit ? 'Made changes' : n.run ? 'Ran commands' : n.agent ? 'Asked helpers'
    : (n.read || n.search) ? 'Looked around' : n.web ? 'Looked things up' : 'Worked';

  return `<details class="steps"><summary>${icon('chev')}<span class="stitle"><b>${title}</b> &mdash; ${tools.length} steps</span>`
    + `<span class="tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}`
    + `${failed ? `<span class="tag bad">${failed} failed</span>` : ''}</span></summary>`
    + `<div class="steplist">${rows}</div></details>`;
}

/** File edits stay in view as cards: what changed is the point of most chats. */
function isEditCard(b) {
  return b && b.type === 'tool' && toolKind(b.name) === 'edit' && b.result && b.result.kind === 'diff';
}

function renderEditCard(b, anchor) {
  const r = b.result;
  const lines = (r.patch || []).reduce((a, h) => a + ((h.lines || []).length), 0);
  const fp = r.filePath || (b.input && b.input.file_path) || '';
  const name = basename(fp);
  const dir = fp.slice(0, Math.max(0, fp.length - name.length)).replace(/[\\/]$/, '');
  return `<details class="card edit"${anchor || ''}${lines <= 40 ? ' open' : ''}>`
    + `<summary>${icon('pencil')}<span class="verb">${escapeHtml(VERB[b.name] || 'Edited')}</span>`
    + `<span class="what"><b>${escapeHtml(name)}</b>${dir ? ` <span class="dir">${escapeHtml(dir)}</span>` : ''}</span>`
    + `<span class="delta"><span class="plus">+${r.added}</span> <span class="minus">&minus;${r.removed}</span></span>${icon('chev')}</summary>`
    + `<div class="cbody">${renderDiff(r.patch)}</div></details>`;
}

// ---------------------------------------------------------------- notices --

function renderErrors(errs) {
  const timeOf = (t) => (t.timestamp ? ` <span class="muted">${escapeHtml(clock(t.timestamp))}</span>` : '');
  if (errs.length === 1) {
    const t = errs[0];
    return `<div class="notice err" id="t${t.index}">${icon('alert')}<div><b>${escapeHtml(t.label || 'Error')}</b>${timeOf(t)}`
      + `<div>${escapeHtml(firstLineOf(t.text))}</div></div></div>`;
  }
  const items = errs.map((t) => `<li id="t${t.index}">${escapeHtml(firstLineOf(t.text))}${timeOf(t)}</li>`).join('');
  return `<details class="notice err"><summary>${icon('alert')}<span><b>Connection or service problems</b> &mdash; ${errs.length} in a row; Claude Code retried</span></summary>`
    + `<ul>${items}</ul></details>`;
}

function renderContextRow(t) {
  const body = t.text ? `<div class="stext">${escapeHtml(String(t.text).slice(0, 20000))}</div>` : '';
  return `<div class="ctx" data-cat="context" id="t${t.index}">`
    + (body ? `<details><summary>${escapeHtml(t.label || 'context')}</summary>${body}</details>` : `<span>${escapeHtml(t.label || 'context')}</span>`)
    + '</div>';
}

function renderNotice(t) {
  const cls = t.category === 'warn' ? 'warn' : 'note';
  const body = t.code && t.text ? codeBlock(t.text, null)
    : t.text ? `<div>${escapeHtml(t.text)}</div>` : '';
  return `<div class="notice ${cls}" id="t${t.index}">${icon(cls === 'warn' ? 'alert' : 'info')}`
    + `<div><b>${escapeHtml(t.label || 'Note')}</b>${t.detail ? ` <span class="muted">${escapeHtml(t.detail)}</span>` : ''}${body}</div></div>`;
}

// ---------------------------------------------------------------- messages --

const longMessage = (text) => { const s = String(text || ''); return s.length > 2400 || s.split('\n').length > 30; };

function renderYou(t) {
  const b = (t.blocks || [])[0] || { text: '' };
  const long = longMessage(b.text);
  return `<article class="msg you" id="t${t.index}" data-i="${t.index}">`
    + '<div class="avatar you">You</div><div class="body">'
    + `<div class="who"><b>You</b>${b.pasted ? `<span class="chip">${icon('clip')}pasted</span>` : ''}${timeTag(t.timestamp)}</div>`
    + `<div class="bubble${long ? ' long' : ''}" data-special="you" data-when="${escapeAttr(clock(t.timestamp))}">`
    + `<div class="prose">${mdUser(b.text)}</div>`
    + (long ? '<button class="more" type="button" data-more>Show the whole message</button>' : '')
    + '</div></div></article>';
}

function renderQueued(t, anchor) {
  const b = (t.blocks || [])[0] || { text: '' };
  return `<div class="queued" data-special="you" data-when="${escapeAttr(clock(t.timestamp))}"${anchor || ''}>`
    + `<span class="ql">${icon('chat')}You, while Claude was working${t.timestamp ? ' · ' + escapeHtml(clock(t.timestamp)) : ''}</span>`
    + `<div class="prose">${mdUser(b.text)}</div></div>`;
}

function renderEvent(t) {
  if (t.category === 'compact' && t.text) {
    return `<details class="event compact-summary" id="t${t.index}">`
      + `<summary>${icon('layers')}<span><b>The summary Claude Code wrote for itself</b> when it compacted the chat. Click to read it.</span></summary>`
      + `<div class="prose">${md(t.text)}</div></details>`;
  }
  if (t.category === 'compact') {
    return `<div class="event compact" id="t${t.index}">${icon('layers')}<div><b>${escapeHtml(t.label)}</b>`
      + `${t.detail ? ` &mdash; ${escapeHtml(t.detail)}` : ''}. Nothing above was lost: the full text is still in this chat file.</div></div>`;
  }
  return `<div class="event job" id="t${t.index}">${icon('check')}<div><b>${escapeHtml(t.label)}</b>`
    + `${t.detail ? `: ${escapeHtml(t.detail)}` : ''}. Claude carried on by itself &mdash; nobody typed this.`
    + (t.text ? `<details><summary>Show the report</summary>${codeBlock(String(t.text).slice(0, 60000), null)}</details>` : '')
    + '</div></div>';
}

/** Everything Claude did between two of your messages, as one reply. */
function renderReply(run, opts) {
  const firstAi = run.find((t) => t.kind === 'assistant');
  const parts = [];
  const anchored = new Set();
  const anchor = (t) => {
    if (anchored.has(t.index)) return '';
    anchored.add(t.index);
    return ` id="t${t.index}"`;
  };
  let steps = [];
  let errors = [];
  let final = null;     // one answer can span several records of the same message

  const flushSteps = () => { if (steps.length) { parts.push(renderSteps(steps, opts)); steps = []; } };
  const flushErrors = () => { if (errors.length) { parts.push(renderErrors(errors)); errors = []; } };
  const flushFinal = () => {
    if (!final) return;
    parts.push(`<div class="prose final" data-special="answer" data-when="${escapeAttr(final.when)}"${final.anchor}>`
      + `<div class="final-label">${icon('check')}Answer${final.when ? ` <span>${escapeHtml(final.when)}</span>` : ''}</div>`
      + final.html.join('') + '</div>');
    final = null;
  };
  const flushAll = () => { flushSteps(); flushErrors(); flushFinal(); };

  for (const t of run) {
    if (t.kind === 'assistant') {
      for (const b of t.blocks || []) {
        if (b.type === 'thinking') {
          if (b.redacted) continue;          // only a signature is stored: nothing to show
          flushAll();
          parts.push(`<details class="thinking"${anchor(t)}><summary>${icon('spark')}Claude's thinking</summary><div class="prose">${md(b.text)}</div></details>`);
        } else if (b.type === 'tool') {
          flushErrors(); flushFinal();
          if (isEditCard(b)) { flushSteps(); parts.push(renderEditCard(b, anchor(t))); }
          else steps.push({ b, anchor: anchor(t) });
        } else if (b.type === 'text') {
          flushSteps(); flushErrors();
          if (t.final) {
            if (final && final.messageId && final.messageId === t.messageId) final.html.push(md(b.text));
            else { flushFinal(); final = { messageId: t.messageId, when: clock(t.timestamp), anchor: anchor(t), html: [md(b.text)] }; }
          } else {
            flushFinal();
            parts.push(`<div class="prose"${anchor(t)}>${md(b.text)}</div>`);
          }
        }
      }
    } else if (t.kind === 'human') {
      flushAll();
      parts.push(renderQueued(t, anchor(t)));
    } else if (t.category === 'error') {
      flushSteps(); flushFinal();
      errors.push(t);
    } else if (t.category === 'context') {
      // ambient context rides along inside a run of steps instead of splitting it
      if (steps.length) steps.push({ html: renderContextRow(t) });
      else parts.push(renderContextRow(t));
    } else {
      flushAll();
      parts.push(renderNotice(t));
    }
  }
  flushAll();

  if (!firstAi) return parts.join('');     // only notices and context: no reply to frame

  const meta = [];
  if (firstAi.model && firstAi.model !== '<synthetic>') meta.push(escapeHtml(firstAi.model.replace(/^claude-/, '')));
  if (firstAi.effort) meta.push(escapeHtml(firstAi.effort) + ' effort');
  if (firstAi.skill) meta.push('skill: ' + escapeHtml(firstAi.skill));
  return `<article class="msg ai" data-i="${firstAi.index}">`
    + '<div class="avatar ai">C</div><div class="body">'
    + `<div class="who"><b>Claude</b><span class="model">${meta.join(' · ')}</span>${timeTag(firstAi.timestamp)}</div>`
    + parts.join('') + '</div></article>';
}

// --------------------------------------------------------------- the chat --

const GAP_MS = 30 * 60 * 1000;

function gapLabel(fromMs, toMs) {
  const a = new Date(fromMs);
  const b = new Date(toMs);
  if (a.toDateString() !== b.toDateString()) {
    return b.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const mins = Math.round((toMs - fromMs) / 60000);
  if (mins < 60) return `${mins} minutes later`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? '' : 's'} later`;
}

/**
 * The chat as HTML pieces in reading order. The app adds them a few at a time
 * so a long chat shows at once; the export joins them.
 *
 * @returns {Array<{kind: 'you'|'reply'|'event'|'divider', i: number|null, html: string}>}
 */
function renderItems(session, opts = {}) {
  const turns = session.turns || [];
  const items = [];
  let lastMs = null;
  const ms = (t) => { const v = t && t.timestamp ? Date.parse(t.timestamp) : NaN; return isNaN(v) ? null : v; };
  const divider = (t) => {
    const at = ms(t);
    if (at && lastMs && at - lastMs >= GAP_MS) {
      items.push({ kind: 'divider', i: null, html: `<div class="divider">${escapeHtml(gapLabel(lastMs, at))}</div>` });
    }
  };
  const seen = (t) => { const at = ms(t); if (at && (!lastMs || at > lastMs)) lastMs = at; };
  const standalone = (t) => (t.kind === 'human' ? !t.queued : (t.kind === 'system' && (t.category === 'job' || t.category === 'compact')));

  let i = 0;
  while (i < turns.length) {
    const t = turns[i];
    if (standalone(t)) {
      divider(t);
      items.push({ kind: t.kind === 'human' ? 'you' : 'event', i: t.index, html: t.kind === 'human' ? renderYou(t) : renderEvent(t) });
      seen(t);
      i++;
      continue;
    }
    const run = [];
    while (i < turns.length && !standalone(turns[i])) run.push(turns[i++]);
    divider(run.find((x) => x.category !== 'context') || run[0]);
    items.push({ kind: 'reply', i: run[0].index, html: renderReply(run, opts) });
    for (const x of run) seen(x);
  }
  return items;
}

module.exports = { renderItems, renderStep, renderEditCard, ICON_SPRITE, toolLabel, toolKind, mdUser, clock, gapLabel };
