/* Real-browser check of the scheduled backup (folder, frequency, run now, status) and that the server-made ZIP restores through the page.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-backup-schedule-test.js */
const { chromium } = require('playwright');
const base = process.env.RL_URL || 'http://127.0.0.1:8088', page = process.env.RL_PAGE || '/rl/', user = process.env.RL_USER || 'admin', pass = process.env.RL_PASS;
if (!pass) { console.error('RL_PASS required'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(base + '/wp-login.php', { waitUntil: 'commit' });
  await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
  await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(3000);
  let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  const nz = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), T = s => p.innerText(s), W = ms => p.waitForTimeout(ms);
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { path = path.replace('&purge=1', (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1'); const r = await fetch(RL_CFG.rest + path, { method: m, headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.status; }, [m, path, body]);
  const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  await p.evaluate(async () => { await fetch(RL_CFG.rest + 'settings', { method: 'PUT', headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { vat: 19, remindDays: 30, customFields: {} } }) }); }); await p.reload(); await p.waitForTimeout(2500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-sched-')), tit = 'Probe Sched ' + Date.now();
  const y = o => new Date(Date.now() + 864e5 * o).toISOString().slice(0, 10);
  await p.evaluate(async () => { await fetch(RL_CFG.rest + 'backup-schedule', { method: 'PUT', headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: { enabled: false, frequency: 'weekly', path: '', keep: 8 } }) }); });
  await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app'); await W(2500);
  await p.click('#tabSt'); await W(600);
  ok('settings page has the scheduled-backup card with checkbox, frequency, folder, keep and both buttons', await p.locator('#bsCard').count() === 1 && await p.locator('#bsOn').count() === 1 && await p.locator('#bsFreq option').count() === 2 && await p.locator('#bsPath').count() === 1 && await p.locator('#bsKeep').count() === 1 && await p.locator('[data-act=bssave]').count() === 1 && await p.locator('[data-act=bsrun]').count() === 1);
  ok('a status line is shown (last run or "not yet")', /Τελευταία εκτέλεση|Δεν έχει γίνει ακόμη/.test(await T('#bsStatus')));
  /* validation messages */
  await p.check('#bsOn'); await p.fill('#bsPath', ''); await p.click('[data-act=bssave]'); await W(400);
  ok('enabled without a folder: asked for the folder', (await T('#bsErr')).includes('φάκελο'));
  await p.fill('#bsPath', 'relative/dir'); await p.click('[data-act=bssave]'); await W(900);
  ok('relative path: the server reason is shown', (await T('#bsErr')).includes('πλήρη διαδρομή'), await T('#bsErr'));
  await p.fill('#bsPath', dir + '/missing'); await p.click('[data-act=bssave]'); await W(900);
  ok('folder that does not exist: reason shown', (await T('#bsErr')).includes('δεν βρέθηκε'));
  await p.fill('#bsPath', dir); await p.fill('#bsKeep', '0'); await p.click('[data-act=bssave]'); await W(400);
  ok('keep 0 refused before sending', (await T('#bsErr')).includes('1 έως 100'));
  /* save */
  await p.fill('#bsKeep', '3'); await p.selectOption('#bsFreq', 'monthly'); await p.click('[data-act=bssave]'); await W(1000);
  ok('valid schedule saved without error', (await T('#bsErr')).trim() === '');
  const sv = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'backup-schedule', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).schedule);
  ok('server has it: enabled, monthly, keep 3, folder', sv.enabled === true && sv.frequency === 'monthly' && sv.keep === 3 && sv.path === dir, JSON.stringify(sv));
  await p.click('#tabCt'); await W(400); await p.click('#tabSt'); await W(600);
  ok('after leaving and coming back the form shows the saved values', (await p.inputValue('#bsPath')) === dir && (await p.inputValue('#bsFreq')) === 'monthly' && (await p.inputValue('#bsKeep')) === '3' && await p.isChecked('#bsOn'));
  /* a contract with an attachment, then run now from the page */
  const mk = await p.evaluate(async ([tit, f, t]) => {
    const h = { 'X-WP-Nonce': RL_CFG.nonce }; const fd = new FormData(); fd.append('file', new Blob(['sched-attachment'], { type: 'application/xml' }), 'sched.xml');
    const up = await (await fetch(RL_CFG.rest + 'files?coll=contracts', { method: 'POST', headers: h, body: fd })).json();
    const rec = { title: tit, tender: 'SCH-1', months: 12, dateFrom: f, dateTo: t, cost: 500, years: [{ from: f, to: t, cost: 500, remind: 30 }], attachments: [{ id: up.id, name: up.name, size: up.size, type: up.type }] };
    const r = await fetch(RL_CFG.rest + 'records/contracts/sched1', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify({ data: rec }) });
    return r.status;
  }, [tit, y(-30), y(300)]);
  ok('probe contract with an attachment created', mk === 200, mk);
  await p.click('[data-act=bsrun]'); await W(3500);
  const files = fs.readdirSync(dir).filter(f => /^PROCURE360-backup-.*\.zip$/.test(f));
  ok('"Αποθήκευση και backup τώρα" wrote one ZIP into the folder', files.length === 1, files.join(','));
  ok('status shows success with the file name', (await T('#bsStatus')).includes('επιτυχία') && (await T('#bsStatus')).includes(files[0]), await T('#bsStatus'));
  ok('status shows the next run', (await T('#bsStatus')).includes('Επόμενο'));
  /* the server-made ZIP restores through the page (format compatibility) */
  const zp = path.join(dir, files[0]);
  const lst = cp.spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print("\\n".join(z.namelist()))', zp]).stdout.toString();
  ok('ZIP is valid (python testzip) and has manifest, data, settings, articles and the attachment', lst.startsWith('None') && ['manifest.json', 'data/contracts.json', 'settings.json', 'articles.json'].every(x => lst.includes(x)) && /files\//.test(lst), lst);
  await api('DELETE', 'records/contracts/sched1'); await api('DELETE', 'records/contracts/sched1&purge=1');
  await p.click('#tabCt'); await W(700);
  ok('probe contract is gone before the restore', !(await T('#list')).includes(tit));
  await p.click('#tabSt'); await W(500);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=bkpick]')]);
  await fc.setFiles(zp); await W(1500);
  ok('restore preview lists the contracts', (await T('#bkRestore')).includes('Συμβάσεις'));
  await p.uncheck('#bkSet').catch(() => {}); 
  await p.click('[data-act=bkgo]'); await W(5000);
  await p.click('#tabCt'); await W(700);
  ok('contract made by the SERVER backup is restored in the list', (await T('#list')).includes(tit));
  await p.locator('#list .row', { hasText: tit }).first().click(); await W(500);
  ok('and its attachment came back', (await T('#overlay')).includes('sched.xml'));
  await p.click('#overlay [data-act=close]'); await W(300);
  /* restoring a backup must not touch the schedule */
  const sv2 = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'backup-schedule', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).schedule);
  ok('the schedule (folder, frequency) is unchanged by a restore', sv2.path === dir && sv2.frequency === 'monthly');
  /* disable */
  await p.click('#tabSt'); await W(500); await p.uncheck('#bsOn'); await p.click('[data-act=bssave]'); await W(900);
  const sv3 = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'backup-schedule', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).schedule);
  ok('can be switched off', sv3.enabled === false);
  /* cleanup */
  const items = await p.evaluate(async () => (await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).items.map(i => i.id));
  for (const id of items) { const t = await p.evaluate(async id => (await (await fetch(RL_CFG.rest + 'records/contracts', { headers: { 'X-WP-Nonce': RL_CFG.nonce } })).json()).items.find(i => i.id === id).data.title, id); if (t.startsWith('Probe Sched')) { await api('DELETE', `records/contracts/${id}`); await api('DELETE', `records/contracts/${id}&purge=1`); } }
  await p.evaluate(async () => { await fetch(RL_CFG.rest + 'backup-schedule', { method: 'PUT', headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: { enabled: false, frequency: 'weekly', path: '', keep: 8 } }) }); });
  fs.rmSync(dir, { recursive: true, force: true });
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
