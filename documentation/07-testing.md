# Testing
Tests live in `/tests/integration` and run against a real WordPress (we used 7.1.4 on SQLite via the official sqlite-database-integration drop-in; MySQL/MariaDB is the production target and has not been tested here).

```
php tests/integration/milestones-test.php http://127.0.0.1:8088          # milestones (HTTP)
php tests/integration/cron-milestones-test.php /path/to/wp-load.php     # milestone reminder selection
php tests/integration/emails-migration-test.php /path/to/wp-load.php    # password clean-up, e-mail validation and routing
php tests/integration/engine-service-test.php /path/to/wp-load.php    # engine, service, store, logging
php tests/integration/rest-permissions-test.php http://127.0.0.1:8088   # HTTP: anonymous, CSRF, roles, export, uploads
```
The REST test expects users `admin` (Super Admin), `viewer1`, `editor1`, `manager1`, `nobody` (password `Pw-<login>-12345!`).
See the root README for what is and is not verified.

Note: the REST tests deliberately provoke denied requests; running them repeatedly within 5 minutes can trigger the temporary block (HTTP 429) for the test users. Wait 5 minutes between runs.


Budget breakdown: `php tests/integration/budget-test.php <base-url>` (HTTP; needs `RL_TEST_ADMIN_PASS`).

Unit tests (Node, no WordPress needed): `node tests/unit/budget-calc-test.js` (budget calculation) and `node tests/unit/budget-export-test.js` (structure of the Excel export against a SheetJS stub). `php tests/integration/articles-test.php <wp-load.php>` checks the article list.

WordPress UI in a real browser: `RL_URL=… RL_PAGE=/page-with-shortcode/ RL_USER=… RL_PASS=… node tests/browser/wp-ui-test.js` (needs Playwright). It checks that the page does not freeze and the tabs respond; run it for an admin and for a restricted user (e.g. viewer1).

Trash: `php tests/integration/trash-test.php <base-url> <wp-load.php>` (HTTP, needs `RL_TEST_ADMIN_PASS`), `php tests/integration/trash-cron-test.php <wp-load.php>` (auto-purge, retention, reminders), `node tests/browser/wp-trash-test.js` (real browser; run as admin, as a user with delete but no purge, and as a viewer).

Tenders: `php tests/integration/tenders-test.php <base-url>` (HTTP; needs `RL_TEST_ADMIN_PASS`). Real browser: `node tests/browser/wp-tenders-test.js` (WordPress, needs `RL_PASS`) and `node tests/browser/html-tenders-test.js path/to/index.html` (standalone HTML and Windows builds). The Claude artifact build needs the Claude host and was only syntax-checked.
