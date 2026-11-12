<?php
/**
 * Archive of expired contracts: HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php archive-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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
$get = function ( $id ) use ( $c ) { $r = $c->rl( 'GET', 'records/contracts' ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };
$ids = array( 'arc1', 'arc2', 'arc3' );
$clean = function () use ( $c, $ids ) { foreach ( $ids as $i ) { $c->rl( 'DELETE', 'records/contracts/' . $i ); $c->rl( 'DELETE', 'records/contracts/' . $i . '&purge=1' ); } };
$clean();
$y = function ( $o ) { return gmdate( 'Y-m-d', time() + 86400 * $o ); };
$mk = function ( $title, $from, $to, $extra = array() ) use ( $y ) { return array_merge( array( 'title' => $title, 'tender' => 'ARC-1', 'months' => 12, 'dateFrom' => $y( $from ), 'dateTo' => $y( $to ), 'cost' => 100, 'years' => array( array( 'from' => $y( $from ), 'to' => $y( $to ), 'cost' => 100, 'remind' => 30 ) ), 'milestones' => array( array( 'id' => 'm1', 'year' => 1, 'description' => 'Probe ms', 'due' => $y( 5 ), 'remind' => 30 ) ) ), $extra ); };

echo "archive: expired contract can be archived\n";
$r = $c->rl( 'PUT', 'records/contracts/arc1', array( 'data' => $mk( 'Probe Archive expired', -400, -10, array( 'archived' => true, 'archivedAt' => $y( 0 ) ) ) ) );
t( 'save 200', 200 === $r['code'], json_encode( $r['json'] ) );
$d = $get( 'arc1' );
t( 'archived flag and date stored', $d && true === $d['archived'] && $y( 0 ) === $d['archivedAt'], json_encode( $d ) );

echo "archive: a contract that is not expired cannot stay archived\n";
$r = $c->rl( 'PUT', 'records/contracts/arc2', array( 'data' => $mk( 'Probe Archive active', -30, 300, array( 'archived' => true, 'archivedAt' => $y( 0 ) ) ) ) );
$d = $get( 'arc2' );
t( 'saved but archived dropped', 200 === $r['code'] && $d && false === $d['archived'] && '' === $d['archivedAt'], json_encode( $d ) );

echo "archive: extending the dates of an archived contract makes it active again\n";
$r = $c->rl( 'PUT', 'records/contracts/arc1', array( 'data' => $mk( 'Probe Archive expired', -400, 200, array( 'archived' => true, 'archivedAt' => $y( 0 ) ) ) ) );
$d = $get( 'arc1' );
t( 'no longer archived after the end date moved into the future', $d && false === $d['archived'], json_encode( $d ) );
$c->rl( 'PUT', 'records/contracts/arc1', array( 'data' => $mk( 'Probe Archive expired', -400, -10, array( 'archived' => true, 'archivedAt' => $y( 0 ) ) ) ) );

echo "archive: notifications\n";
$c->rl( 'PUT', 'records/contracts/arc3', array( 'data' => $mk( 'Probe Archive not archived', -400, -10 ) ) );
$keys = array(); foreach ( RL_Cron::collect() as $it ) { $keys[] = $it['key']; }
t( 'archived contract: no expired notification', ! in_array( 'ct:arc1:exp', $keys, true ), json_encode( $keys ) );
t( 'archived contract: no milestone notification', ! in_array( 'ms:contracts:arc1:m1:due', $keys, true ), json_encode( $keys ) );
t( 'same expired contract that is NOT archived still notifies (expired + milestone)', in_array( 'ct:arc3:exp', $keys, true ) && in_array( 'ms:contracts:arc3:m1:due', $keys, true ), json_encode( $keys ) );

echo "archive: stays listed and exported\n";
$r = $c->req( 'GET', '/?rest_route=/rl/v1/export/contracts&format=csv' );
t( 'archived contract is still in the export with status Αρχειοθετήθηκε', 200 === $r['code'] && false !== strpos( $r['body'], 'Probe Archive expired' ) && false !== strpos( $r['body'], 'Αρχειοθετήθηκε' ) );

$clean();
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
