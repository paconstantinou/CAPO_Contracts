/* Real-browser check of Ρυθμίσεις: custom fields, settings, backup and restore in a standalone HTML build (usage: node html-settings-test.js path/to/index.html). */
const { chromium } = require('playwright');
const file = require('path').resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabSt', { timeout: 20000 }); await p.waitForTimeout(1500);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : ' ' + (x || ''))); };
  const nz = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), T = s => p.innerText(s), W = ms => p.waitForTimeout(ms);
  const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  const tit = 'Probe Settings ' + Date.now(), dl = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  await p.click('#tabSt'); await W(600);
  let d = await T('#list');
  ok('Ρυθμίσεις page shows Backup & Restore, general settings and custom fields', d.includes('Backup') && d.includes('Γενικές ρυθμίσεις') && d.includes('Custom fields'));
  ok('no Add / Import / Export buttons on the settings page', !(await p.isVisible('#btnAdd')) && !(await p.isVisible('#btnImport')) && !(await p.isVisible('#btnExport')));
  /* --- custom fields --- */
  const add = async (coll, label, type, opts) => {
    await p.click(`[data-act=cfadd][data-coll=${coll}]`); await W(200);
    const row = p.locator(`.cfrow[data-coll=${coll}]`).last();
    await row.locator('[data-cf=label]').fill(label);
    if (type) { await row.locator('[data-cf=type]').selectOption(type); }
    if (opts) await row.locator('[data-cf=options]').fill(opts);
  };
  await add('contracts', 'Κωδικός CPV', 'text'); await add('contracts', 'Βαθμός', 'select', 'Α\nΒ\nΓ'); await add('contracts', 'Μπόνους', 'number'); await add('contractors', 'Fax', 'text'); await add('software', 'Owner', 'text');
  await p.fill('#stVat', '24'); await p.fill('#stRem', '45');
  await p.click('[data-act=stsave]'); await W(1500);
  d = await T('#list');
  ok('settings saved: fields and values are shown again after the save', (await p.locator('.cfrow[data-coll=contracts] [data-cf=label]').first().inputValue()) === 'Κωδικός CPV' && (await p.inputValue('#stVat')) === '24' && (await p.inputValue('#stRem')) === '45');
  ok('saved field type is locked (no type select for saved fields)', await p.locator('.cfrow[data-coll=contracts] select[data-cf=type]').count() === 0);
  /* validation */
  await p.click('[data-act=cfadd][data-coll=tenders]'); await W(200); await p.click('[data-act=stsave]'); await W(500);
  ok('a custom field without a name is refused', (await T('#stErr')).includes('όνομα'));
  await p.click('[data-act=cfdel][data-coll=tenders]'); await W(300);
  /* --- use them in a contract --- */
  await p.click('#tabCt'); await W(600); await p.click('#btnAdd'); await W(300); await p.click('[data-act=ctfull]'); await W(300);
  await p.fill('#c_title', tit); await p.fill('#c_tender', 'SET-1/2026'); await p.fill('#c_months', '12'); await p.dispatchEvent('#c_months', 'change'); await p.fill('#c_dateFrom', '2026-01-01'); await p.dispatchEvent('#c_dateFrom', 'change'); await W(300);
  await p.fill('#cy_cost_0', '1000');
  await p.locator('#overlay input[type=text][id^=c_cf_]').first().fill('72212000-4');
  await p.locator('#overlay select[id^=c_cf_]').first().selectOption('Β');
  await p.locator('#overlay input[type=number][id^=c_cf_]').first().fill('12.5');
  await p.click('[data-act=ctsave]'); await W(1500);
  d = await T('#overlay');
  ok('contract detail shows the custom fields with their values', nz(d).includes('προσθετα πεδια') && nz(d).includes('κωδικος cpv') && d.includes('72212000-4') && nz(d).includes('βαθμος') && d.includes('12.5'), d);
  /* attachment for the backup test */
  await p.setInputFiles('#fileAttach', { name: 'probe.xml', mimeType: 'application/xml', buffer: Buffer.from('<a>backup</a>') }); await W(1500);
  ok('attachment added', (await T('#overlay')).includes('probe.xml'));
  await p.click('#overlay [data-act=close]'); await W(300);
  /* list column + export */
  await p.click('[data-act=cols]'); await W(300);
  ok('custom fields are offered as optional list columns', nz(await T('#overlay')).includes('κωδικος cpv'));
  await p.click('#overlay [data-act=close]'); await W(300);
  /* --- backup --- */
  await p.click('#tabSt'); await W(500);
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-act=bkdo]')]);
  const zipPath = path.join(dl, 'b.zip'); await download.saveAs(zipPath); await W(500);
  const lst = cp.spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print("|".join(z.namelist()))', zipPath]).stdout.toString();
  ok('backup is a valid ZIP (CRC ok) with manifest, data, settings, articles and the attachment', lst.startsWith('None') && ['manifest.json', 'data/contracts.json', 'data/software.json', 'settings.json', 'articles.json'].every(x => lst.includes(x)) && /files\//.test(lst), lst);
  const man = cp.spawnSync('python3', ['-c', 'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([x for x in json.loads(z.read("data/contracts.json")) if x["title"].startswith("Probe Settings")][0]["custom"]))', zipPath]).stdout.toString();
  ok('backup keeps the custom values', man.includes('72212000-4'), man);
  ok('backup message shown', (await T('#bkMsg')).includes('Το backup αποθηκεύτηκε'));
  /* --- delete the contract, then restore --- */
  await p.click('#tabCt'); await W(500);
  await p.locator('#list .row', { hasText: tit }).first().click(); await W(500);
  await p.click('#overlay [data-act=ctdel]'); await W(300); await p.click('#delYes'); await W(1500);
  ok('contract deleted (gone from the list)', !(await T('#list')).includes(tit));
  await p.click('#tabSt'); await W(500);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=bkpick]')]);
  await fc.setFiles(zipPath); await W(1500);
  d = await T('#bkRestore');
  ok('restore preview lists the collections with new / replaced counts', d.includes('Προεπισκόπηση') && d.includes('Συμβάσεις') && d.includes('Νέες'));
  await p.click('[data-act=bkgo]'); await p.waitForFunction(() => /Ολοκληρώθηκε/.test((document.querySelector('#bkRestore') || {}).innerText || ''), null, { timeout: 90000 }); await W(300);
  d = await T('#bkRestore');
  ok('restore completes without errors', d.includes('Ολοκληρώθηκε') && !d.includes('Προβλήματα'), d);
  await p.click('#tabCt'); await W(600);
  ok('restored contract is back in the list', (await T('#list')).includes(tit));
  await p.locator('#list .row', { hasText: tit }).first().click(); await W(500);
  d = await T('#overlay');
  ok('restored contract has its custom values and attachment', d.includes('72212000-4') && d.includes('12.5') && d.includes('probe.xml'));
  await p.click('#overlay [data-act=close]'); await W(300);
  /* --- a bad file is refused --- */
  fs.writeFileSync(path.join(dl, 'bad.zip'), 'not a zip');
  await p.click('#tabSt'); await W(400);
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=bkpick]')]);
  await fc2.setFiles(path.join(dl, 'bad.zip')); await W(800);
  ok('a file that is not a backup is refused with a message', (await T('#bkRestore')).includes('ZIP'));
  /* --- delete a field (data hidden), settings of the other collections intact --- */
  await p.click('[data-act=cfdel][data-coll=software]'); await W(300);
  await p.click('[data-act=stsave]'); await W(1200);
  ok('deleted field disappears from the settings', !(await T('#list')).includes('Owner'));
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
