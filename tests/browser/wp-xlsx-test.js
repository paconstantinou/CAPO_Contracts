/* Real-browser check (WordPress): the bundled SheetJS 0.20.3 loads from the plugin with its SRI hash, with no external request, and Excel export works.
   Usage: RL_URL=http://127.0.0.1:8088 RL_PAGE=/rl/ RL_USER=admin RL_PASS=... node tests/browser/wp-xlsx-test.js */
const { chromium } = require('playwright');
const base = process.env.RL_URL || 'http://127.0.0.1:8088', page = process.env.RL_PAGE || '/rl/', user = process.env.RL_USER || 'admin', pass = process.env.RL_PASS;
if (!pass) { console.error('RL_PASS required'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })).newPage();
  await p.route('**/*', r => { const u = r.request().url(); if(!u.startsWith(base)&&!u.startsWith('data:')&&!u.startsWith('blob:'))external.push(u); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const external = [], errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(base + '/wp-login.php', { waitUntil: 'commit' });
  await p.fill('#user_login', user); await p.fill('#user_pass', pass); await p.click('#wp-submit'); await p.waitForTimeout(3000);
  await p.goto(base + page, { waitUntil: 'commit' }); await p.waitForSelector('#rl-app', { timeout: 20000 }); await p.waitForTimeout(3000);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + (x || ''))); };
  const nz = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), T = s => p.innerText(s), W = ms => p.waitForTimeout(ms);
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { path = path.replace('&purge=1', (RL_CFG.rest.indexOf('?') >= 0 ? '&' : '?') + 'purge=1'); const r = await fetch(RL_CFG.rest + path, { method: m, headers: { 'X-WP-Nonce': RL_CFG.nonce, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.status; }, [m, path, body]);
  const info = await p.evaluate(() => { const s = [...document.scripts].find(x => /xlsx\.full\.min\.js/.test(x.src)); return { v: typeof XLSX !== 'undefined' ? XLSX.version : null, src: s ? s.src : null, integrity: s ? s.integrity : null }; });
  ok('XLSX 0.20.3 is loaded', info.v === '0.20.3', JSON.stringify(info));
  ok('it comes from the plugin folder (assets/vendor), not a CDN', !!info.src && info.src.startsWith(base) && info.src.includes('/assets/vendor/'), info.src);
  ok('the script tag carries an SRI hash (sha384)', /^sha384-/.test(info.integrity || ''));
  const cdn = external.filter(u => !/gravatar\.com/.test(u)); /* WP core avatars are not app assets */
  ok('no request left the server (no CDN)', cdn.length === 0, cdn.join(','));
  const sriOk = await p.evaluate(async () => { const s = [...document.scripts].find(x => /xlsx\.full\.min\.js/.test(x.src)); const buf = await (await fetch(s.src)).arrayBuffer(); const h = await crypto.subtle.digest('SHA-384', buf); return 'sha384-' + btoa(String.fromCharCode(...new Uint8Array(h))); });
  ok('the served file hashes to exactly the SRI value in the tag', sriOk === info.integrity);
  const wb = await p.evaluate(() => { const ws = XLSX.utils.aoa_to_sheet([['Τίτλος', 'Ποσό'], ['Δοκιμή', 12.5]]); const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, ws, 'S'); const out = XLSX.write(w, { type: 'array', bookType: 'xlsx' }); const r = XLSX.read(out, { type: 'array' }); return XLSX.utils.sheet_to_json(r.Sheets.S, { header: 1 }); });
  ok('write then read round trip works', JSON.stringify(wb) === JSON.stringify([['Τίτλος', 'Ποσό'], ['Δοκιμή', 12.5]]), JSON.stringify(wb));
  ok('no script errors', errs.length === 0); if (errs.length) console.log(errs.join('\n'));
  console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
