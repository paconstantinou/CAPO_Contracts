/* Real-browser check (v3.8.0): full-screen forms that do not close by accident, contractor details, e-mail hint,
   attachments (3+ files, HTML, size limit), duplicate tender numbers.
   WordPress:  RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/forms-test.js
   HTML build: node tests/browser/forms-test.js path/to/index.html */
const { chromium } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path');
const file = process.argv[2] ? path.resolve(process.argv[2]) : '';
const base = process.env.RL_URL || 'http://127.0.0.1:8088', page = process.env.RL_PAGE || '/rl/', user = process.env.RL_USER || 'admin', pass = process.env.RL_PASS;
if (!file && !pass) { console.error('RL_PASS required (or pass an HTML file)'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const p = await ctx.newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(file ? 'file:' : base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); let dlg = 'accept'; p.on('dialog', d => dlg === 'accept' ? d.accept() : d.dismiss());
  if (file) { await p.goto('file://' + file); await p.waitForSelector('#tabTn', { timeout: 20000 }); await p.waitForTimeout(1500); }
  else {
    await p.goto(base + '/wp-login.php', { waitUntil: 'commit' }); await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
    await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(3000);
  }
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  const T = s => p.innerText(s), W = ms => p.waitForTimeout(ms), tag = Date.now();
  const open = async sel => p.locator('#overlay').evaluate(o => !o.hidden);
  const panelW = () => p.evaluate(() => document.querySelector('#overlay .panel').getBoundingClientRect().width);

  /* 1. forms: full screen, not closed by clicking outside / Backspace / Escape without asking */
  for (const [tab, label] of [['#tabSw', 'Online Renewals'], ['#tabCt', 'Συμβάσεις'], ['#tabTn', 'Διαγωνισμοί']]) {
    await p.click(tab); await W(500); await p.click('#btnAdd'); await W(300);
    const full = await p.locator('[data-act=wfull],[data-act=ctfull]').count(); if (full) { await p.click('[data-act=wfull],[data-act=ctfull]'); await W(300); }
    ok(label + ': form opens full screen', (await panelW()) >= 1390);
    const first = p.locator('#overlay input:not([type=hidden])').first(); await first.fill('Δοκιμή ' + tag);
    await p.evaluate(() => document.getElementById('overlay').click()); await W(200);
    ok(label + ': a click outside the form does not close it', await open());
    await p.keyboard.press('Backspace'); await p.locator('#overlay h2').click(); await p.keyboard.press('Backspace'); await W(200);
    ok(label + ': Backspace does not close it', await open());
    dlg = 'dismiss'; await p.keyboard.press('Escape'); await W(300); dlg = 'accept';
    ok(label + ': Escape asks first and keeps the form when you decline', await open() && (await first.inputValue()).startsWith('Δοκιμή'));
    await p.keyboard.press('Escape'); await W(300);
    ok(label + ': Escape closes after you confirm', !(await open()));
  }

  /* 2. contractor details on a contract + e-mail hint */
  await p.click('#tabCt'); await W(500); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  const ft = await T('#overlay');
  ok('contract form has the contractor detail fields', ['ΑΦΜ ΑΝΑΔΟΧΟΥ', 'ΔΙΕΥΘΥΝΣΗ ΑΝΑΔΟΧΟΥ', 'ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ ΑΝΑΔΟΧΟΥ', 'ΤΗΛΕΦΩΝΟ ΑΝΑΔΟΧΟΥ', 'EMAIL ΑΝΑΔΟΧΟΥ'].every(x => ft.includes(x)));
  ok('notification e-mail field explains comma (,) or semicolon (;)', ft.includes('κόμμα (,) ή ερωτηματικό (;)'));
  const cname = 'Σύμβαση-Probe ' + tag;
  await p.fill('#c_title', cname); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', '2027-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
  await p.fill('#c_contractor', 'Ανάδοχος ΑΕ'); await p.fill('#c_contractorPhone', 'abc'); await p.click('[data-act=ctsave]'); await W(500);
  ok('an invalid phone number is refused', (await T('#werr')).includes('μη έγκυρο τηλέφωνο'));
  await p.fill('#c_contractorPhone', '+357 22 123456; 99 123456'); await p.fill('#c_contractorEmail', 'bad'); await p.click('[data-act=ctsave]'); await W(500);
  ok('an invalid contractor e-mail is refused', (await T('#werr')).includes('EMAIL ΑΝΑΔΟΧΟΥ'));
  await p.fill('#c_contractorEmail', 'a@x.com; b@y.org'); await p.fill('#c_contractorVat', 'CY12345678X'); await p.fill('#c_contractorAddress', 'Οδός 1, Λευκωσία'); await p.fill('#c_contractorContact', 'Μαρία Παπά');
  await p.fill('#c_cost', '1000'); await p.click('[data-act=ctsave]'); await W(1500);
  let d = await T('#overlay');
  ok('contract saved and the detail shows the contractor details', d.includes('Ανάδοχος ΑΕ') && d.includes('CY12345678X') && d.includes('Οδός 1, Λευκωσία') && d.includes('Μαρία Παπά') && d.includes('+357 22 123456; 99 123456') && d.includes('a@x.com; b@y.org'));
  /* 3. attachments: more than two, HTML, size limit */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rlatt-'));
  const mk = (n, c) => { const f = path.join(tmp, n); fs.writeFileSync(f, c); return f; };
  ok('limit is shown next to the attachments', (await T('#overlay')).includes('μέγιστο μέγεθος αρχείου') && (await T('#overlay')).includes('HTML'));
  for (const f of [mk('a.txt', 'one'), mk('b.csv', 'x,y\n1,2'), mk('c.html', '<html><script>window.__pwned=1</script><body>hi</body></html>'), mk('d.txt', 'four')]) { await p.setInputFiles('#fileAttach', f); await W(900); }
  d = await T('#overlay');
  ok('four attachments (including an HTML file) are attached', ['a.txt', 'b.csv', 'c.html', 'd.txt'].every(x => d.includes(x)));
  const dl = p.waitForEvent('download', { timeout: 8000 }).catch(() => null); const pagesBefore = ctx.pages().length;
  await p.click('a[data-blob]:has-text("c.html")'); const dd = await dl; await W(500);
  ok('an HTML attachment is downloaded, not opened or run', !!dd && dd.suggestedFilename() === 'c.html' && ctx.pages().length === pagesBefore && !(await p.evaluate(() => window.__pwned)));
  const big = path.join(tmp, 'big.txt'); fs.writeFileSync(big, Buffer.alloc(26 * 1048576, 65));
  await p.setInputFiles('#fileAttach', big); await W(1200);
  ok('a file over the limit gets a clear message and is not added', /όριο/.test(await T('#toast')) && !(await T('#overlay')).includes('big.txt'));
  await p.click('[data-act=close]'); await W(300);

  /* 4. duplicate tender numbers */
  await p.click('#tabTn'); await W(500);
  const mkTn = async (title, num) => { await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300); await p.fill('#c_title', title); await p.fill('#c_tender', num); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', '2028-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300); await p.fill('#c_cost', '100'); await p.click('[data-act=ctsave]'); await W(1500); };
  const num = 'DUP-' + (tag % 100000) + '/2028', t1 = 'Διαγ-Α ' + tag, t2 = 'Διαγ-Β ' + tag;
  await mkTn(t1, num); await p.click('[data-act=close]'); await W(300);
  await mkTn(t2, ' ' + num.toLowerCase().replace('/', ' / ') + ' ');
  ok('a second tender with the same number (other case / spaces) is refused', (await T('#werr')).includes('υπάρχει ήδη') && (await T('#werr')).includes(t1));
  await p.fill('#c_tender', num + '-Β'); await p.click('[data-act=ctsave]'); await W(1500);
  ok('with a different number it saves', (await T('#overlay')).includes(t2));
  await p.click('[data-act=close]'); await W(300);
  /* the first tender goes to the trash: its number is free again, but restoring it later must not create a duplicate */
  await p.locator('#list').getByText(t1).first().click(); await W(500);
  await p.click('[data-act=tndel]'); await W(300); await p.click('#delYes'); await W(1200);
  await mkTn('Διαγ-Γ ' + tag, num);
  ok('a number held only by a trashed tender can be used again', (await T('#overlay')).includes('Διαγ-Γ ' + tag));
  await p.click('[data-act=close]'); await W(300);
  await p.click('[data-f=trash]'); await W(600);
  await p.locator('#list tr', { hasText: t1 }).locator('[data-act=trrestore]').click(); await W(1200);
  ok('restoring the trashed tender is refused while its number is in use', (await T('#toast')).includes('χρησιμοποιείται ήδη'));
  if (!file) {
    const code = await p.evaluate(async ([title, number]) => { const id = 'dup' + Date.now(); const r = await fetch(RL_CFG.rest + 'records/tenders/' + id, { method: 'PUT', credentials: 'same-origin', headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { title: title, tender: number, months: 12, dateFrom: '2028-01-01', dateTo: '2028-12-31', cost: 1, years: [{ from: '2028-01-01', to: '2028-12-31', cost: 1 }] } }) }); return r.status; }, ['Direct', num.toLowerCase()]);
    ok('the server refuses a duplicate tender number too (409)', code === 409);
  }
  if (!file) { /* remove everything this test created */
    await p.evaluate(async tg => { const H = { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, q = (i) => String(i.data.title || '').includes(String(tg)) || i.data.title === 'Direct';
      for (const c of ['tenders', 'contracts']) { const r = await (await fetch(RL_CFG.rest + 'records/' + c, { headers: H })).json(); for (const i of r.items.filter(q)) { await fetch(RL_CFG.rest + 'records/' + c + '/' + i.id, { method: 'DELETE', headers: H }); }
        const t = await (await fetch(RL_CFG.rest + 'records/' + c + (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'trash=1', { headers: H })).json(); for (const i of (t.items || []).filter(q)) await fetch(RL_CFG.rest + 'records/' + c + '/' + i.id + (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1', { method: 'DELETE', headers: H }); } }, tag);
  }
  ok('no JavaScript errors', errs.length === 0 || (console.log(errs), false));
  await b.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})();
