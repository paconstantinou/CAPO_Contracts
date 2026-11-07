/* Checks the structure bdExport() builds (sheets, merges, SUM formulas) against a stub of the SheetJS API.
   It does NOT test SheetJS itself. Run: node tests/unit/budget-export-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../application/renewal-ledger/assets/app.js'), 'utf8');
const g = (a, b) => { const i = src.search(a); return src.slice(i, src.indexOf(b, i)); };
const code = [g(/var DEFAULT_ARTICLES=/, 'function articles()'), g(/function artFind/, 'function artLabel'), g(/\/\*BD-CALC-START\*\//, '/*BD-CALC-END*/'), g(/function bdExport\(\)/, '/* =============== CONTRACTS'), g(/function tnActive/, 'function tnInfo')].join('\n');
const book = { sheets: [] };
const XLSX = { utils: { book_new: () => book, book_append_sheet: (wb, ws, n) => wb.sheets.push({ n, ws }), aoa_to_sheet: aoa => ({ aoa }),
  encode_col: i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; } }, write: () => new Uint8Array(1) };
let saved = null;
const run = new Function('XLSX', 'S', 'needX', 'toast', 'offer', 'todayIso', 'articles', code + '\nBD_VAT = 0; /* the export tests below are about structure, so they run net of VAT */\nreturn bdExport;');
const arts = JSON.parse(fs.readFileSync(path.join(__dirname, 'articles.json'), 'utf8'));
const S = { tenders: [], items: [{ id: 's1', name: 'Software X', dateFrom: '2026-06-01', dateTo: '2027-05-31', cost: 240, budget: [{ year: 1, amount: 240, article: '03583' }] }],
  contracts: [{ id: 'c1', title: 'Συντήρηση', tender: 'Δ1', months: 24, dateFrom: '2026-12-01', dateTo: '2028-11-30',
    years: [{ from: '2026-12-01', to: '2027-11-30', cost: 1700 }, { from: '2027-12-01', to: '2028-11-30', cost: 600 }],
    budget: [{ year: 1, amount: 1200, article: '03461' }, { year: 1, amount: 500, article: '07651' }, { year: 2, amount: 600, article: '03461' }] }] };
run(XLSX, S, () => false, m => { throw new Error(m); }, (n, d) => { saved = n; }, () => '2026-11-06', () => arts)();
let ok = 0, bad = 0;
function t(n, f) { try { f(); ok++; console.log('  ok   ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n       ' + e.message); } }
const by = n => book.sheets.find(s => s.n.startsWith(n));
t('file name', () => assert.strictEqual(saved, 'budget-2026-11-06.xlsx'));
t('sheets: summary + one per used article', () => assert.deepStrictEqual(book.sheets.map(s => s.n.split(' ')[0]), ['Σύνοψη', '03461', '03583', '07651']));
t('sheet names are Excel-safe (<=31, unique)', () => { const n = book.sheets.map(s => s.n.toLowerCase()); assert(book.sheets.every(s => s.n.length <= 31)); assert.strictEqual(new Set(n).size, n.length); });
const s = by('03461');
t('template layout: header, merged C:F, years from G', () => {
  const h = s.ws.aoa[0]; assert.deepStrictEqual(h.slice(0, 3), ['Α/Α', 'Λεπτομέρειες Δαπάνης (Περιγραφή)', 'Τρόπος Υπολογισμού']);
  assert(h[6].includes('ΕΤΟΣ 2026') && h[7].includes('ΕΤΟΣ 2027') && h[8].includes('ΕΤΟΣ 2028'));
  assert.deepStrictEqual(s.ws['!merges'][0], { s: { r: 0, c: 2 }, e: { r: 0, c: 5 } });
});
t('row content: name, calculation, amounts per year', () => {
  const r = s.ws.aoa[1]; assert.strictEqual(r[0], 1); assert.strictEqual(r[1], 'Συντήρηση'); assert(r[2].includes('Δ1') && r[2].includes('1.200,00 €'));
  assert.deepStrictEqual([r[6].v, r[7].v, r[8].v], [100, 1150, 550]);
});
t('Σύνολα row with SUM formulas and merged A:F', () => {
  const r = s.ws.aoa[2]; assert.strictEqual(r[0], 'Σύνολα'); assert.strictEqual(r[6].f, 'SUM(G2:G2)'); assert.strictEqual(r[7].f, 'SUM(H2:H2)');
  assert.deepStrictEqual(s.ws['!merges'].pop(), { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } });
});
t('summary sheet has totals formulas', () => { const a = by('Σύνοψη').ws.aoa, last = a[a.length - 1]; assert.strictEqual(last[0], 'Σύνολα'); assert(/^SUM\(E2:E4\)$/.test(last[4].f)); });
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
