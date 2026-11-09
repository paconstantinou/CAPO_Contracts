/* Real-browser check of the WordPress admin menu: Settings and Application Management live under PROCURE360.
   Usage: RL_URL=http://127.0.0.1:8088 RL_USER=admin RL_PASS=... node tests/browser/wp-admin-menu-test.js */
const { chromium } = require('playwright');
const base = process.env.RL_URL || 'http://127.0.0.1:8088', user = process.env.RL_USER || 'admin', pass = process.env.RL_PASS;
if (!pass) { console.error('RL_PASS required'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/wp-login.php', { waitUntil: 'commit' });
  await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  await p.goto(base + '/wp-admin/admin.php?page=renewal-ledger', { waitUntil: 'load' });
  const top = await p.locator('#adminmenu > li > a.menu-top').allInnerTexts();
  ok('one PROCURE360 top-level menu', top.filter(t => t.trim() === 'PROCURE360').length === 1);
  ok('no separate top-level Application Management menu', !top.some(t => t.trim() === 'Application Management'));
  const sub = (await p.locator('#adminmenu li.wp-has-current-submenu .wp-submenu li:visible').allInnerTexts()).map(t => t.trim()).filter(Boolean);
  ok('submenu: Ρυθμίσεις and Application Management under PROCURE360', sub.includes('Ρυθμίσεις') && sub.includes('Application Management') && !sub.includes('Users & Access'));
  ok('settings page opens under the PROCURE360 menu', (await p.locator('.wrap h1').first().innerText()).includes('PROCURE360') && /Άρθρα|εφαρμογή/.test(await p.locator('.wrap').first().innerText()));
  ok('settings page no longer holds the articles table', await p.locator('#rl-art-table').count() === 0);
  for (const [pg, title] of [['am-dashboard', 'Dashboard'], ['am-users', 'Users & Access'], ['am-roles', 'Roles Management'], ['am-permissions', 'Permissions Management'], ['am-modules', 'Module Management'], ['am-logs', 'Activity Logs'], ['am-settings', 'Settings']]) {
    const r = await p.goto(base + '/wp-admin/admin.php?page=' + pg, { waitUntil: 'load' });
    const h1 = await p.locator('.am-wrap h1').count() ? await p.locator('.am-wrap h1').innerText() : '';
    const cur = await p.locator('#adminmenu li.wp-has-current-submenu > a').count() ? (await p.locator('#adminmenu li.wp-has-current-submenu > a').first().innerText()).trim().split('\n')[0] : '';
    ok(pg + ' opens (' + title + ') with PROCURE360 menu highlighted', r.status() === 200 && h1 === title && cur === 'PROCURE360');
  }
  ok('no JavaScript errors', errs.length === 0);
  await p.goto(base + '/wp-admin/admin.php?page=am-users', { waitUntil: 'load' }); await p.screenshot({ path: '/tmp/s-menu.png' });
  await b.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})();
