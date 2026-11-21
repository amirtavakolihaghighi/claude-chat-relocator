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
    await step('Browse hands the chosen folder back to the dialog', async () => {
      await evaluate("location.hash = '#home'");
      await until("document.querySelector('.issue .btn.primary')", 'issue card');
      await evaluate("document.querySelector('.issue .btn.primary').click()");
      await until("document.querySelector('.modal .about')", 'the relocate dialog');
      await evaluate("[...document.querySelectorAll('.modal .inrow .btn')].find((b) => /Browse/.test(b.textContent)).click()");
      await until("document.querySelectorAll('.modal').length === 2 && document.querySelector('.pickerlist')", 'the folder picker');
      // The project's old folder may not exist, so the list can start out empty: go Up to the top first.
      // (The spinner sits inside a .sidenote, so "loaded" means no spinner, not just "a note is showing".)
      const loaded = "!document.querySelector('.pickerlist .spin') && document.querySelector('.pickerlist button, .pickerlist .sidenote')";
      await until(loaded, 'the first list');
      if (!(await evaluate("!!document.querySelector('.pickerlist button')"))) {
        await evaluate("[...document.querySelectorAll('.modal .pickerbar .btn')].pop().click()");
        await until("!document.querySelector('.pickerlist .spin') && document.querySelector('.pickerlist button')", 'the top-level folders');
      }
      const pathBox = "[...document.querySelectorAll('.modal')].pop().querySelector('.field input')";
      const before = await evaluate(`${pathBox}.value`);
      await evaluate("document.querySelector('.pickerlist button').click()");
      await until(`${loaded} && ${pathBox}.value !== ${JSON.stringify(before)}`, 'the folder to open');
      const chosen = await evaluate(`${pathBox}.value`);
      if (!chosen) throw new Error('the picker never showed a path');
      await evaluate("[...document.querySelectorAll('.modal')].pop().querySelector('.btn.primary').click()");
      await until("document.querySelectorAll('.modal').length === 1", 'the picker to close');
      const got = await evaluate("document.querySelector('.modal .inrow input').value");
      if (got !== chosen) throw new Error(`picked "${chosen}" but the dialog got "${got}"`);
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
    await step('switching memory files keeps the page where it is and prints no stray "null"', async () => {
      await evaluate("location.hash = '#help'");
      await until("document.querySelector('.helpdoc')", 'help page');
      await evaluate("location.hash = '#memory'");
      await until("document.querySelectorAll('.memlist button').length >= 3 && document.querySelector('.memview header')", 'memory page');
      // make the page tall enough to scroll, then scroll a little
      await evaluate("window.__list = document.querySelector('.memlist'); document.querySelector('.memview').style.minHeight = '2500px'; document.querySelector('#main').scrollTop = 100");
      for (const nm of ['user-profile', 'MEMORY', 'money-rules']) {
        await evaluate(`[...document.querySelectorAll('.memlist button')].find((b) => b.textContent.startsWith('${nm}')).click()`);
        await until(`document.querySelector('.memlist button.on').textContent.startsWith('${nm}') && document.querySelector('.memview header b').textContent.startsWith('${nm}')`, nm);
        const r = await evaluate("({ same: window.__list === document.querySelector('.memlist'), top: document.querySelector('#main').scrollTop, stray: [...document.querySelector('.memview').childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue) })");
        if (!r.same) throw new Error(`${nm}: the file list was rebuilt, so its scrollbar goes back to the top`);
        if (r.top !== 100) throw new Error(`${nm}: the page jumped from 100 to ${r.top}`);
        if (r.stray.length) throw new Error(`${nm}: stray text in the file view: ${JSON.stringify(r.stray)}`);
        const note = await evaluate("(() => { const n = document.querySelector('.memview .memnote'); if (!n) return null; const q = (s) => n.querySelector(s); return { label: q('.pill') && q('.pill').textContent, name: q('b') && q('b').textContent, desc: q('.desc') && q('.desc').textContent, open: q('details').open, prose: document.querySelector('.memview .prose').innerText }; })()");
        if (nm !== 'user-profile') { if (note) throw new Error(`${nm}: a note box appeared on a file with no settings block`); continue; }
        if (!note) throw new Error('user-profile: its settings block did not become a note box');
        if (note.label !== 'About you' || note.name !== 'user-profile' || !/plain words first/.test(note.desc)) throw new Error('the note box shows the wrong things: ' + JSON.stringify(note));
        if (note.open) throw new Error('the technical details should start folded');
        if (/originSessionId|node_type|name: user-profile/.test(note.prose)) throw new Error('the settings block is still in the text: ' + note.prose.slice(0, 80));
        await evaluate("document.querySelector('.memnote summary').click()");
        const tech = await evaluate("document.querySelector('.memnote .tech').innerText");
        if (!/originSessionId: 0000/.test(tech) || !/node_type: memory/.test(tech)) throw new Error('technical details are missing: ' + tech);
      }
    });
    // ---- the sidebar and the window sizes
    const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const sideBox = () => evaluate("(() => { const q = (s) => document.querySelector(s); const s = q('#sidebar'); const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { w: Math.round(r.width), left: Math.round(r.left), mainLeft: Math.round(q('#main').getBoundingClientRect().left), shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.right > 0, saved: localStorage.getItem('ccx-side-w'), mode: localStorage.getItem('ccx-side') }; })()");
    const reload = async () => { await send('Page.reload'); await until("document.querySelectorAll('.proj').length >= 5", 'the page after a reload'); };
    const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    const expect = (what, got, want) => { if (got !== want) throw new Error(`${what}: expected ${want}, got ${got}`); };
    const near = (what, got, want, tol = 3) => { if (Math.abs(got - want) > tol) throw new Error(`${what}: expected about ${want}, got ${got}`); };

    await step('wide window: drag the sidebar wider, and it stays that way after a reload', async () => {
      await viewport(1440, 1000);
      await evaluate("location.hash = '#home'; localStorage.clear()");
      await reload();
      let b = await sideBox();
      expect('usual width', b.w, 300); expect('page starts after the sidebar', b.mainLeft, 300);
      await mouse('mousePressed', 300, 500); await mouse('mouseMoved', 360, 500); await mouse('mouseMoved', 420, 500); await mouse('mouseReleased', 420, 500);
      b = await sideBox();
      near('width after dragging', b.w, 420); expect('the width is saved', b.saved, String(b.w));
      await reload();
      b = await sideBox();
      near('width after a reload', b.w, 420);
      await mouse('mousePressed', b.w, 500); await mouse('mouseMoved', 100, 500); await mouse('mouseReleased', 100, 500);
      expect('the smallest width', (await sideBox()).w, 220);
      await evaluate("document.querySelector('#sideResizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
      b = await sideBox();
      expect('double-click puts it back', b.w, 300); expect('and forgets the saved width', b.saved, null);
      await evaluate("document.querySelector('#sideResizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))");
      expect('an arrow key with Shift', (await sideBox()).w, 364);
      await evaluate("document.querySelector('#sideResizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))");
      expect('Home', (await sideBox()).w, 220);
      await evaluate("document.querySelector('#sideResizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    });
    await step('wide window: narrow the sidebar to icons, close it, bring it back', async () => {
      await evaluate("document.querySelector('#compactBtn').click()");
      let b = await sideBox();
      expect('icon strip width', b.w, 64); expect('page starts after the strip', b.mainLeft, 64); expect('mode is saved', b.mode, 'compact');
      if (await evaluate("[...document.querySelectorAll('#sidebar .nl')].some((n) => n.offsetParent)")) throw new Error('labels are still showing in the icon strip');
      if (!(await evaluate("!!document.querySelector('#railProjects').offsetParent"))) throw new Error('the Projects icon is missing from the strip');
      await evaluate("document.querySelector('#navToggle').click()");
      b = await sideBox();
      expect('closed: nothing shows', b.shown, false); expect('closed: page starts at the left edge', b.mainLeft, 0);
      await reload();
      expect('closed stays closed after a reload', (await sideBox()).shown, false);
      await evaluate("document.querySelector('#navToggle').click()");
      expect('showing it again brings back the icon strip', (await sideBox()).w, 64);
      await evaluate("document.querySelector('#railProjects').click()");
      b = await sideBox();
      expect('the Projects icon makes it wide again', b.w, 300); expect('and the mode is forgotten', b.mode, null);
    });
    await step('Settings puts the sidebar back to its usual size', async () => {
      await mouse('mousePressed', 300, 500); await mouse('mouseMoved', 400, 500); await mouse('mouseReleased', 400, 500);
      await evaluate("document.querySelector('#compactBtn').click()");
      expect('the strip is on', (await sideBox()).w, 64);
      await evaluate("document.querySelector('#settingsBtn').click()");
      await until("[...document.querySelectorAll('.modal .btn')].some((b) => /usual size/.test(b.textContent))", 'the reset button');
      await evaluate("[...document.querySelectorAll('.modal .btn')].find((b) => /usual size/.test(b.textContent)).click()");
      const b = await sideBox();
      expect('back to the usual width', b.w, 300); expect('and nothing is left saved', `${b.saved}/${b.mode}`, 'null/null');
      await evaluate("document.querySelector('.modal .x').click()");
    });
    await step('phone: the sidebar slides over the page, and the top buttons move into it', async () => {
      await viewport(390, 844);
      await wait(300);   // let the browser announce the new size, as it would between a person's resize and click
      await until("document.querySelector('#sidebar') && !document.documentElement.getAttribute('data-nav')", 'the phone layout');
      let b = await sideBox();
      expect('the panel starts hidden', b.shown, false);
      expect('the page uses the whole width', b.mainLeft, 0);
      if (await evaluate("!!document.querySelector('#bulkBtn').offsetParent")) throw new Error('"Move many projects" is still in the top bar on a phone');
      await evaluate("document.querySelector('#navToggle').click()");
      await wait(350);   // it slides in
      b = await sideBox();
      expect('the panel opens', b.shown, true); expect('over the page', b.left, 0);
      if (!(await evaluate("getComputedStyle(document.querySelector('#scrim')).display !== 'none' && document.querySelector('#scrim').getBoundingClientRect().width > 300"))) throw new Error('no dimmed backdrop behind the panel');
      if (!(await evaluate("[...document.querySelectorAll('#sidebar .tools button')].every((n) => n.offsetParent)"))) throw new Error('the tools are not in the panel');
      await evaluate("document.querySelector('[data-proxy=\"#historyBtn\"]').click()");
      await until("document.querySelector('.modal .about')", 'Undo history from the panel');
      expect('the panel gets out of the way of the dialog', await evaluate("document.documentElement.getAttribute('data-nav')"), null);
      await evaluate("document.querySelector('.modal .x').click()");
      await evaluate("document.querySelector('#navToggle').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      expect('Esc closes the panel', await evaluate("document.documentElement.getAttribute('data-nav')"), null);
      await evaluate("document.querySelector('#navToggle').click(); document.querySelector('#scrim').click()");
      expect('clicking outside closes the panel', await evaluate("document.documentElement.getAttribute('data-nav')"), null);
      await evaluate("document.querySelector('#navToggle').click(); document.querySelector('[data-nav=\"archive\"]').click()");
      await until("document.querySelector('.statusbar')", 'the archive page');
      expect('choosing a page closes the panel', await evaluate("document.documentElement.getAttribute('data-nav')"), null);
    });
    await step('every page fits at laptop, tablet and phone sizes, with nothing running off the side', async () => {
      const chat = await evaluate("(async () => { const p = await (await fetch('/api/projects')).json(); const x = p.projects.find((q) => q.sessions.some((s) => /rounding/i.test(s.title))); const s = x.sessions.find((y) => /rounding/i.test(y.title)); return '#chat/' + encodeURIComponent(x.folderName) + '/' + s.sessionId; })()");
      // Text is wider on some systems than on others (Linux fonts are wider than Windows ones), so
      // test with deliberately wide fonts: what fits then fits everywhere.
      await evaluate("(() => { const s = document.createElement('style'); s.id = 'wide-fonts'; s.textContent = \"body, button, input, select, textarea, h1, h2, h3 { font-family: Verdana, 'DejaVu Sans', sans-serif !important } .mono, code, pre, .path { font-family: 'Courier New', 'DejaVu Sans Mono', monospace !important }\"; document.head.appendChild(s); })()");
      const found = [];
      try {
        for (const [w, h] of [[1024, 700], [768, 1024], [390, 844], [320, 640]]) {
          await viewport(w, h);
          for (const page of ['#home', '#archive', '#memory', '#help', chat]) {
            await evaluate(`location.hash = ${JSON.stringify(page)}`);
            await wait(450);
            await until("document.querySelector('#main') && !document.querySelector('#main .spin')", `${page} at ${w}`);
            const over = await evaluate("(() => { const m = document.querySelector('#main'); const mr = m.getBoundingClientRect(); const out = { page: document.documentElement.scrollWidth - innerWidth, main: m.scrollWidth - m.clientWidth, who: '' }; if (out.main > 1) for (const e of m.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).display === 'none' || r.right <= mr.right + 1) continue; let clipped = false; for (let n = e.parentElement; n && n !== m; n = n.parentElement) if (getComputedStyle(n).overflowX !== 'visible' && n.getBoundingClientRect().right <= mr.right + 1) { clipped = true; break; } if (!clipped) { out.who = e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 30) + ' \"' + e.textContent.trim().slice(0, 30) + '\"'; break; } } return out; })()");
            if (over.page > 1 || over.main > 1) found.push(`${page.slice(0, 20)} at ${w}px wide runs off the side (page ${over.page}px, content ${over.main}px) at ${over.who || '?'}`);
          }
        }
      } finally {
        await evaluate("document.getElementById('wide-fonts').remove()");
      }
      if (found.length) throw new Error(found.join('; '));
    });
    await step('a window smaller than the smallest layout scrolls instead of cutting things off', async () => {
      await viewport(280, 360);
      await wait(300);
      const r = await evaluate("(() => { scrollTo(60, 40); const e = document.scrollingElement; return { wide: e.scrollWidth > innerWidth, tall: e.scrollHeight > innerHeight, x: scrollX, y: scrollY }; })()");
      if (!r.wide || !r.tall) throw new Error('the page does not scroll in a tiny window ' + JSON.stringify(r));
      if (r.x < 1 || r.y < 1) throw new Error('scrolling does not move the page ' + JSON.stringify(r));
      await evaluate("scrollTo(0, 0)");
      await viewport(1440, 1000);
      await evaluate("location.hash = '#home'");
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
