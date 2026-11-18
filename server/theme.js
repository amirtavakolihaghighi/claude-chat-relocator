'use strict';

/**
 * The conversation stylesheet. Shared verbatim by the app and the
 * self-contained HTML export, so an exported chat looks exactly like the one
 * you were reading.
 *
 * Every colour -- syntax tokens included -- is a CSS variable, so light, dark
 * (following the system) and the explicit data-theme override are each
 * defined once. Text sizes never go below 12px: this is for reading.
 */

const TOKENS = `
:root {
  color-scheme: light dark;
  --bg: #f7f6f3; --surface: #ffffff; --sunk: #f0eee9; --hover: #ebe8e2;
  --line: #e3dfd8; --line-2: #d3cec5;
  --text: #1d1b18; --text-2: #4f4a43; --text-3: #6f695f;
  --accent: #2f5fd0; --accent-2: #2450b8; --accent-bg: #e8eefc; --accent-line: #b8c9f3; --on-accent: #ffffff;
  --you-bg: #eef2fb; --you-line: #c9d6f4;
  --ok: #1d7a43; --ok-bg: #e4f4ea; --ok-line: #b5dcc3;
  --warn: #9a5b00; --warn-bg: #fdf1dc; --warn-line: #ecc98a;
  --bad: #b42318; --bad-bg: #fde8e6; --bad-line: #f1b7b1;
  --arch: #6941c6; --arch-bg: #f0ebfd; --arch-line: #cdbdf5;
  --code-bg: #f4f2ee; --code-text: #24211d;
  --add-bg: #e3f5e8; --add-no: #c9ead3; --del-bg: #fde7e5; --del-no: #f6cdc8;
  --shadow: 0 1px 2px rgba(20,18,14,.06), 0 4px 16px rgba(20,18,14,.06);
  --shadow-lg: 0 24px 64px rgba(20,18,14,.22);
  --tok-comment: #857e74; --tok-keyword: #8d3fb3; --tok-string: #1d7a43; --tok-number: #b0570f;
  --tok-title: #2f5fd0; --tok-attr: #b42318; --tok-builtin: #0f7a83;
  --r: 10px;
  --sans: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "Cascadia Code", "Cascadia Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  /* older names, still used here and there */
  --bg-sunk: var(--sunk); --panel: var(--surface); --border: var(--line); --border-2: var(--line-2);
  --text-dim: var(--text-2); --text-faint: var(--text-3); --err: var(--bad); --err-bg: var(--bad-bg);
  --del-edge: var(--bad-line); --add-edge: var(--ok-line); --radius: var(--r);
}
`;

const DARK_VARS = `
  --bg: #141519; --surface: #1b1d22; --sunk: #111216; --hover: #24272e;
  --line: #2b2e36; --line-2: #3a3e48;
  --text: #ebe9e5; --text-2: #b9b4ab; --text-3: #938d83;
  --accent: #7da2ff; --accent-2: #9db9ff; --accent-bg: #1e2740; --accent-line: #34467a; --on-accent: #0b1222;
  --you-bg: #1d2333; --you-line: #2f3b5c;
  --ok: #6fcf97; --ok-bg: #15291e; --ok-line: #24503a;
  --warn: #f0b75e; --warn-bg: #2c2312; --warn-line: #5c4720;
  --bad: #ff8f84; --bad-bg: #321a18; --bad-line: #5e2c27;
  --arch: #b9a1ff; --arch-bg: #251e3b; --arch-line: #463873;
  --code-bg: #101114; --code-text: #dcd8d1;
  --add-bg: #13301f; --add-no: #1b4429; --del-bg: #3a1a18; --del-no: #552521;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.25);
  --shadow-lg: 0 24px 64px rgba(0,0,0,.6);
  --tok-comment: #8a847a; --tok-keyword: #d39bf2; --tok-string: #8fd6a7; --tok-number: #f0a868;
  --tok-title: #8fb0ff; --tok-attr: #ff9f95; --tok-builtin: #6fd0d8;
`;

