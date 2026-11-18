#!/usr/bin/env node
'use strict';
/**
 * Drives the real app in a headless Chrome and fails on any error the page
 * reports. It builds the demo store, starts the server against it with its own
 * settings (nothing of yours is read or written), then visits every page and
 * opens the main dialogs.
 *
 *   node scripts/ui-check.js                 check only
 *   node scripts/ui-check.js --shots <dir>   also save screenshots there
 *
 * Needs Node 22+ (for the built-in WebSocket) and Chrome or Edge. Set
 * CHROME_PATH if it is somewhere unusual.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
const ROOT = path.join(__dirname, '..');
const PORT = 4391;
const DEMO = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-ui-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome or Edge found. Set CHROME_PATH.');
  return hit;
}

async function main() {
  if (typeof WebSocket === 'undefined') throw new Error('Node 22 or newer is needed (built-in WebSocket).');

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'demo-store.js'), '--root', DEMO], { stdio: 'ignore' });
  const env = {
    ...process.env, NO_OPEN: '1', PORT: String(PORT),
    CLAUDE_PROJECTS_DIR: path.join(DEMO, 'store'),
    CLAUDE_RELOCATOR_DATA: path.join(DEMO, 'app-data'),
    CLAUDE_SETTINGS_FILE: path.join(DEMO, 'claude-settings.json'),
  };
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-chrome-'));
  const chrome = spawn(findChrome(), [
    // GitHub's Linux runners forbid the sandbox Chrome normally uses
    ...(process.env.CI ? ['--no-sandbox'] : []),
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });

  const problems = [];
  try {
    // both up?
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch { /* starting */ }
      await wait(250);
    }
    let target;
    for (let i = 0; i < 120 && !target; i++) {
      try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
      if (!target) await wait(250);
    }
    if (!target) throw new Error('Chrome did not start');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (msg.params.exceptionDetails.exception || {}).description);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push('console.error: ' + msg.params.args.map((a) => a.value || a.description).join(' '));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    };
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error('evaluate failed: ' + expr.slice(0, 80) + ' :: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const until = async (expr, what, ms = 8000) => {
      for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await evaluate(expr)) return;
      throw new Error('timed out waiting for ' + what);
    };
    const shot = async (name, theme) => {
      if (!shotsDir) return;
      if (theme) { await evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`); await wait(150); }
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(shotsDir, { recursive: true });
      fs.writeFileSync(path.join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
    };

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const base = `http://127.0.0.1:${PORT}/`;

    const step = async (label, fn) => {
      const before = problems.length;
      try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); }
      console.log(`  ${problems.length > before ? 'FAIL' : 'ok  '}  ${label}`);
    };

    await step('home loads, with projects and the issue cards', async () => {
      await send('Page.navigate', { url: base + '#home' });
      await until("document.querySelectorAll('.proj').length >= 5 && document.querySelector('.issue')", 'home');
      await shot('home', 'light');
    });
    await step('a chat opens with grouped steps, answers and the pinned bar', async () => {
      await evaluate("document.querySelectorAll('.proj .head')[0].click()");
      const href = await evaluate("[...document.querySelectorAll('.chat')].find((a) => /rounding/i.test(a.textContent)).getAttribute('href')");
      await evaluate(`location.hash = ${JSON.stringify(href)}`);
      await until("document.querySelectorAll('#transcript [data-special=\"answer\"]').length >= 3", 'the answers');
      const counts = await evaluate("({ you: document.querySelectorAll('#transcript [data-special=\"you\"]').length, steps: document.querySelectorAll('#transcript .steps').length, cards: document.querySelectorAll('#transcript .card.edit').length, job: document.querySelectorAll('#transcript .event.job').length, compact: document.querySelectorAll('#transcript .event.compact').length })");
      if (counts.you < 3 || counts.steps < 1 || counts.cards < 3 || counts.job !== 1 || counts.compact !== 1) throw new Error('unexpected chat structure ' + JSON.stringify(counts));
      await evaluate("document.querySelector('#main').scrollTop = 0");
      await shot('chat', 'light');
      await evaluate("document.querySelector('#main').scrollTop = 900; document.querySelector('#main').dispatchEvent(new Event('scroll'))");
      await until("!document.querySelector('#pinned').classList.contains('off')", 'the pinned bar');
      await shot('chat-pinned-dark', 'dark');
      await evaluate("document.documentElement.setAttribute('data-theme', 'light')");
    });
    await step('conversation only hides the steps and keeps the answers', async () => {
      await evaluate("document.querySelector('.segbtns [data-mode=\"convo\"]').click()");
      const vis = await evaluate("({ steps: [...document.querySelectorAll('#transcript .steps, #transcript .card')].filter((n) => n.offsetParent).length, answers: [...document.querySelectorAll('#transcript .final')].filter((n) => n.offsetParent).length })");
      if (vis.steps !== 0 || vis.answers < 3) throw new Error('conversation only shows ' + JSON.stringify(vis));
      await evaluate("document.querySelector('#main').scrollTop = 0");
      await shot('conversation-only', 'light');
      await evaluate("document.querySelector('.segbtns [data-mode=\"full\"]').click()");
    });
    await step('search finds a message and opens the chat at it', async () => {
      await evaluate("{ const s = document.querySelector('#search'); s.value = 'bank statement'; s.dispatchEvent(new Event('input')); }");
      await until("document.querySelectorAll('.hit').length > 0", 'search results');
      await evaluate("{ const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input')); }");
    });
    await step('the relocate dialog explains itself and previews the change', async () => {
      await evaluate("location.hash = '#home'");
      await until("document.querySelector('.issue .btn.primary')", 'issue card');
      await evaluate("document.querySelector('.issue .btn.primary').click()");
      await until("document.querySelector('.modal .about') && document.querySelector('.modal .notice-box')", 'the relocate dialog');
      await shot('relocate', 'light');
      await evaluate("document.querySelector('.modal .x').click()");
    });
    await step('the archive page shows the rescued chat and the log', async () => {
      await evaluate("location.hash = '#archive'");
      await until("document.querySelector('.statusbar') && document.querySelectorAll('.logrow').length > 0", 'archive page');
      await shot('archive', 'dark');
      await evaluate("document.documentElement.setAttribute('data-theme', 'light')");
    });
    await step('memory files show versions and what changed', async () => {
      await evaluate("location.hash = '#memory'");
      await until("document.querySelectorAll('.memlist button').length >= 3", 'memory list');
      await evaluate("[...document.querySelectorAll('.memlist button')].find((b) => /money-rules/.test(b.textContent)).click()");
      await until("document.querySelector('.vtabs')", 'version tabs');
      await evaluate("[...document.querySelectorAll('.vtabs button')].find((b) => /What changed/.test(b.textContent)).click()");
      await until("document.querySelector('.vdiff .gone') && document.querySelector('.vdiff .new')", 'the comparison');
      await shot('memory', 'light');
    });
    await step('help opens at a message code, in the side panel and as a page', async () => {
      await evaluate("location.hash = '#help/w-live'");
      await until("document.querySelector('.helpdoc [data-code=\"w-live\"]')", 'help page');
      await evaluate("location.hash = '#home'");
      await until("document.querySelector('.tiles')", 'home again');
      await evaluate("document.querySelector('#helpBtn').click()");
      await until("!document.querySelector('#drawer').hidden && document.querySelector('#drawer .helpdoc h2')", 'help drawer');
      await evaluate("document.querySelector('#drawerClose').click()");
    });
    await step('settings, undo history, move many projects and zip dialogs open', async () => {
      for (const [btn, sel] of [['#settingsBtn', '.settings-sec'], ['#historyBtn', '.modal .about'], ['#bulkBtn', '.modal .about']]) {
        await evaluate(`document.querySelector('${btn}').click()`);
        await until(`document.querySelector('${sel}')`, btn);
        await evaluate("document.querySelector('.modal .x').click()");
      }
      await evaluate("document.querySelector('#ioBtn').click(); document.querySelector('[data-act=\"import-zip\"]').click()");
      await until("document.querySelector('.modal input[type=file]')", 'import dialog');
      await evaluate("document.querySelector('.modal .x').click()");
    });
    await step('the exported page renders on its own, conversation only, without errors', async () => {
      const href = await evaluate("(async () => { const p = await (await fetch('/api/projects')).json(); const x = p.projects.find((q) => q.sessions.some((s) => /rounding/i.test(s.title))); const s = x.sessions.find((y) => /rounding/i.test(y.title)); return '/api/print/' + encodeURIComponent(x.folderName) + '/' + s.sessionId + '?convo=1'; })()");
      await send('Page.navigate', { url: base.replace(/\/$/, '') + href });
      await wait(800);
      await until("document.querySelectorAll('.final').length >= 3 && document.querySelector('[data-act=\"convo\"]')", 'export page');
    });

    ws.close();
  } finally {
    chrome.kill();
    server.kill();
    await wait(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it */ }
    if (!args.includes('--root')) try { fs.rmSync(DEMO, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (problems.length) {
    console.error('\n  The page reported problems:\n' + problems.map((p) => '    - ' + p).join('\n'));
    process.exit(1);
  }
  console.log('\n  No errors.' + (shotsDir ? ' Screenshots in ' + shotsDir : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
