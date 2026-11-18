/* Real-browser check in WordPress: Γενικές Πρόνοιες tab and Πλαίσιο Συμφιλίωσης tab, permissions by role.
   RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-provisions-test.js */
const { chromium } = require('playwright');
(async () => {
  const base = process.env.RL_URL || 'http://127.0.0.1:8088';
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const login = async (user, pass) => {
    const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(base + '/wp-login.php', { waitUntil: 'commit' }); await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
    await p.goto(base + (process.env.RL_PAGE || '/rl/'), { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(2500); return p;
  };
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const p = await login(process.env.RL_USER || 'admin', process.env.RL_PASS); const W = ms => p.waitForTimeout(ms), T = s => p.innerText(s);
  const purge = () => p.evaluate(async () => { const H = { 'X-WP-Nonce': RL_CFG.nonce }, u = (x, q) => RL_CFG.rest + x + (q ? (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + q : '');
    for (const t of [false, true]) { const r = await (await fetch(u('records/provisions', t ? 'trash=1' : ''), { headers: H })).json(); for (const i of r.items || []) { if (/^WPPV/.test(i.data.title)) { if (!t) await fetch(u('records/provisions/' + i.id), { method: 'DELETE', headers: H }); } } }
    const r2 = await (await fetch(u('records/provisions', 'trash=1'), { headers: H })).json(); for (const i of r2.items || []) { if (/^WPPV/.test(i.data.title)) await fetch(u('records/provisions/' + i.id, 'purge=1'), { method: 'DELETE', headers: H }); } });
  await purge(); await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('#tabPv'); await W(2500);
  ok('tabs Γενικές Πρόνοιες and Πλαίσιο Συμφιλίωσης are visible for admin', await p.isVisible('#tabPv') && await p.isVisible('#tabRc'));
  await p.click('#tabPv'); await W(500);
  ok('add button visible, import hidden', await p.isVisible('#btnAdd') && !(await p.isVisible('#btnImport')));
  await p.click('#btnAdd'); await W(300); await p.fill('#pv_title', 'WPPV πρόνοια'); await p.selectOption('#pv_article', { index: 1 });
  await p.fill('#pv_amt_0', '2000'); await p.fill('#pv_amt_1', '1000'); await p.click('[data-act=pvsave]'); await W(1500);
  ok('saved on the server, detail opens', (await T('#overlay')).includes('WPPV πρόνοια') && (await T('#overlay')).includes('2.380,00'), (await T('#overlay')).slice(0, 200));
  await p.click('[data-act=close]'); await W(300); await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('#tabPv'); await W(2500); await p.click('#tabPv'); await W(500);
  ok('still there after reload', (await T('#list')).includes('WPPV πρόνοια'));
  await p.click('#tabBd'); await W(800);
  ok('Budget includes it', (await T('#list')).includes('WPPV πρόνοια') && (await T('#list')).includes('2.380,00'));
  await p.click('#tabRc'); await W(600);
  ok('reconciliation page renders three sections', (await p.locator('#list section.bds').count()) === 3 && !(await p.isVisible('#btnAdd')));
  await p.click('#tabPv'); await W(400); await p.click('[data-act=pvopen]'); await W(300); await p.click('[data-act=pvdel]'); await W(200); await p.click('#delYes'); await W(1200);
  await p.click('[data-f=trash]'); await W(800);
  ok('deleted provision is in the trash (server)', (await T('#list')).includes('WPPV πρόνοια'));
  /* viewer: sees tab, no add/edit/delete */
  const v = await login('viewer1', 'Pw-viewer1-12345!');
  await v.click('#tabPv'); await v.waitForTimeout(600);
  ok('viewer sees the tab but no add button', await v.isVisible('#tabPv') && !(await v.isVisible('#btnAdd')));
  const n = await login('nobody', 'Pw-nobody-12345!').catch(() => null);
  await purge();
  ok('no script errors', p.errs.length === 0 && v.errs.length === 0, p.errs.concat(v.errs).join(' | '));
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
