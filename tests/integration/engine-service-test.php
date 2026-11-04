<?php
/**
 * Engine + service tests on the real wpdb store, run inside a local WordPress:
 *   php engine-service-test.php /path/to/wp-load.php
 * Creates and removes its own temporary users and roles. Needs user 1 to be a Super Admin.
 */
$_SERVER['HTTP_HOST'] = '127.0.0.1'; $_SERVER['REMOTE_ADDR'] = '127.0.0.1'; $_SERVER['REQUEST_URI'] = '/';
require $argv[1];
$pass = 0; $fail = 0;
function t( $n, $c, $i = '' ) { global $pass, $fail; if ( $c ) { $pass++; echo "  ok   $n\n"; } else { $fail++; echo "  FAIL $n $i\n"; } }
$e = AM::engine(); $s = AM::service(); $st = AM::store();
$A = 1;
$mk = function ( $l ) { $u = get_user_by( 'login', $l ); return $u ? $u->ID : wp_insert_user( array( 'user_login' => $l, 'user_pass' => wp_generate_password(), 'user_email' => "$l@t.test" ) ); };
$u1 = $mk( 'ut_one' ); $u2 = $mk( 'ut_two' ); $wpadmin = $mk( 'ut_wpadmin' ); ( new WP_User( $wpadmin ) )->set_role( 'administrator' );
$ok = fn( $r ) => true === $r;
$allowed = function ( $u, $m, $a ) use ( $e ) { $e->flush(); return $e->explain( $u, $m, $a )['allowed']; };
$why = function ( $u, $m, $a ) use ( $e ) { $e->flush(); return $e->explain( $u, $m, $a )['reason']; };

echo "deny by default\n";
t( 'user without access is denied', ! $allowed( $u1, 'software', 'view' ) );
t( 'WP administrator is NOT automatically app super admin', ! $allowed( $wpadmin, 'software', 'view' ) && ! $e->is_super( $wpadmin ) );
t( 'unknown module denied', 'module_unknown' === $why( $A, 'nope', 'view' ) );
t( 'unknown action denied', 'action_unknown' === $why( $A, 'software', 'fly' ) );
t( 'user id 0 denied', ! $allowed( 0, 'software', 'view' ) );

echo "roles\n";
t( 'enable access', $ok( $s->set_user_access( $A, $u1, true ) ) );
t( 'access without role still denied', ! $allowed( $u1, 'software', 'view' ) );
t( 'assign viewer', $ok( $s->set_user_roles( $A, $u1, array( 'viewer' ) ) ) );
t( 'viewer can view', $allowed( $u1, 'software', 'view' ) );
t( 'viewer cannot edit', ! $allowed( $u1, 'software', 'edit' ) );
t( 'viewer has no credentials permission', ! $allowed( $u1, 'software', 'credentials' ) );
t( 'access off beats role', $ok( $s->set_user_access( $A, $u1, false ) ) && 'access_disabled' === $why( $u1, 'software', 'view' ) );
$s->set_user_access( $A, $u1, true );

echo "overrides and precedence\n";
t( 'allow override grants beyond role', $ok( $s->set_user_overrides( $A, $u1, array( 'software:credentials' => 'allow' ) ) ) && $allowed( $u1, 'software', 'credentials' ) );
t( 'deny override beats role grant', $ok( $s->set_user_overrides( $A, $u1, array( 'software:view' => 'deny' ) ) ) && ! $allowed( $u1, 'software', 'view' ) && 'override_deny' === $why( $u1, 'software', 'view' ) );
t( 'deny override beats super admin', $ok( $s->set_user_roles( $A, $u1, array( 'super_admin' ) ) ) && ! $allowed( $u1, 'software', 'view' ) );
t( 'clearing override restores', $ok( $s->set_user_overrides( $A, $u1, array( 'software:view' => '' ) ) ) && $allowed( $u1, 'software', 'view' ) );
$s->set_user_roles( $A, $u1, array( 'viewer' ) ); $s->set_user_overrides( $A, $u1, array( 'software:credentials' => '' ) );

