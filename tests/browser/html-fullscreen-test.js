/* Real-browser check: opening an existing record (detail) uses the whole screen, centered, not a side panel.
   Usage: node tests/browser/html-fullscreen-test.js [path/to/index.html] */
const { chromium } = require('playwright'); const path = require('path');
const file = path.resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + file); await p.waitForSelector('#tabCo', { timeout: 20000 }); await p.waitForTimeout(1200);
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); }, W = ms => p.waitForTimeout(ms);
  const box = async () => p.evaluate(() => { const o = document.querySelector('#overlay'), pn = o.querySelector('.panel'), r = pn.getBoundingClientRect(), k = pn.firstElementChild.getBoundingClientRect(); return { kind: o.dataset.kind, x: r.x, w: r.width, h: r.height, cx: k.x, cw: k.width, vw: innerWidth, vh: innerHeight }; });
  const full = (m, label) => ok(label + ': detail fills the screen and its content is centered (max 1040px)', m.kind === 'detail' && Math.abs(m.w - m.vw) < 2 && m.h >= m.vh - 2 && m.cw <= 1041 && Math.abs((m.cx + m.cw / 2) - m.vw / 2) < 4, JSON.stringify(m));
  /* contract */
  await p.click('#tabCt'); await W(500); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  await p.fill('#c_title', 'Probe FS'); await p.fill('#c_tender', 'FS-1/2026'); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', '2026-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
  await p.fill('#cy_cost_0', '1000'); await p.click('[data-act=ctsave]'); await W(1500);
  full(await box(), 'contract');
  await p.screenshot({ path: process.env.SHOT || '/tmp/fs-contract.png' });
  await p.click('#overlay [data-act=close]'); await W(300);
  await p.locator('#list .row', { hasText: 'Probe FS' }).first().click(); await W(500);
  full(await box(), 'contract opened from the list');
  ok('Close button works', (await p.click('#overlay [data-act=close]'), await W(300), await p.locator('#overlay').isHidden()));
  /* narrow screen still fine */
  await p.setViewportSize({ width: 390, height: 800 }); await p.locator('#list .row', { hasText: 'Probe FS' }).first().click(); await W(500);
  const m = await box(); ok('phone width: no horizontal overflow', m.w <= m.vw + 1 && m.cw <= m.vw + 1, JSON.stringify(m));
  await p.click('#overlay [data-act=close]'); await W(200);
  ok('no script errors', errs.length === 0);
  console.log(bad ? bad + ' failed' : 'all passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
