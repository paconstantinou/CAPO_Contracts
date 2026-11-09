/* Real-browser check of the budget-article permissions (module "articles") for a limited user.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_WPLOAD=/path/to/wp-load.php RL_ADMIN_PASS=... node tests/browser/wp-articles-perms-test.js  (user manager1, password Pw-manager1-12345!) */
const { chromium } = require('playwright'); const { execFileSync } = require('child_process'); const path = require('path');
const base = process.env.RL_URL || 'http://127.0.0.1:8088', page = process.env.RL_PAGE || '/rl/', wp = process.env.RL_WPLOAD;
if (!wp) { console.error('RL_WPLOAD required'); process.exit(2); }
const ov = (...pairs) => execFileSync('php', [path.join(__dirname, '../integration/set-override.php'), wp, 'manager1', ...pairs]).toString().trim();
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  async function open() {
    const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    p.on('dialog', d => d.accept());
    await p.goto(base + '/wp-login.php', { waitUntil: 'commit' });
    await p.fill('#user_login', 'manager1'); await p.fill('#user_pass', 'Pw-manager1-12345!'); await p.click('#wp-submit'); await p.waitForTimeout(3000);
    await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(3000);
    await p.click('#tabAr'); await p.waitForTimeout(600); return p;
  }
  ov('articles:create=', 'articles:edit=', 'articles:delete=');
  let p = await open();
  ok('no articles permission: the list is visible but there is no edit button', await p.locator('table.arview tbody tr').count() > 3 && await p.locator('[data-act=arts]').count() === 0);
  ov('articles:create=allow');
  p = await open();
  ok('create permission: edit button appears', await p.locator('#chips [data-act=arts]').count() === 1);
  await p.click('#chips [data-act=arts]'); await p.waitForTimeout(400);
  ok('add is enabled, existing rows are read-only, delete is disabled', await p.locator('[data-act=artadd]:not([disabled])').count() === 1 && await p.locator('#artRows tr:first-child [data-k=desc][disabled]').count() === 1 && await p.locator('#artRows [data-act=artdel]:not([disabled])').count() === 0);
  await p.click('[data-act=artadd]'); await p.waitForTimeout(200);
  const nr = p.locator('#artRows tr').last();
  ok('the new row is editable', await nr.locator('[data-k=code]:not([disabled])').count() === 1);
  await nr.locator('[data-k=code]').fill('TST98'); await nr.locator('[data-k=desc]').fill('Άρθρο χρήστη'); await nr.locator('[data-k=cat]').fill('9'); 
  await p.click('[data-act=artsave]'); await p.waitForTimeout(1800);
  ok('the user saved a new article', (await p.innerText('#list')).includes('TST98'));
  ov('articles:create=', 'articles:delete=allow');
  p = await open(); await p.click('#chips [data-act=arts]'); await p.waitForTimeout(400);
  ok('delete permission: add is disabled, delete is enabled', await p.locator('[data-act=artadd][disabled]').count() === 1 && await p.locator('#artRows [data-act=artdel]:not([disabled])').count() > 3);
  await p.locator('#artRows tr', { has: p.locator('input[value="TST98"]') }).locator('[data-act=artdel]').click(); await p.waitForTimeout(200);
  await p.click('[data-act=artsave]'); await p.waitForTimeout(1800);
  ok('the user removed the article again', !(await p.innerText('#list')).includes('TST98'));
  ov('articles:delete=');
  await b.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})();
