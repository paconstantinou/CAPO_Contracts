/* Unit test of the budget-sheet calculation in application/renewal-ledger/assets/app.js (no browser needed).
   Run: node tests/unit/budget-calc-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../application/renewal-ledger/assets/app.js'), 'utf8');
function grab(startRe, endMarker) { const i = src.search(startRe); const j = src.indexOf(endMarker, i); return src.slice(i, j); }
const code = [
  grab(/var DEFAULT_ARTICLES=/, 'function articles()'),
  grab(/function artFind/, 'function artLabel'),
  grab(/\/\*BD-CALC-START\*\//, '/*BD-CALC-END*/'),
  grab(/function tnActive/, 'function tnInfo'),
].join('\n');
const api = new Function(code + '\nreturn {DEFAULT_ARTICLES,parseArtLines,artFind,bdMonths,bdAlloc,bdBuild,bdTotals,bdEur,tnActive};')();
let ok = 0, bad = 0;
function t(name, fn) { try { fn(); ok++; console.log('  ok   ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const arts = api.DEFAULT_ARTICLES;

t('17 default articles, 6 with split=ΝΑΙ', () => { assert.strictEqual(arts.length, 17); assert.strictEqual(arts.filter(a => a.split).length, 6); });
t('parse lines (pipe and tab) with ΝΑΙ/ΌΧΙ', () => {
  const l = api.parseArtLines('A1 | Desc | C1 | CD | ΝΑΙ\nB2\tDesc2\tC2\tCD2\tΌΧΙ\n\nA1 | dup');
  assert.strictEqual(l.length, 2); assert.strictEqual(l[0].split, true); assert.strictEqual(l[1].split, false); assert.strictEqual(l[1].desc, 'Desc2');
});
t('artFind by code and by "code description"', () => {
  assert.strictEqual(api.artFind('03461', arts).code, '03461');
  assert.strictEqual(api.artFind('03461 — Συντήρηση', arts).code, '03461');
  assert.strictEqual(api.artFind('nope', arts), null);
});
t('months: 01/12/2026-30/11/2027 = 1 in 2026, 11 in 2027', () => {
  const m = api.bdMonths('2026-12-01', '2027-11-30'); assert.strictEqual(m.by[2026], 1); assert.strictEqual(Math.round(m.by[2027] * 1e6) / 1e6, 11); assert.strictEqual(Math.round(m.total * 1e6) / 1e6, 12);
});
t('USER EXAMPLE: 1200 € NAI -> 100 (2026) + 1100 (2027)', () => {
  const a = api.bdAlloc(1200, '2026-12-01', '2027-11-30', true); assert.deepStrictEqual(a.by, { 2026: 100, 2027: 1100 });
});
t('OXI: whole amount in the start year', () => {
  assert.deepStrictEqual(api.bdAlloc(1200, '2026-12-01', '2027-11-30', false).by, { 2026: 1200 });
});
t('split amounts always add up to the original (rounding)', () => {
  const a = api.bdAlloc(1000, '2026-11-15', '2028-02-10', true); const s = Object.values(a.by).reduce((x, y) => x + y, 0);
  assert.strictEqual(Math.round(s * 100) / 100, 1000); assert.strictEqual(Object.keys(a.by).length, 3);
});
t('period inside one calendar year stays in that year', () => {
  assert.deepStrictEqual(api.bdAlloc(500, '2026-03-01', '2026-12-31', true).by, { 2026: 500 });
});
t('invalid start date -> null; invalid end date with NAI -> start year', () => {
  assert.strictEqual(api.bdAlloc(10, '', '', true), null);
  assert.deepStrictEqual(api.bdAlloc(10, '2026-05-05', '', true).by, { 2026: 10 });
});
const contract = { id: 'c1', title: 'Συντήρηση Συστημάτων', tender: 'ΔΙΑΓ 12/2026', months: 24, dateFrom: '2026-12-01', dateTo: '2028-11-30',
  years: [{ from: '2026-12-01', to: '2027-11-30', cost: 1700 }, { from: '2027-12-01', to: '2028-11-30', cost: 600 }],
  budget: [{ year: 1, amount: 1200, article: '03461' }, { year: 1, amount: 500, article: '07651' }, { year: 2, amount: 600, article: '03461' }] };
const sw = { id: 's1', name: 'Software X', dateFrom: '2026-06-01', dateTo: '2027-05-31', cost: 240, budget: [{ year: 1, amount: 240, article: '03583' }] };
const free = { id: 's2', name: 'Χωρίς άρθρο', dateFrom: '2026-02-01', dateTo: '2027-01-31', cost: 99, budget: [] };
const B = api.bdBuild(arts, [sw, free], [contract]);
t('one row per record per article', () => {
  assert.strictEqual(B.byArt['03461'].length, 1); assert.strictEqual(B.byArt['07651'].length, 1); assert.strictEqual(B.byArt['03583'].length, 1); assert.strictEqual(B.byArt[''].length, 1);
});
t('contract, NAI article across two contract years: 2026=100, 2027=1100+50, 2028=550', () => {
  const r = B.byArt['03461'][0]; assert.deepStrictEqual(r.by, { 2026: 100, 2027: 1150, 2028: 550 });
});
t('contract, OXI article: whole amount in the start year of the contract year (2026)', () => { assert.deepStrictEqual(B.byArt['07651'][0].by, { 2026: 500 }); });
t('software NAI: 240 over Jun26-May27 -> 7/12 in 2026 (140), 5/12 in 2027 (100)', () => { assert.deepStrictEqual(B.byArt['03583'][0].by, { 2026: 140, 2027: 100 }); });
t('no article -> "Χωρίς άρθρο" group in the start year', () => { assert.deepStrictEqual(B.byArt[''][0].by, { 2026: 99 }); });
t('descriptions and calculation text', () => {
  const r = B.byArt['03461'][0];
  assert.strictEqual(r.desc, 'Συντήρηση Συστημάτων');
  const how = r.how.join('\n'); assert(how.includes('ΔΙΑΓ 12/2026')); assert(how.includes('24 μήνες')); assert(how.includes('01/12/2026 – 30/11/2028'));
  assert(how.includes('1.200,00 €')); assert(how.includes('κατανομή ανά μήνα'));
  assert(B.byArt['03583'][0].how.join('\n').includes('Ανανέωση: 01/06/2026 – 31/05/2027'));
  assert.strictEqual(B.byArt['03583'][0].desc, 'Software X');
});
t('year range and totals', () => {
  assert.deepStrictEqual(B.years, [2026, 2027, 2028]);
  const all = [].concat(...Object.values(B.byArt)); assert.deepStrictEqual(api.bdTotals(all, B.years), [100 + 500 + 140 + 99, 1150 + 100, 550]);
});
t('grand total equals the sum of all entered amounts (nothing lost)', () => {
  const all = [].concat(...Object.values(B.byArt)); const tot = api.bdTotals(all, B.years).reduce((a, b) => a + b, 0);
  assert.strictEqual(Math.round(tot * 100) / 100, 1200 + 500 + 600 + 240 + 99);
});
t('unknown article is reported, amount kept (no article group)', () => {
  const x = api.bdBuild(arts, [{ id: 'z', name: 'Z', dateFrom: '2026-01-01', dateTo: '2026-12-31', cost: 50, budget: [{ year: 1, amount: 50, article: 'ΑΓΝΩΣΤΟ' }] }], []);
  assert.strictEqual(x.byArt[''].length, 1); assert(x.byArt[''][0].how.join('').includes('δεν υπάρχει στη λίστα'));
});
t('record without a start date is reported, not silently dropped', () => {
  const x = api.bdBuild(arts, [{ id: 'z', name: 'Z', dateFrom: '', dateTo: '', cost: 50, budget: [] }], []); assert.strictEqual(x.warn.length, 1);
});
const tn = (id, status, extra) => Object.assign({ id, title: 'Διαγωνισμός ' + id, tender: 'Δ/' + id, months: 24, dateFrom: '2027-01-01', dateTo: '2028-12-31', status,
  years: [{ from: '2027-01-01', to: '2027-12-31', cost: 1000 }, { from: '2028-01-01', to: '2028-12-31', cost: 700 }],
  budget: [{ year: 1, amount: 1000, article: '03461' }, { year: 2, amount: 700, article: '03461' }] }, extra || {});
t('only ACTIVE tenders are budgeted (cancelled and promoted are left out)', () => {
  const all = [tn('a', 'active'), tn('b', 'cancelled'), tn('c', 'promoted'), tn('d', undefined)];
  const list = all.filter(api.tnActive); assert.deepStrictEqual(list.map(x => x.id), ['a', 'd']);
  const B = api.bdBuild(arts, [], [], list); const rows = B.byArt['03461'];
  assert.strictEqual(rows.length, 2); assert(rows.every(r => r.kind === 'tn'));
  const tot = api.bdTotals(rows, B.years).reduce((x, y) => x + y, 0); assert.strictEqual(tot, 2 * 1700);
});
t('tender row describes the estimated tender and period', () => {
  const B = api.bdBuild(arts, [], [], [tn('a', 'active')]); const r = B.byArt['03461'][0];
  assert.strictEqual(r.desc, 'Διαγωνισμός a'); assert(r.how[0].includes('Εκτιμώμενος διαγωνισμός: Δ/a')); assert(r.how[1].includes('01/01/2027 – 31/12/2028'));
});
t('tender amounts follow the same split rule as contracts (ΝΑΙ spread by month, ΌΧΙ start year)', () => {
  const spl = { ...arts.find(a => a.code === '03461'), code: 'SPL', split: true }, one = { ...spl, code: 'ONE', split: false };
  const mk = c => tn('m', 'active', { months: 12, dateFrom: '2027-04-01', dateTo: '2028-03-31', years: [{ from: '2027-04-01', to: '2028-03-31', cost: 1200 }], budget: [{ year: 1, amount: 1200, article: c }] });
  const a = api.bdBuild([spl, one], [], [], [mk('SPL')]).byArt['SPL'][0].by, b = api.bdBuild([spl, one], [], [], [mk('ONE')]).byArt['ONE'][0].by;
  assert.deepStrictEqual(a, { 2027: 900, 2028: 300 }); assert.deepStrictEqual(b, { 2027: 1200 });
});
t('a tender without partial amounts uses its year cost; with the contract it created there is no double count', () => {
  const noParts = tn('n', 'active', { budget: [] });
  const B1 = api.bdBuild(arts, [], [], [noParts]); const r1 = [].concat(...Object.values(B1.byArt)); assert.strictEqual(r1.length, 1); assert.strictEqual(api.bdTotals(r1, B1.years).reduce((x, y) => x + y, 0), 1700);
  const promoted = tn('p', 'promoted'), contract = { id: 'k', title: 'K', tender: 'Δ/p', months: 24, dateFrom: '2027-01-01', dateTo: '2028-12-31', years: promoted.years, budget: promoted.budget };
  const B2 = api.bdBuild(arts, [], [contract], [promoted].filter(api.tnActive)); const tot = api.bdTotals([].concat(...Object.values(B2.byArt)), B2.years).reduce((x, y) => x + y, 0);
  assert.strictEqual(tot, 1700);
});
t('Greek money format', () => { assert.strictEqual(api.bdEur(1100), '1.100,00 €'); assert.strictEqual(api.bdEur(0.5), '0,50 €'); });
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
