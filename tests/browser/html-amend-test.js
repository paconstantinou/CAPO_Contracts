/* Real-browser check (standalone HTML / Windows app): Contract amendment (Τροποποίηση Σύμβασης): previous values, summary, history.
   Usage: node tests/browser/html-amend-test.js [path/to/index.html]
          WordPress: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/html-amend-test.js */
const { chromium } = require('playwright'); const path = require('path');
const file = path.resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const WP = !!process.env.RL_PASS, base = process.env.RL_URL || 'http://127.0.0.1:8088';
  if (WP) {
    await p.goto(base + '/wp-login.php', { waitUntil: 'commit' }); await p.fill('#user_login', process.env.RL_USER || 'admin'); await p.fill('#user_pass', process.env.RL_PASS); await p.click('#wp-submit'); await p.waitForTimeout(3000);
    await p.goto(base + (process.env.RL_PAGE || '/rl/'), { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForSelector('#tabCo'); await p.waitForTimeout(2500);
    /* start from no contract with the probe numbers */
    await p.evaluate(async () => { const r = await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json(); for (const i of r.items || []) { if (/^DUP-\d\/2027$/.test(i.data.tender || '')) { await fetch(RL_CFG.rest + 'records/contracts/' + i.id, { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); await fetch(RL_CFG.rest + 'records/contracts/' + i.id + (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1', { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); } } });
    await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('#tabCo'); await p.waitForTimeout(2500);
  } else { await p.goto('file://' + file); await p.waitForSelector('#tabCo', { timeout: 20000 }); await p.waitForTimeout(1200); }
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const W = ms => p.waitForTimeout(ms), T = s => p.innerText(s), vis = s => p.isVisible(s);
  const addContract = async (title, tender) => { await p.click('#tabCt'); await W(500); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
    await p.fill('#c_title', title); await p.fill('#c_tender', tender); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change');
    await p.fill('#c_dateFrom', '2027-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300); await p.fill('#cy_cost_0', '2500'); await p.click('[data-act=ctsave]'); await W(900); };
  const count = async () => p.evaluate(() => { const c = document.querySelector('#cntCt'); return c ? c.textContent : ''; });

  console.log('amendment');
  const sw = async () => {};
  await addContract('Σύμβαση ΤΡ', 'AMD-1/2027');
  ok('contract exists with the year cost 2500', (await T('#overlay')).includes('2,500.00'), (await T('#overlay')).slice(0, 120));
  ok('detail has the "Τροποποίηση σύμβασης" button', await vis('[data-act=ctamend]'));
  await p.click('[data-act=ctamend]'); await W(400);
  ok('amendment form opens with a description field and today as the date', (await vis('#am_desc')) && (await p.inputValue('#am_date')).length === 10);
  ok('title says Τροποποίηση σύμβασης', (await T('#overlay .ph h2')).includes('Τροποποίηση σύμβασης'));
  ok('no changes yet: summary says so', (await T('#amSummary')).includes('Δεν έχει γίνει καμία αλλαγή'));
  await p.fill('#am_desc', 'ΤΕΑΑ'); await p.click('[data-act=ctsave]'); await W(500);
  ok('saving without any change is refused', (await T('#werr')).includes('Δεν έγινε καμία αλλαγή'), await T('#werr'));
  await p.fill('#am_desc', ''); await p.fill('#c_coordinator', 'Νέος Συντονιστής'); await p.dispatchEvent('#c_coordinator', 'change'); await W(300);
  ok('changed field shows the previous value (new entry)', (await T('#overlay')).includes('Προηγούμενη τιμή: — (νέα καταχώρηση)'));
  await p.click('[data-act=ctsave]'); await W(500);
  ok('saving without a description is refused', (await T('#werr')).includes('περιγραφή της τροποποίησης είναι υποχρεωτική'), await T('#werr'));
  await p.fill('#cy_cost_0', '3000'); await p.dispatchEvent('#cy_cost_0', 'change'); await W(400);
  const sum = await T('#amSummary');
  ok('summary lists the coordinator and the year cost with old and new values', sum.includes('ΣΥΝΤΟΝΙΣΤΗΣ') && sum.includes('Νέος Συντονιστής') && sum.includes('2,500.00') && sum.includes('3,000.00'), sum);
  ok('total cost field shows its previous value too', (await T('#overlay')).includes('Προηγούμενη τιμή: €2,500.00'));
  await p.fill('#am_desc', 'ΤΕΑΑ'); await p.click('[data-act=ctsave]'); await W(900);
  const det = await T('#overlay');
  ok('after saving, the detail shows the amendment history', det.includes('Τροποποιήσεις σύμβασης (1)') && det.includes('ΤΕΑΑ'), det.slice(-600));
  ok('history shows cost before and after', det.includes('€2,500.00 → €3,000.00') && det.includes('+€500.00'), det.slice(-600));
  ok('history lists the changed fields from old to new', det.includes('ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ') && det.includes('Νέος Συντονιστής'));
  ok('the contract has the new cost', det.includes('3,000.00'));
  await p.click('[data-act=ctamend]'); await W(400);
  await p.fill('#c_coordinator', 'Τρίτος Συντονιστής'); await p.dispatchEvent('#c_coordinator', 'change'); await W(300);
  ok('second amendment compares with the state after the first', (await T('#overlay')).includes('Προηγούμενη τιμή: Νέος Συντονιστής'));
  await p.fill('#am_desc', 'ΚΕΑΑ'); await p.click('[data-act=ctsave]'); await W(900);
  const det2 = await T('#overlay');
  ok('two amendments are listed, newest first', det2.includes('Τροποποιήσεις σύμβασης (2)') && det2.indexOf('ΚΕΑΑ') < det2.indexOf('ΤΕΑΑ'), det2.slice(-700));
  await p.click('#overlay [data-act=edit]'); await W(400);
  ok('normal edit form has no amendment block', !(await vis('#am_desc')));
  await p.click('#overlay [data-act=close]'); await W(300);
  await p.click('#tabCt'); await W(300);
  if (WP) await p.evaluate(async () => { const r = await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json(); for (const i of r.items || []) { if (/^AMD-1\/2027$/.test(i.data.tender || '')) { await fetch(RL_CFG.rest + 'records/contracts/' + i.id, { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); await fetch(RL_CFG.rest + 'records/contracts/' + i.id + (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1', { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); } } });
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
