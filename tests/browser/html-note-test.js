/* Real-browser check (standalone HTML / Windows app): "Ετοιμασία Σημειώματος" on an Online Renewal (Word note filled from the template)
   and the template card in Ρυθμίσεις (download, upload, invalid upload refused, reset).
   Usage: node tests/browser/html-note-test.js [path/to/index.html] */
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const file = path.resolve(process.argv[2] || 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + file); await p.waitForSelector('#tabSt', { timeout: 20000 }); await p.waitForTimeout(1200);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const W = ms => p.waitForTimeout(ms), T = s => p.innerText(s);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-'));
  const unzipDoc = (f) => cp.execFileSync('unzip', ['-p', f, 'word/document.xml']).toString();
  const textOf = x => x.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  /* software record */
  await p.click('#btnAdd'); await W(300); await p.click('[data-act=wfull]'); await W(300);
  await p.fill('#w_name', 'Probe Note <Tool> & Co'); await p.fill('#w_description', 'Εργαλείο δοκιμής για σημειώματα.');
  await p.fill('#w_dateFrom', '2025-03-01'); await p.fill('#w_dateTo', '2026-02-28'); await p.fill('#w_cost', '1234.5');
  await p.click('[data-act=wsave]'); await W(1200);
  ok('detail shows the button', await p.isVisible('[data-act=swnote]') && (await T('[data-act=swnote]')).includes('Ετοιμασία Σημειώματος'));
  await p.click('[data-act=swnote]'); await W(400);
  ok('dialog prefilled (name, next period, cost)', await p.inputValue('#nt_name') === 'Probe Note <Tool> & Co' && await p.inputValue('#nt_from') === '2026-03-01' && await p.inputValue('#nt_to') === '2027-02-28' && await p.inputValue('#nt_cost') === '1234.5');
  await p.click('[data-act=ntgen]'); await W(300);
  ok('article is required', (await T('#nterr')).includes('άρθρο'));
  await p.selectOption('#nt_art', { index: 1 });
  const art = await p.$eval('#nt_art', e => e.value), artTxt = await p.$eval('#nt_art', e => e.options[e.selectedIndex].text);
  await p.fill('#nt_to', '2025-01-01'); await p.click('[data-act=ntgen]'); await W(300);
  ok('end before start refused', (await T('#nterr')).includes('μετά την έναρξη'));
  await p.fill('#nt_to', '2027-02-28');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-act=ntgen]')]);
  const out = path.join(tmp, 'note.docx'); await dl.saveAs(out); await W(300);
  ok('file name', dl.suggestedFilename().startsWith('Σημείωμα ανανέωσης - Probe Note') && dl.suggestedFilename().endsWith('.docx'), dl.suggestedFilename());
  let xml = ''; try { xml = unzipDoc(out) } catch (e) { }
  const tx = textOf(xml), today = new Date(), pd = n => String(n).padStart(2, '0'), td = pd(today.getDate()) + '/' + pd(today.getMonth() + 1) + '/' + today.getFullYear();
  ok('valid docx with document.xml', xml.length > 1000);
  ok('no placeholder left', !/\[(Σημερινή Ημερομηνία|Software Name|Description|Renewal Date From|Renewal Date To|Cost|Κωδικός Άρθρου|Περιγραφή Άρθρου)\]/.test(tx), tx.slice(0, 600));
  ok('name (escaped), description, dates, cost, article filled', tx.includes('Probe Note <Tool> & Co') && tx.includes('Εργαλείο δοκιμής για σημειώματα') && tx.includes('01/03/2026') && tx.includes('28/02/2027') && tx.includes('1.234,50') && tx.includes(art) && tx.includes(td), tx.slice(0, 900));
  fs.writeFileSync(path.join(tmp, 'x.xml'), xml);
  ok('XML well-formed', cp.spawnSync('python3', ['-c', 'import sys,xml.dom.minidom as m;m.parse(sys.argv[1])', path.join(tmp, 'x.xml')]).status === 0);
  if (cp.spawnSync('which', ['soffice']).status === 0) {
    cp.spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, out], { timeout: 120000 });
    ok('LibreOffice opens the generated file', fs.existsSync(path.join(tmp, 'note.pdf')));
    if (process.env.NT_KEEP) fs.copyFileSync(out, process.env.NT_KEEP);
  }
  /* settings */
  const closeAll = async () => { await p.evaluate(() => { const o = document.querySelector('#overlay [data-act=back]'); if (o) o.click() }); await W(300); await p.evaluate(() => { const c = document.querySelector('#overlay [data-act=close]'); if (c) c.click() }); await W(300) };
  await closeAll();
  await p.click('#tabSt'); await W(1000);
  let d = await T('#list');
  d = await p.$eval('#ntCard', e => e.textContent); ok('settings card with fields list and default info', d.includes('Πρότυπο Σημειώματος') && d.includes('[Software Name]') && d.includes('προεπιλεγμένο πρότυπο'), d.slice(0,200));
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-act=ntdl]')]);
  const tpl = path.join(tmp, 'tpl.docx'); await dl2.saveAs(tpl);
  ok('template download is the docx with placeholders', textOf(unzipDoc(tpl)).includes('[Software Name]'));
  /* upload invalid */
  fs.writeFileSync(path.join(tmp, 'bad.docx'), 'not a zip');
  const [fc1] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=ntup]')]); await fc1.setFiles(path.join(tmp, 'bad.docx')); await W(600);
  ok('invalid file refused', (await T('#ntMsg')).length > 5 && (await T('#ntInfo')).includes('προεπιλεγμένο'), await T('#ntMsg'));
  /* upload modified template */
  const wd = path.join(tmp, 'w'); fs.mkdirSync(wd); cp.execFileSync('unzip', ['-q', tpl, '-d', wd]);
  const dx = path.join(wd, 'word/document.xml'); fs.writeFileSync(dx, fs.readFileSync(dx, 'utf8').replace(/<w:body>/, '<w:body><w:p><w:r><w:t>CUSTOM-MARK [Software Name]</w:t></w:r></w:p>'));
  const cust = path.join(tmp, 'custom.docx'); cp.execFileSync('zip', ['-q', '-r', cust, '.'], { cwd: wd });
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=ntup]')]); await fc2.setFiles(cust); await W(800);
  ok('custom template stored and shown', (await T('#ntInfo')).includes('προσαρμοσμένο') && (await T('#ntInfo')).includes('custom.docx'), await T('#ntMsg'));
  await p.click('#tabSw'); await W(500); await p.click('[data-id]'); await W(500);
  await p.click('[data-act=swnote]'); await W(300); await p.selectOption('#nt_art', { index: 1 });
  const [dl3] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-act=ntgen]')]);
  const o3 = path.join(tmp, 'n3.docx'); await dl3.saveAs(o3);
  ok('note now built from the custom template', textOf(unzipDoc(o3)).includes('CUSTOM-MARK Probe Note'));
  await closeAll(); await p.click('#tabSt'); await W(800); await p.click('[data-act=ntreset]'); await W(600);
  ok('reset restores the default', (await T('#ntInfo')).includes('προεπιλεγμένο'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(bad ? 'FAILED: ' + bad : 'all ok'); await b.close(); process.exit(bad ? 1 : 0);
})();
