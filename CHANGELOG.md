# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-11-21

The app now fits any window, from a wide desktop screen down to a phone, and
its sidebar can be resized, narrowed to icons or closed. It also fixes three
bugs found in daily use: Browse in the folder picker, a stray "null" in memory
files, and the Memory page jumping back to the top. This is a minor version:
nothing you used has moved, and everything you saved keeps working.

### Added

- **The sidebar is yours to shape.** Drag its edge to make it wider or
  narrower (double-click the edge to reset), shrink it to an icon strip, or
  close it with the new button at the far left of the top bar. The choice is
  remembered per browser, and Settings can put it back to its usual size.
- **The layout follows the window.** Laptop, tablet and phone sizes each get a
  fitting layout: on a tablet or phone the sidebar slides over the page instead
  of squeezing it, and on a phone the rarer top buttons move into it. A short
  window shrinks the chat header so there is room to read. A window smaller
  than 320 x 420 scrolls instead of cutting things off.
- **Memory files show a tidy note box.** The settings block at the top of each
  memory file used to appear as a rule and one giant heading with every line
  run together. It is now a small box with the kind of note, its name and its
  one-line description, and the rest folds away under **Technical details**.
- The browser check now covers all of this: it drags the sidebar with a real
  mouse, resizes the window to laptop, tablet, phone and tiny sizes, and fails
  if any page runs off the side.

### Fixed

- **Browse in the folder picker did nothing.** Choosing a folder and pressing
  **Use this folder** closed the picker but threw the choice away, so the field
  kept its old path. Typing or pasting a path worked, which hid the problem.
  The picker also now ignores a folder listing that arrives late, if you have
  already clicked somewhere else.
- **A stray "null" at the top of memory files** that have no older versions.
- **Clicking a memory file jumped both scrollbars back to the top.** The file
  list is no longer rebuilt, so it keeps its place, and so does the page.
- **The top bar spilled off the right edge** of narrow windows, and its
  **Import / Export** button showed only an arrow once its words were hidden.
- **A button with a long label ran off the edge of a phone-sized window** on
  systems whose text is wider than Windows' (found on a Linux machine). Such a
  button now wraps its label. The browser check tests with deliberately wide
  fonts, so the same slip is caught on any computer.
- Links from one entry of [docs/HELP.md](docs/HELP.md) to a message code
  (for example from Relocate to W-LIVE) went nowhere when the guide was read
  on GitHub. The app now names its help headings the way GitHub does, so the
  same links work in both places, and a test checks every link by GitHub's
  rule.

## [2.0.0] - 2026-11-19

The app grows from a relocation tool into a reader and permanent archive for
your Claude Code chats, with a new interface built for reading. This is a major
version because the interface is reorganised: buttons moved and were renamed,
and "Archive" now means the permanent archive, while the zip export lives under
**Import / Export**. Everything 1.x saved — settings, backups, undo history —
keeps working.

### Added

- **A permanent archive.** A folder you choose that keeps every chat and memory
  file, and never deletes anything. Claude Code removes chats after 30 days by
  default, and Claude rewrites its memory files; the archive keeps both:
  - a chat that only grew replaces its archived copy, proven by hash to
    contain the old one;
  - a file that was rewritten keeps every earlier version, compressed, stored
    once each;
  - a file Claude Code deletes stays, dated, and keeps appearing in the app,
    marked **Archived**.
- **Automatic saving** after every Claude reply, before compaction and when a
  chat closes, through Claude Code hooks. The hook starts the save in the
  background and returns at once. It can be turned on and off from the app,
  keeps your other hooks, saves a copy of Claude Code's settings file first, and
  will not write a settings file that is not valid JSON.
- **Import an old backup folder** into the archive. Shorter copies of chats the
  archive holds in full are recognised and ignored; differing versions are both
  kept, the newer as the current copy.
- **Put chats back** into Claude Code from the archive, with their helper chats
  and saved output, never over an existing file, keeping their original dates.
- **Memory files**: a page listing the notes Claude keeps per project, with
  every older version and a line-by-line comparison.
