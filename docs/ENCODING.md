# How Claude Code names chat folders

This is the whole reason the tool exists, so it is worth understanding on its
own — whether or not you ever run the app.

## The rule

Claude Code stores each project's chats in `~/.claude/projects/<name>`, where
`<name>` is derived from the project's absolute path:

1. **Lowercase the drive letter.**
2. **Replace every character that is not `a–z`, `A–Z` or `0–9` with a dash.**

That is the entire rule. There is no escaping, no hashing, no length limit
handling.

```
D:\Files\Projects\AI_Chat_Extractor   ->   d--Files-Projects-AI-Chat-Extractor
```

The leading `d--` is the drive letter, then `:` becomes a dash, then `\`
becomes another. Underscores become dashes too, which is why `AI_Chat_Extractor`
reads as `AI-Chat-Extractor`.

Case is preserved everywhere except the drive letter. Spaces, dots, and dashes
are all just "not alphanumeric", so they all become dashes.

## Why your chats vanish when you move a project

The extension does not store a pointer to your chats. When you open a
workspace, it computes the folder name from the workspace path and looks there.

Move `D:\Files\Projects\MyApp` to `E:\Dev\MyApp` and the extension starts
looking for `e--Dev-MyApp`. Your chats are still sitting in
`d--Files-Projects-MyApp`, which nothing looks at any more. Nothing is deleted —
it is simply never found.

## The rule is one-way

You cannot decode a folder name back into a path. Given:

```
d--Files-Projects-My-App
```

the original might have been any of:

```
D:\Files\Projects\My_App
D:\Files\Projects\My App
D:\Files\Projects\My-App
D:\Files\Projects\My.App
D:\Files/Projects/My App
```

There is no way to tell. **The real path survives only inside the files.**
Claude Code stamps a `cwd` field on nearly every record in every `.jsonl`:

```json
{"type":"user","cwd":"D:\\Files\\Projects\\My_App","message":{...}}
```

That is what this tool reads to recover the true path, and it is why a proper
relocation has to rewrite those fields as well as rename the folder. Renaming
alone leaves every record inside claiming the project still lives somewhere it
does not.

## Non-Latin paths

The rule is applied **per character**, and every non-ASCII character is
"not alphanumeric". So a five-letter Persian folder name becomes five dashes:

```
C:\Quiz\کوییز\4- Working   ->   c--Quiz-------4--Working
                                        ^^^^^^^
                                        \  کوییز  \
                                        1 + 5 + 1 = 7 dashes
```

A real example, verified end to end:

```
C:\Users\Amir-TH Laptop\Documents\Files\Documents\Jobs\Quiz\کوییز\
   4- Working\Qok\Work\LiveOps\Seasons\TBM - Season 75\Worldcup Survey

c--Users-Amir-TH-Laptop-Documents-Files-Documents-Jobs-Quiz-------4--Working-
Qok-Work-LiveOps-Seasons-TBM---Season-75-Worldcup-Survey
```

This works correctly, but it has three consequences worth knowing about.

### 1. Names get long

One character in, one dash out. Deep paths with non-Latin segments produce very
long folder names — the example above is 133 characters. Windows caps a single
folder name at 255 characters and a full path at 260 unless long paths are
enabled, and the session files inside add roughly another 43. The app refuses
names past 255 and warns when the full path gets close to the limit.

### 2. Different projects can collide

Because the actual characters are discarded, **two unrelated projects whose
names differ only in non-Latin characters of the same length produce the same
folder name**:

```
C:\Work\کوییز   ->   c--Work------
C:\Work\سلامت   ->   c--Work------      <- identical
```

Claude Code will put both projects' chats in that one folder. This is a
property of the encoding, not of this tool. The app detects it — a folder whose
records contain more than one distinct root `cwd` is flagged **ambiguous**, and
relocation tells you that only the chats matching the chosen path will move.

### 3. Unicode normalisation matters

Some characters can be written more than one way. `é` may be a single code
point, or `e` followed by a combining accent — two characters, so two dashes:

```
C:\a\café   (composed)     ->   c--a-caf-
C:\a\café   (decomposed)   ->   c--a-cafe-
```

The extension encodes whatever string the OS hands it. Typing a path by hand is
where the two spellings can drift apart, so the app warns when the text you
typed would encode differently from its normalised form — and browsing to a
folder rather than typing it avoids the problem entirely, because the path is
then read straight from disk.

## Doing it by hand

If you would rather not run anything:

1. Work out the new folder name using the rule above.
2. Rename the folder in `~/.claude/projects`.
3. Search and replace the old `cwd` value inside every `.jsonl` in it.

Back the folder up first. Step 3 is the one people skip, and it is the one that
leaves chats loading but misbehaving.
