# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- 74 tests covering the encoding rule, parsing, relocation, archives and
  rendering, run on Node 20/22/24 across Linux, Windows and macOS.

### Notes

- Non-Latin paths (Persian, Arabic, Cyrillic, CJK) are handled correctly: the
  encoding turns each character into one dash. See
  [docs/ENCODING.md](docs/ENCODING.md) for the consequences — long names,
  possible collisions between unrelated projects, and Unicode normalisation.
- Historical path references inside tool output and edit snippets are
  deliberately left untouched during relocation. They record what happened at
  the time and are not configuration.

[1.0.0]: https://github.com/amirtavakolihaghighi/claude-chat-relocator/releases/tag/v1.0.0
