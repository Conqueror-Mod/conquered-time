// REPL driver for Conquered Time (Electron). Run from the repo root with:
//   node .claude/skills/run-app/driver.mjs
// Designed for agents: type commands at the `driver>` prompt, one per line.
// Windows host with a real display — no xvfb. Launches with --dev so the
// profile selector is skipped and dev-data/dev-vault.db loads directly; the
// seeded devuser has dev_mode=1 so TOTP is bypassed. Run `npm run seed` first.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR  = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, '.tmp-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = process.platform === 'win32'
  ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');

let app = null, page = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitURL(frag, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (page && !page.isClosed() && page.url().includes(frag)) return true;
    // The app uses multiple BrowserWindows (splash precedes login in a separate
    // window). firstWindow() may have bound `page` to the splash, so scan every
    // open window and rebind to whichever matches the target URL fragment.
    if (app) {
      for (const w of app.windows()) {
        try { if (!w.isClosed() && w.url().includes(frag)) { page = w; return true; } } catch {}
      }
    }
    await sleep(200);
  }
  throw new Error(`TIMEOUT waiting for url to contain "${frag}" (now: ${page && page.url()})`);
}

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: ['--dev', '.'],
      cwd: APP_DIR,
      timeout: 30_000,
    });
    page = await app.firstWindow();
    await waitURL('login');                       // splash may precede this
    await page.waitForSelector('#login-username', { timeout: 15_000 });
    console.log('launched — at login screen');
  },

  // Log in as the seeded dev user (TOTP bypassed by dev_mode).
  async login(arg) {
    const [u = 'devuser', p = 'devpass123'] = (arg || '').split(/\s+/).filter(Boolean);
    await page.fill('#login-username', u);
    await page.fill('#login-password', p);
    await page.evaluate(() => doLogin());
    await waitURL('dashboard');
    await sleep(1200);
    console.log('logged in — at dashboard');
  },

  // Navigate via the app's own IPC nav (dashboard|companies|tracker|global-log|reports|task-timer)
  async nav(dest) {
    await page.evaluate(d => api.send('navigate', d), dest);
    await waitURL(dest);
    await sleep(800);
    console.log('navigated to', dest);
  },

  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async eval(expr) {
    try { console.log(JSON.stringify(await page.evaluate(`(async()=>(${expr}))()`))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async url() { console.log(page ? page.url() : '(no page)'); },

  // The historically-cursed path (gotcha #6): N save operations on ONE session
  // must yield exactly ONE row, never duplicates. Requires being on the tracker.
  // Usage: verify-cursed-path [companyValue]   (default: first company w/ no entry today)
  async 'verify-cursed-path'(companyValue) {
    await COMMANDS.nav('tracker');
    await page.waitForSelector('#company-select', { timeout: 10_000 });
    const picked = await page.evaluate(cv => {
      const sel = document.getElementById('company-select');
      const opts = [...sel.options].filter(o => o.value);
      const opt = (cv && opts.find(o => o.value === cv)) || opts[opts.length - 1];
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
      return opt ? { v: opt.value, t: opt.textContent } : null;
    }, companyValue);
    console.log('company:', JSON.stringify(picked));
    await sleep(800);

    const today = await page.evaluate(() => document.getElementById('log-date').value);
    const baseline = await page.evaluate(async d =>
      (await api.invoke('entries:all')).filter(e => e.log_date === d).length, today);

    await page.evaluate(() => {
      const lab = document.getElementById('input-label');
      const opt = [...lab.options].find(o => o.value && o.value !== '');
      if (opt) { lab.value = opt.value; lab.dispatchEvent(new Event('change')); }
      const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } };
      set('input-name', 'Cursed Path Test');
      set('input-desc', 'clock in/out + repeated autosave');
    });
    await page.evaluate(() => clockIn());        await sleep(600);  // save #1 (insert)
    await page.evaluate(() => saveSession(true)); await sleep(400); // save #2 (update)
    await page.evaluate(() => clockOut());       await sleep(600);  // save #3 (update)
    await page.evaluate(() => saveSession(true)); await sleep(800); // save #4 (update)

    const eid   = await page.evaluate(() => (typeof currentEntryId !== 'undefined' ? currentEntryId : 'n/a'));
    const after = await page.evaluate(async d =>
      (await api.invoke('entries:all')).filter(e => e.log_date === d).length, today);
    const delta = after - baseline;
    console.log(`today=${today} baseline=${baseline} after=${after} currentEntryId=${eid}`);
    console.log(`4 saves on one session -> ${delta} new row(s): ` +
      (delta === 1 ? 'PASS — no duplication (gotcha #6 holds)'
                   : `FAIL — expected 1, got ${delta}`));
  },

  async windows() {
    if (!app) return console.log('launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(() => {}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });

// Serialize commands so piped input (all lines arriving at once) runs in order,
// not concurrently — otherwise `login` fires before `launch` resolves.
let chain = Promise.resolve();
rl.on('line', line => {
  const t = line.trim();
  if (!t) { rl.prompt(); return; }
  chain = chain.then(async () => {
    const sp = t.indexOf(' ');
    const cmd = sp === -1 ? t : t.slice(0, sp);
    const arg = sp === -1 ? '' : t.slice(sp + 1).trim();
    const fn = COMMANDS[cmd];
    if (!fn) { console.log('unknown:', cmd, '— try: help'); return rl.prompt(); }
    try { await fn.call(COMMANDS, arg); } catch (e) { console.log('ERROR:', e.message); }
    if (cmd === 'quit') { rl.close(); process.exit(0); }
    rl.prompt();
  });
});
// On stdin close (e.g. piped input ends), let the queued commands finish first.
rl.on('close', () => { chain = chain.then(async () => { await COMMANDS.quit(); process.exit(0); }); });

console.log('Conquered Time driver — "help" for commands, "launch" to start, "quit" to exit');
rl.prompt();
