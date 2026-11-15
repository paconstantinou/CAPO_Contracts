# Troubleshooting
* **"You do not have permission" / 403 for everyone** – give the user access and a role in Users & Access; check the module is enabled in Module Management; check Activity Logs for `access.denied` and its reason.
* **Page says no access** – the user needs `view` on at least one module.
* **Blocked for a few minutes (429)** – too many denied requests; wait 5 minutes or raise the threshold in Settings.
* **No Super Admin exists** (e.g. the only one was deleted from WordPress) – a WordPress administrator opens Application Management → Settings → *Recover Super Admin access* and ticks the confirmation. This only works when no Super Admin exists, and it is logged.
* **No .xlsx** – the PHP `zip` extension is missing; export falls back to CSV.
* **Excel import button missing library message** – the SheetJS library is bundled (`assets/vendor/xlsx.full.min.js`, loaded with an SRI hash). If the message appears, the file is missing or was modified (the browser refuses a file whose hash differs from `renewal-ledger.php`); reinstall the plugin zip.
* **No reminder e-mails** – check recipients, `wp_mail` SMTP setup and that WP-Cron runs; use *Send now* in Settings → PROCURE360.
* **Attachment 404** – the file record was removed or the uploads folder was moved.
