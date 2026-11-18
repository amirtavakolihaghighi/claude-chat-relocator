#!/usr/bin/env node
'use strict';
/**
 * The privacy gate: finds personal data before it is published.
 *
 *   node scripts/privacy-scan.js             the files git would publish
 *   node scripts/privacy-scan.js --range A..B every file, message and identity in those commits
 *   node scripts/privacy-scan.js --push      as a pre-push hook: everything about to be pushed
 *   node scripts/privacy-scan.js --history   every commit ever made (report only)
 *
 * It looks for e-mail addresses, private network addresses, home-folder paths
 * that carry a user name, credentials, metadata hidden in images, commit and
 * tag identities that are not GitHub noreply addresses, time-zone offsets
 * other than UTC, and any exact value listed in .privacy-blocklist.
 *
 * .privacy-blocklist (git-ignored, one value per line) holds what no pattern
 * can catch: a user name, a friend's name, a machine name. Matches are
 * reported by place and kind, never by value.
 *
 * .privacy-allow (committed) accepts a finding on purpose. Each line names a
 * file (a glob) and a kind -- never the value, or the allowlist would itself
 * be the leak:   docs/ENCODING.md  home-path
 *
 * This file must not contain a sample of anything it looks for, or it would
 * report itself: the patterns are built from pieces.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'buffer', maxBuffer: 1 << 30 });
const gitText = (...a) => git(...a).toString('utf8');

// ------------------------------------------------------------------ rules --

const AT = '@';
const RULES = [
  { kind: 'email', re: new RegExp('[A-Za-z0-9._%+-]+' + AT + '[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}', 'g'),
    ok: (m) => /noreply/i.test(m) || /\.(example|test|invalid)$|[@.]example\.(com|org|net)$/i.test(m) },
  { kind: 'private-ip', re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254)\.\d{1,3}\.\d{1,3}\b/g },
  { kind: 'home-path', re: /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/|\/home\/)([^\\/\s"'`<>*?|:]{2,})/g,
    ok: (m, name) => /^(me|you|user|username|someone|somebody|name|runner|USER|<[^>]*>|\$\{?\w+\}?|%\w+%)$/i.test(name) },
  { kind: 'credential', re: new RegExp(['sk' + '-ant-[A-Za-z0-9_-]{20,}', 'gh[pousr]_[A-Za-z0-9]{30,}', 'github' + '_pat_[A-Za-z0-9_]{30,}',
    'AK' + 'IA[0-9A-Z]{16}', 'xox[baprs]-[A-Za-z0-9-]{10,}', '-----BEGIN [A-Z ]*PRIVATE ' + 'KEY-----'].join('|'), 'g') },
];

// ------------------------------------------------------- allow and block --

function readLines(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean); }
  catch { return []; }
}

const ALLOW = readLines('.privacy-allow').map((l) => {
  const [glob, kind] = l.split(/\s+/);
  const re = new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return { re, kind };
});
const allowed = (file, kind) => ALLOW.some((a) => a.kind === kind && a.re.test(file));

/** Letters only, lower case: "Some-Name", "some_name" and "SOME NAME" all fold to "somename". */
const fold = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase().replace(/[^a-z0-9\u0080-\uffff]/g, '');
const BLOCK = readLines('.privacy-blocklist').map(fold).filter((v) => v.length >= 3);

// --------------------------------------------------------------- scanning --

const findings = [];
const report = (where, kind, detail) => findings.push({ where, kind, detail });

function scanText(where, file, text) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        if (rule.ok && rule.ok(m[0], m[1])) continue;
        if (file && allowed(file, rule.kind)) continue;
        report(`${where}:${i + 1}`, rule.kind, rule.kind === 'credential' ? '(hidden)' : m[0]);
      }
    }
    if (BLOCK.length) {
      const f = fold(line);
      if (BLOCK.some((v) => f.includes(v)) && !(file && allowed(file, 'blocked'))) report(`${where}:${i + 1}`, 'blocked', '(a value from .privacy-blocklist)');
    }
  });
}

/** Text hidden inside images: PNG text chunks, JPEG comments and EXIF/XMP. */
function scanImage(where, file, buf) {
  const found = [];
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    for (let o = 8; o + 8 <= buf.length;) {
      const len = buf.readUInt32BE(o);
      const type = buf.slice(o + 4, o + 8).toString('latin1');
      if (/^(tEXt|iTXt|zTXt|eXIf)$/.test(type)) found.push(type);
      o += 12 + len;
    }
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let o = 2; o + 4 <= buf.length && buf[o] === 0xff;) {
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      if (marker === 0xfe) found.push('JPEG comment');
      if (marker === 0xe1) found.push('EXIF/XMP');
      if (marker === 0xda) break;
      o += 2 + len;
    }
  }
  if (found.length && !allowed(file, 'image-metadata')) report(where, 'image-metadata', [...new Set(found)].join(', ') + ' (strip it, or look at what it says)');
}

