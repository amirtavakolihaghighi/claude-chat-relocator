# Help and guide

This app lets you read every chat you've had with Claude Code in the VS Code
extension, outside VS Code. It also fixes chats that VS Code can no longer
find, and keeps a permanent archive so that nothing you and Claude said is ever
lost.

Everything happens on your own computer. Nothing is sent anywhere.

Every action that changes something lasting explains itself first, in a box
called **About this action**. Every warning and error has a short code, such
as `W-LIVE`, and a **What does this mean?** link that leads to its entry in
[Messages and what they mean](#messages-and-what-they-mean).

## Getting started

1. **Start the app.** Double-click `start.cmd` on Windows, or `start.sh` on a
   Mac or Linux. A black console window opens and then your browser. Leave the
   console window open while you use the app: closing it stops the app.
2. **Look at Home.** It lists every project you've chatted in and anything
   that needs fixing.
3. **Read a chat.** Click a project in the left column, then a chat.
4. **Set up the archive** once, on the **Archive** page, so chats Claude Code
   deletes are kept. See [Setting up the archive](#setting-up-the-archive).

### The screen at a glance

| Where | What it is |
|---|---|
| Top bar | The **sidebar button** (far left), Search, **Move many projects**, **Import / Export** (zip files for another computer), **Undo history**, Settings (gear), Help (?) and light/dark. |
| Left column, top | **Home**, **Archive**, **Memory files** and **Help & guide**. |
| Left column, Projects | One entry per folder you've chatted in. Click it to see its chats. A coloured label means something about it needs attention; click the label to learn what. |
| Left column, bottom | **Chat folder**: the folder the chats are read from. You rarely need to change it. |
| The rest | Whatever you opened: Home, a chat, the archive, memory files or this guide. |

Filters above the project list: **All**, **Needs fixing** (only appears when
something does) and **Archived** (only appears when your archive holds chats
Claude Code no longer has).

### The sidebar and small windows

The left column is called the sidebar. You can shape it to suit the window you
are working in. Each computer remembers its own choice.

- **Make it wider or narrower.** Move the mouse over the sidebar's right edge
  until the pointer turns into a left-right arrow, then drag. Double-click the
  edge to put it back to its usual width. With the keyboard, click the edge once
  and use the left and right arrow keys (hold Shift for bigger steps).
- **Shrink it to icons.** The **double arrow** at the top of the sidebar keeps
  only the icons, to leave more room for what you are reading. Point at an icon
  to see its name. The **folder icon** brings the project list back. Press the
  double arrow again to widen it.
- **Close it.** The **sidebar button** at the far left of the top bar hides the
  sidebar completely. Press it again to bring back whatever you had before.
- **Put it back.** If it ends up somewhere awkward, open Settings and press
  **Put the sidebar back to its usual size**.

The app also changes shape to fit the window, the way most apps do:

| Window | What changes |
|---|---|
| Wide (a desktop screen) | Everything shown with its words, and the sidebar stays beside the page. |
| Medium (a laptop, or a window dragged narrower) | The top buttons keep their icons and lose their words. Point at one to see what it does. |
| Narrow (a tablet, or a small window) | The sidebar is hidden to give the page the whole width. The sidebar button slides it open over the page. It closes again when you pick something, press **Esc**, or click outside it. |
| Very narrow (a phone) | The three rarer top buttons (**Move many projects**, **Import / Export**, **Undo history**) move into the sidebar, under **Tools**. |
| Very short | A chat's header keeps its title and buttons, and hides the folder path and the counts so there is room to read. **Details** still shows them. |
| Tiny | Below roughly 320 pixels across or 420 down, nothing shrinks any further. The page scrolls instead, sideways and up and down. |

## Reading a chat

Click a chat in the left column. At the top you see its title, the project it
belongs to, when it happened and how long it took. Below that is the
conversation.

- **Your messages** are in blue bubbles. A long message is cut short with
  **Show the whole message** below it. A **pasted** label means you pasted that
  text in.
- **Claude's reply** is everything Claude did before you spoke again. Its words
  read as normal text. The work it did in between is folded into short
  lines:
  - **Looked around — 5 steps**, **Ran commands — 3 steps** and so on. Click
    one to see each step. Click a step to see exactly what was run or read,
    and what came back.
  - **File changes** stay open as cards that show the lines removed (red) and
    added (green). Large changes start folded.
- **Answer**, with a green line beside it, marks the reply in which Claude
  finished and handed the chat back to you. See
  [Answers and the pinned bar](#answers-and-the-pinned-bar).
- **"40 minutes later"** lines mark long pauses, and a date appears when a
  chat continued on another day.
- Dashed boxes are things that happened around the conversation:
  - **A background job finished**: something Claude started earlier, such as
    a helper agent or a long command, reported back. Claude carried on by
    itself; nobody typed it.
  - **Claude Code compacted the conversation here**: see
    [What is compaction?](#what-is-compaction).
- Red boxes are connection problems. Several in a row are folded into one
  line.

The buttons at the top of a chat:

- **Open project in VS Code**: opens the project's folder in a new window. See
  [Open in your editor](#open-in-your-editor).
- **Export**: save the chat as a file. See
  [Saving a chat as a file](#saving-a-chat-as-a-file).
- **Details**: numbers about the chat. See [Chat details](#chat-details).
- **Full chat / Conversation only**: see [Conversation only](#conversation-only).
- **⋯** (more): open or fold every step, show background context, relocate.

**Background context** is what Claude Code adds behind the scenes: which files
you had open, reminders, hook output. It is hidden because it is rarely
interesting. Turn it on from the **⋯** menu.

### Answers and the pinned bar

Two kinds of message are special: **yours**, and **Claude's answers**.

**What an answer is.** Claude replies in steps: a sentence, a few commands, a
file change, another sentence. Most of those sentences are notes along the
way. An **answer** is the reply in which Claude stopped working and handed the
chat back to you.

**How the app knows.** It does not guess from the wording. With every reply,
Claude Code saves the reason Claude stopped: either "I'm finished, your turn"
(`end_turn`) or "I'm about to run something" (`tool_use`). Only the first
counts as an answer. That is why an answer can sit in the **middle** of a
chat: Claude finished, then a job it had started earlier reported back, and
Claude carried on without you typing anything. Those answers are marked too.

**What does not count:** notes Claude writes while still working, and notices
Claude Code writes itself ("session limit reached", "login expired"). Those
are not Claude's words.

**The pinned bar.** As you scroll down, the last of your messages or Claude's
answers that you scrolled past stays pinned in a slim bar under the chat's
title: blue for yours, green for an answer. When you scroll past the next one,
it takes that place. **Jump to it** scrolls back to the full message.

Messages **you typed while Claude was still working** count as yours too. They
appear inside Claude's reply in a dashed blue box, where they arrived.

### Conversation only

**Conversation only** hides everything except your messages and Claude's
answers. It's the quickest way to reread a long chat: what you asked, and what
Claude finally said.

- **What it does:** hides every step, file change, note and event.
- **What you'll see:** a much shorter chat. The pinned bar still works.
- **Good to know:** the choice is remembered for every chat until you switch
  back. Exports made while it is on are conversation-only too. A reply that has
  no answer (Claude was stopped, for example) disappears in this view.

### Search

Type in the box at the top and every chat is searched at once: your messages,
Claude's replies, the commands it ran and what they printed. Click a result to
open the chat at that spot. Press `/` anywhere to jump to the search box.

- Results are grouped by chat, up to 12 lines per chat.
- The first search after starting the app takes a moment, because it reads
  every chat. Later searches are instant.
- Chats that are only in your archive are not searched yet.

### Saving a chat as a file

From **Export** at the top of a chat:

| Format | What you get |
|---|---|
| **Web page (.html)** | One file that looks exactly like the app, with Conversation only and light/dark. Opens on any computer without this app, offline, and prints to a clean PDF. |
| **Markdown (.md)** | Plain text with headings and code blocks, for notes or for a GitHub issue. |
| **The original file (.jsonl)** | Exactly what Claude Code saved, byte for byte. |
| **Print or save as PDF** | Opens a print-ready page with every step unfolded. In the print window, choose "Save as PDF". |

If **Conversation only** is on when you export, the web page and Markdown file
contain only your messages and Claude's answers.

### Chat details

**Details** at the top of a chat shows numbers about it:

- **Your messages**, **Claude's answers**, **Steps** (tools Claude used) and
  **Connection problems**.
- **Model** and **Git branch**: which Claude and which branch of your project.
- **Cost Claude Code recorded**: what the chat would have cost at API prices.
  On a subscription you don't pay this; it shows how much work the chat was.
- **Compactions**: how many times Claude Code compacted this chat.
- **Thinking**: how often Claude thought before answering. Claude Code does
  not save the text of the thinking, only that it happened.
- **Tokens**: how much text Claude read and wrote. "From cache" is text Claude
  had already read and could reuse cheaply.
- **Files changed**: every file Claude edited or wrote.

### What is compaction?

A chat can grow longer than Claude can hold in mind at once. When that
happens, Claude Code **compacts** it: Claude writes itself a summary of the
conversation so far, and carries on from the summary.

**Nothing is deleted.** The full conversation stays in the chat file, and the
app shows all of it. You'll see a dashed **Claude Code compacted the
conversation here** line where it happened, and below it **The summary Claude
Code wrote for itself**, which you can open and read.

## Project states

Each project in the left column can carry a label. They mean different things.

### Folder missing

**The project folder these chats belong to is not on this computer any
more.** You moved it, renamed it, or the chats came from another computer.

The chats are safe. VS Code still lists them, but only under a folder you can
no longer open. To fix it, tell the app where the project lives now:
[Relocate](#relocate).

### Hidden from VS Code

**The chat folder has the wrong name, so VS Code never looks inside it.**
VS Code works out which folder to read from the project's path. If the chat
folder was renamed by hand, the names no longer match and the chats are
invisible in VS Code, though they're safe on disk.

To fix it, use **Fix the name** on its card on Home: see
[Fix the name](#fix-the-name).

### Shared folder

**Chats from two different projects ended up in one chat folder.** Claude Code
turns every character that is not a plain letter or digit into a dash. Two
project names that differ only in, say, Persian or Chinese letters of the same
length then become the same folder name.

The chats are not mixed up inside, only stored together. Relocating moves the
chats recorded against the path shown first; the rest stay. See
[ENCODING.md](https://github.com/amirtavakolihaghighi/claude-chat-relocator/blob/main/docs/ENCODING.md)
for the details of how names are made.

### Archive only

**Claude Code no longer has these chats, but your archive does.** Most often
Claude Code deleted them because they were older than its
[keep-chats setting](#keeping-chats-for-longer). They still open and read
normally here.

To see them in VS Code again: [Putting chats back](#putting-chats-back).

### Empty or no path

**Empty**: the chat folder has no chats in it. **No path**: the chats never
recorded which folder they were in, so the app cannot work out where the
project was. You can still read them. Relocate needs a recorded path.

## Fixing things

### Relocate

- **What it does:** moves a project's chats over to the folder where the
  project lives now. It renames the chat folder to what VS Code expects, and
  updates the path written inside each chat. Both are needed: renaming the
  folder alone is the common half-fix.
- **What you'll see:** first a preview. You see the chat folder's old and new
  name, how many paths will be updated, and any warnings. **Nothing changes
  until you press Relocate.** Afterwards the project shows as healthy, and
  VS Code lists the chats when you open the new folder.
- **Good to know:**
  - A full backup is made first, and [Undo history](#undo-history) can put it
    all back.
  - **Close VS Code windows that have this project open first.** VS Code may
    write the old path back while you relocate (see [W-LIVE](#w-live-a-chat-changed-in-the-last-90-seconds)).
  - The new folder does not have to exist yet; you'll get a warning
    ([W-NO-FOLDER](#w-no-folder-the-new-folder-does-not-exist-yet)).

Choose the project folder itself, the one you open in VS Code: type it, or use
**Browse…**.

### Old mentions

When you relocate, the preview may say "37 old mentions kept". Those are
places where the old path appears inside what happened: a command Claude ran,
a file it read, its output. They are a record of the past, not settings, so
they are left exactly as they were. Only the paths Claude Code uses to find
the project are changed.

### Fix the name

For a project that is [hidden from VS Code](#hidden-from-vs-code).

- **What it does:** renames the chat folder to the name VS Code looks for.
  Nothing inside the chats changes.
- **What you'll see:** the project turns healthy, and its chats appear in
  VS Code the next time you open the project.
- **Good to know:** a backup is taken first, so [Undo history](#undo-history)
  can put it back.

### Move many projects

For when you moved a whole folder of projects (`D:\Projects` to `E:\Dev`), or
copied everything to a new computer.

- **What it does:** every project that used to live under the old folder is
  relocated to the same place under the new one, in one go. Sub-folders are
  kept: `D:\Projects\Work\App` becomes `E:\Dev\Work\App`.
- **What you'll see:** a table of every project that will move and where to.
  Projects that are not under the old folder are left alone, and the table
  says how many. Nothing changes until you press **Relocate them all**.
- **Good to know:** each project gets its own backup and its own Undo entry. A
  batch where two projects would end up with the same folder name is refused
  before anything runs ([E-BULK-COLLIDE](#e-bulk-collide-two-projects-would-get-the-same-folder-name)).

### Undo history

- **What it does:** lists every relocation, newest first. **Undo** puts a chat
  folder back exactly as it was before, from the backup taken at the time.
- **What you'll see:** the old and new folder name of each relocation. Undone
  entries are greyed out.
- **Good to know:**
  - Close VS Code windows on that project before undoing.
  - Anything added to those chats after the relocation is replaced by the
    backup.
  - **Delete backup** frees disk space, but that relocation can then never be
    undone.
  - Backups are kept in `.claude-chat-relocator\backups` in your user folder.

### Open in your editor

**Open project** opens a project's folder in a new editor window. VS Code,
Cursor, Windsurf, VSCodium, Zed, Sublime Text and JetBrains IDEs are found
automatically. With more than one installed, the app asks which.

The button is greyed out, with the reason when you point at it, when the
folder is not on this computer ([E-OPEN-MISSING](#e-open-missing-the-folder-is-not-on-this-computer)), or when no
editor was found ([E-NO-EDITOR](#e-no-editor-no-editor-found)).

## Moving chats between computers

### Export to a zip

- **What it does:** packs the chats of the projects you tick into one zip
  file, with a note of where each project lived on this computer.
- **What you'll see:** your browser downloads the zip. Nothing on this computer
  changes.
- **Good to know:** the zip holds your chats as plain text. Keep it private.

### Import from a zip

- **What it does:** reads a zip made by **Export**, or any zip of chat folders,
  and puts each project's chats into Claude Code's folder under the right name
  for where that project lives on this computer.
- **What you'll see:** a list of the projects in the zip, with the path each
  had before. Type or browse to where each one lives now, tick **Skip** for any
  you don't want, then press **Import**.
- **Good to know:**
  - A project that already has chats here is skipped, never merged: it shows
    **Already here**.
  - A zip without the note of paths still works. The paths are worked out from
    the chats themselves, so check them.
  - An uploaded zip waits for a day; after that, choose it again
    ([E-ZIP-EXPIRED](#e-zip-expired-the-upload-has-expired)).

## The archive

Claude Code **deletes chats after 30 days** unless you change its
[keep-chats setting](#keeping-chats-for-longer). And Claude **rewrites its
memory files** as it learns, so their earlier wording disappears. A backup you
make by copying folders and overwriting the old copy loses things both ways.

The archive keeps everything, by three rules:

1. **A chat that only grew** replaces the archived copy. Claude Code only ever
   adds to the end of a chat (compaction adds to the end too), so the old copy
   is the start of the new one. Nothing is lost and no second copy is needed.
2. **A file that was rewritten**, usually a memory file, keeps every earlier
   version, compressed and stored once each. You can read each version and see
   what changed: [Older versions](#older-versions).
3. **A file Claude Code deletes stays** in the archive, with the date it
   disappeared.

**Nothing is ever deleted from the archive.**

The archive is a folder you choose. Inside it:

| Folder or file | What it holds |
|---|---|
| `projects` | The most complete copy of every chat and memory file, laid out exactly like Claude Code's own folder. |
| `versions` | Earlier versions of rewritten files. |
| `index.json` | What is held, with sizes and dates. |
| `log.jsonl` | One line per save: what changed and why. |
| `ABOUT THIS FOLDER.txt` | This explanation, for anyone who finds the folder. |

### Setting up the archive

On the **Archive** page:

- **What it does:** copies every chat and memory file into the folder you
  choose, and from then on keeps adding to it.
- **What you'll see:** the copy takes a few seconds to a minute. Then the page
  shows how much is kept, and what happened.
- **Good to know:**
  - Choose a folder on **another drive** if you can, and never a public or
    shared one: your chats are private.
  - The archive cannot be inside Claude Code's own chat folder
    ([E-ARCHIVE-INSIDE](#e-archive-inside-the-archive-is-in-the-wrong-place)).
  - If you already copied chats by hand, give that folder as the **old backup**
    and it is taken in too. See [Importing an old backup](#importing-an-old-backup).

To use another folder later: Settings → Archive → **Use another folder…**. The
old folder is left as it is.

### Automatic saving

- **What it does:** adds an entry ("hook") to Claude Code's settings, so the
  archive saves what changed **after every Claude reply**, **just before a
  compaction** and **when a chat closes**.
- **What you'll see:** nothing in VS Code. On the Archive page the status says
  "saves automatically after every reply", and the last-saved time keeps
  moving.
- **Good to know:**
  - The save runs in the background and never slows Claude down.
  - Your other Claude Code hooks are left exactly as they were, and a copy of
    the settings file is kept first, in
    `.claude-chat-relocator\claude-settings-backups`.
  - Turn it off from Settings or the Archive page.
  - The hook runs this copy of the app. If you move or delete the app's
    folder, turn automatic saving off and on again from the new place.
  - Without automatic saving, use **Save now** on the Archive page now and
    then.

### Importing an old backup

For a folder of chats you copied by hand earlier: one folder per project
inside, like Claude Code's own folder.

- **What it does:** takes in everything the archive does not have yet: chats,
  memory files and older versions.
- **What you'll see:** a summary of what was added. Chats Claude Code already
  deleted now appear in the app, marked **Archived**.
- **Good to know:**
  - The folder you import is only read, never changed.
  - If the backup has a **shorter copy** of a chat the archive holds in full,
    it is ignored: everything in it is already there.
  - If the backup has a **different version** of a file, both are kept. The
    newer one becomes the current copy.
  - You can import the same folder twice: nothing is doubled.

### Putting chats back

For chats that are only in your archive.

- **What it does:** copies the chat from your archive back into Claude Code's
  folder, with any helper chats and saved output that belong to it.
- **What you'll see:** VS Code lists the chat again the next time you open its
  project, or after **Developer: Reload Window**. You can carry on with it.
- **Good to know:**
  - Files already in Claude Code are never overwritten.
  - If Claude Code still deletes chats after 30 days, an old chat you put back
    will be deleted again. Your archive keeps its copy either way. See
    [Keeping chats for longer](#keeping-chats-for-longer).

### What happened

The list at the bottom of the Archive page shows every save that changed
something, newest first:

| It says | Meaning |
|---|---|
| **new** | Files the archive did not have before. |
| **grew** | Chats that got longer. The archive now has the longer copy. |
| **rewritten (old version kept)** | A file changed in a way that was not just adding to the end. Both versions are kept. |
| **shorter copies ignored** | From an import: the archive already had the full version. |
| **deleted from Claude Code (still kept here)** | Claude Code removed these. The archive still has them. |
| **back in Claude Code** | Files that had gone and are back, for example after you put them back. |
| **could not be read** | A file was locked or unreadable. The next save tries again. |

Saves where nothing changed are not listed.

### Keeping chats for longer

Claude Code has a setting, `cleanupPeriodDays`, for how many days it keeps a
chat. The default is 30. It is not in the settings file until you add it.

To keep chats for 100 years, open `.claude\settings.json` in your user folder
and add this line inside the outer `{ }`:

```json
"cleanupPeriodDays": 36500,
```

Don't use `0`: Claude Code rejects it. The archive keeps everything whatever
this setting says. The setting just means VS Code can still list old chats.

## Memory files

Claude keeps notes between chats: who you are, how you like to work, the state
of each project. They live in a `memory` folder beside each project's chats.
Claude Code never deletes them for age, but Claude rewrites them as it learns.

The **Memory files** page lists them by project. Click one to read it.

- **In Claude Code**: the file is there now.
- **Only in your archive**: Claude deleted it; the archive kept it.
- A number beside a file: how many older versions the archive holds.

At the top of most notes, a small grey box says what kind of note it is
(**About you**, **Feedback**, **Project note** or **Reference**), gives its name
and a one-line description. **Technical details** unfolds the rest of the
settings block at the top of the file. That part is Claude Code's own
bookkeeping, so you can ignore it. A note with no such block shows no box.

### Older versions

When a memory file has older versions, buttons appear above it: one per
version, by date, then **Current**, then **What changed**.

- Click a date to read the file as it was then.
- **What changed** compares the latest older version with the current one:
  lines removed in red, lines added in green. A removed line is not lost: it is
  in the older version.

## Settings

Open Settings with the gear at the top right.

- **Chat folder**: where the chats are read from. See
  [The chat folder](#the-chat-folder).
- **Archive**: where your archive is, **Show in Explorer**, **Use another
  folder…**, and automatic saving on or off.
- **Appearance**: follow Windows, always light, or always dark. The moon button
  at the top right switches between light and dark directly.

### The chat folder

Normally the app reads Claude Code's own folder, `.claude\projects` in your
user folder, and you never change this. Point it somewhere else only to read a
copy, for example a folder restored from an old computer. Relocating then works
on that folder. The choice is remembered until you choose
**Use Claude Code's own**.

## Messages and what they mean

Every warning (`W-`) and error (`E-`) the app shows has an entry here. A
warning lets you go ahead; an error stops the action until it is sorted out.

### E-NOT-ABSOLUTE: Not a full path

The path you typed does not start at a drive (`D:\...`) or, on a Mac or Linux,
at `/`. Type the whole path, or use **Browse…**.

### E-NO-CWD: No recorded path

These chats never recorded which folder they were in, so there is no old path
to update. You can still rename the chat folder by hand: see "Doing it by
hand" in the README.

### W-NO-FOLDER: The new folder does not exist yet

Nothing exists at the path you gave. Relocating still works, but VS Code only
shows these chats once you open a folder at exactly that path. Check for a
typo, or go ahead if you are about to create or copy the folder there.

### E-NAME-TOO-LONG: The folder name would be too long

A folder name can be at most 255 characters. Claude Code turns every character
of the project's path into one character of the name, so a deeply nested
project, especially one with non-Latin letters, can go over. Move the project
somewhere shallower, then relocate.

### W-PATH-LONG: The full path would be very long

Windows limits a full path to 260 characters unless long paths are turned on.
The chat files inside add about 43 characters, so some programs may fail to
open them. Prefer a shallower location for the project.

### W-UNICODE: Letters that can be written two ways

Some letters, for example in Persian, Arabic or with accents, can be stored in
Unicode in two different ways that look identical. The way you typed it gives
a different folder name from the way your computer stores it, so VS Code would
look in a different place. Use **Browse…** instead of typing, so the path is
read straight from disk.

### W-SHARED: This folder holds chats from more than one project

See [Shared folder](#shared-folder). Only the chats recorded against the
project you are relocating are moved; the others stay in the old folder.

### E-TARGET-EXISTS: A chat folder for that path already exists

Another chat folder already has the name these chats would get, usually
because you have already chatted in the project at its new place. The app
never merges two chat folders by itself.

To combine them by hand: close VS Code, copy the `.jsonl` files from one
folder into the other in Explorer, then press **Rescan**. Better still,
[export](#export-to-a-zip) one first as a backup.

### W-NAME-OK: The name is already right

The chat folder's name already matches the new path. Only the paths written
inside the chats will be updated.

### W-SAME-PATH: Nothing to do

The new path is the same as the recorded one.

### E-UNREADABLE: A chat file could not be read

A file in this chat folder could not be opened: it may be locked by another
program, or you may not have permission. Close VS Code and try again.

### W-LIVE: A chat changed in the last 90 seconds

**One of these chats was written to less than a minute and a half ago, so it
may be open in VS Code right now.** Claude Code writes to a chat while you use
it. If you relocate while it is open, VS Code can write the old path back into
the file and undo part of the fix.

Close that chat, or VS Code, wait a minute, and try again. If you are sure
nothing is open, you can go ahead.

### E-BULK-COLLIDE: Two projects would get the same folder name

Moving everything would give two projects the same chat folder name, usually
because their names differ only in letters Claude Code turns into dashes. Leave
those two out by choosing a narrower old folder, and relocate them one at a
time.

### E-BULK-BLOCKED: Some projects cannot move

At least one project in the batch has a problem of its own. The table shows
the reason under each one. Relocate it separately, or leave it out by choosing
a narrower old folder.

### E-UNDO-UNKNOWN: Not in the history

That relocation is no longer in the history. The history keeps the last 200.

### E-UNDO-DONE: Already undone

That relocation has been undone already.

### E-UNDO-NO-BACKUP: The backup is gone

The backup for that relocation was deleted, so it can't be undone
automatically. To reverse it by hand, relocate the project back to its old
path.

### E-UNDO-EXISTS: The old folder is back

A chat folder with the old name exists again, usually because VS Code started
a new chat in the project's old place. Rename or remove that folder in
Explorer, then undo.

### E-OPEN-MISSING: The folder is not on this computer

The project folder does not exist here, so it can't be opened. Relocate the
chats first.

### E-NO-EDITOR: No editor found

No supported editor could be started from this computer. For VS Code: open
it, press `Ctrl+Shift+P`, run **Shell Command: Install 'code' command in
PATH**, restart the app, then press **Rescan**.

### E-ZIP-BAD: Not a zip file

The file you chose is not a readable zip. Make sure it finished downloading,
and that it is the `.zip` itself rather than a folder unpacked from it.

### E-ZIP-EMPTY: No chats in the zip

The zip has no folders with `.jsonl` chat files in them. It should contain one
folder per project, as Claude Code's own folder does, or as **Export** makes.

### E-ZIP-EXPIRED: The upload has expired

An uploaded zip waits for a day before it is cleaned up. Choose the file again.

### E-NOT-A-FOLDER: Not a folder

The path you gave is not a folder on this computer. Check it, or use
**Browse…**.

### E-NO-SESSION: Chat not found

That chat is not in the chat folder any more: it was moved, deleted, or the
chat folder was changed. Press **Rescan**.

### E-ARCHIVE-INSIDE: The archive is in the wrong place

The archive cannot be inside Claude Code's own chat folder, nor the other way
round, because each would end up copying itself. Choose a folder somewhere
else, ideally on another drive.

### E-ARCHIVE-BUSY: A save is already running

The archive is already saving, probably an automatic save after Claude's last
reply. Wait a few seconds and press **Save now** again.

### E-ARCHIVE-NONE: No archive yet

The archive has not been set up. Open the **Archive** page and choose a folder
for it.

### E-ARCHIVE-OWN: That is Claude Code's own folder

**Import an old backup** is for copies you made earlier. Claude Code's own
chats are saved with **Save now**, or automatically.

### E-SETTINGS-JSON: Claude Code's settings file is broken

Claude Code's settings file, `.claude\settings.json` in your user folder, is
not valid JSON, usually because of a missing comma or quote from a hand edit.
The app will not change a file it cannot read safely. Open it in VS Code, which
underlines the mistake in red, fix it, and try again.

### E-AUTO-SAVE-FAILED: An automatic save had a problem

The archive's background save failed; the message says why. The most common
causes:

- the archive's drive was not connected;
- the app's folder was moved, so the hook points at the old place. Turn
  automatic saving off and on again.

The failures are listed in `.claude-chat-relocator\archive-errors.log` in your
user folder. The next successful save catches up on everything missed.

### W-UNREADABLE-LINES: Parts of a chat could not be read

A few lines of the chat file are damaged, usually the last line of a chat that
was being written when VS Code closed. They are skipped; the rest of the chat
is intact. The original file is not changed.

## Privacy

Everything runs on your computer. The app makes no network connections and
sends nothing anywhere. It only answers on your own computer (`127.0.0.1`), and
has no password, so never make it reachable from a network. Your archive and
exports hold your chats as plain text: keep them private.
