/* Real-browser check (standalone HTML / Windows app): Γενικές Πρόνοιες (add, 3 yearly amounts, article, detail, edit, trash, Budget integration)
   and Πλαίσιο Συμφιλίωσης (tenders; contracts deviating >20% from their tender; amended contracts with a changed amount).
   Usage: node tests/browser/html-provisions-test.js [path/to/index.html] */
const { chromium } = require('playwright'); const path = require('path');
const file = path.resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabCo', { timeout: 20000 }); await p.waitForTimeout(1200);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const W = ms => p.waitForTimeout(ms), T = s => p.innerText(s), vis = s => p.isVisible(s);
  const Y = new Date().getFullYear();

  console.log('provisions');
  await p.click('#tabPv'); await W(400);
  ok('tab exists, empty state, add button', (await T('#btnAdd')).includes('Νέα Γενική Πρόνοια') && (await T('#list')).includes('Δεν υπάρχουν Γενικές Πρόνοιες'));
  await p.click('#btnAdd'); await W(300);
  const lab = await T('#overlay');
  ok('form shows the 3 following years', [Y + 1, Y + 2, Y + 3].every(y => lab.includes('ΠΟΣΟ ' + y)) && !lab.includes('ΠΟΣΟ ' + Y + ' '));
  ok('form has description, article, notes', await vis('#pv_title') && await vis('#pv_article') && await vis('#pv_notes'));
  await p.click('[data-act=pvsave]'); await W(300);
  ok('description is required', (await T('#werr')).includes('υποχρεωτικό'));
  await p.fill('#pv_title', 'Πρόνοια δοκιμής'); await p.click('[data-act=pvsave]'); await W(300);
  ok('article is required', (await T('#werr')).includes('σχετικό άρθρο'));
  await p.selectOption('#pv_article', { index: 1 }); await p.click('[data-act=pvsave]'); await W(300);
  ok('at least one amount is required', (await T('#werr')).includes('τουλάχιστον ένα έτος'));
  await p.fill('#pv_amt_0', '1000'); await p.fill('#pv_amt_2', '-5'); await p.click('[data-act=pvsave]'); await W(300);
  ok('negative amount refused', (await T('#werr')).includes('μη έγκυρο'));
  await p.fill('#pv_amt_2', '500'); await p.click('[data-act=pvsave]'); await W(600);
  const d = await T('#overlay');
  ok('saved: detail shows article, amounts (net and with VAT) and total', d.includes('Πρόνοια δοκιμής') && d.includes('ΠΟΣΟ ' + (Y + 1)) && d.includes('1.000,00') && d.includes('1.500,00') && d.includes('1.190,00'), d.slice(0, 400));
  ok('detail offers attachments, edit, delete', await vis('[data-act=attach]') && await vis('[data-act=edit]') && await vis('[data-act=pvdel]'));
  await p.click('[data-act=close]'); await W(300);
  const lst = await T('#list');
  ok('list shows the provision with year columns and totals', lst.includes('Πρόνοια δοκιμής') && lst.includes(String(Y + 1)) && lst.includes('1.500,00'), lst.slice(0, 300));
  ok('tab counter shows 1', (await T('#cntPv')) === '1');
  await p.click('#tabBd'); await W(600);
  const bl = await T('#list');
  ok('Budget includes the provision (with VAT, own legend)', bl.includes('Πρόνοια δοκιμής') && bl.includes('1.190,00') && bl.includes('595,00') && bl.includes('Γενικές Πρόνοιες'), bl.slice(0, 300));
  await p.fill('#q', 'δοκιμής'); await W(300);
  ok('Budget search finds the provision', (await T('#list')).includes('Πρόνοια δοκιμής'));
  await p.fill('#q', ''); await W(200);
  await p.click('#tabPv'); await W(300); await p.fill('#q', 'δεν-υπάρχει'); await W(300);
  ok('search on the provisions page', (await T('#list')).includes('Κανένα αποτέλεσμα'));
  await p.fill('#q', 'δοκιμής'); await W(300);
  ok('search matches', (await T('#list')).includes('Πρόνοια δοκιμής'));
  await p.click('[data-act=pvopen]'); await W(300); await p.click('[data-act=edit]'); await W(300);
  ok('edit keeps the registration year and its 3 years', (await T('#overlay')).includes('ΠΟΣΟ ' + (Y + 1)) && (await p.inputValue('#pv_amt_0')) === '1000');
  await p.fill('#pv_amt_1', '250'); await p.click('[data-act=pvsave]'); await W(600);
  ok('edited amount appears', (await T('#overlay')).includes('250,00'));
  await p.click('[data-act=pvdel]'); await W(200); await p.click('#delYes'); await W(500);
  ok('delete moves it to the trash and out of the budget', (await T('#list')).includes('Δεν υπάρχουν') || !(await T('#list')).includes('Πρόνοια δοκιμής'));
  await p.fill('#q', ''); await p.click('#tabBd'); await W(500);
  ok('budget no longer has it', !(await T('#list')).includes('Πρόνοια δοκιμής'));
  await p.click('#tabPv'); await W(300); await p.click('[data-f=trash]'); await W(400);
  ok('trash lists the provision', (await T('#list')).includes('Πρόνοια δοκιμής'));
  await p.click('[data-act=trrestore]'); await W(500); await p.click('[data-f=all]'); await W(300);
  ok('restored provision is back', (await T('#list')).includes('Πρόνοια δοκιμής'));

  console.log('reconciliation');
  const mkTender = async (name, num, cost) => { await p.click('#tabTn'); await W(400); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
    await p.fill('#c_title', name); await p.fill('#c_tender', num); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change');
    await p.fill('#c_dateFrom', '2027-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300); await p.fill('#cy_cost_0', cost); await p.dispatchEvent('#cy_cost_0', 'change');
    await p.click('[data-act=ctsave]'); await W(900); };
  const promote = async (name, newCost) => { await p.click('#tabTn'); await W(500); await p.click('text=' + name); await W(300); await p.click('[data-act=tnpromote]'); await W(500);
    if (newCost) { await p.fill('#cy_cost_0', newCost); await p.dispatchEvent('#cy_cost_0', 'change'); }
    await p.click('[data-act=ctsave]'); await W(1500); await p.click('[data-act=close]').catch(() => {}); await W(300); };
  await mkTender('Διαγ Α', 'RC-A/2027', '1000'); await p.click('[data-act=close]').catch(() => {});
  await mkTender('Διαγ Β', 'RC-B/2027', '1000'); await p.click('[data-act=close]').catch(() => {});
  await mkTender('Διαγ Γ', 'RC-C/2027', '1000'); await p.click('[data-act=close]').catch(() => {});
  await promote('Διαγ Α', '1500');   /* +50%: deviates */
  await promote('Διαγ Β', '1200');   /* exactly +20%: does not */
  await p.click('#tabRc'); await W(500);
  let r = await T('#list');
  ok('tab opens, no add button', !(await vis('#btnAdd')));
  ok('A lists all three tenders with their status', ['Διαγ Α', 'Διαγ Β', 'Διαγ Γ'].every(x => r.includes(x)) && r.includes('Προωθήθηκε σε σύμβαση') && r.includes('Ενεργός'), r.slice(0, 400));
  const secB = await p.evaluate(() => [...document.querySelectorAll('#list section.bds')].map(s => s.innerText));
  ok('B has only the +50% contract', secB[1].includes('Διαγ Α') && !secB[1].includes('Διαγ Β') && secB[1].includes('+50'), secB[1].slice(0, 400));
  ok('C is empty before any amendment', secB[2].includes('Δεν υπάρχουν γραμμές'));
  /* amend contract Διαγ Β: 1200 -> 1500 */
  await p.click('#tabCt'); await W(500); await p.click('text=Διαγ Β'); await W(300); await p.click('[data-act=ctamend]'); await W(400);
  await p.fill('#cy_cost_0', '1500'); await p.dispatchEvent('#cy_cost_0', 'change'); await p.fill('#am_desc', 'ΤΕΑΑ'); await p.click('[data-act=ctsave]'); await W(900); await p.click('[data-act=close]'); await W(300);
  await p.click('#tabRc'); await W(500);
  const s2 = await p.evaluate(() => [...document.querySelectorAll('#list section.bds')].map(s => s.innerText));
  ok('after the amendment Β is now deviating (1000 -> 1500 = +50%)', s2[1].includes('Διαγ Β') && s2[1].includes('Διαγ Α'));
  ok('C lists the amended contract with original 1.200, current 1.500, +25% and the description', s2[2].includes('Διαγ Β') && s2[2].includes('1.200,00') && s2[2].includes('1.500,00') && s2[2].includes('ΤΕΑΑ') && s2[2].includes('+25'), s2[2].slice(0, 400));
  await p.fill('#q', 'ΤΕΑΑ'); await W(300);
  const s3 = await p.evaluate(() => [...document.querySelectorAll('#list section.bds')].map(s => s.innerText));
  ok('search filters rows (amendment text)', s3[2].includes('Διαγ Β') && !s3[0].includes('Διαγ Γ'));
  await p.fill('#q', ''); await W(200);
  ok('stats show the counts', (await T('#stats')).includes('3') );
  ok('export button present on this tab', await vis('#btnExport'));
  ok('no script errors', errs.length === 0, errs.join(' | '));
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
