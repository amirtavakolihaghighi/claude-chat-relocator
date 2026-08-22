# Getting this into non-developers' hands

Ranked by how much friction they face, easiest first. The repository ships
option 2 today; the rest are here as a roadmap.

## 1. A hosted web page — not possible

Worth stating up front, because it is everyone's first instinct. This cannot be
a website you visit.

A page in a browser cannot see absolute paths (a directory picker returns
`"MyProject"`, never `E:\Work\MyProject`), cannot rename a directory, and
cannot reach `~/.claude/projects` at all. The whole job is filesystem work on
the user's own machine. It has to run locally.

What it *can* be — and is — is a local program with a browser for its window.

## 2. Double-click launcher — shipped

`start.cmd` (Windows) and `start.sh` (macOS/Linux). The user downloads the
repository as a zip, unpacks it, and double-clicks one file. The launcher:

- checks whether Node is installed, and if not, explains where to get it in
  plain language and opens the download page;
- runs `npm install` on first launch only, with an explanation of why it is
  waiting;
- starts the server and opens the browser.

**Friction:** they must install Node once, and they must not be scared of a
console window sitting there while they work.

**Why it is the default:** zero build infrastructure, works on every platform,
and nothing to keep in sync with releases.

## 3. A single `.exe` with Node bundled — recommended next step

Removes the Node install entirely. The user downloads one file and runs it.

### Option A — Node's own single executable applications

Built into Node 20+, no third-party tooling.

```bash
node --experimental-sea-config sea-config.json
node -e "require('fs').copyFileSync(process.execPath, 'relocator.exe')"
npx postject relocator.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

with `sea-config.json`:

```json
{
  "main": "server/index.js",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true,
  "assets": {}
}
```

The catch: SEA does not bundle `node_modules` or the `public/` folder. You need
to bundle the server into one file first (esbuild works:
`npx esbuild server/index.js --bundle --platform=node --outfile=bundled.js`)
and embed the front-end assets, either through SEA's `assets` map or by
inlining them as strings at build time.

### Option B — `@yao-pkg/pkg`

The maintained fork of the archived `pkg`. Less work, handles assets:

```bash
npx @yao-pkg/pkg . --targets node22-win-x64,node22-macos-arm64,node22-linux-x64 --out-path dist
```

with this added to `package.json`:

```json
"pkg": {
  "assets": ["public/**/*", "node_modules/highlight.js/**/*"],
  "scripts": []
}
```

Watch out for `highlight.js`, which resolves language files at runtime — hence
listing it in `assets`.

### Signing

An unsigned `.exe` triggers SmartScreen ("Windows protected your PC"), and
unsigned macOS binaries are refused outright unless the user right-clicks →
Open. A code-signing certificate costs real money; without one, say plainly in
the README what the warning looks like and how to get past it.

## 4. A real desktop app

Electron or Tauri, giving a native window, a proper OS folder picker, and no
console. Electron adds ~150 MB; Tauri is small but needs Rust and a rewrite of
the server as a sidecar or as Rust commands.

Only worth it if the browser-window-plus-console arrangement genuinely bothers
people. The app already works well in a browser tab.

## 5. `npx`, for developers

Once published to npm:

```bash
npx claude-chat-relocator
```

Nothing to clone, nothing to install. Still requires Node, so it is a
convenience for developers rather than an answer for everyone else.

## Automating releases

A tag-triggered workflow can build binaries for all three platforms and attach
them to a GitHub release, so non-developers get a download link rather than a
repository. Sketch:

```yaml
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
            target: node22-win-x64
            artifact: relocator-win-x64.exe
          - os: macos-latest
            target: node22-macos-arm64
            artifact: relocator-macos-arm64
          - os: ubuntu-latest
            target: node22-linux-x64
            artifact: relocator-linux-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx @yao-pkg/pkg . --targets ${{ matrix.target }} --output ${{ matrix.artifact }}
      - uses: softprops/action-gh-release@v2
        with:
          files: ${{ matrix.artifact }}
```

This is deliberately **not** enabled in the repository yet — a release workflow
that has never successfully run is worse than none, and it should be tested on
a fork before being trusted with a real tag.

## Making the app itself friendlier

Packaging is only half of it. Things that matter regardless of how it is
delivered:

- **Say what will happen before it happens.** The relocation dry run already
  does this, in sentences rather than counts.
- **Never make someone type a path.** Browse is always available, and it also
  sidesteps the Unicode normalisation trap described in
  [ENCODING.md](ENCODING.md).
- **Explain failures in terms of what to do next**, not what went wrong
  internally — "close VS Code first", not "EBUSY".
- **Make undo obvious.** People are far braver when they can see a way back.
