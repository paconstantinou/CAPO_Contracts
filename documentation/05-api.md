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
