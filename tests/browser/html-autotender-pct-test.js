/* Real-browser check (standalone HTML): the estimated cost of an automatic tender = contract cost + the % set in Ρυθμίσεις (default 10%: 100.000 -> 110.000). Usage: node html-autotender-pct-test.js path/to/index.html */
const { chromium } = require('playwright');
const file = require('path').resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabSt', { timeout: 20000 }); await p.waitForTimeout(1500);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : ' ' + (x || ''))); };
  const W = ms => p.waitForTimeout(ms), Y = new Date().getFullYear();
  await p.click('#tabSt'); await W(600);
  ok('settings field exists with default 10', (await p.inputValue('#stAutoPct')) === '10');
  const mk = async (title, cost) => {
    await p.click('#tabCt'); await W(500); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
    await p.fill('#c_title', title); await p.fill('#c_tender', 'T-' + title); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change');
    await p.fill('#c_dateFrom', (Y + 1) + '-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
    await p.fill('#cy_cost_0', String(cost)); await p.click('[data-act=ctsave]'); await W(1200);
    await p.keyboard.press('Escape'); await W(300);
  };
  await mk('PCT-A', 100000);
  await p.click('#tabSt'); await W(500); await p.click('[data-act=autotn]'); await W(1500);
  await p.click('#tabTn'); await W(800);
  let d = await p.innerText('#list');
  ok('auto tender for PCT-A exists', d.includes('PCT-A'), d);
  ok('its estimated cost is 110,000 (not 10,000)', /€110,000\.00/.test(d) && !/€10,000\.00/.test(d), d);
  /* change the percentage and create for a second contract */
  await p.click('#tabSt'); await W(500); await p.fill('#stAutoPct', '25'); await p.click('[data-act=stsave]'); await W(1200);
  ok('saved value is shown again', (await p.inputValue('#stAutoPct')) === '25');
  await mk('PCT-B', 100000);
  await p.click('#tabSt'); await W(500); await p.click('[data-act=autotn]'); await W(1500);
  await p.click('#tabTn'); await W(800);
  d = await p.innerText('#list');
  ok('with 25% the second tender costs 125,000 (the first stays 110,000)', /€125,000\.00/.test(d) && /€110,000\.00/.test(d), d);
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close(); console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); process.exit(bad ? 1 : 0);
})();
