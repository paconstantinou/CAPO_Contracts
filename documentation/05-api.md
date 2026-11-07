# REST API
Base: `/wp-json/`. Authentication: WordPress cookie + `X-WP-Nonce: <wp_rest nonce>` header. Every route has a `permission_callback`; errors: 401 not logged in, 403 not permitted, 400 invalid input, 429 rate limited.

## am/v1
| Route | Notes |
|---|---|
| `GET /am/v1/me` | Current user's roles and effective permissions |
| `GET /am/v1/check?module=&action=` | Boolean check for one permission |

## rl/v1
| Route | Permission |
|---|---|
| `GET /rl/v1/records/{software\|contracts}` | view (credentials blanked without `credentials`) |
| `PUT /rl/v1/records/{coll}/{id}` | create (new) / edit (existing); body `{"data":{…}}`, whitelisted and validated server-side |
| `DELETE /rl/v1/records/{coll}/{id}` | delete |
| `GET /rl/v1/export/{coll}?format=xlsx\|csv` | export |
| `POST /rl/v1/files` (multipart `file`, `coll`) | create or edit |
| `GET /rl/v1/files/{id}` | view |
| `DELETE /rl/v1/files/{id}` | edit |
Uploads: type allow-list, 20 MB, stored outside direct web access with a random name.

## Milestones
Each record (software or contract) may carry `milestones`: `[{id, year, description, due, remind (30|60), comments, done, attachments[]}]`, saved with the record through `PUT /rl/v1/records/{coll}/{id}` and therefore governed by **create/edit**. Server-side: ids must be unique `[A-Za-z0-9_-]`, description required (max 1000), `year` 1–60, `remind` forced to 30 or 60, dates validated, attachments must be existing files of the same module; max 300 per record. Deleting a record deletes the milestone attachments. Open (not done) milestones are included in the daily reminder e-mail: from 30/60 days before the due date, and for 30 days after it is overdue.

Records may also carry `budget`: `[{year, amount, article}]` (partial amounts; max 200, `year` 1–60, `amount` 0–1e9 rounded to 2 decimals, `article` ≤200 chars). When a year (contracts) or the record (software) has partial amounts, the server sets that year's / the record's `cost` to their sum. The selectable articles come from Settings → PROCURE360 (`rl_budget_articles`) and are passed to the app as `RL_CFG.articles`.

## Notification e-mails and passwords (2.2.0)
* Records have `emails`: one or more addresses separated by comma, semicolon or space (max 20). Invalid addresses are rejected with 400 (`rl_bad_email`). Stored normalised as `a@x.gr, b@y.gr`.
* Reminders (expiry, yearly expiry of contracts and milestones) are e-mailed to the record's own addresses; records without addresses use the default recipients from Settings → PROCURE360. One message per distinct recipient set.
* The `password` field no longer exists. Any value sent is ignored, and the upgrade removes passwords already stored.


## Budget sheet (Προϋπολογισμός)

Third tab, calculated in the browser from the records the user may view (no extra REST route). Articles are `{code, desc, cat, catDesc, split}` from Settings → PROCURE360 (`rl_budget_articles`, edited as a table in the settings page (code, description, category, category description, split ΝΑΙ/ΌΧΙ; add and delete rows), stored internally one line per article; default = the 17 organisation articles). Records store the article **code**. For each record and article: `split` (ΝΑΙ) spreads the amount by month over the calendar years of the period (a part-month counts by its share of days; rounding remainder goes to the last year); otherwise the whole amount is placed in the year of the period's start date. All amounts in the sheet include **19% VAT** (`BD_VAT` in app.js): the records hold net amounts, the sheet multiplies each article group by 1.19 (rounded to cents) before the month split, and the «Τρόπος Υπολογισμού» column shows net + VAT = gross. Amounts without an article appear under «Χωρίς άρθρο». The tab is visible to users who can view software or contracts. The Excel export is generated in the browser, so the Export permission is enforced in the UI only (the data is what the user may already view).


## Trash and permanent deletion (3.0.0)

`DELETE /records/{coll}/{id}` no longer destroys: it moves the record to the trash (`deleted_at`, `deleted_by` columns; attachments stay). Trashed records are hidden from `GET /records/{coll}`, exports, reminders and the budget sheet and cannot be edited (`PUT` → 409 `rl_in_trash`).

| Call | Permission | Result |
|---|---|---|
| `GET /records/{coll}?trash=1` | `delete` | trashed records with `deleted_at` (UTC) and `deleted_by` (name) |
| `POST /records/{coll}/{id}/restore` | `delete` | back to the live list (404 if not in the trash) |
| `DELETE /records/{coll}/{id}?purge=1` | `purge` (new custom action, no role has it by default) | removes a record that is **in the trash** for good, with its attachment files (409 `rl_not_in_trash` otherwise) |

A daily WP-Cron job removes records trashed longer than `rl_trash_days` (Settings → PROCURE360, default 30, 0 = never). Activity log actions: `ledger.record_delete` (`to_trash`), `ledger.record_restore`, `ledger.record_purge`, `ledger.trash_auto_purge`. Budget articles used by any record (live or trashed) cannot be removed from the settings; the server keeps them. Application Management 1.1.0 refuses to delete a role that users still hold (409 `am_role_in_use`).

## Tenders (Διαγωνισμοί, 3.1.0)

Fourth collection `tenders` with its own Application Management module `tenders` (actions view/create/edit/delete/export/manage + `purge`). Same REST routes as software and contracts (`/records/tenders`, `/records/tenders/{id}`, trash, restore, `/export/tenders`, attachments with `coll=tenders`). Fields: `title`, `tender`, `description`, `months`, `dateFrom`, `dateTo`, `cost`, `years[{from,to,cost}]` (no reminder), `budget[{year,article,amount}]`, `attachments`, `status` (`active` | `cancelled` | `promoted`), `statusAt`, `promotedTo`.

* Only `active` tenders are counted in the budget sheet. Cancelling is a normal `PUT` with `status: cancelled`; the client cannot set `promoted`.
* `POST /records/tenders/{id}/promote` with `{contractId, data}` is atomic from the client's view: it needs `edit` on tenders **and** `create` on contracts, validates and saves the (corrected) contract, copies the tender's attachment files to the contract, then marks the tender `promoted` with `promotedTo`. 409 `rl_tender_closed` if the tender is not active, 409 `rl_exists` if the contract id exists. A promoted tender stays promoted on later edits.
* A user without `view` on a module gets an empty list for it in the app (the tab is hidden) instead of a sync error.
