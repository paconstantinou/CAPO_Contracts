# WordPress integration

The application runs **inside** WordPress. There is no second login and no password is ever exchanged: the browser sends the normal WordPress session cookie plus the `X-WP-Nonce` header, and the server decides on every request. Users are the existing WordPress users.

* WordPress login/logout/failed login are written to the Activity Logs.
* A WordPress administrator is **not** automatically an application Super Admin.
* The GitHub Pages and Windows builds in `/application/standalone` are separate local single-user copies with no users or roles.
* Other plugins can plug into the same permission system:

```php
add_action( 'am_register_modules', function ( $registry ) {
    $registry->register( 'invoices', array(
        'name' => 'Invoices',
        'actions' => array( 'approve' => 'Approve invoices' ),
    ) );
} );
// in an endpoint:
'permission_callback' => fn( $req ) => AM::authorize( 'invoices', 'edit' ),
// elsewhere:
if ( am_can( 'invoices', 'approve' ) ) { ... }
```
Public helpers: `am_can`, `AM::authorize` (returns `true|WP_Error`, logs denials, rate-limits), `am_user_permissions`, `am_is_super_admin`, `am_log`, `am_register_module`.
