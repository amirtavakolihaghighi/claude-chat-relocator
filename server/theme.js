'use strict';

/**
 * The transcript stylesheet. Shared verbatim by the live viewer and the
 * self-contained HTML export, so an exported chat looks exactly like the one
 * you were reading.
 *
 * Every colour -- including syntax-highlighting tokens -- is a CSS variable, so
 * light, system-dark, and the explicit data-theme override are each defined
 * once and nothing is duplicated per theme.
 */

const TOKENS = `
:root {
  color-scheme: light dark;
  --bg:        #ffffff;
  --bg-sunk:   #f6f7f9;
  --panel:     #ffffff;
  --border:    #e2e5ea;
  --border-2:  #cfd4dc;
  --text:      #1c1f24;
  --text-dim:  #5b6470;
  --text-faint:#8a929e;
  --accent:    #4a5db5;
  --accent-bg: #eef0fb;
  --user-bg:   #f0f3fb;
  --user-edge: #4a5db5;
  --code-bg:   #f5f6f8;
  --code-text: #24292f;
  --add-bg:    #e5f6e9;
  --add-edge:  #4a9c62;
  --del-bg:    #fdeaea;
  --del-edge:  #c25353;
  --warn:      #a86a1a;
  --warn-bg:   #fdf3e2;
  --err:       #b3403f;
  --err-bg:    #fdecec;
  --ok:        #3f7d52;
  --ok-bg:     #e8f5ec;

  --tok-comment: #7d8894;
  --tok-keyword: #a052a0;
  --tok-string:  #3f7d52;
  --tok-number:  #b06b2a;
  --tok-title:   #3a6fb5;
  --tok-attr:    #b3403f;
  --tok-builtin: #2d7f88;

  --radius: 10px;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
`;

const DARK_VARS = `
  --bg:        #16181d;
  --bg-sunk:   #101216;
  --panel:     #1c1f26;
  --border:    #2b2f38;
  --border-2:  #3a3f4b;
  --text:      #e3e6ea;
  --text-dim:  #a2abb8;
  --text-faint:#727b88;
  --accent:    #93a4ee;
  --accent-bg: #22273a;
  --user-bg:   #1e2331;
  --user-edge: #7186e0;
  --code-bg:   #101319;
  --code-text: #d6dae0;
  --add-bg:    #14301d;
  --add-edge:  #3f8a56;
  --del-bg:    #3a1a1c;
  --del-edge:  #b45459;
  --warn:      #e0b061;
  --warn-bg:   #2e2513;
  --err:       #ef8b89;
  --err-bg:    #331b1c;
  --ok:        #79c48f;
  --ok-bg:     #16301f;

  --tok-comment: #6d7684;
  --tok-keyword: #cd8ecd;
  --tok-string:  #86c99a;
  --tok-number:  #e0a86b;
  --tok-title:   #86aae6;
  --tok-attr:    #e58a88;
  --tok-builtin: #6dbcc6;
`;

const DARK = `
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_VARS}}
}
:root[data-theme="dark"] {${DARK_VARS}}
`;

