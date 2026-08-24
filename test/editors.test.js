'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const ED = require('../server/editors');

// These tests never launch an editor. They cover the refusal paths, which are
// the ones that matter: the request names an editor by id, and an id that is
// not on the list must never reach a spawn.

test('detect returns a well-formed list, empty or not', async () => {
  const found = await ED.detect(true);
  assert.ok(Array.isArray(found));
  for (const e of found) {
    assert.equal(typeof e.id, 'string');
    assert.equal(typeof e.name, 'string');
    assert.equal(typeof e.command, 'string');
    assert.ok(ED.EDITORS.some((x) => x.id === e.id), `${e.id} must come from the allowlist`);
  }
});

test('every entry in the allowlist is a bare command, never a command line', () => {
  for (const e of ED.EDITORS) {
    for (const cmd of e.commands) {
      assert.doesNotMatch(cmd, /[\s;&|<>$`'"\\/]/,
        `"${cmd}" must be a plain executable name with no shell characters`);
    }
  }
});

test('a folder that does not exist is refused', async () => {
  const missing = path.join(os.tmpdir(), 'ccr-definitely-not-here-9f2c1a');
  await assert.rejects(
    () => ED.open(missing, null, true),
    (err) => {
      assert.match(err.message, /not on this machine/);
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('an editor id that is not on the allowlist never spawns anything', async () => {
  // The directory is real, so the only thing that can stop this is the id
  // check. Either error proves no process was started: on a machine with no
  // editor installed the list is empty, otherwise the id simply is not in it.
  await assert.rejects(
    () => ED.open(process.cwd(), 'rm -rf /', true),
    (err) => {
      assert.match(err.message, /not installed or is not a supported editor|No supported editor was found/);
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test('a shell metacharacter in the editor id is not treated as a command', async () => {
  for (const evil of ['code && calc', 'code; ls', 'code | more', '../../bin/sh']) {
    await assert.rejects(
      () => ED.open(process.cwd(), evil, true),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      },
      `"${evil}" must be refused`,
    );
  }
});
