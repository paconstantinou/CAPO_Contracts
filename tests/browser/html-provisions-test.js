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
  await mkTender('Διαγ Α', 'RC-A/2027', '10000'); await p.click('[data-act=close]').catch(() => {});
  await mkTender('Διαγ Β', 'RC-B/2027', '10000'); await p.click('[data-act=close]').catch(() => {});
  await mkTender('Διαγ Γ', 'RC-C/2027', '10000'); await p.click('[data-act=close]').catch(() => {});
  await promote('Διαγ Α', '16000');  /* +6000: reported */
  await promote('Διαγ Β', '14999');  /* +4999: not reported */
  await p.click('#tabRc'); await W(500);
  const rowsOf = async k => p.evaluate(k => [...document.querySelectorAll('#list table.rct tbody tr.k-' + k)].map(r => [...r.children].map(c => c.innerText)), k);
  let r = await T('#list');
  ok('tab opens, no add button', !(await vis('#btnAdd')));
  ok('ONE table in the template layout: 13 columns, numbered row 1..6, years from the current year', await p.evaluate(() => { const t = document.querySelectorAll('#list table.rct'); const h = [...t[0].querySelectorAll('thead tr')[1].children].map(c => c.innerText); const y = new Date().getFullYear(); return t.length === 1 && h.length === 13 && h[0] === 'Κεφάλαιο' && h[1] === 'Άρθρο' && h[2].includes('' + y) && h[3].includes('' + (y + 1)) && h[9].includes('' + (y + 3)) && [...t[0].querySelectorAll('thead tr')[0].children].map(c => c.innerText).join('') === '123456' }));
  let tn = await rowsOf('tn'), dv = await rowsOf('dv');
  ok('A lists ONLY the active tender (the two promoted ones have no row of their own)', tn.length === 1 && tn[0][12].includes('Διαγ Γ') && !r.includes('Διαγ Β'), JSON.stringify(tn).slice(0, 300));
  ok('A row: chapter blank, amount of Y+1 with VAT as base, change 0, revised = base', tn[0][0] === '' && tn[0][3] === '11.900' && tn[0][4] === '0' && tn[0][5] === '11.900', JSON.stringify(tn[0]));
  ok('B has only the +6000 contract: base 11.900, change +7.140, revised 19.040', dv.length === 1 && dv[0][12].includes('Διαγ Α') && dv[0][3] === '11.900' && dv[0][4] === '7.140' && dv[0][5] === '19.040', JSON.stringify(dv));
  ok('no row for the +4999 contract', !r.includes('Διαγ Β'));
  ok('no other groups yet', (await rowsOf('am')).length === 0 && (await rowsOf('inc')).length === 0 && (await rowsOf('pv')).length === 0);
  /* amend contract Διαγ Β: 14999 -> 16000 */
  await p.click('#tabCt'); await W(500); await p.click('text=Διαγ Β'); await W(300);
  ok('contract detail shows the reconciliation flag', (await T('#overlay')).includes('Δεν συμπεριλαμβάνεται'));
  await p.click('[data-act=ctamend]'); await W(400);
  ok('amend form has the include checkbox', await vis('#c_rcInclude'));
  await p.fill('#cy_cost_0', '16000'); await p.dispatchEvent('#cy_cost_0', 'change'); await p.check('#c_rcInclude'); await p.fill('#am_desc', 'ΤΕΑΑ'); await W(200);
  ok('the flag change is listed with its previous value', (await T('#amSummary')).includes('Συμπερίληψη στο Πλαίσιο Συμφιλίωσης') && (await T('#amSummary')).includes('Όχι'));
  await p.click('[data-act=ctsave]'); await W(900); await p.click('[data-act=close]'); await W(300);
  await p.click('#tabRc'); await W(500); dv = await rowsOf('dv');
  ok('after the amendment Β deviates (10000 -> 16000)', dv.length === 2 && dv.some(x => x[12].includes('Διαγ Β')));
  let am = await rowsOf('am'), inc = await rowsOf('inc');
  ok('Γ lists it: base 17.849 (14.999 + VAT), change +1.191, revised 19.040, with the description', am.length === 1 && am[0][3] === '17.849' && am[0][4] === '1.191' && am[0][5] === '19.040' && am[0][12].includes('ΤΕΑΑ'), JSON.stringify(am));
  ok('Δ lists the flagged contract', inc.length === 1 && inc[0][12].includes('Διαγ Β'));
  /* provision flag */
  await p.click('#tabPv'); await W(300); await p.click('#btnAdd'); await W(300); await p.fill('#pv_title', 'Πρόνοια RC'); await p.selectOption('#pv_article', { index: 1 }); await p.fill('#pv_amt_0', '700');
  ok('provision form has the include checkbox', await vis('#pv_rc')); await p.check('#pv_rc'); await p.click('[data-act=pvsave]'); await W(700);
  ok('provision detail shows the flag', (await T('#overlay')).includes('Συμπεριλαμβάνεται')); await p.click('[data-act=close]'); await W(300);
  await p.click('#tabRc'); await W(500); let pv = await rowsOf('pv');
  ok('Ε lists the flagged provision: 700 net = 833 with VAT, explanation has the description', pv.length === 1 && pv[0][3] === '833' && pv[0][12].includes('Περιγραφή: Πρόνοια RC'), JSON.stringify(pv));
  await p.fill('#q', 'ΤΕΑΑ'); await W(300);
  ok('search filters rows (amendment text)', (await rowsOf('am')).length === 1 && (await rowsOf('pv')).length === 0 && (await rowsOf('tn')).length === 0);
  await p.fill('#q', ''); await W(200);
  ok('stats show the counts', (await T('#stats')).toUpperCase().includes('ΔΙΑΓΩΝΙΣΜΟΙ'));
  /* Excel export keeps the template layout */
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#btnExport')]); const xf = require('path').join(require('os').tmpdir(), 'rc-' + Date.now() + '.xlsx'); await dl.saveAs(xf);
  const py = require('child_process').spawnSync('python3', ['-c', `import openpyxl,sys\nws=openpyxl.load_workbook(sys.argv[1]).active\nprint(ws.title,'|',ws['A2'].value,'|',repr(ws['C2'].value),'|',ws['D1'].value,'|',ws['B3'].value,'|',ws['D3'].number_format,'|',ws['C2'].font.name,ws['C2'].font.sz,'|',ws.max_row)`, xf]).stdout.toString();
  ok('Excel: template sheet, header, numbering, styles and rows', py.includes('Πλαίσιο Συμφιλίωσης | Κεφάλαιο | ') && py.includes('| 1 |') && py.includes('#,##0') && py.includes('Arial 9.0'), py);
  if (process.env.RC_KEEP) { require('fs').copyFileSync(xf, process.env.RC_KEEP + '.xlsx'); await p.screenshot({ path: process.env.RC_KEEP + '.png' }); }
  ok('Excel has one data row per table row', Number(py.trim().split('|').pop()) === 2 + (await p.evaluate(() => document.querySelectorAll('#list table.rct tbody tr').length)), py);
  ok('export button present on this tab', await vis('#btnExport'));
  ok('no script errors', errs.length === 0, errs.join(' | '));
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