const TRANSCRIPT = `
.transcript { font-family: var(--sans); color: var(--text); line-height: 1.62; }
.transcript *, .transcript *::before, .transcript *::after { box-sizing: border-box; }

/* ---- turns ---- */
.turn { margin: 0 0 22px; scroll-margin-top: 90px; }
.turn .who {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  font-size: 12.5px; font-weight: 650; letter-spacing: .02em;
  color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase;
}
.turn .who time { font-weight: 400; color: var(--text-faint); font-size: 11.5px; text-transform: none; letter-spacing: 0; margin-left: auto; }
.turn .who .meta { font-weight: 400; color: var(--text-faint); font-size: 11.5px; text-transform: none; letter-spacing: 0; }

.turn.human .who { color: var(--user-edge); }
.turn.human .bubble {
  background: var(--user-bg); border: 1px solid var(--border);
  border-left: 3px solid var(--user-edge);
  border-radius: var(--radius); padding: 14px 18px;
}
.turn.assistant .bubble { padding: 0 2px; }
.turn.hit > .bubble, .turn.hit > details { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: var(--radius); }

/* ---- prose ---- */
.prose > *:first-child { margin-top: 0; }
.prose > *:last-child { margin-bottom: 0; }
.prose p { margin: 0 0 .85em; }
.prose h1, .prose h2, .prose h3, .prose h4 { margin: 1.5em 0 .5em; line-height: 1.3; font-weight: 650; }
.prose h1 { font-size: 1.45em; } .prose h2 { font-size: 1.25em; }
.prose h3 { font-size: 1.1em; }  .prose h4 { font-size: 1em; }
.prose ul, .prose ol { margin: 0 0 .85em; padding-left: 1.5em; }
.prose li { margin: .22em 0; }
.prose li > p { margin: 0 0 .4em; }
.prose blockquote {
  margin: 0 0 .85em; padding: .1px 0 .1px 14px;
  border-left: 3px solid var(--border-2); color: var(--text-dim);
}
.prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.prose hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
.prose code {
  font-family: var(--mono); font-size: .885em;
  background: var(--code-bg); border: 1px solid var(--border);
  padding: .1em .38em; border-radius: 5px; word-break: break-word;
}
.prose table { border-collapse: collapse; margin: 0 0 .85em; display: block; overflow-x: auto; max-width: 100%; }
.prose th, .prose td { border: 1px solid var(--border); padding: 6px 11px; text-align: left; }
.prose th { background: var(--bg-sunk); font-weight: 650; }
.prose img { max-width: 100%; height: auto; border-radius: 6px; }

/* ---- code blocks ---- */
.codewrap {
  margin: 0 0 .85em; border: 1px solid var(--border);
  border-radius: 8px; overflow: hidden; background: var(--code-bg);
}
.codebar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 10px; background: var(--bg-sunk);
  border-bottom: 1px solid var(--border);
  font: 600 11px/1.5 var(--mono); color: var(--text-dim);
  text-transform: lowercase;
}
.codebar .copy {
  font: 600 10.5px/1 var(--sans); color: var(--text-dim);
  background: transparent; border: 1px solid var(--border-2);
  border-radius: 5px; padding: 3px 8px; cursor: pointer;
}
.codebar .copy:hover { color: var(--text); border-color: var(--text-faint); }
.codewrap pre { margin: 0; padding: 11px 13px; overflow-x: auto; }
.codewrap code {
  font-family: var(--mono); font-size: 12.4px; line-height: 1.55;
  color: var(--code-text); background: none; border: 0; padding: 0;
  white-space: pre; display: block;
}

/* ---- thinking ---- */
.thought {
  margin: 0 0 .85em; font-size: 13px; color: var(--text-faint);
  border-left: 2px dashed var(--border-2); padding-left: 12px;
}
.thought.redacted { font-style: italic; }
.thought > summary { cursor: pointer; font-weight: 600; color: var(--text-dim); }

/* ---- tool cards ---- */
.tool {
  margin: 0 0 9px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--panel); overflow: hidden;
}
.tool.iserr { border-color: var(--del-edge); }
.tool > summary {
  cursor: pointer; padding: 8px 12px; display: flex; align-items: center;
  gap: 9px; list-style: none; user-select: none; font-size: 13px;
}
.tool > summary::-webkit-details-marker { display: none; }
.tool > summary::marker { content: ''; }
.tool > summary:hover { background: var(--bg-sunk); }
.tool[open] > summary { border-bottom: 1px solid var(--border); background: var(--bg-sunk); }
.tool .ticon { font-size: 13px; opacity: .75; flex: none; }
.tool .tname { font-weight: 650; color: var(--text); flex: none; }
.tool .tsum {
  font-family: var(--mono); font-size: 11.8px; color: var(--text-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
}
.tbody { padding: 11px 12px 2px; }
.tbody > *:last-child { margin-bottom: 9px; }

.pill {
  flex: none; font: 600 10.5px/1 var(--sans); padding: 3px 6px;
  border-radius: 4px; background: var(--bg-sunk); color: var(--text-dim);
  border: 1px solid var(--border);
}
.pill.add { background: var(--add-bg); color: var(--ok); border-color: var(--add-edge); }
.pill.del { background: var(--del-bg); color: var(--err); border-color: var(--del-edge); }
.pill.err { background: var(--err-bg); color: var(--err); border-color: var(--del-edge); }
.pill.warn { background: var(--warn-bg); color: var(--warn); border-color: var(--warn); }

.res { margin: 0 0 .85em; }
.res.none { font-size: 12.5px; color: var(--text-faint); font-style: italic; }
.reshead {
  font: 600 11.8px/1.6 var(--mono); color: var(--text-dim);
  margin-bottom: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  word-break: break-all;
}
.stderr .codebar { color: var(--err); }
.note { font-size: 12.5px; color: var(--text-dim); margin: 4px 0; }
.note.warn { color: var(--warn); }
.kv { font-size: 13px; margin: 0 0 .6em; display: flex; gap: 8px; }
.kv b { color: var(--text-dim); font-weight: 650; flex: none; }
.kv span { font-family: var(--mono); font-size: 12.2px; word-break: break-all; }

.filelist { margin: 0; padding-left: 1.3em; font-family: var(--mono); font-size: 12.2px; color: var(--text-dim); }
.filelist li { margin: 1px 0; word-break: break-all; }

.todos { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.todo { display: flex; gap: 8px; align-items: baseline; margin: 3px 0; }
.todo .tick { flex: none; width: 1em; }
.todo.completed { color: var(--text-faint); text-decoration: line-through; }
.todo.completed .tick { color: var(--ok); text-decoration: none; }
.todo.in_progress { color: var(--text); font-weight: 600; }
.todo.in_progress .tick { color: var(--accent); }
.todo.pending .tick { color: var(--text-faint); }

.shot { margin: 0 0 .7em; }
.shot img {
  max-width: 100%; height: auto; border: 1px solid var(--border);
  border-radius: 6px; display: block;
}

/* ---- diffs ---- */
.diff {
  border: 1px solid var(--border); border-radius: 8px;
  overflow-x: auto; background: var(--code-bg);
  font-family: var(--mono); font-size: 12.2px; line-height: 1.5;
}
.diff .hunk {
  padding: 3px 10px; background: var(--bg-sunk); color: var(--text-faint);
  border-bottom: 1px solid var(--border); font-size: 11.4px;
}
.diff .hunk:not(:first-child) { border-top: 1px solid var(--border); }
.dl { display: flex; white-space: pre; min-width: min-content; }
.dl .no {
  flex: none; width: 3.4em; padding: 0 6px; text-align: right;
  color: var(--text-faint); background: var(--bg-sunk); user-select: none;
  font-size: 11.2px; opacity: .8;
}
.dl .sig { flex: none; width: 1.4em; text-align: center; color: var(--text-faint); user-select: none; }
.dl .txt { padding-right: 12px; color: var(--code-text); }
.dl.add { background: var(--add-bg); }
.dl.add .sig { color: var(--ok); }
.dl.del { background: var(--del-bg); }
.dl.del .sig { color: var(--err); }

/* ---- system lines ---- */
.turn.system { margin-bottom: 12px; font-size: 12.5px; }
.turn.system .sline, .turn.system > details > summary {
  display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap;
  color: var(--text-faint);
}
.turn.system > details > summary { cursor: pointer; list-style: none; }
.turn.system > details > summary::-webkit-details-marker { display: none; }
.turn.system .slabel {
  font-weight: 650; text-transform: uppercase; font-size: 10.5px;
  letter-spacing: .04em; padding: 2px 7px; border-radius: 4px;
  background: var(--bg-sunk); border: 1px solid var(--border); color: var(--text-dim);
}
.turn.system .sdetail { font-family: var(--mono); font-size: 11.6px; word-break: break-all; }
.turn.system time { font-size: 11px; margin-left: auto; }
.turn.system .stext { margin-top: 5px; color: var(--text-dim); white-space: pre-wrap; word-break: break-word; }
.turn.system.error .slabel { background: var(--err-bg); color: var(--err); border-color: var(--del-edge); }
.turn.system.error .stext { color: var(--err); }
.turn.system.note .slabel { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }

/* ---- syntax tokens ---- */
.hljs-comment, .hljs-quote { color: var(--tok-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: var(--tok-keyword); }
.hljs-string, .hljs-doctag, .hljs-regexp, .hljs-addition { color: var(--tok-string); }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-meta { color: var(--tok-number); }
.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: var(--tok-title); }
.hljs-attribute, .hljs-attr, .hljs-variable, .hljs-template-variable { color: var(--tok-attr); }
.hljs-built_in, .hljs-builtin-name, .hljs-class .hljs-title { color: var(--tok-builtin); }
.hljs-deletion { color: var(--tok-attr); }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
`;

const PRINT = `
@media print {
  :root {
    --bg: #fff; --panel: #fff; --bg-sunk: #f7f7f8; --text: #000;
    --text-dim: #3a3a3a; --text-faint: #666; --code-bg: #f7f7f8; --code-text: #111;
  }
  .transcript { font-size: 10.5pt; line-height: 1.5; }
  .turn { break-inside: avoid; margin-bottom: 14px; }
  .tool, .thought { break-inside: avoid; }
  /* Print the whole conversation, including anything collapsed on screen. */
  details > summary { list-style: none; }
  details:not([open]) > *:not(summary) { display: revert !important; }
  .codebar .copy { display: none; }
  .codewrap pre, .codewrap code, .dl { white-space: pre-wrap; word-break: break-word; }
  a { color: inherit; text-decoration: none; }
  .noprint { display: none !important; }
}
`;

/** Full transcript CSS: variables, light + dark, layout, print. */
function transcriptCss() {
  return [TOKENS, DARK, TRANSCRIPT, PRINT].join('\n');
}

module.exports = { transcriptCss, TOKENS, DARK, TRANSCRIPT, PRINT };
