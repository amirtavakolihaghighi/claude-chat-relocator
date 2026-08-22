'use strict';
const { basename } = require('../parser');
const { langForFile } = require('../render');

/**
 * Markdown export: a plain .md that reads well in a repo, an issue, or any
 * editor. Diffs go into ```diff fences, tool output into fenced blocks, and
 * screenshots are inlined as data URIs so the file stays self-contained.
 */

function fence(text, lang) {
  const body = String(text == null ? '' : text).replace(/\s+$/, '');
  if (!body) return '';
  // Pick a fence longer than any run of backticks inside the content.
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const bar = '`'.repeat(Math.max(3, longest + 1));
  return `${bar}${lang || ''}\n${body}\n${bar}\n\n`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }

function diffText(patch) {
  const out = [];
  for (const h of patch || []) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines || []) out.push(l);
  }
  return out.join('\n');
}

function todoText(todos) {
  return (todos || []).map((t) => {
    const box = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
    return `- ${box} ${t.status === 'in_progress' && t.activeForm ? t.activeForm : (t.content || '')}`;
  }).join('\n') + '\n\n';
}

function renderResult(res, imageSrc) {
  if (!res) return '';
  switch (res.kind) {
    case 'diff':
      return `\`${res.filePath || ''}\` — +${res.added} / −${res.removed}\n\n` + fence(diffText(res.patch), 'diff');
    case 'shell': {
      let out = '';
      if (res.stdout) out += fence(res.stdout);
      if (res.stderr) out += `stderr:\n\n` + fence(res.stderr);
      if (res.interrupted) out += `_Interrupted._\n\n`;
      if (!out) out = '_No output._\n\n';
      return out;
    }
    case 'todos': return todoText(res.todos);
    case 'file': {
      const head = res.filePath ? `\`${res.filePath}\`\n\n` : '';
      return head + fence(res.content, langForFile(res.filePath) || '');
    }
    case 'list': {
      const items = (res.items || []).map((f) => `- \`${f}\``).join('\n');
      const more = res.total && res.total > (res.items || []).length
        ? `\n- _…${res.total - res.items.length} more_` : '';
      return items + more + '\n\n';
    }
    case 'images': {
      let out = (res.images || []).map((im) => `![screenshot](${imageSrc(im.ref, im.mediaType)})`).join('\n\n') + '\n\n';
      if (res.text) out += fence(res.text);
      return out;
    }
    case 'text': return fence(res.text);
    case 'json': return fence(JSON.stringify(res.json, null, 2), 'json');
    case 'pending': return '_No result recorded._\n\n';
    default: return '';
  }
}

function renderInput(name, input) {
  if (!input) return '';
  if (name === 'Bash' || name === 'PowerShell') {
    return fence(input.command, name === 'PowerShell' ? 'powershell' : 'bash');
  }
  if (name === 'Write') return fence(input.content, langForFile(input.file_path) || '');
  if (name === 'Edit') {
    let out = '';
    if (input.old_string != null) out += 'Replace:\n\n' + fence(input.old_string);
    if (input.new_string != null) out += 'With:\n\n' + fence(input.new_string);
    return out;
  }
  if (name === 'TodoWrite' && Array.isArray(input.todos)) return todoText(input.todos);
  const keys = Object.keys(input);
  if (!keys.length) return '';
  return fence(JSON.stringify(input, null, 2), 'json');
}

function exportMarkdown(session, imageStore, opts = {}) {
  const includeSystem = opts.includeSystem === true;   // noisy in prose; opt in
  const includeTools = opts.includeTools !== false;
  const imageSrc = (ref, mediaType) => {
    const img = imageStore.get(ref);
    if (!img) return '';
    return `data:${img.mediaType || mediaType || 'image/png'};base64,${img.data}`;
  };

  const s = session.stats || {};
  const out = [];

  out.push(`# ${session.title || 'Claude chat'}\n`);
  const meta = [];
  meta.push(`- **Project:** \`${session.projectPath || '(not recorded)'}\``);
  meta.push(`- **Session:** \`${session.sessionId}\``);
  if (session.startedAt) meta.push(`- **Started:** ${fmtTime(session.startedAt)}`);
  if (session.endedAt) meta.push(`- **Ended:** ${fmtTime(session.endedAt)}`);
  meta.push(`- **Messages:** ${fmtNum(s.humanTurns)} from you, ${fmtNum(s.assistantTurns)} from Claude`);
  if (s.toolCalls) meta.push(`- **Tool calls:** ${fmtNum(s.toolCalls)}`);
  const model = Object.keys(s.models || {}).filter((m) => m && m !== '<synthetic>')[0];
  if (model) meta.push(`- **Model:** ${model}`);
  if (session.gitBranch) meta.push(`- **Git branch:** ${session.gitBranch}`);
  out.push(meta.join('\n') + '\n');
  out.push('---\n');

  for (const turn of session.turns) {
    if (turn.kind === 'human') {
      out.push(`\n## You\n`);
      if (turn.timestamp) out.push(`<sub>${fmtTime(turn.timestamp)}</sub>\n`);
      for (const b of turn.blocks || []) if (b.text) out.push(b.text.trim() + '\n');
      continue;
    }

    if (turn.kind === 'assistant') {
      out.push(`\n## Claude\n`);
      for (const b of turn.blocks || []) {
        if (b.type === 'text') {
          out.push(b.text.trim() + '\n');
        } else if (b.type === 'thinking') {
          if (b.redacted) continue;
          out.push(b.text.split('\n').map((l) => '> ' + l).join('\n') + '\n');
        } else if (b.type === 'tool' && includeTools) {
          const res = b.result || {};
          const badge = res.kind === 'diff' ? ` (+${res.added} / −${res.removed})`
            : res.isError ? ' (error)' : '';
          out.push(`\n<details>\n<summary><b>${b.name}</b> <code>${(b.summary || '').replace(/</g, '&lt;')}</code>${badge}</summary>\n`);
          const input = renderInput(b.name, b.input);
          if (input) out.push('\n' + input);
          const result = renderResult(res, imageSrc);
          if (result) out.push(result);
          out.push('</details>\n');
        }
      }
      continue;
    }

    if (turn.kind === 'system') {
      if (turn.category === 'error') {
        out.push(`\n> **${turn.label || 'Error'}** — ${(turn.text || '').split('\n')[0]}\n`);
      } else if (includeSystem) {
        out.push(`\n<sub>${turn.label || 'note'}${turn.detail ? ' — ' + turn.detail : ''}</sub>\n`);
      }
    }
  }

  out.push(`\n---\n\n<sub>Exported from \`${session.sessionId}.jsonl\` on ${fmtTime(new Date().toISOString())}.</sub>\n`);
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

module.exports = { exportMarkdown };
