'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Load the shared modules.
 *
 * In development the extension sits inside the repository and loads them from
 * ../../server directly, so pressing F5 works with no build step. `npm run
 * build` copies the same files into extension/lib for packaging, because a
 * .vsix can only contain what is inside the extension folder. This prefers the
 * copy when it exists, so dev and packaged behave identically.
 *
 * Only four modules are needed, and none of them has an npm dependency -- the
 * rendering and export code, which does, stays in the web app.
 */
const bundled = path.join(__dirname, '..', 'lib');
const source = path.join(__dirname, '..', '..', 'server');
const base = fs.existsSync(path.join(bundled, 'paths.js')) ? bundled : source;

module.exports = {
  base,
  bundledInUse: base === bundled,
  P: require(path.join(base, 'paths.js')),
  Store: require(path.join(base, 'store.js')).Store,
  RL: require(path.join(base, 'relocate.js')),
};
