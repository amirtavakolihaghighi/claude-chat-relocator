'use strict';
const fs = require('fs');
const path = require('path');
const { parseSessionFile } = require('./parser');

/**
 * Full-text search across every chat in the store.
 *
 * Sessions are parsed into a compact { turnIndex, kind, text } index, cached
 * per file signature, so the first search pays for parsing and the rest are
 * instant. Results carry the turn index, which is what the viewer scrolls to.
 */

const indexCache = new Map();   // "file|mtime|size" -> Item[]
const MAX_CACHED_FILES = 400;

/** Flatten a parsed session into searchable text units. */
function buildIndex(session) {
  const items = [];
  const add = (i, kind, text, label) => {
    if (!text) return;
    const t = String(text);
    if (!t.trim()) return;
    items.push({ i, kind, label, text: t });
  };

  for (const turn of session.turns) {
    if (turn.kind === 'human') {
      for (const b of turn.blocks || []) add(turn.index, 'human', b.text);
    } else if (turn.kind === 'assistant') {
      for (const b of turn.blocks || []) {
        if (b.type === 'text') add(turn.index, 'assistant', b.text);
        else if (b.type === 'thinking' && b.text) add(turn.index, 'thinking', b.text);
        else if (b.type === 'tool') {
          const i = b.input || {};
          add(turn.index, 'tool', [b.name, b.summary, i.command, i.file_path, i.pattern, i.query, i.url]
            .filter(Boolean).join('  '), b.name);
          const r = b.result || {};
          if (r.kind === 'shell') add(turn.index, 'output', [r.stdout, r.stderr].filter(Boolean).join('\n'), b.name);
          else if (r.kind === 'text') add(turn.index, 'output', r.text, b.name);
          else if (r.kind === 'file') add(turn.index, 'output', r.content, b.name);
          else if (r.kind === 'diff') {
            const lines = [];
            for (const h of r.patch || []) for (const l of h.lines || []) lines.push(l);
            add(turn.index, 'output', lines.join('\n'), b.name);
          }
          if (i.content) add(turn.index, 'output', i.content, b.name);
          if (i.new_string) add(turn.index, 'output', i.new_string, b.name);
        }
      }
    } else if (turn.kind === 'system') {
      add(turn.index, 'system', turn.text, turn.label);
    }
  }
  return items;
}

function indexFor(filePath) {
  const st = fs.statSync(filePath);
  const key = `${filePath}|${st.mtimeMs}|${st.size}`;
  const hit = indexCache.get(key);
  if (hit) return hit;

  const { session } = parseSessionFile(filePath);
  const items = buildIndex(session);
  const rec = { items, title: session.title, projectPath: session.projectPath, sessionId: session.sessionId };
  indexCache.set(key, rec);
  while (indexCache.size > MAX_CACHED_FILES) {
    indexCache.delete(indexCache.keys().next().value);
  }
  return rec;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher({ query, regex, caseSensitive, wholeWord }) {
  let source = regex ? query : escapeRe(query);
  if (wholeWord && !regex) source = `\\b${source}\\b`;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  return new RegExp(source, flags);
}

/** A short excerpt centred on the hit, with the hit marked by offsets. */
function snippet(text, start, end, radius = 110) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  let s = text.slice(from, to).replace(/\s+/g, ' ').trim();
  const lead = from > 0 ? '…' : '';
  const tail = to < text.length ? '…' : '';
  // Re-locate the hit inside the whitespace-collapsed excerpt.
  const hit = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return { text: lead + s + tail, hit };
}

/**
 * @param {Store} store
 * @param {object} opts  query, regex, caseSensitive, wholeWord, folder,
 *                       sessionId, kinds (Set|array), limit
 */
function search(store, opts) {
  const query = String(opts.query || '').trim();
  const out = { query, results: [], totalMatches: 0, filesSearched: 0, truncated: false, error: null };
  if (!query) return out;

  let re;
  try { re = buildMatcher(opts); }
  catch (e) { out.error = `Invalid pattern: ${e.message}`; return out; }

  const kinds = opts.kinds && opts.kinds.length ? new Set(opts.kinds) : null;
  const limit = Math.max(1, Math.min(2000, opts.limit || 300));
  const perSessionCap = 40;

  const scan = store.scan();
  for (const project of scan.projects) {
    if (opts.folder && project.folderName !== opts.folder) continue;

    for (const s of project.sessions) {
      if (s.unreadable) continue;
      if (opts.sessionId && s.sessionId !== opts.sessionId) continue;

      let rec;
      try { rec = indexFor(s.file); }
      catch { continue; }
      out.filesSearched++;

      const hits = [];
      for (const item of rec.items) {
        if (kinds && !kinds.has(item.kind)) continue;
        re.lastIndex = 0;
        let m, guard = 0;
        while ((m = re.exec(item.text)) !== null) {
          if (m[0] === '') { re.lastIndex++; continue; }   // zero-width pattern
          out.totalMatches++;
          if (hits.length < perSessionCap) {
            hits.push({
              turnIndex: item.i,
              kind: item.kind,
              label: item.label || null,
              ...snippet(item.text, m.index, m.index + m[0].length),
            });
          }
          if (++guard > 500) break;    // one pathological item shouldn't stall the scan
        }
      }

      if (hits.length) {
        out.results.push({
          folderName: project.folderName,
          projectPath: project.projectPath,
          sessionId: s.sessionId,
          title: rec.title || s.title,
          endedAt: s.endedAt,
          issues: project.issues,
          hits,
        });
      }
      if (out.results.length >= limit) { out.truncated = true; break; }
    }
    if (out.results.length >= limit) { out.truncated = true; break; }
  }

  out.results.sort((a, b) => b.hits.length - a.hits.length);
  return out;
}

function clearCache() { indexCache.clear(); }

module.exports = { search, clearCache };
