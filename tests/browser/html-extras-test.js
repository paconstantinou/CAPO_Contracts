/* Real-browser check of the Additional / optional services in a standalone HTML build (usage: node html-extras-test.js path/to/index.html): create, duplicate check, contract selection, counters, trash.
   */
const { chromium } = require('playwright');
const file = require('path').resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabCo', { timeout: 20000 }); await p.waitForTimeout(1500);
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  const T = s => p.innerText(s), W = ms => p.waitForTimeout(ms);
  const tit = 'Probe Υπηρεσίες ' + Date.now();
  await p.click('#tabCt'); await W(800); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  ok('form has the services section', (await T('#overlay')).includes('Επιπρόσθετες / Προαιρετικές Υπηρεσίες') && await p.locator('[data-act=exadd]').count() === 1);
  await p.fill('#c_title', tit); await p.fill('#c_tender', 'EXT-1/2027');
  await p.fill('#c_months', '24'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', '2027-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
  await p.fill('#cy_cost_0', '1000'); await p.fill('#cy_cost_1', '1000'); await p.fill('#c_cost', '2000');
  await p.click('[data-act=exadd]'); await W(200);
  await p.selectOption('#ex_kind_0', 'optional'); await p.fill('#ex_desc_0', 'Υπηρεσία Α'); await p.fill('#ex_amt_0', '1200');
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
  ok('detail lists both services and the cost includes them', d.includes('Υπηρεσία Α') && d.includes('Υπηρεσία Β') && d.includes('Προαιρετική') && d.includes('Επιπρόσθετη') && dn.includes('5,000.00') && d.includes('(με υπηρεσίες)'), d.slice(0, 400));
  ok('year rows show the cost with services (2.500 €)', dn.includes('2,500.00'));
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
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
