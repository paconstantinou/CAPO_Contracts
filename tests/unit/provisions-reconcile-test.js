/* Unit test: general provisions in the budget (bdBuild) and the reconciliation sets (rcSets) of application/renewal-ledger/assets/app.js.
   Run: node tests/unit/provisions-reconcile-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../application/renewal-ledger/assets/app.js'), 'utf8');
function grab(startRe, endMarker) { const i = src.search(startRe); const j = src.indexOf(endMarker, i); return src.slice(i, j); }
const code = [
  grab(/var DEFAULT_ARTICLES=/, 'function articles()'), grab(/function artFind/, 'function artLabel'),
  'function r2(x){return Math.round((Number(x)||0)*100)/100}',
  grab(/\/\*BD-CALC-START\*\//, '/*BD-CALC-END*/'), grab(/\/\*RC-CALC-START\*\//, '/*RC-CALC-END*/'),
  'function bdVat(){return BD_VAT}', grab(/function exOk/, 'function exText'),
].join('\n');
const api = new Function(code + '\nreturn {DEFAULT_ARTICLES,bdBuild,bdTotals,rcSets,ctTotal,RC_THR};')();
let ok = 0, bad = 0;
function t(name, fn) { try { fn(); ok++; console.log('  ok   ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const arts = api.DEFAULT_ARTICLES, code1 = arts[0].code;
const prov = { id: 'p1', title: 'Πρόνοια Α', article: code1, baseYear: 2026, amounts: [{ year: 2027, amount: 1000 }, { year: 2028, amount: '' }, { year: 2029, amount: 500 }] };

t('provision amounts land in their own calendar years, with VAT', () => {
  const B = api.bdBuild(arts, [], [], [], 0.19, [prov]), rows = B.byArt[code1];
  assert.ok(rows && rows.length === 1 && rows[0].kind === 'pv');
  assert.strictEqual(rows[0].by[2027], 1190); assert.strictEqual(rows[0].by[2029], 595); assert.strictEqual(rows[0].by[2028], undefined);
  assert.deepStrictEqual(B.years, [2027, 2028, 2029]);
});
t('a year outside base+1..base+3 is ignored', () => {
  const B = api.bdBuild(arts, [], [], [], 0, [{ id: 'p2', title: 'X', article: code1, baseYear: 2026, amounts: [{ year: 2026, amount: 9 }, { year: 2030, amount: 9 }, { year: 2027, amount: 5 }] }]);
  assert.deepStrictEqual(Object.keys(B.byArt[code1][0].by), ['2027']);
});
t('no provisions: same result as before', () => { const B = api.bdBuild(arts, [], [], [], 0); assert.strictEqual(B.years.length, 0); });
t('provisions with an unknown article go to "no article"', () => {
  const B = api.bdBuild(arts, [], [], [], 0, [{ id: 'p3', title: 'Y', article: 'zzz', baseYear: 2026, amounts: [{ year: 2027, amount: 7 }] }]);
  assert.ok(B.byArt['']);
});

const mk = (id, cost) => ({ id, title: 'C' + id, tender: 'T' + id, cost, years: [{ cost }], extras: [] });
const tn = (id, cost, to) => ({ id: 't' + id, title: 'Δ' + id, tender: 'T' + id, cost, status: to ? 'promoted' : 'active', promotedTo: to || '' });
t('deviation exactly 20% is NOT reported; just above is (up and down)', () => {
  const R = api.rcSets([tn('1', 100, 'c1'), tn('2', 100, 'c2'), tn('3', 100, 'c3'), tn('4', 100, 'c4')], [mk('c1', 120), mk('c2', 120.01), mk('c3', 79), mk('c4', 80)]);
  assert.deepStrictEqual(R.dev.map(d => d.c.id).sort(), ['c2', 'c3']);
  assert.strictEqual(R.dev.find(d => d.c.id === 'c2').pct, 20.01); assert.strictEqual(R.dev.find(d => d.c.id === 'c3').diff, -21);
});
t('contract cost includes the extra services', () => {
  const c = mk('c1', 100); c.extras = [{ desc: 'x', amount: 30 }];
  const R = api.rcSets([tn('1', 100, 'c1')], [c]); assert.strictEqual(R.dev.length, 1); assert.strictEqual(R.dev[0].cur, 130);
});
t('contracts without a tender, or with a zero-cost tender, never deviate', () => {
  const R = api.rcSets([tn('1', 0, 'c1')], [mk('c1', 500), mk('c2', 500)]); assert.strictEqual(R.dev.length, 0);
});
t('all tenders are listed (any status)', () => { const R = api.rcSets([tn('1', 1), tn('2', 2, 'c9')], []); assert.strictEqual(R.tenders.length, 2); });
t('amended contracts: only those where an amendment changed the cost; original = cost before the first amendment', () => {
  const a = mk('c1', 150); a.amendments = [{ costBefore: 100, costAfter: 120, description: 'ΤΕΑΑ' }, { costBefore: 120, costAfter: 150, description: 'ΚΕΑΑ' }];
  const b = mk('c2', 100); b.amendments = [{ costBefore: 100, costAfter: 100, description: 'Παράταση' }];
  const R = api.rcSets([], [a, b, mk('c3', 5)]);
  assert.strictEqual(R.amd.length, 1); assert.strictEqual(R.amd[0].base, 100); assert.strictEqual(R.amd[0].cur, 150); assert.strictEqual(R.amd[0].diff, 50); assert.strictEqual(R.amd[0].pct, 50); assert.strictEqual(R.amd[0].n, 2);
});
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
