'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';
const SEP = IS_WIN ? '\\' : '/';

/**
 * Claude Code derives the folder name under ~/.claude/projects from the
 * project's absolute path: it lowercases the drive letter, then replaces every
 * non-alphanumeric character with a dash.
 *
 *   D:\Files\Projects\AI_Chat_Extractor  ->  d--Files-Projects-AI-Chat-Extractor
 *   (the double dash is ':' followed by '\')
 *
 * Verified against every folder/cwd pair in a real ~/.claude/projects tree.
 *
 * The transform is LOSSY and one-way: a dash in the result may have come from
 * ':', '\', '/', '_', '.', a space, or a literal dash. Nothing can decode it.
 * The true path survives only in the `cwd` field that Claude Code stamps on
 * nearly every JSONL record -- which is why relocation reads cwd, and why it
 * must rewrite cwd as well as rename the folder.
 */
function encodeProjectFolder(absPath) {
  let p = String(absPath == null ? '' : absPath).trim();
  p = p.replace(/[\\/]+$/, '');          // drop trailing separators
  if (/^[a-zA-Z]:/.test(p)) p = p[0].toLowerCase() + p.slice(1);
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Collapse mixed separators onto the native one and drop any trailing slash. */
function normalizePath(p) {
  let s = String(p == null ? '' : p).trim();
  if (!s) return '';
  const isUnc = IS_WIN && /^[\\/]{2}[^\\/]/.test(s);
  s = s.replace(/[\\/]+/g, SEP);
  if (isUnc) s = SEP + s;                 // restore the second leading slash
  if (s.length > 1) s = s.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(s)) s += SEP;    // "D:" alone means the drive root
  return s;
}

/** Windows paths compare case-insensitively; POSIX paths do not. */
function foldCase(p) {
  return IS_WIN ? String(p).toLowerCase() : String(p);
}

function looksAbsolute(p) {
  const s = String(p == null ? '' : p).trim();
  if (!s) return false;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;   // D:\ or D:/
  if (/^[\\/]{2}[^\\/]/.test(s)) return true;   // \\server\share (UNC)
  if (!IS_WIN && s.startsWith('/')) return true;
  return false;
}

function pathsEqual(a, b) {
  return foldCase(normalizePath(a)) === foldCase(normalizePath(b));
}

/** True when `child` is `parent` itself or lives inside it. */
function isUnder(child, parent) {
  const c = foldCase(normalizePath(child));
  const p = foldCase(normalizePath(parent));
  if (!c || !p) return false;
  if (c === p) return true;
  const withSep = p.endsWith(SEP) ? p : p + SEP;
  return c.startsWith(foldCase(withSep));
}

/**
 * Re-root `full` from `oldRoot` onto `newRoot`, preserving the tail exactly.
 * Returns null when `full` is not under `oldRoot` -- callers use that to leave
 * unrelated paths untouched rather than blindly string-replacing.
 */
function replacePrefix(full, oldRoot, newRoot) {
  const f = normalizePath(full);
  const o = normalizePath(oldRoot);
  const n = normalizePath(newRoot);
  if (!f || !o) return null;
  if (foldCase(f) === foldCase(o)) return n;
  const oWithSep = o.endsWith(SEP) ? o : o + SEP;
  if (!foldCase(f).startsWith(foldCase(oWithSep))) return null;
  const tail = f.slice(oWithSep.length);
  return n.endsWith(SEP) ? n + tail : n + SEP + tail;
}

/** Default location of the Claude Code project store. */
function defaultClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** Where this app keeps its own state: backups, undo manifests, settings. */
function appDataDir() {
  return path.join(os.homedir(), '.claude-chat-relocator');
}

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** A folder name is safe to use as a single path segment. */
function isSafeFolderName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length < 250
    && !name.includes('/')
    && !name.includes('\\')
    && name !== '.'
    && name !== '..';
}

module.exports = {
  IS_WIN, SEP,
  encodeProjectFolder, normalizePath, foldCase, looksAbsolute,
  pathsEqual, isUnder, replacePrefix,
  defaultClaudeProjectsDir, appDataDir,
  dirExists, fileExists, isSafeFolderName,
};
