# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.1.0
[1.0.1]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.0.1
[1.0.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.0.0
