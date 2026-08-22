# Security

## What this tool touches

It reads and writes two places on your machine:

- `~/.claude/projects` — your Claude Code chat history. It renames folders here
  and rewrites `cwd` fields inside `.jsonl` files.
- `~/.claude-chat-relocator` — its own backups, operation history, and
  temporarily staged zip uploads.

It does not modify your actual project files, and it never sends anything
anywhere. There is no telemetry, no update check, and no network call of any
kind. The only outbound traffic your browser makes is to `127.0.0.1`.

## Threat model

The server binds to `127.0.0.1` and has **no authentication**. Anything able to
make HTTP requests from your machine can, while the app is running:

- list directories on your disk (`/api/fs/browse`)
- read any chat transcript in the configured store
- rename chat folders and rewrite their contents

That is acceptable for a local single-user tool and is the same authority a
script you ran yourself would have. It is **not** safe to expose to a network.

Do not:

- bind it to `0.0.0.0` or put it behind a reverse proxy
- run it on a shared or multi-user machine while others are logged in
- forward the port through SSH or a tunnel to somewhere public

Leave it running only while you are using it.

## Handling of chat content

Transcript text is treated as untrusted input. Raw HTML inside a message is
escaped, never injected, in both the live viewer and the HTML export, so a
message containing markup cannot execute anything. Folder and session names are
validated before being used as path segments, and paths are checked to be
inside the configured store.

Exports are plain files written wherever your browser saves downloads. A
self-contained HTML export embeds the full conversation, including any
screenshots — treat an exported file as being as sensitive as the chat itself
before sharing it.

## Reporting a vulnerability

If you find something that could destroy, corrupt, or expose chat history,
please report it privately rather than opening a public issue:

- Use GitHub's [private vulnerability reporting][gh] on this repository
  (Security → Report a vulnerability), or
- open an issue that says only "security report, please make contact" with no
  details, and wait to be contacted.

[gh]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

Please include what you did, what happened, and whether data was lost. A
reproduction against a *copied* store is ideal — please do not send session
files from your real history.

Expect an acknowledgement within a week. This is a spare-time project, not a
funded one, so there is no bounty and no guaranteed response window beyond
best effort.

## Supported versions

The latest release on `main` is the supported version. Fixes are not backported.
