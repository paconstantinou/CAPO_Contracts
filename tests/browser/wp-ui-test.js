/* Real-browser check of the WordPress page (needs Playwright + a page containing [renewal_ledger]).
   Fails if the page freezes (e.g. an endless MutationObserver loop) or a tab does not respond.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=viewer1 RL_PASS=... node tests/browser/wp-ui-test.js */
const { chromium } = require('playwright');
const base = process.env.RL_URL || 'http://127.0.0.1:8088', page = process.env.RL_PAGE || '/rl/', user = process.env.RL_USER || 'admin', pass = process.env.RL_PASS;
if (!pass) { console.error('RL_PASS required'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/wp-login.php', { waitUntil: 'commit' });
  await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
  await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(4000);
  let bad = 0;
  async function step(name, fn) { const r = await Promise.race([fn().then(() => 'ok', e => 'ERR ' + e.message.split('\n')[0]), new Promise(r => setTimeout(() => r('HUNG'), 10000))]); if (r !== 'ok') bad++; console.log((r === 'ok' ? '  ok   ' : '  FAIL ') + name + (r === 'ok' ? '' : ' - ' + r)); }
  await step('budget tab opens', () => p.click('#tabBd', { timeout: 5000 }));
  await step('budget table rendered', async () => { await p.waitForSelector('#list', { timeout: 5000 }); });
  await step('article selector works', () => p.selectOption('#bdArt', '03461', { timeout: 5000 }));
  await step('contracts tab', () => p.click('#tabCt', { timeout: 5000 }));
  await step('software tab', () => p.click('#tabSw', { timeout: 5000 }));
  await step('no script errors', async () => { if (errs.length) throw new Error(errs[0]); });
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
