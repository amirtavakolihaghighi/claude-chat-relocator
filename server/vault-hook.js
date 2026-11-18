#!/usr/bin/env node
'use strict';
/*
 * Run by Claude Code (see server/hooks.js) after every reply, before a
 * compaction, and when a chat closes. It must never slow Claude down or make
 * it stop, so it starts the save as a separate background process and exits
 * straight away with success, whatever happens.
 */
const { spawn } = require('child_process');
const path = require('path');

try {
  const child = spawn(process.execPath, [path.join(__dirname, 'vault-cli.js'), 'save', '--from-hook'], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
} catch { /* never fail the hook */ }

// Claude Code writes a small JSON description of the event to stdin. Read it
// to the end so it never meets a closed pipe, then leave.
process.stdin.on('data', () => {});
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
setTimeout(() => process.exit(0), 1500).unref();
