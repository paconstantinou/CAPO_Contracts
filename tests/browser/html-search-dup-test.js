/* Real-browser check (standalone HTML / Windows app): (1) a second contract with the same tender number is refused with a message,
   (2) every page has a working search field (Budget, Settings and the Guide included).
   Usage: node tests/browser/html-search-dup-test.js [path/to/index.html]
          WordPress: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/html-search-dup-test.js */
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

  console.log('duplicate tender number in contracts');
  await addContract('Πρώτη σύμβαση ZQX', 'DUP-1/2027');
  ok('first contract is saved', parseInt(await count(), 10) >= 1, await count());
  const nBase = parseInt(await count(), 10);
  await p.click('#overlay [data-act=close]').catch(() => {}); await W(300);
  await addContract('Δεύτερη σύμβαση', ' dup-1 / 2027 ');
  const err = await T('#werr').catch(() => '');
  ok('second contract with the same number shows the message', err.includes('Υπάρχει ήδη Σύμβαση καταχωρημένη με τον ίδιο αριθμό') && err.includes('Πρώτη σύμβαση ZQX'), err);
  ok('the form stays open and nothing was added', (await vis('#c_title')) && parseInt(await count(), 10) === nBase);
  await p.fill('#c_tender', 'DUP-2/2027'); await p.click('[data-act=ctsave]'); await W(900);
  ok('with a different number it is saved', parseInt(await count(), 10) === nBase + 1, await count());
  await p.click('#overlay [data-act=close]').catch(() => {}); await W(300);
  await p.click('#tabCt'); await W(400);

  console.log('search field on every page');
  const pages = [['#tabSw', 'Online Renewals'], ['#tabCt', 'Συμβάσεις'], ['#tabTn', 'Διαγωνισμοί'], ['#tabCo', 'Ανάδοχοι'], ['#tabAr', 'Άρθρα'], ['#tabBd', 'Προϋπολογισμός'], ['#tabSt', 'Ρυθμίσεις']];
  for (const [tab, name] of pages) {
    if (!(await p.locator(tab).count()) || !(await vis(tab))) { console.log('  (tab ' + tab + ' not shown, skipped)'); continue; }
    await p.click(tab); await W(500);
    ok(name + ': search field is visible and enabled', (await vis('#q')) && (await p.isEnabled('#q')));
  }
  console.log('Budget');
  await p.click('#tabBd'); await W(500);
  const before = await T('#list');
  ok('budget shows the contract before filtering', before.includes('Πρώτη σύμβαση ZQX') && before.includes('Δεύτερη') === false || before.includes('ZQX'));
  await p.fill('#q', 'ZQX'); await W(400);
  const f1 = await T('#list'); ok('filter by contract text keeps its row', f1.includes('ZQX'), f1.slice(0, 200));
  ok('and shows the filter note', f1.includes('Φίλτρο'));
  await p.fill('#q', 'zzzqq-none'); await W(400);
  ok('no match shows an empty message', (await T('#list')).includes('Καμία γραμμή δεν ταιριάζει'));
  await p.fill('#q', ''); await W(400);
  ok('clearing the filter brings the rows back', (await T('#list')).includes('ZQX'));
  console.log('Settings');
  await p.click('#tabSt'); await W(600);
  const cards = () => p.evaluate(() => [...document.querySelectorAll('#stRoot .stcard')].filter(c => c.style.display !== 'none').map(c => c.querySelector('h3').textContent));
  const all = await cards(); ok('all settings cards are shown at first', all.length >= 4, JSON.stringify(all));
  await p.fill('#q', 'ΦΠΑ'); await W(400);
  const c1 = await cards(); ok('search "ΦΠΑ" keeps the general settings and hides the others', c1.includes('Γενικές ρυθμίσεις') && c1.length < all.length, JSON.stringify(c1));
  await p.fill('#q', 'zzzqq-none'); await W(400);
  ok('nothing found: message, no cards', (await cards()).length === 0 && (await T('#stRoot')).includes('Δεν βρέθηκε τίποτα στις ρυθμίσεις'));
  await p.fill('#q', ''); await W(400);
  ok('clearing brings every card back and removes the message', (await cards()).length === all.length && !(await T('#stRoot')).includes('Δεν βρέθηκε τίποτα'));
  console.log('Guide');
  await p.click('#btnGuide'); await W(500);
  ok('guide has a search field', await vis('#gq'));
  const secs = () => p.evaluate(() => [...document.querySelectorAll('.guide h3')].filter(h => h.style.display !== 'none').length);
  const nAll = await secs();
  await p.fill('#gq', 'Συνημμένα'); await W(300);
  const n1 = await secs(); ok('search narrows the guide to the matching sections', n1 >= 1 && n1 < nAll, n1 + ' of ' + nAll);
  await p.fill('#gq', 'zzzqq-none'); await W(300);
  ok('nothing found: message', (await T('.guide')).includes('Δεν βρέθηκε τίποτα στον οδηγό'));
  await p.fill('#gq', ''); await W(300);
  ok('clearing shows all sections and the topic buttons again', (await secs()) === nAll && (await vis('.gtoc')));
  if (WP) await p.evaluate(async () => { const r = await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json(); for (const i of r.items || []) { if (/^DUP-\d\/2027$/.test(i.data.tender || '')) { await fetch(RL_CFG.rest + 'records/contracts/' + i.id, { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); await fetch(RL_CFG.rest + 'records/contracts/' + i.id + (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1', { method: 'DELETE', headers: { 'X-WP-Nonce': RL_CFG.nonce } }); } } });
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
