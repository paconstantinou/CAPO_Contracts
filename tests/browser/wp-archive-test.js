/* Real-browser check of the Archive of expired contracts in WordPress.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-archive-test.js */
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
  const T = s => p.innerText(s), W = ms => p.waitForTimeout(ms);
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { path = path.replace('&purge=1', (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1'); const r = await fetch(RL_CFG.rest + path, { method: m, headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.status; }, [m, path, body]);
  const tit = 'Probe Archive ' + Date.now();
  const mk = async (title, from) => {
    await p.click('#tabCt'); await W(600); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
    await p.fill('#c_title', title); await p.fill('#c_tender', 'ARC-1/2020');
    await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', from); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
    await p.fill('#cy_cost_0', '1000'); await p.click('[data-act=ctsave]'); await W(1500);
  };
  await mk(tit + ' A', '2020-01-01');
  let d = await T('#overlay');
  ok('expired contract shows Έληξε and an enabled Αρχειοθέτηση button', d.includes('Έληξε') && await p.locator('[data-act=ctarch]').count() === 1 && await p.locator('[data-act=ctarch]').isEnabled());
  await p.click('[data-act=ctarch]'); await W(1500);
  d = await T('#overlay');
  ok('after Archive the contract shows Αρχειοθετήθηκε and offers restore', d.includes('Αρχειοθετήθηκε') && await p.locator('[data-act=ctunarch]').count() === 1);
  await p.click('#overlay [data-act=close]'); await W(300);
  await p.click('#chips [data-f=archived]'); await W(300);
  ok('Αρχείο filter lists the archived contract', (await T('#list')).includes(tit + ' A'));
  await p.click('#chips [data-f=expired]'); await W(300);
  ok('archived contract is not in the Έληξαν filter', !(await T('#list')).includes(tit + ' A'));
  await p.click('#chips [data-f=all]'); await W(300);
  ok('archived contract still appears in the full list (reference)', (await T('#list')).includes(tit + ' A'));
  await mk(tit + ' B', '2026-01-01');
  ok('contract that has not expired: Αρχειοθέτηση is disabled', await p.locator('[data-act=ctarch]').count() === 1 && await p.locator('[data-act=ctarch]').isDisabled());
  await p.click('#overlay [data-act=close]'); await W(300);
  /* the archived contract does not count in the attention digest list / alerts */
  ok('archived contract is not in the attention alerts', !(await T('#alerts')).includes(tit + ' A'));
  /* restore */
  await p.click('#chips [data-f=archived]'); await W(300);
  await p.locator('#list .row, #list tr', { hasText: tit + ' A' }).first().click(); await W(500);
  await p.click('[data-act=ctunarch]'); await W(1500);
  ok('restore returns it to Έληξε', (await T('#overlay')).includes('Έληξε') && await p.locator('[data-act=ctarch]').count() === 1);
  /* the server stored it */
  const rec = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).items.filter(i => /^Probe Archive/.test(i.data.title)).map(i => ({ id: i.id, t: i.data.title, a: i.data.archived })));
  ok('server: A restored (not archived), B never archived', rec.length === 2 && rec.every(x => x.a === false), JSON.stringify(rec));
  for (const x of rec) { await api('DELETE', `records/contracts/${x.id}`); await api('DELETE', `records/contracts/${x.id}&purge=1`); }
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
