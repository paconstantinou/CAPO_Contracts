# Installation

Requirements: WordPress 5.8+, PHP 7.4+ (ZipArchive recommended for .xlsx export), MySQL/MariaDB, HTTPS.

1. **Plugins → Add New → Upload**: install `application-management-1.3.0.zip` first, then `renewal-ledger-3.7.0.zip`. (PROCURE360 refuses to serve data when Application Management is missing.)
2. Activate **Application Management**. The administrator who activates it becomes the first **Super Admin**. Other WordPress administrators get no application access until a Super Admin assigns it.
3. Activate **PROCURE360**. It registers two modules: `software` (Online Renewals) and `contracts` (Συμβάσεις).
4. Create a private page containing the shortcode `[renewal_ledger]`.
5. **Application Management → Users & Access**: enable access for each user and assign a role.
6. **PROCURE360 → Ρυθμίσεις**: reminder e-mail recipients and repeat interval.

Upgrading: replace the plugin; tables are migrated automatically on the next page load. Deactivating keeps all data. Deleting the plugin keeps data unless *Delete data on uninstall* is ticked in Application Management → Settings.