const DARK = `
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_VARS}}
}
:root[data-theme="dark"] {${DARK_VARS}}
`;

const TRANSCRIPT = `
.transcript { font-family: var(--sans); color: var(--text); line-height: 1.65; font-size: 15.5px; font-variant-ligatures: none; }
.transcript *, .transcript *::before, .transcript *::after { box-sizing: border-box; }
.transcript details > summary { list-style: none; cursor: pointer; }
.transcript details > summary::-webkit-details-marker { display: none; }
.ti { width: 16px; height: 16px; flex: none; vertical-align: -3px; }
.muted { color: var(--text-3); }

/* ---- messages ---- */
.msg { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 14px; margin: 0 0 28px; scroll-margin-top: 140px; }
.msg .body { min-width: 0; }
.avatar { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 12px; user-select: none; }
.avatar.you { background: var(--accent); color: var(--on-accent); }
.avatar.ai { background: var(--sunk); color: var(--text-2); border: 1px solid var(--line); font-size: 13.5px; }
.who { display: flex; align-items: baseline; gap: 10px; margin: 5px 0 7px; flex-wrap: wrap; }
.who b { font-size: 14.5px; }
.who .model { font-size: 12.5px; color: var(--text-3); }
.who time { font-size: 12.5px; color: var(--text-3); margin-left: auto; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-3); background: var(--sunk); border-radius: 6px; padding: 0 7px; }
.chip .ti { width: 13px; height: 13px; }

.bubble {
  background: var(--you-bg); border: 1px solid var(--you-line); border-radius: 4px 14px 14px 14px;
  padding: 12px 16px; position: relative; scroll-margin-top: 140px;
}
.bubble.long:not(.expanded) { max-height: 420px; overflow: hidden; }
.bubble.long:not(.expanded)::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 90px;
  background: linear-gradient(to bottom, transparent, var(--you-bg) 75%); border-radius: 0 0 14px 14px; pointer-events: none;
}
.bubble .more {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 2;
  font: 600 13px var(--sans); color: var(--accent); background: var(--surface);
  border: 1px solid var(--accent-line); border-radius: 999px; padding: 4px 14px; cursor: pointer;
}
.bubble.expanded .more { position: static; transform: none; display: block; margin: 10px auto 0; }

.queued { margin: 12px 0 14px; padding: 9px 14px; border-radius: var(--r); background: var(--you-bg); border: 1px dashed var(--you-line); scroll-margin-top: 140px; }
.queued .ql { font-size: 12.5px; font-weight: 650; color: var(--accent); display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }

.final { border-left: 3px solid var(--ok); padding: 2px 0 2px 14px; margin: 8px 0 14px; scroll-margin-top: 140px; }
.final-label { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 650; color: var(--ok); margin: 0 0 6px; }
.final-label span { font-weight: 400; color: var(--text-3); }

.thinking { margin: 0 0 12px; font-size: 14px; color: var(--text-2); border-left: 2px dashed var(--line-2); padding-left: 12px; }
.thinking > summary { font-weight: 600; display: flex; gap: 6px; align-items: center; }

/* ---- prose ---- */
.prose { margin: 0 0 12px; overflow-wrap: anywhere; }
.prose > *:first-child { margin-top: 0; }
.prose > *:last-child { margin-bottom: 0; }
.prose p { margin: 0 0 .8em; }
.prose h1, .prose h2, .prose h3, .prose h4 { margin: 1.3em 0 .45em; line-height: 1.3; font-weight: 680; }
.prose h1 { font-size: 1.35em; } .prose h2 { font-size: 1.2em; } .prose h3 { font-size: 1.08em; } .prose h4 { font-size: 1em; }
.prose ul, .prose ol { margin: 0 0 .8em; padding-left: 1.5em; }
.prose li { margin: .25em 0; }
.prose li > p { margin: 0 0 .35em; }
.prose blockquote { margin: 0 0 .8em; padding: .1px 0 .1px 14px; border-left: 3px solid var(--line-2); color: var(--text-2); }
.prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.prose hr { border: 0; border-top: 1px solid var(--line); margin: 1.4em 0; }
.prose code { font-family: var(--mono); font-size: .86em; background: var(--code-bg); border: 1px solid var(--line); padding: .08em .38em; border-radius: 5px; }
.prose strong { font-weight: 680; }
.prose table { border-collapse: collapse; margin: 0 0 .9em; display: block; overflow-x: auto; max-width: 100%; font-size: .93em; }
.prose th, .prose td { border: 1px solid var(--line); padding: 6px 11px; text-align: left; vertical-align: top; }
.prose th { background: var(--sunk); font-weight: 650; }
.prose img { max-width: 100%; height: auto; border-radius: 6px; }

/* ---- code ---- */
.codewrap { margin: 0 0 .9em; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--code-bg); }
.codebar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px 4px 14px;
  background: var(--sunk); border-bottom: 1px solid var(--line); font: 12.5px/1.6 var(--sans); color: var(--text-3);
}
.codebar .copy { font: 600 12px/1 var(--sans); color: var(--text-2); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 5px 9px; cursor: pointer; }
.codebar .copy:hover { background: var(--hover); color: var(--text); }
.codewrap pre { margin: 0; padding: 11px 14px; overflow-x: auto; }
.codewrap code { font-family: var(--mono); font-size: 13.5px; line-height: 1.6; color: var(--code-text); background: none; border: 0; padding: 0; white-space: pre; display: block; }

/* ---- steps: Claude's tool calls ---- */
.steps { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); margin: 10px 0 14px; overflow: hidden; }
.steps > summary { display: flex; align-items: center; gap: 10px; padding: 9px 14px; font-size: 14px; color: var(--text-2); }
.steps > summary:hover { background: var(--hover); }
.steps > summary > .ti { color: var(--text-3); transition: transform .15s; }
.steps[open] > summary > .ti { transform: rotate(90deg); }
.steps > summary b { color: var(--text); font-weight: 600; }
.steps .tags { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.tag { font-size: 12px; color: var(--text-3); background: var(--sunk); border-radius: 6px; padding: 1px 8px; white-space: nowrap; }
.tag.bad { color: var(--bad); background: var(--bad-bg); }
.steplist { border-top: 1px solid var(--line); }
.steps.single { overflow: visible; }

.step { border-top: 1px solid var(--line); }
.steplist > .step:first-child, .steps.single > .step { border-top: 0; }
.step > summary { display: grid; grid-template-columns: 22px auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 14px; font-size: 14px; }
.step > summary:hover { background: var(--hover); }
.step[open] > summary { background: var(--sunk); }
.step .sic { color: var(--text-3); display: grid; place-items: center; }
.step .verb { color: var(--text-2); font-weight: 600; white-space: nowrap; }
.step .what { font-family: var(--mono); font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step .res { font-size: 12.5px; color: var(--text-3); display: flex; gap: 6px; align-items: center; white-space: nowrap; }
.step.iserr .sic, .step.iserr .verb { color: var(--bad); }
.sbody { padding: 12px 14px 4px; border-top: 1px solid var(--line); background: var(--surface); }
.transcript .plus, .card .plus { color: var(--ok); font-weight: 650; }
.transcript .minus, .card .minus { color: var(--bad); font-weight: 650; }
.step .res .good { color: var(--ok); display: inline-flex; }
.step .res .bad { color: var(--bad); font-weight: 600; }
.step .res .warn { color: var(--warn); font-weight: 600; }
.ctx { font-size: 13px; color: var(--text-3); padding: 4px 14px; border-top: 1px dashed var(--line); }
.ctx > details > summary { font-family: var(--mono); font-size: 12.5px; }
.ctx .stext { white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 12.5px; margin-top: 4px; max-height: 300px; overflow: auto; }
.transcript:not(.show-ctx) [data-cat="context"] { display: none; }

/* ---- file edits ---- */
.card { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); margin: 10px 0 14px; overflow: hidden; scroll-margin-top: 140px; }
.card > summary { display: flex; align-items: center; gap: 10px; padding: 9px 14px; font-size: 14px; background: var(--sunk); }
.card[open] > summary { border-bottom: 1px solid var(--line); }
.card > summary:hover { background: var(--hover); }
.card .verb { font-weight: 600; }
.card .what { font-family: var(--mono); font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.card .what .dir { color: var(--text-3); font-size: 12.5px; }
.card .delta { font-size: 13px; white-space: nowrap; }
.card > summary > .ti:last-child { color: var(--text-3); transition: transform .15s; }
.card[open] > summary > .ti:last-child { transform: rotate(90deg); }
.card .cbody .diff { border: 0; border-radius: 0; }

.diff { border: 1px solid var(--line); border-radius: var(--r); overflow-x: auto; background: var(--code-bg); font: 13.5px/1.6 var(--mono); margin: 0 0 .9em; }
.card .cbody .diff { margin: 0; }
.diff .hunk { padding: 3px 14px; background: var(--sunk); color: var(--text-3); font-size: 12.5px; }
.diff .hunk:not(:first-child) { border-top: 1px solid var(--line); }
.dl { display: flex; white-space: pre; min-width: min-content; }
.dl .no { flex: none; width: 3.6em; padding: 0 8px; text-align: right; color: var(--text-3); user-select: none; font-size: 12.5px; }
.dl .sig { flex: none; width: 1.4em; text-align: center; color: var(--text-3); user-select: none; }
.dl .txt { padding-right: 14px; color: var(--code-text); }
.dl.add { background: var(--add-bg); } .dl.add .no { background: var(--add-no); color: var(--ok); } .dl.add .sig { color: var(--ok); }
.dl.del { background: var(--del-bg); } .dl.del .no { background: var(--del-no); color: var(--bad); } .dl.del .sig { color: var(--bad); }

/* ---- tool output pieces ---- */
.pill { flex: none; font: 600 12px/1.4 var(--sans); padding: 1px 7px; border-radius: 6px; background: var(--sunk); color: var(--text-2); }
.pill.add { background: var(--add-bg); color: var(--ok); }
.pill.del { background: var(--del-bg); color: var(--bad); }
.pill.err { background: var(--bad-bg); color: var(--bad); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.res { margin: 0 0 .9em; }
.res.none { font-size: 13.5px; color: var(--text-3); font-style: italic; }
.reshead { font: 600 13px/1.6 var(--mono); color: var(--text-2); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; word-break: break-all; }
.stderr .codebar { color: var(--bad); }
.note { font-size: 13.5px; color: var(--text-2); margin: 4px 0; }
.note.warn { color: var(--warn); }
.kv { font-size: 14px; margin: 0 0 .7em; display: flex; gap: 8px; }
.kv b { color: var(--text-2); font-weight: 650; flex: none; }
.kv span { font-family: var(--mono); font-size: 13px; word-break: break-all; }
.filelist { margin: 0 0 .6em; padding-left: 1.3em; font-family: var(--mono); font-size: 13px; color: var(--text-2); }
.filelist li { margin: 1px 0; word-break: break-all; }
.todos { list-style: none; margin: 0 0 .8em; padding: 0; font-size: 14px; }
.todo { display: flex; gap: 8px; align-items: baseline; margin: 3px 0; }
.todo .tick { flex: none; width: 1em; }
.todo.completed { color: var(--text-3); text-decoration: line-through; }
.todo.completed .tick { color: var(--ok); text-decoration: none; }
.todo.in_progress { color: var(--text); font-weight: 600; }
.todo.in_progress .tick { color: var(--accent); }
.todo.pending .tick { color: var(--text-3); }
.shot { margin: 0 0 .8em; }
.shot img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; display: block; }

/* ---- events and notices ---- */
.divider { display: flex; align-items: center; gap: 12px; margin: 30px 0 26px; color: var(--text-3); font-size: 13px; }
.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.event {
  display: flex; gap: 12px; align-items: flex-start; margin: 0 0 26px 48px; padding: 11px 14px;
  border: 1px dashed var(--line-2); border-radius: var(--r); font-size: 14px; color: var(--text-2); scroll-margin-top: 140px;
}
.event > .ti { margin-top: 3px; }
.event b { color: var(--text); }
.event.job > .ti { color: var(--ok); }
.event.compact > .ti, .event.compact-summary .ti { color: var(--arch); }
.event details { margin-top: 6px; }
.event details > summary { color: var(--accent); font-weight: 550; }
.event details .codewrap { margin-top: 8px; max-height: 360px; overflow: auto; }
.event.compact-summary { display: block; }
.event.compact-summary > summary { display: flex; gap: 12px; align-items: flex-start; }
.event.compact-summary > .prose { margin-top: 10px; max-height: 480px; overflow: auto; }

.notice { display: flex; gap: 10px; align-items: flex-start; border-radius: var(--r); padding: 9px 14px; margin: 0 0 12px; font-size: 14px; border: 1px solid; scroll-margin-top: 140px; }
.notice > .ti { margin-top: 3px; }
.notice.err { background: var(--bad-bg); border-color: var(--bad-line); }
.notice.err > .ti, .notice.err > summary > .ti { color: var(--bad); }
.notice.warn { background: var(--warn-bg); border-color: var(--warn-line); }
.notice.warn > .ti { color: var(--warn); }
.notice.note { background: var(--sunk); border-color: var(--line); color: var(--text-2); }
.notice.note > .ti { color: var(--text-3); }
details.notice { display: block; }
details.notice > summary { display: flex; gap: 10px; align-items: flex-start; }
details.notice ul { margin: 8px 0 2px 26px; padding-left: 16px; color: var(--text-2); }
.notice .codewrap { margin-top: 6px; }

/* ---- the conversation-only view: your messages and Claude's answers ---- */
.transcript.convo-only .msg.ai .body > :not(.who):not(.final):not(.queued) { display: none; }
.transcript.convo-only .msg.ai:not(:has(.final, .queued)) { display: none; }
.transcript.convo-only .event, .transcript.convo-only .notice, .transcript.convo-only .ctx { display: none; }
.transcript.convo-only .final { border-left-width: 3px; }

.hit, .hit > .bubble { outline: 3px solid var(--accent); outline-offset: 4px; border-radius: var(--r); transition: outline-color 1.5s; }

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
    --bg: #fff; --surface: #fff; --sunk: #f6f6f6; --text: #000; --text-2: #333; --text-3: #555;
    --code-bg: #f6f6f6; --code-text: #111; --you-bg: #f3f5fa;
  }
  .transcript { font-size: 10.5pt; line-height: 1.5; }
  .msg { break-inside: avoid-page; margin-bottom: 14px; }
  .step, .card, .notice, .event { break-inside: avoid; }
  /* Print everything, including what is folded away on screen. */
  details:not([open]) > *:not(summary) { display: revert !important; }
  .bubble.long:not(.expanded) { max-height: none; overflow: visible; }
  .bubble.long::after, .bubble .more { display: none !important; }
  .codebar .copy { display: none; }
  .codewrap pre, .codewrap code, .dl { white-space: pre-wrap; word-break: break-word; }
  a { color: inherit; text-decoration: none; }
  .noprint { display: none !important; }
}
`;

/** Full conversation CSS: variables, light + dark, layout, print. */
function transcriptCss() {
  return [TOKENS, DARK, TRANSCRIPT, PRINT].join('\n');
}

module.exports = { transcriptCss, TOKENS, DARK, TRANSCRIPT, PRINT };