const isBinary = (buf) => buf.slice(0, 8000).includes(0);

function scanBlob(where, file, buf) {
  if (/\.(png|jpe?g)$/i.test(file)) return scanImage(where, file, buf);
  if (isBinary(buf)) return;
  scanText(where, file, buf.toString('utf8'));
}

/** A commit's or tag's people, time-zone offsets and message. */
function scanHeader(where, raw) {
  const [head, ...msg] = raw.split('\n\n');
  for (const line of head.split('\n')) {
    const m = /^(author|committer|tagger) (.*) <([^>]*)> \d+ ([+-]\d{4})$/.exec(line);
    if (!m) continue;
    if (!/noreply/i.test(m[3]) && !allowed('(identity)', 'email')) report(`${where} ${m[1]}`, 'identity-email', m[3]);
    if (m[4] !== '+0000' && !allowed('(identity)', 'timezone')) report(`${where} ${m[1]}`, 'timezone', `offset ${m[4]} (commit with TZ=UTC)`);
    if (BLOCK.some((v) => fold(m[2]).includes(v))) report(`${where} ${m[1]}`, 'blocked', '(a value from .privacy-blocklist)');
  }
  scanText(`${where} message`, '(message)', msg.join('\n\n'));
}

/** Every object in `revs`, each by its real type. */
function scanObjects(revs) {
  const list = gitText('rev-list', '--objects', ...revs).split('\n').filter(Boolean);
  if (!list.length) return 0;
  const names = new Map(list.map((l) => { const i = l.indexOf(' '); return i < 0 ? [l, null] : [l.slice(0, i), l.slice(i + 1)]; }));
  const types = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { cwd: ROOT, input: [...names.keys()].join('\n') + '\n', encoding: 'utf8' })
    .split('\n').filter(Boolean).map((l) => l.split(' '));
  for (const [sha, type] of types) {
    const raw = git('cat-file', type, sha);
    if (type === 'commit') scanHeader(`commit ${sha.slice(0, 8)}`, raw.toString('utf8'));
    else if (type === 'tag') scanHeader(`tag ${sha.slice(0, 8)}`, raw.toString('utf8'));
    else if (type === 'blob') { const name = names.get(sha) || sha; scanBlob(`${name} (${sha.slice(0, 8)})`, name, raw); }
  }
  return types.length;
}

// ------------------------------------------------------------------- main --

function main() {
  const args = process.argv.slice(2);
  let scope;
  if (args.includes('--push')) {
    // stdin: "<local ref> <local sha> <remote ref> <remote sha>" per pushed ref
    const zero = /^0+$/;
    const input = fs.readFileSync(0, 'utf8').trim();
    let n = 0;
    for (const line of input.split('\n').filter(Boolean)) {
      const [, local, , remote] = line.split(' ');
      if (zero.test(local)) continue;                         // deleting a ref
      n += scanObjects(zero.test(remote) ? [local, '--not', '--remotes'] : [`${remote}..${local}`]);
      // a tag pushed on its own: rev-list lists its object, but check it directly too
      if (gitText('cat-file', '-t', local).trim() === 'tag') scanHeader(`tag ${local.slice(0, 8)}`, gitText('cat-file', 'tag', local));
    }
    scope = `${n} object(s) about to be pushed`;
  } else if (args.includes('--range')) {
    const range = args[args.indexOf('--range') + 1];
    scope = `${scanObjects([range])} object(s) in ${range}`;
  } else if (args.includes('--history')) {
    scope = `${scanObjects(['--all'])} object(s) in the whole history`;
  } else {
    const files = gitText('ls-files', '-z', '--cached').split('\0').filter(Boolean);
    for (const f of files) {
      let buf;
      try { buf = fs.readFileSync(path.join(ROOT, f)); } catch { continue; }
      scanBlob(f, f, buf);
    }
    scope = `${files.length} file(s) git would publish`;
  }

  // Write plainly, even on a Windows console that cannot show every character.
  const out = (s) => process.stdout.write(Buffer.from(s + '\n', 'utf8'));
  if (!findings.length) { out(`privacy scan: nothing found in ${scope}.`); return 0; }
  out(`privacy scan: ${findings.length} finding(s) in ${scope}:`);
  for (const f of findings) out(`  ${f.kind.padEnd(15)} ${f.where}  ${f.detail}`);
  out('\nRemove them, or accept one on purpose with a "<file> <kind>" line in .privacy-allow.');
  return 1;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { console.error('privacy scan failed:', e.message); process.exitCode = 2; }
}

module.exports = { RULES, fold, scanImage, scanText, findings };
