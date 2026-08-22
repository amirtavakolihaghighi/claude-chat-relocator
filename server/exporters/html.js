'use strict';
const R = require('../render');
const { transcriptCss } = require('../theme');

/**
 * Self-contained HTML export: one file, no network, no build step.
 *
 * Images are inlined as data URIs and the stylesheet is embedded, so the file
 * still renders identically years from now on a machine that has never heard of
 * this app. Ctrl+P produces a clean PDF -- a beforeprint hook opens every
 * collapsed section first so nothing silently vanishes from the printout.
 */

const SHELL_CSS = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--sans); line-height: 1.6;
}
.page { max-width: 900px; margin: 0 auto; padding: 28px 24px 96px; }

.doc-head { border-bottom: 1px solid var(--border); padding-bottom: 18px; margin-bottom: 26px; }
.doc-head h1 { margin: 0 0 10px; font-size: 23px; line-height: 1.3; font-weight: 680; letter-spacing: -.01em; }
.doc-path {
  font-family: var(--mono); font-size: 12.4px; color: var(--text-dim);
  word-break: break-all; margin: 0 0 14px;
}
.facts { display: flex; flex-wrap: wrap; gap: 6px 8px; margin: 0; padding: 0; list-style: none; }
.fact {
  font-size: 11.5px; color: var(--text-dim); background: var(--bg-sunk);
  border: 1px solid var(--border); border-radius: 5px; padding: 3px 8px;
}
.fact b { color: var(--text); font-weight: 650; }

.bar {
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  margin: 0 0 22px; padding: 10px 0; border-bottom: 1px solid var(--border);
  position: sticky; top: 0; background: var(--bg); z-index: 5;
}
.bar button {
  font: 600 12px/1 var(--sans); color: var(--text-dim); cursor: pointer;
  background: var(--panel); border: 1px solid var(--border-2);
  border-radius: 6px; padding: 7px 11px;
}
.bar button:hover { color: var(--text); border-color: var(--text-faint); }
.bar .spacer { flex: 1; }
.bar .count { font-size: 11.5px; color: var(--text-faint); }

.doc-foot {
  margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border);
  font-size: 11.5px; color: var(--text-faint);
}
.doc-foot code { font-family: var(--mono); }

@media (max-width: 640px) { .page { padding: 18px 14px 60px; } }
@media print { .page { max-width: none; padding: 0; } .bar { display: none; } }
`;

const SCRIPT = `
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('ccx-theme'); } catch (e) {}
  if (saved) root.setAttribute('data-theme', saved);

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;

    if (t.hasAttribute('data-copy')) {
      var wrap = t.closest('.codewrap');
      var code = wrap && wrap.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText).then(function () {
        var was = t.textContent; t.textContent = 'Copied';
        setTimeout(function () { t.textContent = was; }, 1200);
      }, function () {});
      return;
    }

    var act = t.getAttribute('data-act');
    if (act === 'expand' || act === 'collapse') {
      var open = act === 'expand';
      document.querySelectorAll('.transcript details').forEach(function (d) { d.open = open; });
      return;
    }
    if (act === 'theme') {
      var now = root.getAttribute('data-theme');
      var next = now === 'dark' ? 'light' : now === 'light' ? '' : 'dark';
      if (next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
      try { next ? localStorage.setItem('ccx-theme', next) : localStorage.removeItem('ccx-theme'); } catch (e) {}
      return;
    }
    if (act === 'print') { window.print(); return; }
  });

  // Print the whole conversation, not just what happens to be expanded.
  var reopened = [];
  window.addEventListener('beforeprint', function () {
    reopened = [];
    document.querySelectorAll('.transcript details:not([open])').forEach(function (d) {
      d.open = true; reopened.push(d);
    });
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
 * @param {object} opts      includeSystem, expandTools
 */
function exportHtml(session, imageStore, opts = {}) {
  const includeSystem = opts.includeSystem !== false;
  const esc = R.escapeHtml;

  const imageSrc = (ref, mediaType) => {
    const img = imageStore.get(ref);
    if (!img) return '';
    return `data:${img.mediaType || mediaType || 'image/png'};base64,${img.data}`;
  };

  const turns = includeSystem
    ? session.turns
    : session.turns.filter((t) => !(t.kind === 'system' && t.category === 'context'));

  let body = turns.map((t) => R.renderTurn(t, { imageSrc })).join('\n');
  if (opts.expandTools) body = body.replace(/<details class="tool"/g, '<details class="tool" open');

  const s = session.stats || {};
  const facts = [];
  if (session.startedAt) facts.push(['Started', R.fmtTime(session.startedAt)]);
  if (session.durationMs) facts.push(['Duration', fmtDuration(session.durationMs)]);
  facts.push(['Messages', `${fmtNum(s.humanTurns)} you / ${fmtNum(s.assistantTurns)} Claude`]);
  if (s.toolCalls) facts.push(['Tool calls', fmtNum(s.toolCalls)]);
  if (s.tokens && s.tokens.output) facts.push(['Output tokens', fmtNum(s.tokens.output)]);
  const model = Object.keys(s.models || {}).filter((m) => m && m !== '<synthetic>')[0];
  if (model) facts.push(['Model', model]);
  if (session.gitBranch) facts.push(['Branch', session.gitBranch]);
  if (s.apiErrors) facts.push(['API errors', fmtNum(s.apiErrors)]);
  facts.push(['Source', fmtBytes(session.sizeBytes)]);

  const factsHtml = facts
    .map(([k, v]) => `<li class="fact">${esc(k)} <b>${esc(String(v))}</b></li>`)
    .join('');

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
<div class="page">
  <header class="doc-head">
    <h1>${esc(session.title || 'Claude chat')}</h1>
    <p class="doc-path">${esc(session.projectPath || '(project path not recorded)')}</p>
    <ul class="facts">${factsHtml}</ul>
  </header>

  <div class="bar noprint">
    <button type="button" data-act="expand">Expand all</button>
    <button type="button" data-act="collapse">Collapse all</button>
    <button type="button" data-act="print">Save as PDF</button>
    <span class="spacer"></span>
    <span class="count">${turns.length} entries</span>
    <button type="button" data-act="theme">Theme</button>
  </div>

  <main class="transcript">
${body}
  </main>

  <footer class="doc-foot">
    Exported ${esc(R.fmtTime(new Date().toISOString()))} from
    <code>${esc(session.sessionId)}.jsonl</code>${session.parseErrors && session.parseErrors.length
      ? ` &middot; ${session.parseErrors.length} unreadable line(s) skipped` : ''}
  </footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

module.exports = { exportHtml, fmtBytes, fmtDuration, fmtNum };
