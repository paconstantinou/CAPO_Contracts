/* Unit test: the Πλαίσιο Συμφιλίωσης table (rcBuild / rcRows / rcCells, 3.19.0) of application/renewal-ledger/assets/app.js.
   Run: node tests/unit/rc-frame-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../application/renewal-ledger/assets/app.js'), 'utf8');
function grab(startRe, endMarker) { const i = src.search(startRe); const j = src.indexOf(endMarker, i); return src.slice(i, j); }
const code = [
  grab(/var DEFAULT_ARTICLES=/, 'function articles()'), grab(/function artFind/, 'function artLabel'),
  'function r2(x){return Math.round((Number(x)||0)*100)/100}',
  grab(/\/\*BD-CALC-START\*\//, '/*BD-CALC-END*/'), grab(/\/\*RC-CALC-START\*\//, '/*RC-CALC-END*/'), grab(/\/\*RC2-CALC-START\*\//, '/*RC2-CALC-END*/'),
  'function bdVat(){return BD_VAT}', grab(/function exOk/, 'function exText'), grab(/function pvArtText/, '\n').replace('articles()', 'DEFAULT_ARTICLES'),
].join('\n');
const api = new Function(code + '\nreturn {DEFAULT_ARTICLES,rcBuild,rcCells,rcHeads,RC_LBL};')();
let ok = 0, bad = 0;
function t(name, fn) { try { fn(); ok++; console.log('  ok   ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const arts = api.DEFAULT_ARTICLES, A1 = arts[0].code, A2 = arts[1].code, Y = 2026;
const yrs = (from, n, cost, art) => { const ys = [], bud = []; for (let i = 0; i < n; i++) { ys.push({ from: (from + i) + '-01-01', to: (from + i) + '-12-31', cost }); bud.push({ year: i + 1, article: art, amount: cost }) } return { years: ys, budget: bud } };
const tender = (id, cost, from, n, art, extra) => Object.assign({ id, title: 'Δ' + id, tender: 'T' + id, description: 'Περιγραφή ' + id, months: n * 12, dateFrom: from + '-01-01', dateTo: (from + n - 1) + '-12-31', cost: cost * n, status: 'active', promotedTo: '' }, yrs(from, n, cost, art), extra || {});
const contract = (id, cost, from, n, art, extra) => Object.assign({ id, title: 'Σ' + id, tender: 'T' + id, description: 'Συμβ ' + id, months: n * 12, dateFrom: from + '-01-01', dateTo: (from + n - 1) + '-12-31', cost: cost * n, extras: [], amendments: [] }, yrs(from, n, cost, art), extra || {});
const build = (T, C, P) => api.rcBuild(arts, T, C, P || [], Y, null, 0);

t('headers carry the real years and the 13 template columns', () => {
  const h = api.rcHeads(Y); assert.strictEqual(h.length, 13);
  assert.ok(h[2].includes('2026') && h[3].includes('2027') && h[6].includes('2028') && h[9].includes('2029') && h[11].includes('2029'));
  assert.ok(!h.join('').includes('[τρέχων'));
});
t('A: an active tender gives one row per article, chapter blank, amounts per year, change 0', () => {
  const tn = tender('1', 1000, 2026, 4, A1); tn.budget[1].article = A2; // year 2 on another article
  const B = build([tn], []); const rows = B.rows;
  assert.strictEqual(rows.length, 2); assert.deepStrictEqual(rows.map(r => r.code).sort(), [A1, A2].sort());
  const r1 = rows.find(r => r.code === A1), c = api.rcCells(r1);
  assert.strictEqual(c.length, 13); assert.strictEqual(c[0], ''); assert.strictEqual(c[1], A1);
  assert.strictEqual(c[2], 1000); assert.strictEqual(c[3], 0); assert.strictEqual(c[4], 0); assert.strictEqual(c[5], 0); // Y+1 is on A2
  assert.strictEqual(c[6], 1000); assert.strictEqual(c[7], 0); assert.strictEqual(c[8], 1000); assert.strictEqual(c[9], 1000); assert.strictEqual(c[11], 1000);
  const r2_ = rows.find(r => r.code === A2); assert.strictEqual(api.rcCells(r2_)[3], 1000); assert.strictEqual(api.rcCells(r2_)[5], 1000);
  assert.ok(r1.expl.join('\n').includes('Περιγραφή 1') && r1.expl.join('\n').includes('48 μήνες') && r1.expl.join('\n').includes('01/01/2026'));
});
t('cancelled and promoted tenders have no row of their own', () => {
  const T = [Object.assign(tender('1', 100, 2026, 2, A1), { status: 'cancelled' }), Object.assign(tender('2', 100, 2026, 2, A1), { status: 'promoted', promotedTo: 'c2' })];
  assert.strictEqual(build(T, [contract('c2', 100, 2026, 2, A1)]).rows.length, 0);
});
t('B: contract from a tender, cost changed by more than 4,999: base = tender, change = difference, revised = contract', () => {
  const tn = Object.assign(tender('2', 10000, 2026, 3, A1), { status: 'promoted', promotedTo: 'c2' }), c = contract('c2', 14000, 2026, 3, A1);
  const rows = build([tn], [c]).rows.filter(r => r.kind === 'dv'); assert.strictEqual(rows.length, 1);
  const x = api.rcCells(rows[0]);
  assert.strictEqual(x[2], 10000); assert.strictEqual(x[3], 10000); assert.strictEqual(x[4], 4000); assert.strictEqual(x[5], 14000);
  assert.strictEqual(x[6], 10000); assert.strictEqual(x[7], 4000); assert.strictEqual(x[8], 14000); assert.strictEqual(x[9], 0); assert.strictEqual(x[10], 0 + 0); assert.strictEqual(x[11], 0);
  assert.ok(x[12].includes('Αριθμός Διαγωνισμού: Tc2') || x[12].includes('Αριθμός Διαγωνισμού: T'));
});
t('B: total cost 3 x 1,666 = 4,998 difference is NOT reported (limit 4,999)', () => {
  const tn = Object.assign(tender('2', 10000, 2026, 3, A1), { status: 'promoted', promotedTo: 'c2' });
  assert.strictEqual(build([tn], [contract('c2', 10000 + 1666, 2026, 3, A1)]).rows.length, 0);
});
t('B: a decrease also counts; article moved between tender and contract gives two rows with opposite changes', () => {
  const tn = Object.assign(tender('2', 10000, 2027, 2, A1), { status: 'promoted', promotedTo: 'c2' }), c = contract('c2', 4000, 2027, 2, A2);
  const rows = build([tn], [c]).rows; assert.strictEqual(rows.length, 2);
  const a = rows.find(r => r.code === A1), b = rows.find(r => r.code === A2);
  assert.deepStrictEqual([api.rcCells(a)[3], api.rcCells(a)[4], api.rcCells(a)[5]], [10000, -10000, 0]);
  assert.deepStrictEqual([api.rcCells(b)[3], api.rcCells(b)[4], api.rcCells(b)[5]], [0, 4000, 4000]);
});
t('C: amended contract: base = state before the first amendment', () => {
  const c = contract('c3', 2000, 2026, 3, A1);
  const before = { cost: 6000, years: c.years.map(y => Object.assign({}, y)), budget: c.budget.map(b => Object.assign({}, b)), extras: [], dateFrom: c.dateFrom, dateTo: c.dateTo, months: 36, title: c.title, tender: c.tender };
  c.cost = 9000; c.years = c.years.map(y => Object.assign({}, y, { cost: 3000 })); c.budget = c.budget.map(b => Object.assign({}, b, { amount: 3000 }));
  c.amendments = [{ id: 'a1', costBefore: 6000, costAfter: 9000, before }];
  const rows = build([], [c]).rows.filter(r => r.kind === 'am'); assert.strictEqual(rows.length, 1);
  const x = api.rcCells(rows[0]); assert.deepStrictEqual(x.slice(2, 12), [2000, 2000, 1000, 3000, 2000, 1000, 3000, 0, 0, 0]);
  assert.ok(x[12].includes('Τροποποιήσεις: 1'));
});
t('C: amendment that did not change the cost gives no row', () => {
  const c = contract('c4', 2000, 2026, 3, A1); c.amendments = [{ id: 'a1', costBefore: 6000, costAfter: 6000, before: {} }];
  assert.strictEqual(build([], [c]).rows.length, 0);
});
t('D: contract with the selection: amounts are the base, change 0; extras are included', () => {
  const c = contract('c5', 1000, 2026, 2, A1, { rcInclude: true, extras: [{ desc: 'Extra', amount: 100, article: A1 }] });
  const rows = build([], [c]).rows; assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].kind, 'inc');
  const x = api.rcCells(rows[0]); assert.deepStrictEqual(x.slice(2, 8), [1100, 1100, 0, 1100, 0, 0]);
  assert.strictEqual(build([], [contract('c6', 1000, 2026, 2, A1)]).rows.length, 0);
});
t('E: general provisions with the selection: base = amount, explanation has description, article and notes', () => {
  const p = { id: 'p1', title: 'Πρόνοια', article: A1, notes: 'Σημ', baseYear: 2026, amounts: [{ year: 2027, amount: 500 }, { year: 2028, amount: 700 }], rcInclude: true };
  const rows = build([], [], [p, Object.assign({}, p, { id: 'p2', rcInclude: false })]).rows; assert.strictEqual(rows.length, 1);
  const x = api.rcCells(rows[0]); assert.deepStrictEqual(x.slice(2, 12), [0, 500, 0, 500, 700, 0, 700, 0, 0, 0]);
  assert.ok(x[12].includes('Περιγραφή: Πρόνοια') && x[12].includes('Σημειώσεις: Σημ') && x[12].includes(A1));
});
t('amounts include VAT when a rate is given; years before Y and after Y+3 are left out', () => {
  const tn = tender('9', 1000, 2024, 8, A1); // 2024..2031
  const B = api.rcBuild(arts, [tn], [], [], Y, null, 0.19), x = api.rcCells(B.rows[0]);
  assert.deepStrictEqual(x.slice(2, 12), [1190, 1190, 0, 1190, 1190, 0, 1190, 1190, 0, 1190]);
});
t('rows sorted by group A..E, then title; amounts below one cent do not create rows', () => {
  const T = [tender('2', 100, 2026, 1, A1), tender('1', 100, 2026, 1, A1)], c = contract('c7', 100, 2026, 1, A1, { rcInclude: true });
  const rows = build(T, [c]).rows; assert.deepStrictEqual(rows.map(r => r.kind + r.title), ['tnΔ1', 'tnΔ2', 'incΣc7']);
  assert.strictEqual(build([tender('3', 0, 2026, 1, A1)], []).rows.length, 0);
});
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
