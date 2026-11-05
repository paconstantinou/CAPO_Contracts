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
