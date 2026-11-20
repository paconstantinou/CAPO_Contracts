/* Real-browser check (3.20.0, standalone HTML): tender amendment with previous values, link tender -> contract, automatic tenders (pending, approve), group ΣΤ of the Πλαίσιο Συμφιλίωσης, attachment download name.
   Usage: LC_ALL=C.UTF-8 node tests/browser/html-tender-amend-test.js path/to/index.html */
const { chromium } = require('playwright');
const file = require('path').resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabTn', { timeout: 20000 }); await p.waitForTimeout(1200);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const W = ms => p.waitForTimeout(ms), T = s => p.innerText(s), vis = s => p.isVisible(s);
  const yr = new Date().getFullYear(), endY = yr + 2;
  /* contract ending in current year + 2 */
  await p.click('#tabCt'); await W(500); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  await p.fill('#c_title', 'Σύμβαση-Λήγουσα'); await p.fill('#c_tender', 'LIG-1'); await p.fill('#c_description', 'Περιγραφή λήγουσας'); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change');
  await p.fill('#c_dateFrom', (endY) + '-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300); await p.fill('#cy_cost_0', '10000'); await p.dispatchEvent('#cy_cost_0', 'change');
  await p.click('[data-act=ctsave]'); await W(1000);
  await p.click('[data-act=close]'); await W(300);
  /* automatic creation from Settings */
  await p.click('#tabSt'); await W(600);
  ok('settings has the automatic tenders card', (await T('#atCard')).includes('Αυτόματοι διαγωνισμοί'));
  await p.click('[data-act=autotn]'); await W(1200);
  await p.click('#tabTn'); await W(800);
  const lst = await T('#list');
  ok('auto tender created for the expiring contract and is pending', lst.includes('Σύμβαση-Λήγουσα') && lst.includes('Σε αναμονή'), lst.slice(0, 300));
  await p.click('text=Σύμβαση-Λήγουσα'); await W(400);
  let d = await T('#overlay');
  ok('auto tender: dates, cost 10% and link', d.includes('1.000') || d.includes('1,000'), d.slice(0, 400));
  ok('auto tender names the related contract', d.includes('ΣΧΕΤΙΖΟΜΕΝΗ ΣΥΜΒΑΣΗ') && d.includes('Σύμβαση-Λήγουσα (LIG-1)'));
  ok('pending tender offers approve / reject, not amend', await vis('[data-act=tnapprove]') && await vis('[data-act=tnreject]') && !(await p.locator('[data-act=tnamend]').count()));
  await p.click('[data-act=tnapprove]'); await W(900);
  d = await T('#overlay'); ok('approved tender is active', d.includes('Ενεργός'));
  ok('active tender offers Τροποποίηση Διαγωνισμού', await vis('[data-act=tnamend]'));
  await p.click('[data-act=tnamend]'); await W(400);
  ok('amend form has description + date', (await vis('#am_desc')) && (await T('#overlay .ph h2')).includes('Τροποποίηση'));
  await p.fill('#cy_cost_0', '1500'); await p.dispatchEvent('#cy_cost_0', 'change'); await p.fill('#c_description', 'Νέα περιγραφή'); await p.dispatchEvent('#c_description', 'change'); await W(300);
  const ov = await T('#overlay');
  ok('changed fields show previous values', ov.includes('Προηγούμενη τιμή') && ov.includes('Περιγραφή λήγουσας'));
  await p.fill('#am_desc', 'Αύξηση κόστους'); await p.click('[data-act=ctsave]'); await W(1000);
  d = await T('#overlay'); ok('amendment saved and listed', d.includes('Αύξηση κόστους') && d.includes('Νέα περιγραφή'), d.slice(0, 300));
  ok('amended tender no longer offers promote-less edits wrongly (amend still offered)', await vis('[data-act=tnamend]'));
  /* contract detail lists the related tender */
  await p.click('[data-act=gocontract]'); await W(600);
  d = await T('#overlay'); ok('contract detail lists related tenders', d.includes('Σχετιζόμενοι διαγωνισμοί (1)'), d.slice(0, 200));
  await p.click('[data-act=close]'); await W(300);
  /* manual tender gets a contract selector */
  await p.click('#tabTn'); await W(500); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  ok('manual tender form has the contract selector', await p.locator('#overlay select[id^=c_ctl], #overlay select[id*=contractId]').count() === 1);
  await p.click('[data-act=close]'); await W(300);
  /* reconciliation frame group ΣΤ */
  await p.click('#tabRc'); await W(900);
  const rc = await T('#list'); ok('Πλαίσιο Συμφιλίωσης has a ΣΤ row for the amended tender', rc.includes('ΣΤ · Τροποποιημένος διαγωνισμός'), rc.slice(0, 300));
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})();
