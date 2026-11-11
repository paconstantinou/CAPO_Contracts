/* Real-browser check of the Ανάδοχοι tab in WordPress and the contractor selection inside Συμβάσεις.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-contractors-test.js */
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
  const nm = 'Probe Ανάδοχος ' + Date.now(), nm2 = nm + ' B', tit = 'Probe Σύμβαση ' + Date.now();
  ok('tab Ανάδοχοι is visible', await p.locator('#tabCo:visible').count() === 1);
  await p.click('#tabCo'); await W(800);
  ok('tab opens and offers a button for a new contractor, no Excel import', (await T('#btnAdd')).includes('Νέος ανάδοχος') && await p.locator('#btnImport:visible').count() === 0);
  await p.click('#btnAdd'); await W(300);
  const lb = await T('#overlay');
  ok('form has all contractor fields', ['ΟΝΟΜΑ', 'ΑΦΜ', 'ΔΙΕΥΘΥΝΣΗ (ΟΔΟΣ, ΑΡΙΘΜΟΣ)', 'Τ.Κ.', 'ΠΟΛΗ', 'ΠΕΡΙΦΕΡΕΙΑ', 'ΧΩΡΑ', 'ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ', 'ΤΗΛΕΦΩΝΟ', 'EMAIL'].every(x => lb.includes(x)));
  ok('form is full screen', await p.evaluate(() => document.getElementById('overlay').dataset.kind === 'wiz'));
  await p.fill('#co_name', ''); await p.click('[data-act=cosave]'); await W(300);
  ok('name is required', (await T('#werr')).includes('υποχρεωτικό'));
  await p.fill('#co_name', nm); await p.fill('#co_vat', 'EL' + Date.now().toString().slice(-9)); await p.fill('#co_address', 'Οδός 5'); await p.fill('#co_postal', '1065'); await p.fill('#co_city', 'Λευκωσία'); await p.fill('#co_country', 'Κύπρος');
  await p.fill('#co_contact', 'Γιάννης Ανάδοχος'); await p.fill('#co_phone', '22 123456'); await p.fill('#co_email', 'a@example.com; b@example.com');
  await p.fill('#co_phone', 'abc'); await p.click('[data-act=cosave]'); await W(300);
  ok('bad phone is rejected', (await T('#werr')).includes('τηλέφωνο'));
  await p.fill('#co_phone', '22 123456');
  await p.keyboard.press('Backspace'); await p.locator('#overlay').click({ position: { x: 4, y: 400 } }); await W(200);
  ok('form does not close by Backspace or an outside click', await p.locator('#co_name').count() === 1);
  await p.click('[data-act=cosave]'); await W(1500);
  let d = await T('#overlay');
  ok('contractor saved, detail shows address and counters', d.includes(nm) && d.includes('Οδός 5') && d.includes('ΕΝΕΡΓΕΣ ΣΥΜΒΑΣΕΙΣ') && d.includes('Γιάννης Ανάδοχος'));
  await p.click('#overlay [data-act=close]'); await W(300);
  await p.click('#btnAdd'); await W(300); await p.fill('#co_name', '  ' + nm.toUpperCase() + ' '); await p.click('[data-act=cosave]'); await W(400);
  ok('same name again is refused (case-insensitive)', (await T('#werr')).includes('Υπάρχει ήδη ανάδοχος'));
  await p.click('[data-act=cocancel]'); await W(300);
  let L = await T('#list');
  ok('list shows the contractor with columns for active contracts and tenders', L.includes(nm) && L.includes('Ενεργές συμβάσεις') && L.includes('Διαγωνισμοί ενεργών συμβάσεων'));

  /* contracts */
  await p.click('#tabCt'); await W(800); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  ok('contract form has a contractor drop-down with the registered contractor and a button to add one', (await p.locator('#c_contractorId option', { hasText: nm }).count()) === 1 && (await T('#overlay')).includes('+ Νέος ανάδοχος'));
  ok('old free-text contractor fields are gone from the form', await p.locator('#c_contractor, #c_contractorVat, #c_contractorPhone').count() === 0);
  const lb2 = await T('#overlay');
  ok('representative fields exist', ['ΟΝΟΜΑΤΕΠΩΝΥΜΟ ΑΝΤΙΠΡΟΣΩΠΟΥ', 'ΤΗΛΕΦΩΝΟ ΑΝΤΙΠΡΟΣΩΠΟΥ', 'EMAIL ΑΝΤΙΠΡΟΣΩΠΟΥ'].every(x => lb2.includes(x)));
  await p.fill('#c_title', tit); await p.fill('#c_tender', 'ΑΝΑ-1/2027');
  await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', new Date(Date.now() - 864e5 * 30).toISOString().slice(0, 10)); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
  /* add a contractor from inside the contract */
  await p.click('[data-act=coaddfromct]'); await W(400);
  ok('adding a contractor opens the contractor form', await p.locator('#co_name').count() === 1);
  await p.fill('#co_name', nm2); await p.fill('#co_contact', 'Άλλος Άνθρωπος'); await p.fill('#co_email', 'c@example.com');
  await p.click('[data-act=cocancel]'); await W(300);
  ok('cancelling returns to the contract with the typed values kept', (await p.inputValue('#c_title')) === tit && (await p.inputValue('#c_months')) === '12');
  await p.click('[data-act=coaddfromct]'); await W(400);
  await p.fill('#co_name', nm2); await p.fill('#co_contact', 'Άλλος Άνθρωπος'); await p.fill('#co_email', 'c@example.com');
  await p.click('[data-act=cosave]'); await W(1500);
  ok('after saving it returns to the contract with the new contractor selected', (await p.inputValue('#c_title')) === tit && (await p.locator('#c_contractorId option:checked').innerText()).includes(nm2));
  ok('contractor fields are shown read-only', (await T('#cCtrInfo')).includes('Άλλος Άνθρωπος') && await p.locator('#cCtrInfo input').count() === 0);
  await p.selectOption('#c_contractorId', { label: (await p.locator('#c_contractorId option', { hasText: nm }).first().innerText()) }); await W(300);
  ok('selecting another contractor swaps the read-only block', (await T('#cCtrInfo')).includes('Γιάννης Ανάδοχος') && (await T('#cCtrInfo')).includes('Οδός 5'));
  await p.fill('#c_repName', 'Μαρία Αντιπρόσωπος'); await p.fill('#c_repPhone', '99 111222'); await p.fill('#c_repEmail', 'rep@example.com');
  await p.click('[data-act=ctsave]'); await W(1500);
  d = await T('#overlay');
  ok('contract detail shows the contractor details and the representative', d.includes(nm) && d.includes('Οδός 5') && d.includes('Γιάννης Ανάδοχος') && d.includes('Μαρία Αντιπρόσωπος') && d.includes('99 111222') && d.includes('rep@example.com'));
  await p.click('#overlay [data-act=close]'); await W(300);
  ok('contracts list shows the contractor name', (await T('#list')).includes(nm));

  /* counters on the contractor page */
  await p.click('#tabCo'); await W(800);
  const row = await p.locator('#list .row', { hasText: nm }).first();
  const cells = await row.locator('.cell').allInnerTexts();
  ok('active contracts = 1 and tenders = 1 for the contractor with the contract', cells.slice(-2).join('|').replace(/\s/g, '') === '1|1', cells.join('|'));
  const row2 = await p.locator('#list .row', { hasText: nm2 }).first();
  ok('contractor without contracts shows 0 and 0', (await row2.locator('.cell').allInnerTexts()).slice(-2).join('|').replace(/\s/g, '') === '0|0');
  await row.click(); await W(500);
  ok('detail lists the contract and its tender number', (await T('#overlay')).includes(tit) && (await T('#overlay')).includes('ΑΝΑ-1/2027'));
  await p.click('[data-act=codel]'); await W(300);
  ok('contractor in use cannot be deleted', (await T('#delbox')).includes('δεν μπορεί να διαγραφεί') && await p.locator('#delYes').count() === 0);
  await p.click('#overlay [data-act=close]'); await W(300);
  await p.locator('#list .row', { hasText: nm2 }).first().click(); await W(500);
  await p.click('[data-act=codel]'); await W(300); await p.click('#delYes'); await W(1200);
  ok('unused contractor goes to the trash', !(await T('#list')).includes(nm2));
  await p.click('[data-f=trash]'); await W(800);
  ok('trash lists it and it can be restored', (await T('#list')).includes(nm2));
  await p.click('[data-act=trrestore]'); await W(1200);
  await p.click('[data-f=all]'); await W(500);
  ok('restored contractor is back', (await T('#list')).includes(nm2));

  /* legacy contract with a free-text contractor */
  const legacyName = 'Legacy Co ' + Date.now();
  await api('PUT', 'records/contracts/lgc1', { data: { title: 'Legacy σύμβαση', months: 12, dateFrom: '2026-01-01', dateTo: '2026-12-31', years: [{ from: '2026-01-01', to: '2026-12-31', cost: 1, remind: 30 }], contractor: legacyName, contractorVat: 'LG' + Date.now().toString().slice(-8), contractorContact: 'Παλιός' } });
  await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('#rl-app'); await W(3000);
  await p.click('#tabCo'); await W(800);
  ok('contractors page offers to create contractors from free-text contracts', (await T('#alerts')).includes('ελεύθερο κείμενο'));
  await p.click('[data-act=comigrate]'); await W(2500);
  ok('migration registered the contractor and linked the contract', (await T('#list')).includes(legacyName) && !(await T('#alerts')).includes('ελεύθερο κείμενο'));
  const lg = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).items.find(i => i.id === 'lgc1').data);
  ok('legacy contract now points to a contractor', !!lg.contractorId && lg.contractor === legacyName && lg.contractorVat === '');

  /* clean up through the API */
  const ids = await p.evaluate(async () => { const o = {}; for (const c of ['contracts', 'contractors']) { const r = await (await fetch(RL_CFG.rest + 'records/' + c, { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json(); o[c] = r.items.filter(i => /^Probe |^Legacy/.test(i.data.title || i.data.name || '') || /^Probe |^Legacy/.test(i.data.contractor || '')).map(i => i.id); } return o; });
  for (const c of ['contracts', 'contractors']) for (const id of ids[c]) { await api('DELETE', `records/${c}/${id}`); await api('DELETE', `records/${c}/${id}&purge=1`); }
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
