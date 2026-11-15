/* Real-browser check that the bundled SheetJS 0.20.3 works with NO network: library present, Excel export of a contract, and import of that file into an empty app.
   Usage: node tests/browser/html-xlsx-test.js [path/to/index.html] */
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'), os = require('os');
const file = path.resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const p = await ctx.newPage();
  const external = []; await p.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabCo', { timeout: 20000 }); await p.waitForTimeout(1200);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const T = s => p.innerText(s), W = ms => p.waitForTimeout(ms), tit = 'Probe Xlsx ' + Date.now();
  ok('SheetJS 0.20.3 is loaded without any network', await p.evaluate(() => typeof XLSX !== 'undefined' && XLSX.version === '0.20.3'), await p.evaluate(() => typeof XLSX === 'undefined' ? 'undefined' : XLSX.version));
  ok('no request left the page (no CDN)', external.length === 0, external.join(','));
  await p.click('#tabCt'); await W(700); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  await p.fill('#c_title', tit); await p.fill('#c_tender', 'XL-1/2027'); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change');
  await p.fill('#c_dateFrom', '2027-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300); await p.fill('#cy_cost_0', '2500'); await p.click('[data-act=ctsave]'); await W(1200);
  await p.click('#overlay [data-act=close]'); await W(300);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnExport').then(async () => { await W(400); const x = p.locator('[data-act=exfmt][data-fmt=xlsx], [data-fmt=xlsx], #overlay button:has-text("Excel")').first(); if (await x.count()) await x.click(); })]).catch(e => [null]);
  ok('Excel export produced a download', !!dl);
  if (dl) {
    const f = path.join(os.tmpdir(), 'xl-' + process.pid + '.xlsx'); await dl.saveAs(f);
    const py = require('child_process').spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print("".join(z.read(n).decode("utf-8","ignore") for n in z.namelist() if n.startswith("xl/") and n.endswith(".xml") and ("sheet" in n or "sharedStrings" in n)))', f]).stdout.toString();
    ok('the .xlsx is a valid file and contains the contract title', py.startsWith('None') && py.includes(tit), py.slice(0, 120));
    /* wipe all stored data, reload, import the file into an empty app */
    await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('renewal-ledger'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
    await p.goto('file://' + file); await p.waitForSelector('#tabCo'); await W(1200); await p.click('#tabCt'); await W(600);
    ok('app is empty before the import', !(await T('#list')).includes(tit));
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#btnImport')]); await fc.setFiles(f); await W(2500);
    const txt = await T('body');
    const btn = p.locator('#overlay [data-act=impgo], #overlay [data-act=imp], #overlay button:has-text("Εισαγωγή")').first(); if (await btn.count()) { await btn.click(); await W(1500); }
    await p.click('#tabCt').catch(() => {}); await W(600);
    ok('the contract came back through the import', (await T('#list')).includes(tit) || (await T('body')).includes(tit), txt.slice(0, 200));
    fs.unlinkSync(f);
  }
  ok('no script errors', errs.length === 0, errs.join(' | '));
  console.log(bad ? bad + ' failed' : 'all passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
