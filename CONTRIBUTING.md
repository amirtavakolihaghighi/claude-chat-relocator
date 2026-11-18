# Contributing

Thanks for looking. This is a small, deliberately narrow tool, and the bar for
changes is mostly about safety rather than style.

## Getting set up

```bash
git clone https://github.com/amirtavakolihaghighi/claude-chat-relocator.git
cd claude-chat-relocator
npm install
npm test
npm run dev        # starts the server with --watch
```

Node 20 or newer. There is no build step, no bundler, and no transpiler — what
you edit is what runs.

## The one rule that matters

**Never test against your real `~/.claude/projects`.**

The tests build their own store in a temp directory (`fixtures/store.js`) and
redirect the app's data directory too, so they can never touch real history. If
you add a test that writes, use the same helpers.

To try the app against realistic data, copy a folder somewhere else and point
the app at it, keeping the app's own settings and Claude Code's settings out of
it too:

```bash
CLAUDE_PROJECTS_DIR=/path/to/a/copy CLAUDE_RELOCATOR_DATA=/tmp/relocator-data CLAUDE_SETTINGS_FILE=/tmp/claude-settings.json npm start
```

| Variable | Replaces |
|---|---|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects`, the chats read |
| `CLAUDE_RELOCATOR_DATA` | `~/.claude-chat-relocator`: settings (including the archive's location), backups, history |
| `CLAUDE_SETTINGS_FILE` | `~/.claude/settings.json`, where automatic saving adds its hook |

## What a good change looks like

- **Anything that writes to disk needs a test.** `test/relocate.test.js` is the
  model: it asserts that after a relocation, blanking the `cwd` values out of
  the before and after text leaves the two byte-identical. Writes should stay
  that surgical.
- **Keep the dry run honest.** If you add a step to `applyRelocate`, add the
  matching prediction to `planRelocate`. The plan is a promise about what will
  happen, and the UI will not let a user proceed until it comes back clean.
- **Do not re-serialise session files.** `.jsonl` records are edited as text.
  Parsing a 5 MB record and stringifying it back could reformat a number or
  reorder keys, and this is often the only copy someone has.
- **Explain every action in the app.** A dialog that changes something lasting
  opens with an "About this action" box (`about()` in `public/app.js`): what it
  does, what you will see, what is good to know. Every message gets a code and
  an entry in `docs/HELP.md`.
- **Prefer no new dependencies.** There are four, all mainstream. If you need a
  fifth, say why in the PR.
- **Match the surrounding code.** Plain CommonJS, two-space indent, comments
  that explain *why* rather than restating the line below.

Fixtures live in `fixtures/` rather than `test/`, because Node's test runner
treats every file under a `test` directory as a test file and would otherwise
run the helper as one.

To see the app in every state it can report — a missing project, a folder the
extension cannot find, two projects sharing one folder — build a throwaway
store:

```bash
node scripts/demo-store.js
```

It prints the command to start the app against it, and the folder to delete
afterwards. Nothing it does touches `~/.claude`. The demo also has a chat
that shows every part of the conversation view, memory files, and an archive
with a "deleted" chat and an older memory version.

## Checks to run before a pull request

```bash
npm test                          # every test, no real data touched
node scripts/ui-check.js          # drives every page in headless Chrome (Node 22+)
node scripts/privacy-scan.js      # personal data in anything git would publish
```

The UI check builds the demo store, starts the server against it with its own
settings, visits every page and dialog, and fails on any error the page logs.
Add `--shots <folder>` to get screenshots — the README's come from there.

Turn on the privacy hook once per clone, so a push that would publish an
e-mail address, a home-folder path or a credential is refused before it
leaves your machine:

```bash
git config core.hooksPath .githooks
```

Values no pattern can catch (your user name, a client's name) go in a
`.privacy-blocklist` file, one per line. It is git-ignored; the scan reads it
where it exists. Every message code (`W-LIVE`, `E-TARGET-EXISTS`...) needs an
entry in [docs/HELP.md](docs/HELP.md) — a test checks it.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit
together, and [docs/ENCODING.md](docs/ENCODING.md) for the folder-name rule the
whole tool is built around. Read the encoding document before touching
`server/paths.js` — the rule is lossy in ways that are easy to get wrong.

## Adding support for a tool

Claude Code gains tools over time. To render a new one nicely:

1. `toolSummary()` in `server/parser.js` — the one-line collapsed label.
2. `classifyResult()` in `server/parser.js` — if the result has a shape worth
   special handling (a diff, a file, separated streams).
3. `renderToolInput()` / `renderToolResult()` in `server/render.js`.
4. `TOOL_KIND` and `VERB` in `server/view.js` — which icon and verb its step
   gets, and how it is counted in a step summary ("read 3 files").
5. `renderInput()` / `renderResult()` in `server/exporters/markdown.js`.

Unknown tools already fall back to pretty-printed JSON, so this is polish
rather than a requirement.

## Reporting bugs

Please do not paste session file contents into an issue — they contain your
whole conversation. A folder name and the terminal output are almost always
enough. The issue template covers what helps.

## Security

If you find something that could damage or expose someone's chat history,
please read [SECURITY.md](SECURITY.md) rather than opening a public issue.
