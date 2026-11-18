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
const api = new Function(code + '\nreturn {DEFAULT_ARTICLES,bdBuild,bdTotals,rcSets,ctTotal,RC_LIMIT};')();
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
t('limit: exactly 4,999 EUR is NOT reported; 4,999.01 is (up and down)', () => {
  const R = api.rcSets([tn('1', 10000, 'c1'), tn('2', 10000, 'c2'), tn('3', 10000, 'c3'), tn('4', 10000, 'c4')], [mk('c1', 14999), mk('c2', 14999.01), mk('c3', 5000.99), mk('c4', 5001)]);
  assert.deepStrictEqual(R.dev.map(d => d.c.id).sort(), ['c2', 'c3']);
  assert.strictEqual(R.dev.find(d => d.c.id === 'c2').diff, 4999.01); assert.strictEqual(R.dev.find(d => d.c.id === 'c3').diff, -4999.01);
});
t('a small tender with a big percentage change is NOT reported (absolute rule)', () => {
  const R = api.rcSets([tn('1', 100, 'c1')], [mk('c1', 4000)]); assert.strictEqual(R.dev.length, 0);
});
t('contract cost includes the extra services', () => {
  const c = mk('c1', 10000); c.extras = [{ desc: 'x', amount: 6000 }];
  const R = api.rcSets([tn('1', 10000, 'c1')], [c]); assert.strictEqual(R.dev.length, 1); assert.strictEqual(R.dev[0].cur, 16000);
});
t('contracts without a tender never deviate', () => { assert.strictEqual(api.rcSets([], [mk('c1', 50000)]).dev.length, 0); });
t('a zero-cost tender counts as base 0 (any contract above the limit deviates)', () => { assert.strictEqual(api.rcSets([tn('1', 0, 'c1')], [mk('c1', 6000)]).dev.length, 1); });
t('only ACTIVE tenders are listed; promoted/cancelled are not, but promoted ones still drive section B', () => {
  const c = tn('3', 10000); c.status = 'cancelled';
  const R = api.rcSets([tn('1', 1), tn('2', 10000, 'c9'), c], [mk('c9', 20000)]);
  assert.deepStrictEqual(R.tenders.map(t => t.id), ['t1']); assert.strictEqual(R.dev.length, 1);
});
t('manual inclusion: flagged contracts and provisions only', () => {
  const a = mk('c1', 10); a.rcInclude = true; const R = api.rcSets([], [a, mk('c2', 5)], null, [{ id: 'p1', rcInclude: true }, { id: 'p2' }]);
  assert.deepStrictEqual(R.inc.map(x => x.c.id), ['c1']); assert.deepStrictEqual(R.provs.map(p => p.id), ['p1']);
});
t('amended contracts: only those where an amendment changed the cost; original = cost before the first amendment', () => {
  const a = mk('c1', 150); a.amendments = [{ costBefore: 100, costAfter: 120, description: 'ΤΕΑΑ' }, { costBefore: 120, costAfter: 150, description: 'ΚΕΑΑ' }];
  const b = mk('c2', 100); b.amendments = [{ costBefore: 100, costAfter: 100, description: 'Παράταση' }];
  const R = api.rcSets([], [a, b, mk('c3', 5)]);
  assert.strictEqual(R.amd.length, 1); assert.strictEqual(R.amd[0].base, 100); assert.strictEqual(R.amd[0].cur, 150); assert.strictEqual(R.amd[0].diff, 50); assert.strictEqual(R.amd[0].pct, 50); assert.strictEqual(R.amd[0].n, 2);
});
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
