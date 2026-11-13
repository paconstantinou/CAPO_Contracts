/* Unit test of the settings / custom-field helpers and the backup ZIP writer+reader in application/renewal-ledger/assets/app.js (no browser).
   Run: node tests/unit/settings-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../application/renewal-ledger/assets/app.js'), 'utf8');
const i = src.indexOf('var ST_COLLS='), j = src.indexOf('/* ---------- backup ---------- */');
assert(i > 0 && j > i, 'settings block not found');
const mk = (store) => new Function('window', 'localStorage', 'esc', 'fmtDate', 'parseIso', 'cdef', 'S', 'COLS', 'TextEncoder', 'TextDecoder', 'Response', 'Blob', 'DecompressionStream',
  src.slice(i, j) + '\nreturn {stNorm,stGet,stSave,bdVat,defRemind,cfDescs,cfErr,cfLoad,cfApply,cfShow,cfInput,crc32,zipBuild,zipRead,ST_COLLS,reset:function(){ST_CACHE=null}};');
let ok = 0, bad = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ok   ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n       ' + e.message); } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseIso = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? new Date(v) : null;
const mem = {}; const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v) } };
const A = mk()({}, ls, esc, v => v, parseIso, () => ({}), {}, {}, TextEncoder, TextDecoder, Response, Blob, typeof DecompressionStream === 'undefined' ? undefined : DecompressionStream);
(async () => {
  await t('defaults: VAT 19%, reminder 30 days, no custom fields', () => { const s = A.stGet(); assert.strictEqual(s.vat, 19); assert.strictEqual(s.remindDays, 30); assert.deepStrictEqual(A.ST_COLLS.map(c => s.customFields[c].length), [0, 0, 0, 0]); assert.strictEqual(A.bdVat(), 0.19); });
  await t('normalize clamps VAT 0..100 and reminder 1..365, rejects bad ids / empty labels / duplicate ids, de-dupes options', () => {
    const s = A.stNorm({ vat: 250, remindDays: 0, customFields: { contracts: [{ id: 'a1', label: ' L ', type: 'select', options: ['x', 'x', ' ', 'y'] }, { id: 'a1', label: 'dup', type: 'text' }, { id: 'bad id', label: 'x' }, { id: 'a2', label: '' }, { id: 'a3', label: 'T', type: 'weird' }] } });
    assert.strictEqual(s.vat, 100); assert.strictEqual(s.remindDays, 30);
    assert.deepStrictEqual(s.customFields.contracts.map(f => f.id), ['a1', 'a3']); assert.deepStrictEqual(s.customFields.contracts[0].options, ['x', 'y']); assert.strictEqual(s.customFields.contracts[1].type, 'text'); assert.strictEqual(s.customFields.contracts[0].label, 'L');
    assert.strictEqual(A.stNorm({ vat: '' }).vat, 19); assert.strictEqual(A.stNorm({ vat: 0 }).vat, 0);
  });
  await t('save to the browser store and read back; VAT 24% and reminder 45 are used', async () => {
    assert.strictEqual(await A.stSave({ vat: 24, remindDays: 45, customFields: { contracts: [{ id: 'cf1', label: 'CPV', type: 'text' }, { id: 'cf2', label: 'Ποσό', type: 'number' }, { id: 'cf3', label: 'Ημ', type: 'date' }, { id: 'cf4', label: 'Β', type: 'select', options: ['Α', 'Β'] }] } }), true);
    A.reset(); assert.strictEqual(A.bdVat(), 0.24); assert.strictEqual(A.defRemind(), 45); assert.strictEqual(A.cfDescs('contracts').length, 4); assert.strictEqual(A.cfDescs('tenders').length, 0);
  });
  await t('descriptors plug into the forms: keys cf_<id>, flags for number/date/select', () => { const d = A.cfDescs('contracts'); assert.deepStrictEqual(d.map(f => f.k), ['cf_cf1', 'cf_cf2', 'cf_cf3', 'cf_cf4']); assert(d[1].num && d[2].date && d[3].opts.length === 2 && d[0].cf); });
  await t('cfLoad / cfApply round trip; empty values are not stored; numbers become numbers; cf_ keys never leak into the record', () => {
    const d = { custom: { cf1: 'X', cf2: 5 } }; A.cfLoad(d, 'contracts'); assert.strictEqual(d.cf_cf1, 'X'); assert.strictEqual(d.cf_cf3, '');
    d.cf_cf2 = '12.5'; d.cf_cf4 = 'Β'; const rec = A.cfApply({ title: 't', cf_cf9: 'junk' }, d, 'contracts');
    assert.deepStrictEqual(rec.custom, { cf1: 'X', cf2: 12.5, cf4: 'Β' }); assert(!('cf_cf9' in rec));
  });
  await t('validation: number, date; blank is fine', () => { const [, n, dt] = A.cfDescs('contracts'); assert(A.cfErr(n, 'abc')); assert.strictEqual(A.cfErr(n, '12.5'), ''); assert(A.cfErr(dt, '2026-13-45x')); assert.strictEqual(A.cfErr(dt, '2026-05-01'), ''); assert.strictEqual(A.cfErr(n, ''), ''); });
  await t('inputs: select keeps a value that is no longer in the options; text is escaped', () => {
    const [txt, , , sel] = A.cfDescs('contracts'); const h = A.cfInput(sel, 'Γ', 'c_x'); assert(h.includes('<option value="Γ" selected>')); assert(A.cfInput(txt, '"><script>', 'c_y').includes('&quot;&gt;&lt;script&gt;'));
  });
  await t('CRC32 matches the standard check value', () => assert.strictEqual(A.crc32(new TextEncoder().encode('123456789')), 0xCBF43926));
  await t('ZIP round trip: unicode names, binary data, empty file, 300 KB file', async () => {
    const big = new Uint8Array(300000).map((_, k) => (k * 31) & 255), bin = new Uint8Array([0, 255, 1, 254]);
    const z = A.zipBuild([{ name: 'manifest.json', data: new TextEncoder().encode('{"a":1}') }, { name: 'files/Συνημμένο.xml', data: bin }, { name: 'empty', data: new Uint8Array(0) }, { name: 'big', data: big }]);
    const r = await A.zipRead(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
    assert.deepStrictEqual(Object.keys(r), ['manifest.json', 'files/Συνημμένο.xml', 'empty', 'big']); assert.deepStrictEqual([...r['files/Συνημμένο.xml']], [0, 255, 1, 254]); assert.strictEqual(r.empty.length, 0); assert.strictEqual(Buffer.compare(Buffer.from(r.big), Buffer.from(big)), 0);
  });
  await t('ZIP written by us is readable by python zipfile (independent reader)', () => {
    const z = A.zipBuild([{ name: 'a/b.txt', data: new TextEncoder().encode('hello ελληνικά') }]); const f = path.join(require('os').tmpdir(), 'ut-' + process.pid + '.zip'); fs.writeFileSync(f, z);
    const out = require('child_process').spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read("a/b.txt").decode())', f]).stdout.toString(); fs.unlinkSync(f);
    assert(out.startsWith('None') && out.includes('hello ελληνικά'), out);
  });
  await t('a corrupted entry is detected (CRC) and garbage is refused', async () => {
    const z = A.zipBuild([{ name: 'x', data: new TextEncoder().encode('hello world') }]); z[30 + 1 + 3] ^= 0xFF;
    await assert.rejects(() => A.zipRead(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength)), /CRC|αλλοιωμ/);
    await assert.rejects(() => A.zipRead(new TextEncoder().encode('not a zip at all, just text').buffer), /ZIP/);
  });
  await t('a ZIP re-packed with deflate (e.g. by an unzip/zip round trip) is readable', async () => {
    if (typeof DecompressionStream === 'undefined') return;
    const f = path.join(require('os').tmpdir(), 'ut2-' + process.pid + '.zip');
    require('child_process').spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.writestr("d.txt","abc"*1000);z.close()', f]);
    const b = fs.readFileSync(f); fs.unlinkSync(f); const r = await A.zipRead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); assert.strictEqual(Buffer.from(r['d.txt']).toString(), 'abc'.repeat(1000));
  });
  console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})();
