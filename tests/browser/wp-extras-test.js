/* Real-browser check of the Additional / optional services of a contract in WordPress.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-extras-test.js */
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
  const tit = 'Probe Υπηρεσίες ' + Date.now();
  await p.click('#tabCt'); await W(800); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  ok('form has the services section', (await T('#overlay')).includes('Επιπρόσθετες / Προαιρετικές Υπηρεσίες') && await p.locator('[data-act=exadd]').count() === 1);
  await p.fill('#c_title', tit); await p.fill('#c_tender', 'EXT-1/2027');
  await p.fill('#c_months', '24'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', '2027-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
  await p.fill('#cy_cost_0', '1000'); await p.fill('#cy_cost_1', '1000'); await p.fill('#c_cost', '1');
  await p.click('[data-act=exadd]'); await W(200);
  await p.fill('#ex_desc_0', 'Υπηρεσία Α'); await p.fill('#ex_amt_0', '1200');
  const art = await p.locator('#ex_art_0 option').evaluateAll(o => o.map(x => x.value).filter(Boolean)[0]);
  await p.selectOption('#ex_art_0', art);
  await p.click('[data-act=exadd]'); await W(200);
  ok('adding a second service keeps the first one', (await p.inputValue('#ex_desc_0')) === 'Υπηρεσία Α' && await p.locator('#ex_desc_1').count() === 1);
  await p.fill('#ex_desc_1', 'Υπηρεσία Β'); await p.fill('#ex_amt_1', '300'); await p.selectOption('#ex_art_1', art);
  await p.dispatchEvent('#ex_amt_1', 'input'); await W(200);
  ok('totals update live (yearly 1,500 €, contract 5,000 €)', (await T('#cExSum')).includes('1,500.00') && (await T('#cTotal')).includes('5,000.00'), (await T('#cExSum')) + ' / ' + (await T('#cTotal')));
  await p.fill('#ex_desc_1', ''); await p.click('[data-act=ctsave]'); await W(400);
  ok('service with amount but no description is refused', (await T('#werr')).includes('περιγραφή'));
  await p.fill('#ex_desc_1', 'Υπηρεσία Β'); await p.fill('#ex_amt_1', '-3'); await p.click('[data-act=ctsave]'); await W(400);
  ok('negative amount is refused', (await T('#werr')).includes('μεγαλύτερος από 0'));
  await p.fill('#ex_amt_1', '300'); await p.click('[data-act=ctsave]'); await W(1500);
  let d = await T('#overlay'); const dn = d.replace(/\s/g, '');
  ok('detail lists both services and the cost includes them', d.includes('Υπηρεσία Α') && d.includes('Υπηρεσία Β') && !d.includes('Προαιρετική') && !d.includes('Επιπρόσθετη υπηρεσία') && dn.includes('5,000.00') && !d.includes('(με υπηρεσίες)'), d.slice(0, 400));
  ok('year rows do NOT include the services (1,000.00 and 1,000.00; no 2,500.00)', dn.includes('1,000.00') && !dn.includes('2,500.00'));
  await p.click('#overlay [data-act=close]'); await W(300);
  ok('contracts list shows the total with services', (await p.locator('#list .row', { hasText: tit }).first().innerText()).replace(/\s/g, '').includes('5,000'));
  /* editing keeps the services and does not double the base cost */
  await p.locator('#list .row', { hasText: tit }).first().click(); await W(400); await p.click('[data-act=edit]'); await W(400);
  ok('edit form shows the saved services and the base year cost', (await p.inputValue('#ex_desc_1')) === 'Υπηρεσία Β' && (await p.inputValue('#cy_cost_0')) === '1000' && (await p.inputValue('#ex_amt_0')) === '1200');
  await p.click('[data-act=ctsave]'); await W(1200);
  ok('saving again does not change the totals', (await p.locator('#list .row', { hasText: tit }).first().innerText()).replace(/\s/g, '').includes('5,000'));
  /* budget */
  await p.click('#tabBd'); await W(1500);
  const bt = await T('#list');
  ok('budget shows the services in their article, monthly over the contract years', bt.includes('υπηρεσία «Υπηρεσία Α»') && bt.includes('Έτος 2'), bt.slice(0, 300));
  const rows = await p.evaluate(() => Array.from(document.querySelectorAll('#list tr')).map(r => r.innerText.replace(/\s+/g, ' ')).filter(t => t.includes('Probe Υπηρεσίες')));
  console.log(rows.slice(0, 3).join('\n'));
  /* clean up */
  const ids = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).items.filter(i => /^Probe Υπηρεσίες/.test(i.data.title)).map(i => i.id));
  for (const id of ids) { await api('DELETE', `records/contracts/${id}`); await api('DELETE', `records/contracts/${id}&purge=1`); }
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
