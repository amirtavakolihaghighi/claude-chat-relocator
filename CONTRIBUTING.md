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

The tests build their own store in a temp directory (`test/helpers.js`) and
redirect the app's data directory too, so they can never touch real history. If
you add a test that writes, use the same helpers.

To try the app against realistic data, copy a folder somewhere else and point
the app at it with the store picker in the top bar, or:

```bash
CLAUDE_PROJECTS_DIR=/path/to/a/copy npm start
```

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
- **Prefer no new dependencies.** There are four, all mainstream. If you need a
  fifth, say why in the PR.
- **Match the surrounding code.** Plain CommonJS, two-space indent, comments
  that explain *why* rather than restating the line below.

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
4. `renderInput()` / `renderResult()` in `server/exporters/markdown.js`.

Unknown tools already fall back to pretty-printed JSON, so this is polish
rather than a requirement.

## Reporting bugs

Please do not paste session file contents into an issue — they contain your
whole conversation. A folder name and the terminal output are almost always
enough. The issue template covers what helps.

## Security

If you find something that could damage or expose someone's chat history,
please read [SECURITY.md](SECURITY.md) rather than opening a public issue.
