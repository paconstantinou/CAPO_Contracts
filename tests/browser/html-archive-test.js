/* Real-browser check of the Archive of expired contracts in a standalone HTML build (usage: node html-archive-test.js path/to/index.html). */
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
  const tit = 'Probe Archive ' + Date.now();
  const mk = async (title, from) => {
    await p.click('#tabCt'); await W(600); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
    await p.fill('#c_title', title); await p.fill('#c_tender', 'ARC-1/2020');
    await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', from); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
    await p.fill('#cy_cost_0', '1000'); await p.click('[data-act=ctsave]'); await W(1500);
  };
  await mk(tit + ' A', '2020-01-01');
  let d = await T('#overlay');
  ok('expired contract shows Έληξε and an enabled Αρχειοθέτηση button', d.includes('Έληξε') && await p.locator('[data-act=ctarch]').count() === 1 && await p.locator('[data-act=ctarch]').isEnabled());
  await p.click('[data-act=ctarch]'); await W(1500);
  d = await T('#overlay');
  ok('after Archive the contract shows Αρχειοθετήθηκε and offers restore', d.includes('Αρχειοθετήθηκε') && await p.locator('[data-act=ctunarch]').count() === 1);
  await p.click('#overlay [data-act=close]'); await W(300);
  await p.click('#chips [data-f=archived]'); await W(300);
  ok('Αρχείο filter lists the archived contract', (await T('#list')).includes(tit + ' A'));
  await p.click('#chips [data-f=expired]'); await W(300);
  ok('archived contract is not in the Έληξαν filter', !(await T('#list')).includes(tit + ' A'));
  await p.click('#chips [data-f=all]'); await W(300);
  ok('archived contract still appears in the full list (reference)', (await T('#list')).includes(tit + ' A'));
  await mk(tit + ' B', '2026-01-01');
  ok('contract that has not expired: Αρχειοθέτηση is disabled', await p.locator('[data-act=ctarch]').count() === 1 && await p.locator('[data-act=ctarch]').isDisabled());
  await p.click('#overlay [data-act=close]'); await W(300);
  /* the archived contract does not count in the attention digest list / alerts */
  ok('archived contract is not in the attention alerts', !(await T('#alerts')).includes(tit + ' A'));
  /* restore */
  await p.click('#chips [data-f=archived]'); await W(300);
  await p.locator('#list .row, #list tr', { hasText: tit + ' A' }).first().click(); await W(500);
  await p.click('[data-act=ctunarch]'); await W(1500);
  ok('restore returns it to Έληξε', (await T('#overlay')).includes('Έληξε') && await p.locator('[data-act=ctarch]').count() === 1);
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
