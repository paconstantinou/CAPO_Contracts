# Roles and permissions

Roles: Super Admin, Administrator, Manager, Editor, Viewer, Custom Role (plus any you create). Standard module permissions: **View, Create, Edit, Delete, Export, Manage**; modules may add their own (Online Renewals adds **Credentials**).

Default presets for a newly seen module: Administrator = all standard; Manager = view/create/edit/export; Editor = view/create/edit; Viewer = view. Custom actions such as *Credentials* are given to nobody except Super Admin until you grant them.

## Decision order (first match wins; deny by default)
1. unknown user → deny
2. application access switched off for the user → deny
3. module unknown/disabled → deny
4. action not defined by the module → deny
5. user override **deny** → deny (beats everything, even Super Admin)
6. Super Admin role → allow
7. module restricted to certain roles/users and user not listed → deny
8. user override **allow** → allow
9. any role grants it → allow
10. otherwise deny

## Rules
* Only a WordPress administrator who is also an application Super Admin can change access, and never their own.
* The last Super Admin cannot be removed.
* Everything is managed only in WP Admin → Application Management.

## What each permission means in PROCURE360
View: list records, open attachments · Create: add records/upload · Edit: change, renew, attach, remove attachments · Delete · Export: server-side CSV/XLSX · Credentials (software): see/change the username; without it the username is blanked in responses and the stored value is preserved on edit. Passwords are **not stored at all** (removed in 2.2.0; the upgrade deletes any stored by older versions).
