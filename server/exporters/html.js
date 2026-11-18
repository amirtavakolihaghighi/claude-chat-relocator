'use strict';
const R = require('../render');
const V = require('../view');
const { transcriptCss } = require('../theme');

/**
 * Self-contained HTML export: one file, no network, no build step.
 *
 * Images are inlined as data URIs and the stylesheet is embedded, so the file
 * still renders identically years from now on a machine that has never heard of
 * this app. It has the same view as the app -- grouped steps, marked answers,
 * a "Conversation only" switch, light and dark. Ctrl+P makes a clean PDF: a
 * beforeprint hook opens every folded section first so nothing goes missing.
 */

const SHELL_CSS = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.6; }
.page { max-width: 880px; margin: 0 auto; padding: 32px 28px 96px; }

.doc-head { border-bottom: 1px solid var(--line); padding-bottom: 18px; margin-bottom: 8px; }
.doc-head h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.3; font-weight: 700; letter-spacing: -.01em; }
.doc-path { font-family: var(--mono); font-size: 13.5px; color: var(--text-2); word-break: break-all; margin: 0 0 12px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; padding: 0; list-style: none; font-size: 14px; color: var(--text-2); }
.facts b { color: var(--text); font-weight: 650; }

.bar {
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 26px; padding: 12px 0;
  border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 5;
}
.bar button {
  font: 600 13.5px/1 var(--sans); color: var(--text); cursor: pointer; background: var(--surface);
  border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 12px;
}
.bar button:hover { background: var(--hover); }
.bar button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.bar .spacer { flex: 1; }

.doc-foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 13px; color: var(--text-3); }
.doc-foot code { font-family: var(--mono); }

@media (max-width: 640px) { .page { padding: 18px 14px 60px; } .msg { grid-template-columns: 1fr; } .avatar { display: none; } .event { margin-left: 0; } }
@media print { .page { max-width: none; padding: 0; } .bar { display: none; } }
`;

const SCRIPT = `
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('ccx-theme'); } catch (e) {}
  if (saved) root.setAttribute('data-theme', saved);
  var transcript = document.querySelector('.transcript');

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var b = t.closest('[data-copy],[data-more],[data-act]');
    if (!b) return;

    if (b.hasAttribute('data-copy')) {
      var wrap = b.closest('.codewrap');
      var code = wrap && wrap.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText).then(function () {
        var was = b.textContent; b.textContent = 'Copied';
        setTimeout(function () { b.textContent = was; }, 1200);
      }, function () {});
      return;
    }
    if (b.hasAttribute('data-more')) {
      var bub = b.closest('.bubble');
      var on = bub.classList.toggle('expanded');
      b.textContent = on ? 'Show less' : 'Show the whole message';
      return;
    }
    var act = b.getAttribute('data-act');
    if (act === 'expand' || act === 'collapse') {
      var open = act === 'expand';
      document.querySelectorAll('.transcript details').forEach(function (d) { d.open = open; });
    } else if (act === 'convo') {
      var only = transcript.classList.toggle('convo-only');
      b.setAttribute('aria-pressed', only ? 'true' : 'false');
    } else if (act === 'theme') {
      var now = root.getAttribute('data-theme');
      var dark = now ? now === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('ccx-theme', next); } catch (e) {}
    } else if (act === 'print') {
      window.print();
    }
  });

  // Print the whole conversation, not just what happens to be open.
  var reopened = [];
  window.addEventListener('beforeprint', function () {
    reopened = [];
    document.querySelectorAll('.transcript details:not([open])').forEach(function (d) { d.open = true; reopened.push(d); });
  });
  window.addEventListener('afterprint', function () {
    reopened.forEach(function (d) { d.open = false; });
    reopened = [];
  });
})();
`;

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h + ' h ' + (m % 60) + ' min';
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * @param {object} session   parsed session
 * @param {Map}    imageStore ref -> { mediaType, data }
 * @param {object} opts      includeSystem, expandTools, conversationOnly
 */
function exportHtml(session, imageStore, opts = {}) {
  const includeSystem = opts.includeSystem !== false;
  const esc = R.escapeHtml;

  const imageSrc = (ref, mediaType) => {
    const img = imageStore.get(ref);
    if (!img) return '';
    return `data:${img.mediaType || mediaType || 'image/png'};base64,${img.data}`;
  };

  const view = includeSystem
    ? session
    : { ...session, turns: session.turns.filter((t) => !(t.kind === 'system' && t.category === 'context')) };

  let body = V.renderItems(view, { imageSrc }).map((x) => x.html).join('\n');
  if (opts.expandTools) body = body.replace(/<details class="(steps|step|card edit)"/g, '<details class="$1" open');

  const s = session.stats || {};
  const facts = [];
  if (session.startedAt) facts.push(['Started', R.fmtTime(session.startedAt)]);
  if (session.durationMs) facts.push(['Duration', fmtDuration(session.durationMs)]);
  facts.push(['Your messages', fmtNum(s.humanTurns)]);
  if (s.answers) facts.push(["Claude's answers", fmtNum(s.answers)]);
  if (s.toolCalls) facts.push(['Steps', fmtNum(s.toolCalls)]);
  const model = Object.keys(s.models || {}).filter((m) => m && m !== '<synthetic>')[0];
  if (model) facts.push(['Model', model]);
  if (session.gitBranch) facts.push(['Branch', session.gitBranch]);
  if (s.apiErrors) facts.push(['Connection problems', fmtNum(s.apiErrors)]);

  const factsHtml = facts.map(([k, v]) => `<li>${esc(k)} <b>${esc(String(v))}</b></li>`).join('');
  const only = !!opts.conversationOnly;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(session.title || session.sessionId)}</title>
<meta name="generator" content="Claude Chat Relocator">
<style>
${transcriptCss()}
${SHELL_CSS}
</style>
</head>
<body>
${V.ICON_SPRITE}
<div class="page">
  <header class="doc-head">
    <h1>${esc(session.title || 'Claude chat')}</h1>
    <p class="doc-path">${esc(session.projectPath || '(project path not recorded)')}</p>
    <ul class="facts">${factsHtml}</ul>
  </header>

  <div class="bar noprint">
    <button type="button" data-act="convo" aria-pressed="${only}">Conversation only</button>
    <button type="button" data-act="expand">Open every step</button>
    <button type="button" data-act="collapse">Fold every step</button>
    <span class="spacer"></span>
    <button type="button" data-act="theme">Light / dark</button>
    <button type="button" data-act="print">Save as PDF</button>
  </div>

  <main class="transcript${only ? ' convo-only' : ''}">
${body}
  </main>

  <footer class="doc-foot">
    Exported ${esc(R.fmtTime(new Date().toISOString()))} from
    <code>${esc(session.sessionId)}.jsonl</code> (${esc(fmtBytes(session.sizeBytes))})${session.parseErrors && session.parseErrors.length
      ? ` &middot; ${session.parseErrors.length} unreadable line(s) skipped` : ''}
  </footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

module.exports = { exportHtml, fmtBytes, fmtDuration, fmtNum };
