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
