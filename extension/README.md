# Claude Chat Relocator — VS Code extension

Notices when the Claude Code chats for the project you just opened are
recorded against a path that no longer exists, and repoints them in one click.

> **Not published to any marketplace.** This is built to be installed from a
> `.vsix` file for now. See [Installing](#installing) below.

## What it does

Claude Code names each project's chat folder after the project's absolute
path. Move the project and the extension that writes those chats can no longer
find them — they are still on disk, in a folder nothing looks at.

This extension knows which workspace you have open, so it can spot that the
moment it happens:

> Claude has 47 chats for a project called "MyApp", recorded at a path that no
> longer exists. Do they belong to this workspace?
> **[Relocate them here] [Choose…] [Not now]**

It also puts the chat count for the current workspace in the status bar, which
turns into a warning when orphaned chats look like they belong to it.

## Commands

Run these from the command palette (`Ctrl+Shift+P`):

| Command | What it does |
|---|---|
| **Claude Chats: Check this workspace** | Report what the store has for this workspace |
| **Claude Chats: Relocate chats to this workspace** | Pick an orphaned folder and repoint it here |
| **Claude Chats: Reveal the chat folder for this workspace** | Open it in the file manager |
| **Claude Chats: Undo the last relocation** | Restore the most recent one from its backup |

## Settings

| Setting | Default | |
|---|---|---|
| `claudeChats.storePath` | `~/.claude/projects` | Where Claude Code keeps its chats |
| `claudeChats.checkOnStartup` | `true` | Check when a workspace opens |
| `claudeChats.showStatusBar` | `true` | Show the chat count in the status bar |

## Safety

Relocation goes through the same planner the web app uses:

- **You see the plan first** — the new folder name, how many recorded paths
  change, and in which files — in a modal you have to confirm.
- **The whole folder is backed up** to `~/.claude-chat-relocator/backups/`
  before anything is written.
- **Undo** sits in the success notification, and in the command palette
  afterwards.
- `.jsonl` files are edited as text, replacing only the `cwd` value, so no
  other byte can shift.

Nothing leaves your machine. There is no telemetry and no network access.

## Installing

```bash
git clone https://github.com/amirtavakolihaghighi/claude-chat-relocator.git
cd claude-chat-relocator/extension
npm run package          # produces claude-chat-relocator-0.1.0.vsix
```

Then in VS Code: **Extensions** → `⋯` menu → **Install from VSIX…**

To work on it instead, open the `extension` folder in VS Code and press **F5**.
That launches a second VS Code window with the extension loaded, and needs no
build step.

## The full tool

This extension deliberately does one thing. For reading transcripts, searching
across every chat, exporting to HTML or Markdown, bulk remapping and portable
archives, use the web app in the parent repository:

```bash
npm install && npm start
```

## Licence

[MIT](../LICENSE). Not affiliated with or endorsed by Anthropic.
