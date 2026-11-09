# Configuration

## Application Management → Settings
| Setting | Default | Meaning |
|---|---|---|
| Log retention (days) | 365 | Older log rows are pruned daily; 0 keeps everything |
| Rate limit | 240 / min / user | Authorised requests per user per minute |
| Denied threshold | 30 in 5 min | After this many denied requests the user is blocked for 5 minutes |
| Log IP addresses | off | Store the IP in log rows (privacy: leave off unless needed) |
| Delete data on uninstall | off | Drops the `am_*` tables when the plugin is deleted |

## PROCURE360 → Ρυθμίσεις (WordPress admin menu «PROCURE360»; Application Management is a second entry under the same menu)
Default reminder recipients (comma separated, default: site admin e-mail) and repeat interval in days. A record's own *Notification emails* field overrides the default recipients for that record. A daily WP-Cron job sends the digest. Reminder e-mails never contain passwords. For reliable delivery on low-traffic sites trigger `wp-cron.php` from a real cron job.

Who may use the application is **never** configured in PROCURE360.