- **Claude's answers are marked**, using the stop reason Claude Code records
  with each reply (`end_turn`), not the wording. This finds answers in the
  middle of a chat too: given before a background job reported back and
  Claude carried on.
- **A pinned bar** that keeps the last of your messages or Claude's answers you
  scrolled past in view.
- **Conversation only**: just your messages and Claude's answers. Also for the
  HTML and Markdown exports.
- **Help everywhere.** [docs/HELP.md](docs/HELP.md), a guide to every feature
  and every message, is shown inside the app as a page and as a side panel.
  Every dialog opens with *What it does / What you'll see / Good to know*, and
  every warning and error carries a code (`W-LIVE`, `E-TARGET-EXISTS`...) and a
  link to its explanation.
- **Settings**: chat folder, archive folder, automatic saving, light or dark.
- **Chat details** show the cost Claude Code recorded, and how often the chat
  was compacted.
- **A VS Code extension**, in `extension/`. It knows which workspace you have
  open, so it can notice at that moment that the chats for it are recorded
  against a path which no longer exists, and offer to repoint them. Status bar
  item with the chat count, four commands, and relocation through the same
  planner the web app uses — plan shown first, backup taken, undo offered in
  the success notification. Not published to any marketplace: build a `.vsix`
  with `cd extension && npm run package`, or press F5 in the `extension`
  folder.
- `npm run archive -- save | import <folder> | restore | status`, the archive
  from a terminal.
- `scripts/ui-check.js`, which drives every page of the app in headless Chrome
  against the demo store and fails on any error the page reports. CI runs it.
- `scripts/privacy-scan.js` and a pre-push hook in `.githooks/`, which refuse a
  push that would publish an e-mail address, a home-folder path, a credential,
  image metadata, a non-noreply commit identity, or a value listed in a local
  blocklist. CI runs it too.
- The demo store now has a chat showing every part of the conversation view,
  memory files, and an archive.
- `CLAUDE_RELOCATOR_DATA` and `CLAUDE_SETTINGS_FILE` move the app's own data and
  the Claude Code settings file it edits, for demos and tests.

### Changed

- **A new interface, built for reading.** Larger text (nothing below 12 px),
  higher contrast, light and dark themes, icons with every status, and plain
  words: *Folder missing*, *Hidden from VS Code*, *Move many projects*, *Undo
  history*.
- **Chats read as a conversation.** Everything Claude did between two of your
  messages is one reply. Runs of tool calls fold into one line that says what
  happened ("Ran commands — 3 steps: read 2 files, ran 1 command"), file edits
  stay visible as change cards, and long pauses, background jobs, compaction and
  connection problems are shown where they happened. Before, every step was its
  own message with its own header.
- Messages you typed while Claude was working appear as yours, where they
  arrived. Before, they were a grey "Queued input" line.
- Background-job reports, the summary written at compaction, and notices Claude
  Code writes as if Claude said them ("session limit reached") are no longer
  shown as messages from you or from Claude.
- Text you pasted shows without its `<pasted_content>` wrapper, marked
  *pasted*. Long messages are shortened, with **Show the whole message**.
- A name you gave a chat in VS Code is used instead of the automatic title.
- The chat's toolbar is down to **Open project**, **Export**, **Details** and
  **Full chat / Conversation only**; the rest is in a **⋯** menu.
- CI uses the current major versions of its actions, has time limits, cancels
  superseded runs, and adds the browser and privacy checks.

### Fixed

- Examples in the code, the tests and `docs/ENCODING.md` used the names of real
  projects from the store the tool was first built against. They now use
  invented names with the same shape.
- The README's screenshots showed a real Windows account folder. They are
  replaced with screenshots of the demo store.

## [1.1.0] - 2026-08-23

### Added

- **Open a project in your editor** from the app. Every project row, the
  dashboard table and the chat header get an Open button that launches the
  folder in a new window. VS Code, VS Code Insiders, Cursor, Windsurf,
  VSCodium, Zed, Sublime Text, WebStorm and IntelliJ IDEA are detected on your
  PATH; if more than one is installed the app asks which. The button is
  disabled, with the reason, for a project whose folder is not on this machine.

