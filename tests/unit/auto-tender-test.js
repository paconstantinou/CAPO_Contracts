/* Unit test: automatic tenders (atPlan, 3.20.0). Run: node tests/unit/auto-tender-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../application/renewal-ledger/assets/app.js'), 'utf8');
function grab(startRe, endMarker) { const i = src.search(startRe); const j = src.indexOf(endMarker, i); return src.slice(i, j); }
const code = [
  'function r2(x){return Math.round((Number(x)||0)*100)/100}', 'function defRemind(){return 30}', 'function pad(n){return (n<10?"0":"")+n}', 'function exOk(e){return e&&isFinite(Number(e.amount))}',
  grab(/function iso\(/, '\n'), grab(/function parseIso/, '\n'), grab(/function addDays/, '\n'),
  grab(/function addMonths/, '\n'), grab(/function ctEnd/, '\n'), grab(/function buildYears/, '\nfunction ctTotal'),

  grab(/function exSum/, '\n'), grab(/function ctTotal/, '\n'), grab(/\/\*AT-CALC-START\*\//, '/*AT-CALC-END*/'),
].join('\n');
const api = new Function(code + '\nreturn {atPlan,atDue};')();
let bad = 0; const t = (n, f) => { try { f(); console.log('  ok   ' + n) } catch (e) { bad++; console.log('  FAIL ' + n + '\n       ' + e.message) } };
const C = (id, to, months, cost, extra) => Object.assign({ id, title: 'Σ' + id, description: 'D' + id, months, dateFrom: '2024-01-01', dateTo: to, cost, extras: [], years: [{ from: '2024-01-01', to: '2024-12-31', cost: cost / 2 }, { from: '2025-01-01', to: '2025-12-31', cost: cost / 2 }], budget: [] }, extra || {});
t('due only on / after 5 January', () => { assert(!api.atDue('2027-01-04')); assert(api.atDue('2027-01-05')); assert(api.atDue('2027-06-01')) });
const plan = api.atPlan([C('a', '2027-12-31', 24, 1000), C('b', '2029-12-31', 24, 2000), C('c', '2030-12-31', 24, 3000), C('d', '2026-12-31', 24, 4000), C('e', '2028-06-30', 24, 500, { archived: true })], [], '2026-11-20');
t('contracts ending Y+1..Y+3 only (not Y, Y+4, archived)', () => assert.deepStrictEqual(plan.map(p => p.contractId), ['a', 'b']));
t('fields copied / computed', () => {
  const p = plan[0]; assert.strictEqual(p.status, 'pending'); assert.strictEqual(p.title, 'Σa'); assert.strictEqual(p.description, 'Da'); assert.strictEqual(p.months, 24);
  assert.strictEqual(p.dateFrom, '2028-01-01'); assert.strictEqual(p.dateTo, '2029-12-31'); assert.strictEqual(p.cost, 1100); assert.strictEqual(p.autoCreated, true);
});
t('cost is increased by 10% by default (100,000 -> 110,000)', () => { const q = api.atPlan([C('x', '2027-12-31', 24, 100000)], [], '2026-11-20'); assert.strictEqual(q[0].cost, 110000); assert.strictEqual(q[0].years[0].cost, 55000) });
t('extras included in the base', () => { const q = api.atPlan([C('x', '2027-12-31', 24, 1000, { extras: [{ amount: 100 }] })], [], '2026-11-20'); assert.strictEqual(q[0].cost, 1320) });
t('percentage from the settings (25% -> 125,000; 0% -> unchanged)', () => { assert.strictEqual(api.atPlan([C('x', '2027-12-31', 24, 100000)], [], '2026-11-20', 25)[0].cost, 125000); assert.strictEqual(api.atPlan([C('x', '2027-12-31', 24, 100000)], [], '2026-11-20', 0)[0].cost, 100000) });
t('budget lines are increased too', () => { const q = api.atPlan([C('x', '2027-12-31', 24, 100000, { budget: [{ year: 1, article: 'A1', amount: 100000 }] })], [], '2026-11-20', 10); assert.strictEqual(q[0].budget[0].amount, 110000); assert.strictEqual(q[0].years[0].cost, 110000) });
t('idempotent: contract with linked tender skipped', () => assert.strictEqual(api.atPlan([C('a', '2027-12-31', 24, 1000)], [{ contractId: 'a' }], '2026-11-20').length, 0));
process.exit(bad ? 1 : 0);
