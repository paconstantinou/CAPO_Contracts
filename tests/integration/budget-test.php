<?php
/**
 * HTTP integration test of the Renewal Ledger REST API against a live WordPress with
 * Application Management + Renewal Ledger active.
 *
 *   php rest-permissions-test.php http://127.0.0.1:8088 /path/to/wp   (wp path only used to prepare users)
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

$sw = fn( $n ) => array( 'data' => array( 'name' => $n, 'description' => 'd', 'vendor' => 'v', 'website' => 'https://example.com', 'username' => 'secretuser', 'password' => 'legacypass', 'emails' => 'a@example.com; b@example.com', 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => 100, 'remindDays' => 30 ) );


$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$get = function ( $k, $coll, $id ) { $r = $k->rl( 'GET', "records/$coll" ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };
echo "budget breakdown: software\n";
$sw = array( 'name' => 'Budget SW', 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => 999, 'remindDays' => 30, 'budget' => array(
	array( 'year' => 1, 'amount' => 100.456, 'article' => 'A-1 Test article' ), array( 'year' => 1, 'amount' => '250', 'article' => str_repeat( 'x', 500 ) ),
	array( 'year' => 1, 'amount' => -5, 'article' => 'negative' ), array( 'year' => 1, 'amount' => 'abc', 'article' => 'text' ), array( 'year' => 1, 'amount' => '', 'article' => 'blank' ), 'junk' ) );
$r = $c->rl( 'PUT', 'records/software/bsw1', array( 'data' => $sw ) ); t( 'save software with partial amounts', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'software', 'bsw1' );
t( 'only valid parts kept', 2 === count( $d['budget'] ?? array() ), json_encode( $d['budget'] ?? null ) );
t( 'amount rounded to 2 decimals', 100.46 === (float) $d['budget'][0]['amount'] );
t( 'article capped at 200 chars', 200 === strlen( $d['budget'][1]['article'] ) );
t( 'cost forced to the sum of the parts', 350.46 === (float) $d['cost'], 'cost=' . ( $d['cost'] ?? '?' ) );
$sw['budget'] = array();
$r = $c->rl( 'PUT', 'records/software/bsw1', array( 'data' => $sw ) ); $d = $get( $c, 'software', 'bsw1' );
t( 'without parts the entered cost is kept', 999.0 === (float) $d['cost'] && array() === $d['budget'] );

echo "budget breakdown: contracts\n";
$yr = fn( $i, $cost ) => array( 'from' => ( 2026 + $i ) . '-01-01', 'to' => ( 2026 + $i ) . '-12-31', 'cost' => $cost, 'remind' => 30 );
$ct = array( 'title' => 'Budget CT', 'tender' => '', 'description' => '', 'contractor' => '', 'coordinator' => '', 'months' => 24, 'dateFrom' => '2026-01-01', 'dateTo' => '2027-12-31', 'cost' => 3000, 'years' => array( $yr( 0, 111 ), $yr( 1, 2000 ) ), 'attachments' => array(), 'budget' => array(
	array( 'year' => 1, 'amount' => 400, 'article' => 'Άρθρο 2310' ), array( 'year' => 1, 'amount' => 600.5, 'article' => 'Άρθρο 2320' ) ) );
$r = $c->rl( 'PUT', 'records/contracts/bct1', array( 'data' => $ct ) ); t( 'save contract with partial amounts', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'contracts', 'bct1' );
t( 'year 1 cost = sum of its parts', 1000.5 === (float) $d['years'][0]['cost'], json_encode( $d['years'][0] ?? null ) );
t( 'year 2 (no parts) keeps its own cost', 2000.0 === (float) $d['years'][1]['cost'] );
t( 'article text preserved (Greek)', 'Άρθρο 2310' === $d['budget'][0]['article'] );

echo "budget breakdown: permissions and export\n";
$vw = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
t( 'viewer can read the breakdown', 2 === count( ( $get( $vw, 'contracts', 'bct1' )['budget'] ?? array() ) ) );
$r = $vw->rl( 'PUT', 'records/contracts/bct1', array( 'data' => array_merge( $ct, array( 'budget' => array() ) ) ) ); t( 'viewer cannot change it', 403 === $r['code'], "got {$r['code']}" );
$r = $c->rl( 'GET', 'export/contracts&format=csv' ); t( 'contracts export has ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ with article', false !== strpos( $r['body'], 'ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ' ) && false !== strpos( $r['body'], '[Άρθρο 2320]' ) );
$c->rl( 'PUT', 'records/software/bsw1', array( 'data' => array_merge( $sw, array( 'budget' => array( array( 'year' => 1, 'amount' => 5, 'article' => 'EXP-ART' ) ) ) ) ) );
$r = $c->rl( 'GET', 'export/software&format=csv' ); t( 'software export has Cost breakdown with article', false !== strpos( $r['body'], 'Cost breakdown' ) && false !== strpos( $r['body'], '[EXP-ART]' ) );
foreach ( array( 'software/bsw1', 'contracts/bct1' ) as $x ) { $c->rl( 'DELETE', "records/$x" ); $c->rl( 'DELETE', "records/$x&purge=1" ); } // delete = trash, then purge
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
