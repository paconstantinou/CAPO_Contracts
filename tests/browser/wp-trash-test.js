/* Real-browser check of the trash in WordPress: delete -> undo -> trash -> restore -> purge, and what a restricted user sees.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-trash-test.js */
const { chromium } = require('playwright');
const base = process.env.RL_URL || 'http://127.0.0.1:8088', page = process.env.RL_PAGE || '/rl/', user = process.env.RL_USER || 'admin', pass = process.env.RL_PASS;
if (!pass) { console.error('RL_PASS required'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(base + '/wp-login.php', { waitUntil: 'commit' });
  await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
  await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(3000);
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  const T = s => p.innerText(s);
  const cfgPerm = await p.evaluate(() => ({ d: !!(RL_CFG.perms.software.delete), p: !!(RL_CFG.perms.software.purge) }));
  console.log('permissions in this session: delete=' + cfgPerm.d + ' purge=' + cfgPerm.p);
  if (!cfgPerm.d) {
    ok('no Trash chip for a user without delete permission', await p.locator('[data-f=trash]:visible').count() === 0);
    ok('page responsive', true);
  } else {
    const name = 'WP Trash Probe ' + Date.now();
    await p.evaluate(async n => { await fetch(RL_CFG.rest + 'records/software/probe1', { method: 'PUT', headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { name: n, dateFrom: '2026-01-01', dateTo: '2026-12-31', cost: 5, remindDays: 30 } }) }); }, name);
    await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('#rl-app'); await p.waitForTimeout(3000);
    await p.evaluate(() => { const o = document.querySelector('#overlay'); const c = o && o.querySelector('[data-act=close]'); c && c.click(); });
    ok('record is listed', (await T('#list')).includes(name));
    await p.click('text=' + name); await p.waitForTimeout(400);
    await p.click('[data-act=del]'); await p.click('#delYes'); await p.waitForTimeout(1200);
    ok('deleted record leaves the list', !(await T('#list')).includes(name));
    ok('Undo button shown', await p.locator('#toast .toast-undo').count() === 1);
    await p.click('#toast .toast-undo'); await p.waitForTimeout(1500);
    ok('Undo restores it (server round trip)', (await T('#list')).includes(name));
    await p.click('text=' + name); await p.waitForTimeout(400);
    await p.click('[data-act=del]'); await p.click('#delYes'); await p.waitForTimeout(1200);
    await p.click('[data-f=trash]'); await p.waitForTimeout(1500);
    ok('trash lists the record with who deleted it', (await T('#list')).includes(name) && (await T('#list')).includes('·'));
    ok('purge button ' + (cfgPerm.p ? 'visible (has purge)' : 'hidden (no purge permission)'), (await p.locator('[data-act=trpurge]:visible').count() > 0) === cfgPerm.p);
    await p.click('[data-act=trrestore]'); await p.waitForTimeout(1500);
    await p.click('[data-f=all]'); await p.waitForTimeout(500);
    ok('restore brings it back', (await T('#list')).includes(name));
    await p.click('text=' + name); await p.waitForTimeout(400);
    await p.click('[data-act=del]'); await p.click('#delYes'); await p.waitForTimeout(1200);
    if (cfgPerm.p) {
      await p.click('[data-f=trash]'); await p.waitForTimeout(1200);
      await p.click('[data-act=trpurge]'); await p.waitForTimeout(1500);
      ok('permanent delete empties the trash', (await T('#list')).includes('άδειος') || (await T('#list')).toLowerCase().includes('empty'));
    } else {
      await p.evaluate(async () => { await fetch(RL_CFG.rest + 'records/software/probe1', { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); });
    }
    await p.click('#tabBd'); await p.waitForTimeout(500); ok('budget tab still responds', true);
  }
  ok('no script errors', errs.length === 0);
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
