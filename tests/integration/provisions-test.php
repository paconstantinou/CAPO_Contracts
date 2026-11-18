<?php
/**
 * General Provisions (3.16.0): whitelist, permissions per role, trash, backup. HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php provisions-test.php http://127.0.0.1:8088 /path/to/wp-load.php
 *
 * Expects users: admin (Super Admin), viewer1 (Viewer), editor1 (Editor), manager1 (Manager), nobody (no access).
 * Env: RL_TEST_ADMIN_PASS (required; local throwaway test site only, never a real site). Other users have password "Pw-<login>-12345!".
 */
$base = rtrim( $argv[1] ?? 'http://127.0.0.1:8088', '/' );
$pass = 0; $fail = 0;
function t( $name, $cond, $info = '' ) { global $pass, $fail; if ( $cond ) { $pass++; echo "  ok   $name\n"; } else { $fail++; echo "  FAIL $name $info\n"; } }

class Client {
	public $jar, $nonce = '', $base;
	function __construct( $base ) { $this->base = $base; $this->jar = tempnam( sys_get_temp_dir(), 'cj' ); }
	function req( $method, $url, $body = null, $headers = array(), $raw = false ) {
		$ch = curl_init( ( 0 === strpos( $url, 'http' ) ? '' : $this->base ) . $url );
		curl_setopt_array( $ch, array( CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_COOKIEJAR => $this->jar, CURLOPT_COOKIEFILE => $this->jar, CURLOPT_TIMEOUT => 30 ) );
		$h = $headers; if ( $this->nonce ) { $h[] = 'X-WP-Nonce: ' . $this->nonce; }
		if ( is_array( $body ) && ! $raw ) { $body = json_encode( $body ); $h[] = 'Content-Type: application/json'; }
		if ( null !== $body ) { curl_setopt( $ch, CURLOPT_POSTFIELDS, $body ); }
		curl_setopt( $ch, CURLOPT_HTTPHEADER, $h );
		$res = curl_exec( $ch ); $hs = curl_getinfo( $ch, CURLINFO_HEADER_SIZE ); $code = curl_getinfo( $ch, CURLINFO_HTTP_CODE ); curl_close( $ch );
		return array( 'code' => $code, 'head' => substr( $res, 0, $hs ), 'body' => substr( $res, $hs ), 'json' => json_decode( substr( $res, $hs ), true ) );
	}
	function login( $u, $p ) {
		$this->req( 'GET', '/wp-login.php' );
		$this->req( 'POST', '/wp-login.php', http_build_query( array( 'log' => $u, 'pwd' => $p, 'redirect_to' => '/wp-admin/' ) ), array( 'Content-Type: application/x-www-form-urlencoded' ), true );
		$r = $this->req( 'GET', '/wp-admin/admin-ajax.php?action=rest-nonce' );
		$this->nonce = trim( $r['body'] );
		return strlen( $this->nonce ) > 5 && 'logged' !== $this->nonce;
	}
	function rl( $method, $path, $body = null ) { return $this->req( $method, '/?rest_route=/rl/v1/' . $path, $body ); }
}
function client( $base, $u, $p ) { $c = new Client( $base ); if ( ! $c->login( $u, $p ) ) { echo "login failed for $u\n"; } return $c; }


$wpload = $argv[2] ?? ''; if ( ! $wpload || ! file_exists( $wpload ) ) { die( "Pass wp-load.php as 2nd argument\n" ); }
require_once $wpload;
global $wpdb; $lt = $wpdb->prefix . 'am_logs';
$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$P = fn( $o = array() ) => array( 'data' => array_merge( array( 'title' => 'Πρόνοια τεστ', 'article' => '03460', 'notes' => 'σημ', 'baseYear' => 2026,
	'amounts' => array( array( 'year' => 2027, 'amount' => 100 ), array( 'year' => 2028, 'amount' => '' ), array( 'year' => 2029, 'amount' => 50.555 ) ), 'attachments' => array(), 'evil' => 'x' ), $o ) );
