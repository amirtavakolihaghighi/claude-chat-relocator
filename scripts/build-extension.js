#!/usr/bin/env node
'use strict';
/**
 * Copy the shared modules into extension/lib so they can be packaged.
 *
 * A .vsix can only contain files inside the extension folder, so the four
 * modules the extension needs are copied in before packaging. In development
 * the extension loads them straight from ../../server instead (see src/lib.js),
 * which is why pressing F5 needs no build step.
 *
 * Only modules with no npm dependencies are copied. The renderer and exporters,
 * which pull in marked and highlight.js, stay in the web app.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'server');
const OUT = path.join(ROOT, 'extension', 'lib');

const MODULES = ['paths.js', 'parser.js', 'store.js', 'relocate.js'];

// Guard against a module quietly growing a dependency that the extension
// cannot satisfy, since node_modules is deliberately not packaged.
const ALLOWED_REQUIRES = new Set(['fs', 'path', 'os', './paths', './parser', './store', './relocate']);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let problems = 0;
for (const name of MODULES) {
  const from = path.join(SRC, name);
  const text = fs.readFileSync(from, 'utf8');

  for (const m of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    if (!ALLOWED_REQUIRES.has(m[1])) {
      console.error(`  ! ${name} requires "${m[1]}", which the extension cannot resolve.`);
      problems++;
    }
  }

  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
  console.log(`  copied ${name}  (${(text.length / 1024).toFixed(1)} KB)`);
}

if (problems) {
  console.error(`\n  ${problems} unresolvable require(s). Either keep the module dependency-free,`);
  console.error('  or move that code out of the extension.\n');
  process.exit(1);
}

// Sanity check: the copies must load on their own.
try {
  const P = require(path.join(OUT, 'paths.js'));
  const { Store } = require(path.join(OUT, 'store.js'));
  require(path.join(OUT, 'relocate.js'));
  if (P.encodeProjectFolder('D:\\A\\B') !== 'd--A-B') throw new Error('encodeProjectFolder gave the wrong answer');
  if (typeof Store !== 'function') throw new Error('Store did not load');
} catch (e) {
  console.error(`\n  The copied modules do not load: ${e.message}\n`);
  process.exit(1);
}

console.log(`\n  extension/lib is ready (${MODULES.length} modules, no npm dependencies).`);
