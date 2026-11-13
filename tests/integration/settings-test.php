<?php
/**
 * Settings and custom fields: integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php settings-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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


$wpload = $argv[2] ?? '';
if ( ! $wpload || ! file_exists( $wpload ) ) { die( "Pass the path to wp-load.php as 2nd argument\n" ); }
require_once $wpload;
$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$orig = get_option( 'rl_app_settings', '' );
$cl = function () use ( $c ) { foreach ( array( 'cf1' ) as $i ) { $c->rl( 'DELETE', 'records/contracts/' . $i ); $c->rl( 'DELETE', 'records/contracts/' . $i . '&purge=1' ); } };
$cl();

echo "settings: defaults and validation\n";
delete_option( 'rl_app_settings' );
$r = $c->rl( 'GET', 'settings' );
t( 'defaults: vat 19, reminder 30, no custom fields', 200 === $r['code'] && 19 == $r['json']['settings']['vat'] && 30 == $r['json']['settings']['remindDays'] && array() === $r['json']['settings']['customFields']['contracts'], json_encode( $r['json'] ) );
$in = array( 'vat' => 150, 'remindDays' => 0, 'customFields' => array(
	'contracts' => array(
		array( 'id' => 'cf1', 'label' => ' <b>Κωδικός</b> CPV ', 'type' => 'text' ),
		array( 'id' => 'cf2', 'label' => 'Βαθμός', 'type' => 'select', 'options' => array( 'Α', 'Β', 'Α', '' ) ),
		array( 'id' => 'cf3', 'label' => 'Ποσό', 'type' => 'number' ),
		array( 'id' => 'cf4', 'label' => 'Ημ/νία', 'type' => 'date' ),
		array( 'id' => 'bad id!', 'label' => 'x', 'type' => 'text' ),
		array( 'id' => 'cf1', 'label' => 'dup id', 'type' => 'text' ),
		array( 'id' => 'cf5', 'label' => '', 'type' => 'text' ),
		array( 'id' => 'cf6', 'label' => 'weird type', 'type' => 'script' ),
	),
	'unknown' => array( array( 'id' => 'z', 'label' => 'z', 'type' => 'text' ) ),
) );
$r = $c->rl( 'PUT', 'settings', array( 'settings' => $in ) );
$s = $r['json']['settings'] ?? array();
t( 'vat clamped to 100 and reminder to 1', 200 === $r['code'] && 100 == $s['vat'] && 1 == $s['remindDays'], json_encode( $s ) );
$f = $s['customFields']['contracts'] ?? array();
t( 'invalid ids, duplicate ids and empty labels are dropped (cf1, cf2, cf3, cf4, cf6 remain)', array( 'cf1', 'cf2', 'cf3', 'cf4', 'cf6' ) === array_column( $f, 'id' ), json_encode( array_column( $f, 'id' ) ) );
t( 'label is stripped of tags; select options de-duplicated; unknown type becomes text', 'Κωδικός CPV' === $f[0]['label'] && array( 'Α', 'Β' ) === $f[1]['options'] && 'text' === $f[4]['type'], json_encode( $f ) );
t( 'unknown collections are ignored', ! isset( $s['customFields']['unknown'] ) );

echo "settings: only administrators may change them\n";
wp_set_current_user( 0 );
$req = new WP_REST_Request( 'PUT', '/rl/v1/settings' ); $req->set_body( wp_json_encode( array( 'settings' => $in ) ) ); $req->set_header( 'content-type', 'application/json' );
$res = rest_do_request( $req );
t( 'anonymous PUT /settings is refused', $res->get_status() >= 401 && $res->get_status() <= 403, (string) $res->get_status() );

echo "custom values on records\n";
$c->rl( 'PUT', 'settings', array( 'settings' => array( 'vat' => 19, 'remindDays' => 30, 'customFields' => array( 'contracts' => array(
	array( 'id' => 'cf1', 'label' => 'Κωδικός CPV', 'type' => 'text' ),
	array( 'id' => 'cf2', 'label' => 'Βαθμός', 'type' => 'select', 'options' => array( 'Α', 'Β' ) ),
	array( 'id' => 'cf3', 'label' => 'Ποσό', 'type' => 'number' ),
	array( 'id' => 'cf4', 'label' => 'Ημ/νία', 'type' => 'date' ),
) ) ) ) );
$y = function ( $o ) { return gmdate( 'Y-m-d', time() + 86400 * $o ); };
$rec = array( 'title' => 'Probe Custom', 'tender' => 'CF-1', 'months' => 12, 'dateFrom' => $y( -30 ), 'dateTo' => $y( 300 ), 'cost' => 100, 'years' => array( array( 'from' => $y( -30 ), 'to' => $y( 300 ), 'cost' => 100, 'remind' => 30 ) ),
	'custom' => array( 'cf1' => '  72212000-4  ', 'cf2' => 'Β', 'cf3' => '12.5', 'cf4' => $y( 5 ), 'zzz' => 'not defined' ) );
$r = $c->rl( 'PUT', 'records/contracts/cf1', array( 'data' => $rec ) );
$d = null; foreach ( $c->rl( 'GET', 'records/contracts' )['json']['items'] as $i ) { if ( 'cf1' === $i['id'] ) { $d = $i['data']; } }
t( 'values saved, trimmed, numbers numeric, undefined fields dropped', 200 === $r['code'] && $d && '72212000-4' === $d['custom']['cf1'] && 'Β' === $d['custom']['cf2'] && 12.5 == $d['custom']['cf3'] && $y( 5 ) === $d['custom']['cf4'] && ! isset( $d['custom']['zzz'] ), json_encode( $d['custom'] ?? null ) );
$rec['custom'] = array( 'cf2' => 'Δ', 'cf3' => 'abc', 'cf4' => 'not a date', 'cf1' => '' );
$c->rl( 'PUT', 'records/contracts/cf1', array( 'data' => $rec ) );
foreach ( $c->rl( 'GET', 'records/contracts' )['json']['items'] as $i ) { if ( 'cf1' === $i['id'] ) { $d = $i['data']; } }
t( 'invalid select value, non-number, bad date and empty text are all dropped', array() === $d['custom'] || empty( $d['custom'] ), json_encode( $d['custom'] ) );
$rec['custom'] = array( 'cf1' => 'ΖΖΖ' ); $c->rl( 'PUT', 'records/contracts/cf1', array( 'data' => $rec ) );

echo "custom fields in the Excel/CSV export\n";
$r = $c->req( 'GET', '/?rest_route=/rl/v1/export/contracts&format=csv' );
t( 'contracts export has the custom columns and the value', 200 === $r['code'] && false !== strpos( $r['body'], 'Κωδικός CPV' ) && false !== strpos( $r['body'], 'ΖΖΖ' ) && false !== strpos( $r['body'], 'Βαθμός' ) );

$cl();
if ( '' === $orig ) { delete_option( 'rl_app_settings' ); } else { update_option( 'rl_app_settings', $orig, false ); }
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
