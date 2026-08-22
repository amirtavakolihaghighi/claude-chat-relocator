# Architecture

A local Node server with a plain-DOM front end. No build step, no bundler, no
framework. `npm install && npm start` is the whole toolchain.

## Why a server and not a pure browser app

The obvious design — a static page using the File System Access API — cannot do
the main job:

- **The browser never reveals an absolute path.** A directory picker hands back
  `"MyProject"`, not `E:\Work\MyProject`. Without the absolute path there is
  nothing to encode into a folder name, so the user would have to type every
  path by hand.
- **The API cannot rename a directory.** You would have to copy every file to a
  new handle and delete the original — slower, and far more dangerous on the
  only copy of someone's chat history.

A local server gets real paths, an atomic `fs.rename`, and proper backups. It
binds to `127.0.0.1` only.

## Request flow

```
browser  ──GET /api/projects──────────►  store.js    scan + orphan detection
         ──GET /api/session/:f/:id───►  parser.js   .jsonl  → turns
                                          render.js  turns   → HTML
         ◄─────────── JSON: metadata + one HTML string per turn

         ──POST /api/relocate/plan───►  relocate.js  dry run, no writes
         ──POST /api/relocate/apply──►  relocate.js  backup → rewrite → rename
```

The server renders transcript HTML rather than shipping raw records. That keeps
markdown, syntax highlighting and diff rendering in one place, so **the live
view and the HTML export are produced by the same code** and cannot drift apart.

## Modules

| File | Responsibility |
|---|---|
| `server/paths.js` | The encoding rule, plus path comparison and re-rooting. No I/O. |
| `server/parser.js` | `.jsonl` → a chat-shaped transcript. Pure data, no HTML. |
| `server/render.js` | Transcript → HTML. Markdown, highlighting, diffs, tool cards. |
| `server/theme.js` | The stylesheet, shared by the viewer and the export. |
| `server/store.js` | Scanning, health checks, parsed-session LRU cache. |
| `server/relocate.js` | Plan, apply, bulk remap, undo. Every write lives here. |
| `server/search.js` | Cross-chat full-text search with a per-file index cache. |
| `server/archive.js` | Zip export and import with path remapping. |
| `server/exporters/` | `html.js` (self-contained), `markdown.js`. |
| `server/index.js` | HTTP routes and static hosting. |
| `public/` | Front end: `index.html`, `app.js`, `styles.css`. |

## The record format

A session file is one JSON object per line. Thirteen record types occur in
practice; four carry conversation:

- **`user`** — either a real message from you, or a `tool_result` answering a
  tool call. The parser tells them apart and folds results back into the call
  they belong to, so a tool result never appears as a phantom user turn.
- **`assistant`** — content blocks: `text`, `thinking`, `tool_use`. Carries
  `usage`, `model`, and `effort`.
- **`system`** — `api_error` and `stop_hook_summary`.
- **`attachment`** — mostly ambient context Claude Code injects; only
  `edited_text_file` and `queued_command` are conversation.

The rest (`ai-title`, `mode`, `last-prompt`, `queue-operation`,
`file-history-snapshot`, `file-history-delta`, `frame-link`, `atis-latch`) are
metadata. `ai-title` supplies the human-readable chat title.

Two details worth knowing:

- **Thinking text is not stored.** `thinking` blocks carry a signature and an
  empty string. The parser counts them and marks the beat in the transcript,
  but there is no reasoning text on disk to show.
- **The rich tool result is on the `user` record**, as `toolUseResult`, next to
  the raw block. It has `structuredPatch` for edits and separated
  `stdout`/`stderr` for shell commands, so real diffs come for free.

## How writes are made safe

1. **Dry run first.** `planRelocate` reads everything and writes nothing, and
   the UI will not enable Apply until a plan comes back clean.
2. **Full backup.** The folder is copied to `~/.claude-chat-relocator/backups/`
   before a byte changes.
3. **Text-level edits.** `.jsonl` files are edited line by line with a regex
   that finds the encoded `cwd` string, decodes it to confirm the value, and
   swaps in the new one. Records are never re-serialised from parsed objects —
   re-encoding a 5 MB line could silently reformat a number or reorder keys,
   and this is the user's only copy.
4. **Temp file then rename.** Each file is written beside the original and
   renamed over it.
5. **Collisions refused.** Two chat folders are never merged automatically.
6. **Undo.** Every operation is recorded with its backup location.

`test/relocate.test.js` asserts point 3 directly: after a relocation, blanking
out the `cwd` values in the before and after text must leave the two byte-identical.

## Caching

- **Scan** — keyed by a signature of folder and file mtimes, so a rescan is
  skipped when nothing moved.
- **Sessions** — an LRU of six parsed sessions, keyed by path, mtime and size.
- **Search** — a compact `{turnIndex, kind, text}` index per file, keyed the
  same way. The first search pays for parsing; the rest are instant.

## Images

Base64 screenshots inside tool results can be megabytes. The parser lifts them
out into a side table and leaves a reference behind, so the transcript payload
stays small and the browser fetches each image on demand from `/api/img/...`.
The HTML exporter walks the same references but inlines them as data URIs,
which is what makes the export self-contained.

## Security posture

This is a local tool that reads and writes your home directory. It binds to
loopback, has no authentication, and should not be exposed to a network.
Transcript content is treated as untrusted text: raw HTML in a message is
escaped rather than injected, and session and folder names are validated before
being used as path segments.
