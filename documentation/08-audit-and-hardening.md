# Audit trail and hardening (3.14.0)

Everything here is **optional and off by default** except what is marked "always". Nothing changes for an install that does not use it.

## 1. Tamper-evident activity log

Application Management (1.3.1+) fires `do_action( 'am_log_written', $row, $log_id )` after every activity-log row is written. PROCURE360 listens to it (`includes/class-rl-audit.php`, class `RL_Audit_Chain`):

* **Chain.** Every row gets an entry in `{prefix}rl_audit_chain` with `row_hash = HMAC-SHA256( previous_hash | canonical(row) )`. Changing, deleting or inserting a log row, or removing a chain entry, breaks the chain.
* **Key.** The key is **not** in the database. Add to `wp-config.php` (64+ random hex characters; keep a copy in the offline vault):
  ```php
  define( 'RL_AUDIT_KEY', '…64 hex characters…' );
  ```
  Without the key (or shorter than 32 characters) the chain is not written and verification reports that nothing can be verified. Anyone who can edit `wp-config.php` can also forge the chain, so the key protects against database-only attackers (SQL injection, a DBA, a stolen dump), not against a root compromise of the web server.
* **Concurrency.** Two writers that read the same tail collide on `UNIQUE(prev_hash)`; the loser retries up to 8 times.
* **Syslog copy.** Each row is also sent to syslog (`procure360`, facility `LOG_LOCAL6`, JSON), also when no key is defined. Point rsyslog / the SIEM agent at it so a copy exists outside the database and the web server's database user.
* **Verify.** `wp procure360 audit-verify [--from=<chain id>]` re-computes the chain and lists problems (modified row, deleted row, broken link, row without a chain entry). Exit status is non-zero when it fails, so it can run from cron and alert.

### Retention
Application Management prunes old log rows (default 365 days). A pruned row is reported as "missing". Either set the retention to 0 (keep forever) or archive the chain and verify with `--from=<id of the first entry you kept>`.

### Append-only database user (not shipped, not tested)
For a stronger guarantee the MySQL account used by WordPress should not be able to `UPDATE`/`DELETE` on `{prefix}rl_audit_chain` and `{prefix}am_logs`, or those tables should have `BEFORE UPDATE/DELETE` triggers that raise an error (the pruning job then needs a separate maintenance account). This is a database-administrator task; it was **not** tested here.

## 2. What is logged

| Action | When | Details |
|---|---|---|
| `ledger.record_edit` | a record is saved | `id`, `title`, `changes`: per changed field `[old, new]` (values cut at 120 chars); lists show counts and a 12-char fingerprint; `username`, `password`, e-mail fields only say `"changed"`; `createdAt/updatedAt` ignored. If it would not fit the 4000-char log column only the field names are kept. |
| `ledger.record_create` | a record is created | `id`, `title` (no field dump) |
| `ledger.file_download` | an attachment is opened or downloaded | file name, id, collection |
| `ledger.file_rejected` | an upload is refused by the content check | file name, reason code |
| `ledger.access_denied` | a request to `/rl/v1/*` ends in 401, 403 or 429 | normalised route (record and file ids replaced by `{id}`), method, status. At most once a minute per user, route, method and status. |

## 3. Uploads
* **Content check (always).** Files with a fixed signature (pdf, png, jpg/jpeg, gif, bmp, docx, xlsx, pptx, odt, ods, odp, zip, 7z, rar, gz, rtf) must really start like that format. Windows/Linux/macOS programs, `#!` scripts and `<?php` are refused whatever the extension (`415 rl_bad_content`). Other types (txt, csv, xml, html, legacy doc/xls/ppt …) are only checked for these program signatures. The check looks at the first bytes only: it is a guard against renamed files, not a malware scanner.
* **Optional antivirus.** `define( 'RL_CLAMSCAN_BIN', '/usr/bin/clamdscan' );` (or `clamscan`). The file is scanned before it is stored: exit 0 clean, 1 infected (`422 rl_infected`), anything else or a missing binary → refused (`503 rl_av_unavailable`, fail closed). `define( 'RL_CLAMSCAN_FAIL_OPEN', true );` accepts the file when the scanner itself fails. The `rl_av_scan` filter (`apply_filters( 'rl_av_scan', null, $tmp_path )`, return `true` or `WP_Error`) replaces the scanner. The scanner path was tested with stand-in scripts that return each exit code, **not with a real ClamAV**.
* **Files outside the web root.** `define( 'RL_FILES_DIR', '/var/procure360/files' );` or the `rl_files_dir` filter. The folder must exist (or be creatable) and be writable by the web server. Existing attachments are **not moved automatically**: copy `wp-content/uploads/renewal-ledger/*` there first, then set the constant.

## 4. Settings permission
New module **PROCURE360 Settings** in Application Management with the action `manage_settings`. Anyone with it (Administrator and Super Admin by default) may use the Settings tab, change settings and the backup schedule, without being a WordPress administrator. WordPress administrators (`manage_options`) keep access as before. The WordPress admin screen under *PROCURE360 → Ρυθμίσεις* still needs `manage_options`.

## 5. SheetJS
SheetJS 0.20.3 is bundled (`assets/vendor/xlsx.full.min.js`, Apache-2.0, hashes in `assets/vendor/README.txt`) and loaded with a Subresource-Integrity hash. No CDN is contacted by the WordPress plugin, the standalone HTML or the Windows build.

## 6. Tests
`php tests/integration/audit-test.php <base-url> <wp-load.php>` (needs `RL_TEST_ADMIN_PASS` and `RL_AUDIT_KEY` defined in the test site): chain detects modify / delete / insert / link break, field diff, download and denied logging (with the once-a-minute rule), upload guard, antivirus exit codes, files folder, `manage_settings`. Tested on WordPress with SQLite, not on MySQL.
