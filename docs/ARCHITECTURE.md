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
                                          routes-archive.js  + chats only the archive has
         ──GET /api/session/:f/:id───►  parser.js   .jsonl  → turns
                                          view.js    turns   → conversation HTML
         ◄─────────── JSON: metadata + the conversation in reading order

         ──POST /api/relocate/plan───►  relocate.js  dry run, no writes
         ──POST /api/relocate/apply──►  relocate.js  backup → rewrite → rename

         ──POST /api/vault/save─────►  vault.js     store → archive
Claude Code hook ─► vault-hook.js ─► vault-cli.js save   (in the background)
```

The server renders transcript HTML rather than shipping raw records. That keeps
markdown, syntax highlighting and diff rendering in one place, so **the live
view and the HTML export are produced by the same code** and cannot drift apart.

## Modules

| File | Responsibility |
|---|---|
| `server/paths.js` | The encoding rule, plus path comparison and re-rooting. No I/O. |
| `server/parser.js` | `.jsonl` → a chat-shaped transcript. Pure data, no HTML. |
| `server/render.js` | The pieces: Markdown, highlighting, diffs, tool input and output. |
| `server/view.js` | Turns → the conversation: replies, folded steps, edit cards, answers. |
| `server/theme.js` | The stylesheet, shared by the viewer and the export. |
| `server/store.js` | Scanning, health checks, parsed-session LRU cache. |
| `server/relocate.js` | Plan, apply, bulk remap, undo. Every write lives here. |
| `server/search.js` | Cross-chat full-text search with a per-file index cache. |
| `server/archive.js` | Zip export and import with path remapping. |
| `server/exporters/` | `html.js` (self-contained), `markdown.js`. |
| `server/vault.js` | The permanent archive: save, import, versions, restore. |
| `server/hooks.js` | Adds and removes the automatic-saving hook in Claude Code's settings. |
| `server/vault-cli.js` | The archive from the command line; the worker the hook starts. |
| `server/vault-hook.js` | What Claude Code runs: starts a save in the background, exits at once. |
| `server/routes-archive.js` | Routes for the archive, memory files and help. |
| `server/index.js` | HTTP routes and static hosting. |
| `docs/HELP.md` | The user guide, shown inside the app as well as on GitHub. |
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

The rest (`ai-title`, `custom-title`, `mode`, `last-prompt`, `queue-operation`,
`file-history-snapshot`, `file-history-delta`, `frame-link`, `atis-latch`,
`api-request`, `api-request-blob`, `session-owner`, `cost-state`,
`tools-used`, `worktree-state`, `relocated`) are metadata. `ai-title`
supplies the chat's title, and `custom-title` — a name you gave it — wins
over it. `cost-state` carries Claude Code's running cost figure, shown in
Details.

Since late 2026 the `system` record also carries `compact_boundary`,
`informational` and `model_refusal_fallback`, and a `user` record can be a
compaction summary or a background-job report (see below).

Two details worth knowing:

- **Thinking text is not stored.** `thinking` blocks carry a signature and an
  empty string. The parser counts them and marks the beat in the transcript,
  but there is no reasoning text on disk to show.
- **The rich tool result is on the `user` record**, as `toolUseResult`, next to
  the raw block. It has `structuredPatch` for edits and separated
  `stdout`/`stderr` for shell commands, so real diffs come for free.

## From records to a conversation

Claude Code writes one record per content block, so one reply from Claude is
often dozens of records. `view.js` groups everything between two of your
messages into one reply. Claude's words read as prose; runs of tool calls fold
into one summarised line ("Ran commands — 3 steps: read 2 files, ran 1
command"); file edits stay visible as change cards.

Two kinds of message are marked for the pinned bar and the "Conversation only"
view:

- **Yours**: a real `user` record, or a `queued_command` attachment whose
  `origin.kind` is `human` (you typed while Claude worked). Records that only
  look like user messages are not: tool results, compaction summaries
  (`isCompactSummary`), and background-job reports (`origin.kind` of
  `task-notification`, or `peer` for a helper agent).
- **Claude's answers**: assistant text whose API `stop_reason` is `end_turn`.
  That is the API's own record that Claude finished and handed the chat back;
  notes written mid-task stop with `tool_use`. So the marking is exact, and
  finds answers in the middle of a chat too: Claude finished, then a job it had
  started reported back and it carried on. Notices Claude Code writes as if
  Claude said them have the model `<synthetic>` and are shown as notices.

## The archive

Claude Code deletes transcripts after `cleanupPeriodDays` (30 by default), and
Claude rewrites memory files in place. `vault.js` keeps all of it, in a
folder laid out like `~/.claude/projects` plus a store of earlier versions:

- A file that **only grew** (a chat: Claude Code appends, and compaction
  appends a `compact_boundary` record and a summary) replaces the held copy.
  Checking that the held copy's SHA-256 equals the hash of the new file's first
  *n* bytes proves nothing was lost, so no second copy is kept.
- A **shorter copy** of a held file (an old backup) is checked byte for byte
  against the start of the held copy and ignored when it matches.
- Anything else is a **rewrite**: both are kept. The newer by modification time
  becomes the current copy; the other is stored gzip-compressed under its
  SHA-256, once.
- A file missing from Claude Code's folder is marked with the date it went.
  Nothing is ever deleted from the archive.

A save takes a lock file. A save asked for while one runs leaves a note, and
the running save goes round again. The index is written every 25 changes and
at the end; an interrupted save is healed by the next one, which re-hashes any
held file whose size or date no longer matches the index.

Automatic saving uses Claude Code's hooks: `Stop` (after every reply),
`PreCompact` and `SessionEnd`. The hook script starts `vault-cli.js save` as
a detached process and exits with success at once, so Claude is never kept
waiting and never sees a failure. Failures go to `archive-errors.log` and show
on the Archive page.

Restoring copies a chat and its own folder (subagent chats, saved tool output)
back into `~/.claude/projects`, never over an existing file, keeping the
original modification time so it sorts where it belongs.

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
