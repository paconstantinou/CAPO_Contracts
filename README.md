# CAPO Contracts – Renewal Ledger + Application Management

Tracker for online software renewals (English) and contracts (Greek, per-year breakdown and reminders), running inside WordPress with central, server-enforced users, roles and permissions.

```
/application
    renewal-ledger/      WordPress plugin: the app (v2.1.0)
    standalone/          GitHub Pages / Windows / Claude-artifact copies – local, single user, NO roles
/wordpress-plugin
    application-management/   WordPress plugin: users, roles, permissions, modules, activity logs (v1.0.0)
/documentation           installation, configuration, integration, permissions, API, troubleshooting, testing
/tests/integration       automated tests (run against a real WordPress)
/dist                    installable plugin ZIPs
index.html               GitHub Pages entry (copy of application/standalone/index.html)
```

## Quick start
1. Install `dist/application-management-1.0.0.zip`, then `dist/renewal-ledger-2.1.0.zip` (Plugins → Add New → Upload) and activate both. The admin who activates Application Management becomes the first Super Admin.
2. Add `[renewal_ledger]` to a private page.
3. Application Management → Users & Access: enable users and assign roles.
Details: `documentation/`.

## Security model
SSO = the normal WordPress session (cookie + `X-WP-Nonce`); no passwords are exchanged. Every REST route asks Application Management; deny by default; users cannot edit their own access; a WP administrator is not automatically an app Super Admin; inputs are whitelisted and sanitised; wpdb prepared statements; rate limiting and temporary blocking; everything logged; passwords encrypted at rest (AES-256-GCM) and only visible with the *Credentials* permission; CSV formula-injection guard; uploads allow-listed and served only through permission-checked endpoints.

## What has and has not been verified
Verified by automated tests (WordPress 7.1.4, PHP CLI, **SQLite** test database): 35 engine/service/store checks, 61 HTTP checks (anonymous access, missing nonce, each role on every endpoint, credential hiding/preservation, exports, uploads, input validation) and, for milestones, 18 HTTP checks plus 7 reminder-selection checks.
**Not verified:** the milestone screens in a browser (the JavaScript passes a syntax check and the server side is tested, but the on-screen flow was not clicked through); MySQL/MariaDB (only SQLite was available), multisite, the admin screens' POST forms with real nonces in a browser, the front-end permission hiding in a browser, reminder e-mail delivery, uninstall, other PHP versions. The standalone builds were not changed in this work. GitHub Pages must be enabled manually (Settings → Pages → `main`, `/`).
