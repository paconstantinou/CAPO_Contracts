/* The bundled SheetJS file must match the SRI hash in renewal-ledger.php, the hash in vendor/README.txt, and be identical in the Windows package. Run: node tests/unit/vendor-sri-test.js */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const R = p => path.join(__dirname, '../../application', p);
const lib = fs.readFileSync(R('renewal-ledger/assets/vendor/xlsx.full.min.js'));
const sri = 'sha384-' + crypto.createHash('sha384').update(lib).digest('base64'), sha256 = crypto.createHash('sha256').update(lib).digest('hex');
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ok   ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + ' ' + e.message); } };
t('SRI value in renewal-ledger.php equals the file hash', () => assert(fs.readFileSync(R('renewal-ledger/renewal-ledger.php'), 'utf8').includes('integrity="' + sri + '"')));
t('vendor/README.txt records the same SHA-256 and SHA-384', () => { const r = fs.readFileSync(R('renewal-ledger/assets/vendor/README.txt'), 'utf8'); assert(r.includes(sha256) && r.includes(sri)); });
t('version is 0.20.3', () => assert(/XLSX\.version="0\.20\.3"|version="0\.20\.3"/.test(lib.toString('latin1'))));
t('Windows package ships the identical file', () => assert(lib.equals(fs.readFileSync(R('standalone/windows/RenewalLedger/app/xlsx.full.min.js')))));
t('standalone, Windows and artifact pages load no script from a CDN', () => { for (const p of ['standalone/index.html', 'standalone/windows/RenewalLedger/app/index.html', 'standalone/claude-artifact/renewal-ledger.html']) assert(!/<script[^>]+src="https?:/.test(fs.readFileSync(R(p), 'utf8')), p); });
t('standalone page embeds the same library', () => assert(fs.readFileSync(R('standalone/index.html'), 'utf8').includes(sha256)));
t('plugin does not reference a CDN any more', () => assert(!/cdnjs|unpkg|jsdelivr/.test(fs.readFileSync(R('renewal-ledger/renewal-ledger.php'), 'utf8'))));
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
