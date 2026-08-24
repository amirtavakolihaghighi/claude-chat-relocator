# Changelog

## [0.1.0] - unreleased

First working version. Not published to any marketplace yet.

### Added

- Checks the workspace you open against the Claude Code chat store, and offers
  to relocate chats that are recorded against a path which no longer exists.
- Status bar item showing the chat count for the current workspace, turning
  into a warning when orphaned chats look like they belong here.
- Commands: check this workspace, relocate chats here, reveal the chat folder,
  undo the last relocation.
- Relocation goes through the same planner the web app uses: dry run first,
  full backup, and undoable from a button in the success notification.