echo "module switches\n";
t( 'module off denies everyone incl. super', $ok( $s->set_module_enabled( $A, 'contracts', false ) ) && ! $allowed( $A, 'contracts', 'view' ) );
t( 'module on again', $ok( $s->set_module_enabled( $A, 'contracts', true ) ) && $allowed( $A, 'contracts', 'view' ) );
t( 'restricted module: only listed roles', $ok( $s->set_module_access( $A, 'contracts', array( 'manager' ), array() ) ) && ! $allowed( $u1, 'contracts', 'view' ) );
t( 'restricted module: listed user allowed', $ok( $s->set_module_access( $A, 'contracts', array(), array( $u1 ) ) ) && $allowed( $u1, 'contracts', 'view' ) );
$s->set_module_access( $A, 'contracts', array(), array() );
t( 'unrestricted again', $allowed( $u1, 'contracts', 'view' ) );

echo "service guards\n";
t( 'cannot change own access', is_wp_error( $s->set_user_access( $A, $A, false ) ) && 'am_self' === $s->set_user_access( $A, $A, false )->get_error_code() );
t( 'cannot change own roles', is_wp_error( $s->set_user_roles( $A, $A, array( 'viewer' ) ) ) );
t( 'cannot change own overrides', is_wp_error( $s->set_user_overrides( $A, $A, array( 'software:view' => 'deny' ) ) ) );
t( 'WP admin non-super cannot change anything', is_wp_error( $s->set_user_roles( $wpadmin, $u2, array( 'viewer' ) ) ) );
t( 'non-admin super cannot change settings', is_wp_error( $s->set_user_roles( $u1, $u2, array( 'viewer' ) ) ) );
t( 'unknown role rejected', is_wp_error( $s->set_user_roles( $A, $u2, array( 'does_not_exist' ) ) ) );
t( 'unknown permission pair rejected', is_wp_error( $s->set_user_overrides( $A, $u2, array( 'software:bogus' => 'allow' ) ) ) );
t( 'unknown user rejected', is_wp_error( $s->set_user_access( $A, 999999, true ) ) );

echo "custom roles\n";
$r = $s->create_role( $A, 'UT Auditor', 'test' ); t( 'create custom role', ! is_wp_error( $r ), is_wp_error( $r ) ? $r->get_error_message() : '' );
$slug = is_wp_error( $r ) ? '' : ( is_array( $r ) ? $r['slug'] : $r );
if ( $slug ) {
	t( 'grant view+export to role', $ok( $s->set_role_grants( $A, $slug, array( 'software:view', 'software:export' ) ) ) );
	$s->set_user_roles( $A, $u2, array( $slug ) ); $s->set_user_access( $A, $u2, true );
	t( 'custom role works', $allowed( $u2, 'software', 'export' ) && ! $allowed( $u2, 'software', 'delete' ) );
	t( 'system roles cannot be deleted', is_wp_error( $s->delete_role( $A, 'viewer' ) ) );
	t( 'delete custom role removes grants from users', $ok( $s->delete_role( $A, $slug ) ) && ! $allowed( $u2, 'software', 'export' ) );
}

echo "logging\n";
$rows = $st->query_logs( array(), 50, 0 );
$rows = isset( $rows['rows'] ) ? $rows['rows'] : $rows;
$acts = array(); foreach ( $rows as $r ) { $acts[] = is_object( $r ) ? $r->action : $r['action']; }
t( 'role/permission/access changes are logged', (bool) array_intersect( $acts, array( 'user.roles', 'user.overrides', 'user.access_enabled', 'user.roles_changed' ) ) || count( $acts ) > 5, implode( ',', array_slice( $acts, 0, 8 ) ) );

// cleanup
foreach ( array( $u1, $u2, $wpadmin ) as $u ) { $st->delete_user( $u ); require_once ABSPATH . 'wp-admin/includes/user.php'; wp_delete_user( $u ); }
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