## [1.0.1] - 2026-08-23

### Fixed

- **Drive letters now compare case-insensitively on every platform, not just
  Windows.** Claude Code records both `D:\Files\Foo` and `d:\Files\Foo` for a
  single project. On Linux and macOS those were treated as two different
  projects, so a store copied off a Windows machine and opened elsewhere
  reported its folders as shared between two projects — a false diagnosis from
  the check that exists to give an accurate one. The rest of a POSIX path still
  compares case-sensitively.
- The test suite could not run on Node 20. It was invoked with a glob pattern,
  and glob support in Node's test runner only arrived in Node 21.
- One test asserted a Windows path separator, so it failed on Linux and macOS.
  Fixtures now keep their own separator regardless of which platform builds
  them.

### Added

- A **"sharing a folder"** count on the dashboard. The state was already
  detected and badged in the sidebar, but was missing from the summary row, so
  it was invisible at a glance. The card appears only when the count is
  non-zero.
- `scripts/demo-store.js`, which builds a throwaway store containing every
  state the app can report — healthy projects, one whose folder is missing, one
  renamed so the extension cannot find it, and two that share a folder because
  their names encode identically. For screenshots, and for trying a relocation
  on data nobody cares about. It never touches `~/.claude`.
- Screenshots in the README.

### Changed

- Test fixtures moved from `test/` to `fixtures/`. Node's test runner treats
  every file under a `test` directory as a test file, so the shared helper was
  being run as one.
- CI is green on Node 20, 22 and 24 across Linux, Windows and macOS. It was
  passing only on Windows with Node 22 and 24 at the time of the 1.0.0 release.

## [1.0.0] - 2026-08-22

First release.

### Added

- **Transcript viewer** — renders a session as a conversation: markdown,
  syntax-highlighted code, unified diffs for every `Edit`, separated
  stdout/stderr for shell commands, todo lists, and inline screenshots. Tool
  calls collapse to one line and expand on demand.
- **Relocation** — repoint a chat folder at a project's new location. Renames
  the folder *and* rewrites the `cwd` field on every record inside, which is
  the half that renaming alone misses. Dry run first, full backup before any
  write, and undo afterwards.
- **Health checks** — flags chat folders whose project directory no longer
  exists (`missing`), whose name no longer encodes their recorded path so the
  extension cannot find them (`hidden`), and folders shared by more than one
  project because their paths encode identically (`shared`).
- **Bulk remap** — repoint every project under one parent folder in a single
  pass, for moving a projects directory or setting up a new machine. Refuses a
  batch that would land two folders on the same name.
- **Search** — full-text across every chat at once, covering your messages,
  Claude's replies, tool commands and tool output. Results jump to the message.
- **Exports** — self-contained HTML (images inlined, prints to a clean PDF),
  Markdown, the raw `.jsonl`, and the parsed transcript as JSON.
- **Portable archives** — export chats as a zip with a manifest of each
  project's absolute path; import on another machine and remap the paths.
  Hand-made zips work too, with paths recovered from the files themselves.
- **Session statistics** — token usage, tool breakdown, duration, model, API
  errors, and the files a session changed.
- Double-click launchers for Windows (`start.cmd`) and macOS/Linux
  (`start.sh`) that install dependencies on first run.
- 72 tests covering the encoding rule, parsing, relocation, archives and
  rendering.

### Notes

- Non-Latin paths (Persian, Arabic, Cyrillic, CJK) are handled correctly: the
  encoding turns each character into one dash. See
  [docs/ENCODING.md](docs/ENCODING.md) for the consequences — long names,
  possible collisions between unrelated projects, and Unicode normalisation.
- Historical path references inside tool output and edit snippets are
  deliberately left untouched during relocation. They record what happened at
  the time and are not configuration.

[2.1.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v2.1.0
[2.0.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v2.0.0
[1.1.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.1.0
[1.0.1]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.0.1
[1.0.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.0.0