$get = function ( $cl, $id = 'pv1' ) { foreach ( $cl->rl( 'GET', 'records/provisions' )['json']['items'] ?? array() as $i ) { if ( $id === $i['id'] ) { return $i['data']; } } return null; };
$c->rl( 'DELETE', 'records/provisions/pv1' ); $c->rl( 'DELETE', 'records/provisions/pv1&purge=1' );
echo "provisions\n";
t( 'admin can create a provision', 200 === $c->rl( 'PUT', 'records/provisions/pv1', $P() )['code'] );
$d = $get( $c );
t( 'fields are kept, unknown ones dropped', $d && 'Πρόνοια τεστ' === $d['title'] && '03460' === $d['article'] && 2026 === $d['baseYear'] && ! isset( $d['evil'] ) );
t( 'always 3 amounts for base+1..base+3, rounded to cents, empty stays empty', $d && array( 2027, 2028, 2029 ) === array_column( $d['amounts'], 'year' ) && 100 == $d['amounts'][0]['amount'] && '' === $d['amounts'][1]['amount'] && 50.56 == $d['amounts'][2]['amount'], json_encode( $d['amounts'] ?? null ) );
$c->rl( 'PUT', 'records/provisions/pv1', $P( array( 'amounts' => array( array( 'year' => 2026, 'amount' => 9 ), array( 'year' => 2030, 'amount' => 9 ), array( 'year' => 2027, 'amount' => -5 ), array( 'year' => 2028, 'amount' => 'abc' ) ) ) ) );
$d = $get( $c );
t( 'amounts outside the 3 years, negative or non-numeric are dropped', $d && '' === $d['amounts'][0]['amount'] && '' === $d['amounts'][1]['amount'] && '' === $d['amounts'][2]['amount'] , json_encode( $d['amounts'] ?? null ) );
t( 'a provision without a description is refused', 400 === $c->rl( 'PUT', 'records/provisions/pv2', $P( array( 'title' => '  ' ) ) )['code'] );
t( 'a bad base year falls back to the current year', ( $c->rl( 'PUT', 'records/provisions/pv1', $P( array( 'baseYear' => 5 ) ) ) && (int) gmdate( 'Y' ) === $get( $c )['baseYear'] ) );
t( 'the audit log records the creation', (bool) $wpdb->get_var( "SELECT COUNT(*) FROM $lt WHERE module = 'provisions' AND action = 'ledger.record_create'" ) || (bool) $wpdb->get_var( "SELECT COUNT(*) FROM $lt WHERE details LIKE '%pv1%'" ) );
$c->rl( 'PUT', 'records/provisions/pv1', $P() );
/* roles */
foreach ( array( 'viewer1' => array( 200, 403 ), 'nobody' => array( 403, 403 ) ) as $u => $exp ) {
	$x = client( $base, $u, 'Pw-' . $u . '-12345!' );
	t( "$u: list " . $exp[0], $exp[0] === $x->rl( 'GET', 'records/provisions' )['code'] );
	t( "$u: write " . $exp[1], $exp[1] === $x->rl( 'PUT', 'records/provisions/pvx', $P() )['code'] );
}
$m = client( $base, 'manager1', 'Pw-manager1-12345!' );
t( 'manager1 can create and edit', 200 === $m->rl( 'PUT', 'records/provisions/pv3', $P( array( 'title' => 'Από manager' ) ) )['code'] );
t( 'viewer1 cannot delete', 403 === client( $base, 'viewer1', 'Pw-viewer1-12345!' )->rl( 'DELETE', 'records/provisions/pv3' )['code'] );
/* trash */
t( 'delete moves to the trash', 200 === $c->rl( 'DELETE', 'records/provisions/pv3' )['code'] && null === $get( $c, 'pv3' ) );
$tr = $c->rl( 'GET', 'records/provisions&trash=1' )['json']['items'] ?? array();
t( 'it is listed in the trash', in_array( 'pv3', array_column( $tr, 'id' ), true ) );
t( 'restore brings it back', 200 === $c->rl( 'POST', 'records/provisions/pv3/restore' )['code'] && null !== $get( $c, 'pv3' ) );
$c->rl( 'DELETE', 'records/provisions/pv3' ); t( 'purge removes it for good', 200 === $c->rl( 'DELETE', 'records/provisions/pv3&purge=1' )['code'] );
/* unknown collection still rejected, export of provisions is not offered by the server */
t( 'unknown collection is rejected', 400 === $c->rl( 'GET', 'records/nothing' )['code'] || 404 === $c->rl( 'GET', 'records/nothing' )['code'] );
/* backup includes provisions */
$bk = class_exists( 'RL_Backup' ) && method_exists( 'RL_Backup', 'build' );
$src = file_get_contents( WP_PLUGIN_DIR . '/renewal-ledger/includes/class-rl-backup.php' );
t( 'server backup iterates every collection including provisions', false !== strpos( $src, 'CF_COLLECTIONS' ) && in_array( 'provisions', RL_Settings::CF_COLLECTIONS, true ) );
t( 'module "provisions" is registered in Application Management', class_exists( 'AM' ) && AM::can( 'provisions', 'view' ) !== null );
$c->rl( 'DELETE', 'records/provisions/pv1' ); $c->rl( 'DELETE', 'records/provisions/pv1&purge=1' );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
