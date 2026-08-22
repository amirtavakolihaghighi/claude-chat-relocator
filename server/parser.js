'use strict';
const fs = require('fs');
const path = require('path');
const { encodeProjectFolder, normalizePath } = require('./paths');

/**
 * Turns a Claude Code session .jsonl into a chat-shaped transcript.
 *
 * The file is one JSON object per line. Thirteen record types appear in the
 * wild; the ones that carry conversation are `user`, `assistant`, `system` and
 * `attachment`. Tool calls live as `tool_use` blocks on an assistant record and
 * their results come back as a `tool_result` block on the NEXT user record --
 * that user record is not a human turn, so we fold the result back into the
 * tool call it belongs to instead of showing a phantom user message.
 */

// Attachments that are conversation, versus ambient context Claude Code injects.
const MEANINGFUL_ATTACHMENTS = new Set(['edited_text_file', 'queued_command']);

const MAX_RESULT_CHARS = 200000;   // guard against a single 5 MB tool dump

function readLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/);
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

function basename(p) {
  if (!p) return '';
  const s = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) : s;
}

function firstLine(s, n = 120) {
  const t = String(s == null ? '' : s).split(/\r?\n/)[0].trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Count added/removed lines across a structuredPatch. */
function patchStats(patch) {
  let added = 0, removed = 0;
  if (!Array.isArray(patch)) return { added, removed };
  for (const hunk of patch) {
    for (const line of (hunk && hunk.lines) || []) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

/** A one-line label for a collapsed tool card. */
function toolSummary(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return firstLine(i.command);
    case 'Read':
      return basename(i.file_path) + (i.offset ? ` (from line ${i.offset})` : '');
    case 'Edit':
      return basename(i.file_path);
    case 'Write':
      return basename(i.file_path);
    case 'Grep':
      return i.pattern ? `/${firstLine(i.pattern, 60)}/${i.path ? ' in ' + basename(i.path) : ''}` : '';
    case 'Glob':
      return firstLine(i.pattern, 80);
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} items` : '';
    case 'Task':
    case 'Agent':
      return firstLine(i.description || i.prompt, 90);
    case 'WebSearch':
      return firstLine(i.query, 90);
    case 'WebFetch':
      return firstLine(i.url, 90);
    case 'Skill':
      return firstLine(i.skill, 60);
    case 'ToolSearch':
      return firstLine(i.query, 80);
    case 'Artifact':
      return firstLine(i.title || i.file_path || i.action, 80);
    case 'AskUserQuestion':
      return Array.isArray(i.questions) ? firstLine(i.questions[0] && i.questions[0].question, 90) : '';
    default: {
      for (const k of ['file_path', 'path', 'command', 'query', 'pattern', 'url', 'description']) {
        if (typeof i[k] === 'string') return firstLine(i[k], 90);
      }
      return '';
    }
  }
}

/**
 * Decide how a tool result should be shown. `structured` is the rich
 * `toolUseResult` Claude Code records alongside the raw block -- it carries
 * real diffs and separated stdout/stderr, so it wins whenever present.
 */
function classifyResult(structured, rawBlock, images) {
  const out = { kind: 'none', isError: false };
  if (rawBlock && rawBlock.is_error) out.isError = true;

  if (images && images.length) {
    out.kind = 'images';
    out.images = images;
    return out;
  }

  if (structured && typeof structured === 'object') {
    if (Array.isArray(structured.structuredPatch) && structured.structuredPatch.length) {
      const st = patchStats(structured.structuredPatch);
      out.kind = 'diff';
      out.filePath = structured.filePath;
      out.patch = structured.structuredPatch;
      out.added = st.added;
      out.removed = st.removed;
      return out;
    }
    if (typeof structured.stdout === 'string' || typeof structured.stderr === 'string') {
      out.kind = 'shell';
      out.stdout = truncate(structured.stdout, MAX_RESULT_CHARS);
      out.stderr = truncate(structured.stderr, MAX_RESULT_CHARS);
      out.interrupted = !!structured.interrupted;
      if (!out.stdout && !out.stderr) out.empty = true;
      return out;
    }
    if (Array.isArray(structured.newTodos)) {
      out.kind = 'todos';
      out.todos = structured.newTodos;
      return out;
    }
    if (structured.file && typeof structured.file === 'object') {
      out.kind = 'file';
      out.filePath = structured.file.filePath;
      out.content = truncate(structured.file.content, MAX_RESULT_CHARS);
      out.numLines = structured.file.numLines;
      out.totalLines = structured.file.totalLines;
      return out;
    }
    if (typeof structured.content === 'string' && structured.filePath) {
      // Write: full new file content
      out.kind = 'file';
      out.filePath = structured.filePath;
      out.content = truncate(structured.content, MAX_RESULT_CHARS);
      return out;
    }
    if (Array.isArray(structured.filenames)) {
      out.kind = 'list';
      out.items = structured.filenames.slice(0, 500);
      out.total = structured.numFiles != null ? structured.numFiles : structured.filenames.length;
      if (typeof structured.content === 'string') out.content = truncate(structured.content, MAX_RESULT_CHARS);
      return out;
    }
  }

  if (typeof structured === 'string' && structured.trim()) {
    out.kind = 'text';
    out.text = truncate(structured, MAX_RESULT_CHARS);
    return out;
  }

  const rawContent = rawBlock && rawBlock.content;
  if (typeof rawContent === 'string' && rawContent.trim()) {
    out.kind = 'text';
    out.text = truncate(rawContent, MAX_RESULT_CHARS);
    return out;
  }

  if (structured && typeof structured === 'object') {
    out.kind = 'json';
    out.json = structured;
    return out;
  }
  return out;
}

/** Pull base64 images out of a tool_result content list, keeping data aside. */
function extractImages(rawBlock, refPrefix, imageStore) {
  const images = [];
  const c = rawBlock && rawBlock.content;
  if (!Array.isArray(c)) return images;
  let n = 0;
  for (const b of c) {
    if (!b || b.type !== 'image' || !b.source) continue;
    const src = b.source;
    if (src.type !== 'base64' || typeof src.data !== 'string') continue;
    const ref = `${refPrefix}.${n++}`;
    imageStore.set(ref, { mediaType: src.media_type || 'image/png', data: src.data });
    images.push({ ref, mediaType: src.media_type || 'image/png', bytes: Math.floor(src.data.length * 3 / 4) });
  }
  return images;
}

/** Text a tool_result carries besides any images. */
function textFromContentList(rawBlock) {
  const c = rawBlock && rawBlock.content;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text).join('\n');
}

function parseSessionFile(filePath) {
  const stat = fs.statSync(filePath);
  const lines = readLines(filePath);

  const session = {
    sessionId: path.basename(filePath, '.jsonl'),
    file: filePath,
    folderName: path.basename(path.dirname(filePath)),
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
    title: null,
    projectPath: null,
    cwds: [],
    gitBranch: null,
    versions: [],
    startedAt: null,
    endedAt: null,
    turns: [],
    parseErrors: [],
    stats: {
      lines: 0,
      humanTurns: 0,
      assistantTurns: 0,
      toolCalls: 0,
      thinkingBlocks: 0,
      redactedThinking: 0,
      apiErrors: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      models: {},
      tools: {},
      filesTouched: [],
    },
  };

  const imageStore = new Map();   // ref -> { mediaType, data }  (server-side only)
  const cwdCounts = new Map();
  const versionSet = new Set();
  const filesTouched = new Map();
  const records = [];

  // ---- pass 1: decode lines, harvest metadata ----------------------------
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const o = safeParse(line);
    if (o === undefined) {
      session.parseErrors.push({ line: i + 1, preview: truncate(line, 160) });
      continue;
    }
    session.stats.lines++;
    records.push(o);

    if (o.cwd) cwdCounts.set(o.cwd, (cwdCounts.get(o.cwd) || 0) + 1);
    if (o.version) versionSet.add(o.version);
    if (o.gitBranch && !session.gitBranch) session.gitBranch = o.gitBranch;
    if (o.type === 'ai-title' && o.aiTitle) session.title = o.aiTitle;
    if (o.type === 'file-history-delta' && o.trackingPath) {
      const dir = o.backup && o.backup.realParentDir;
      const full = dir ? path.join(dir, o.trackingPath) : o.trackingPath;
      filesTouched.set(full, (filesTouched.get(full) || 0) + 1);
    }
    if (o.timestamp) {
      if (!session.startedAt || o.timestamp < session.startedAt) session.startedAt = o.timestamp;
      if (!session.endedAt || o.timestamp > session.endedAt) session.endedAt = o.timestamp;
    }
  }

  session.versions = [...versionSet];
  session.cwds = [...cwdCounts.entries()]
    .map(([p, count]) => ({ path: p, count }))
    .sort((a, b) => b.count - a.count);

  // The project root is the cwd that encodes to this session's folder name.
  // Sub-directory cwds (a build dir, a submodule) also appear but are longer.
  const folderName = session.folderName;
  let root = session.cwds.find((c) => encodeProjectFolder(c.path) === folderName);
  if (!root) {
    // Folder was renamed by hand, or came from another machine: fall back to
    // the shortest cwd, which is the closest thing to a root we have.
    root = [...session.cwds].sort((a, b) => a.path.length - b.path.length)[0];
    session.folderNameMatchesCwd = false;
  } else {
    session.folderNameMatchesCwd = true;
  }
  session.projectPath = root ? normalizePath(root.path) : null;

  // ---- pass 2: index tool results by the call they answer -----------------
  const resultsById = new Map();
  for (const o of records) {
    if (o.type !== 'user') continue;
    const content = o.message && o.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b && b.type === 'tool_result' && b.tool_use_id) {
        resultsById.set(b.tool_use_id, { block: b, structured: o.toolUseResult, timestamp: o.timestamp });
      }
    }
  }

  // ---- pass 3: build turns -----------------------------------------------
  let exchange = 0;
  const push = (t) => { t.index = session.turns.length; t.exchange = exchange; session.turns.push(t); };

  for (const o of records) {
    switch (o.type) {
      case 'user': {
        const content = o.message && o.message.content;
        const isMeta = !!o.isMeta;

        if (typeof content === 'string') {
          if (isMeta || /^<[a-z-]+>/i.test(content.trim())) {
            push({ kind: 'system', category: 'context', label: 'context', text: content, timestamp: o.timestamp, uuid: o.uuid });
          } else {
            exchange++;
            session.stats.humanTurns++;
            push({ kind: 'human', timestamp: o.timestamp, uuid: o.uuid, blocks: [{ type: 'text', text: content }] });
          }
          break;
        }
        if (!Array.isArray(content)) break;

        const textBlocks = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
        const hasToolResult = content.some((b) => b && b.type === 'tool_result');
        if (!textBlocks.length) break;             // pure tool_result: folded in below
        if (hasToolResult) break;

        const joined = textBlocks.map((b) => b.text).join('\n\n');
        if (isMeta) {
          push({ kind: 'system', category: 'context', label: 'context', text: joined, timestamp: o.timestamp, uuid: o.uuid });
        } else {
          exchange++;
          session.stats.humanTurns++;
          push({ kind: 'human', timestamp: o.timestamp, uuid: o.uuid, blocks: [{ type: 'text', text: joined }] });
        }
        break;
      }

      case 'assistant': {
        const m = o.message || {};
        const content = Array.isArray(m.content) ? m.content : [];
        const blocks = [];

        for (let bi = 0; bi < content.length; bi++) {
          const b = content[bi];
          if (!b || typeof b !== 'object') continue;

          if (b.type === 'text' && b.text && b.text.trim()) {
            blocks.push({ type: 'text', text: b.text });
          } else if (b.type === 'thinking') {
            // Claude Code records the signature but not the reasoning text, so
            // `thinking` is almost always "". Note that the model thought here
            // rather than dropping the beat from the transcript entirely.
            session.stats.thinkingBlocks++;
            if (b.thinking && b.thinking.trim()) {
              blocks.push({ type: 'thinking', text: b.thinking });
            } else {
              session.stats.redactedThinking++;
              blocks.push({ type: 'thinking', text: '', redacted: true });
            }
          } else if (b.type === 'tool_use') {
            session.stats.toolCalls++;
            session.stats.tools[b.name] = (session.stats.tools[b.name] || 0) + 1;

            const found = resultsById.get(b.id);
            const refPrefix = `${o.uuid}.${bi}`;
            const images = found ? extractImages(found.block, refPrefix, imageStore) : [];
            const extraText = found ? textFromContentList(found.block) : '';
            const display = found ? classifyResult(found.structured, found.block, images) : { kind: 'pending' };
            if (extraText && display.kind === 'images') display.text = truncate(extraText, MAX_RESULT_CHARS);

            // Track files the session wrote to, for the stats panel.
            const fp = (found && found.structured && found.structured.filePath)
              || (b.input && b.input.file_path);
            if (fp && (b.name === 'Edit' || b.name === 'Write')) {
              filesTouched.set(normalizePath(fp), (filesTouched.get(normalizePath(fp)) || 0) + 1);
            }

            blocks.push({
              type: 'tool',
              id: b.id,
              name: b.name,
              input: b.input,
              summary: toolSummary(b.name, b.input),
              result: display,
            });
          }
        }

        // A response carrying nothing but a redacted thinking block has no
        // visible content -- counted in stats, but not worth a chat bubble.
        const hasSubstance = blocks.some(
          (b) => b.type === 'text' || b.type === 'tool' || (b.type === 'thinking' && !b.redacted)
        );
        if (!hasSubstance && !o.isApiErrorMessage) break;

        if (o.isApiErrorMessage) {
          session.stats.apiErrors++;
          const txt = blocks.filter((x) => x.type === 'text').map((x) => x.text).join('\n')
            || (o.error && (o.error.formatted || o.error.message)) || 'API error';
          push({ kind: 'system', category: 'error', label: 'API error', text: txt, timestamp: o.timestamp, uuid: o.uuid });
          break;
        }

        session.stats.assistantTurns++;
        if (m.model) session.stats.models[m.model] = (session.stats.models[m.model] || 0) + 1;
        const u = m.usage || {};
        session.stats.tokens.input += u.input_tokens || 0;
        session.stats.tokens.output += u.output_tokens || 0;
        session.stats.tokens.cacheRead += u.cache_read_input_tokens || 0;
        session.stats.tokens.cacheCreation += u.cache_creation_input_tokens || 0;

        push({
          kind: 'assistant',
          timestamp: o.timestamp,
          uuid: o.uuid,
          model: m.model,
          effort: o.effort,
          skill: o.attributionSkill,
          usage: {
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cacheCreation: u.cache_creation_input_tokens || 0,
          },
          blocks,
        });
        break;
      }

      case 'attachment': {
        const a = o.attachment || {};
        if (!MEANINGFUL_ATTACHMENTS.has(a.type)) {
          push({ kind: 'system', category: 'context', label: a.type || 'attachment', text: '', timestamp: o.timestamp, uuid: o.uuid });
          break;
        }
        if (a.type === 'edited_text_file') {
          push({
            kind: 'system', category: 'note', label: 'You edited a file',
            detail: a.filename, text: a.snippet || '', code: true,
            timestamp: o.timestamp, uuid: o.uuid,
          });
        } else if (a.type === 'queued_command') {
          push({
            kind: 'system', category: 'note', label: 'Queued input',
            text: a.prompt || a.command || '', timestamp: o.timestamp, uuid: o.uuid,
          });
        }
        break;
      }

      case 'system': {
        if (o.subtype === 'api_error') {
          session.stats.apiErrors++;
          const e = o.error || {};
          push({
            kind: 'system', category: 'error', label: 'API error',
            text: e.formatted || e.message || 'Unknown API error',
            detail: o.retryAttempt != null ? `retry ${o.retryAttempt}/${o.maxRetries}` : null,
            timestamp: o.timestamp, uuid: o.uuid,
          });
        } else if (o.subtype === 'stop_hook_summary') {
          const hooks = (o.hookInfos || []).map((h) => firstLine(h.command, 80)).join(', ');
          push({
            kind: 'system', category: 'context', label: 'Stop hook',
            text: hooks, timestamp: o.timestamp, uuid: o.uuid,
          });
        }
        break;
      }

      default:
        break;   // queue-operation, mode, last-prompt, file-history-* : not conversation
    }
  }

  session.stats.filesTouched = [...filesTouched.entries()]
    .map(([p, count]) => ({ path: p, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 200);

  if (session.startedAt && session.endedAt) {
    session.durationMs = new Date(session.endedAt) - new Date(session.startedAt);
  }
  if (!session.title) {
    const firstHuman = session.turns.find((t) => t.kind === 'human');
    session.title = firstHuman ? firstLine(firstHuman.blocks[0].text, 70) : session.sessionId.slice(0, 8);
  }

  return { session, imageStore };
}

/** Cheap header read: title, timestamps, cwd -- without building any turns. */
function peekSessionFile(filePath) {
  const stat = fs.statSync(filePath);
  const lines = readLines(filePath);
  const out = {
    sessionId: path.basename(filePath, '.jsonl'),
    file: filePath,
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
    title: null, projectPath: null, gitBranch: null,
    startedAt: null, endedAt: null,
    messageCount: 0, cwds: [],
  };
  const cwdCounts = new Map();
  let firstPrompt = null;
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const o = safeParse(line);
    if (!o) continue;
    if (o.cwd) cwdCounts.set(o.cwd, (cwdCounts.get(o.cwd) || 0) + 1);
    if (o.type === 'ai-title' && o.aiTitle) out.title = o.aiTitle;
    if (o.gitBranch && !out.gitBranch) out.gitBranch = o.gitBranch;
    if (o.type === 'user' || o.type === 'assistant') out.messageCount++;
    if (!firstPrompt && o.type === 'user' && !o.isMeta) {
      const c = o.message && o.message.content;
      if (typeof c === 'string' && !/^</.test(c.trim())) firstPrompt = c;
      else if (Array.isArray(c)) {
        const t = c.find((b) => b && b.type === 'text' && b.text);
        if (t) firstPrompt = t.text;
      }
    }
    if (o.timestamp) {
      if (!out.startedAt || o.timestamp < out.startedAt) out.startedAt = o.timestamp;
      if (!out.endedAt || o.timestamp > out.endedAt) out.endedAt = o.timestamp;
    }
  }
  out.cwds = [...cwdCounts.entries()].map(([p, count]) => ({ path: p, count })).sort((a, b) => b.count - a.count);
  if (!out.title) out.title = firstPrompt ? firstLine(firstPrompt, 70) : out.sessionId.slice(0, 8);
  return out;
}

module.exports = { parseSessionFile, peekSessionFile, encodeProjectFolder, patchStats, basename };
