<?php
/**
 * Additional / optional services of a contract: HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
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


$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$get = function ( $k, $id ) { $r = $k->rl( 'GET', 'records/contracts' ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };
$clean = function ( $k ) { $k->rl( 'DELETE', 'records/contracts/exc1' ); $k->rl( 'DELETE', 'records/contracts/exc1&purge=1' ); };
$clean( $c );
$y = function ( $o ) { return gmdate( 'Y-m-d', time() + 86400 * $o ); };
$ct = array( 'title' => 'Probe υπηρεσίες', 'tender' => 'EX-1/2027', 'months' => 24, 'dateFrom' => $y( -30 ), 'dateTo' => $y( 700 ),
	'cost' => 2000, 'years' => array( array( 'from' => $y( -30 ), 'to' => $y( 334 ), 'cost' => 1000, 'remind' => 30 ), array( 'from' => $y( 335 ), 'to' => $y( 700 ), 'cost' => 1000, 'remind' => 30 ) ),
	'extras' => array(
		array( 'id' => 'a1', 'kind' => 'optional', 'desc' => '  Υπηρεσία Α ', 'amount' => '120.555', 'article' => '03461', 'evil' => 'x' ),
		array( 'kind' => 'bogus', 'desc' => 'Υπηρεσία Β', 'amount' => 50, 'article' => '' ),
		array( 'desc' => 'zero', 'amount' => 0, 'article' => '03461' ),
		array( 'desc' => 'neg', 'amount' => -5 ),
		array( 'desc' => 'text', 'amount' => 'abc' ),
		'junk',
	) );
echo "extras: sanitize\n";
$r = $c->rl( 'PUT', 'records/contracts/exc1', array( 'data' => $ct ) );
t( 'PUT contract with extras ok', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'exc1' ); $e = $d['extras'] ?? array();
t( 'only valid services are kept (amount > 0)', 2 === count( $e ), json_encode( $e ) );
t( 'amount rounded to cents, description trimmed, kind validated, unknown keys dropped', 120.56 === (float) $e[0]['amount'] && 'Υπηρεσία Α' === $e[0]['desc'] && 'optional' === $e[0]['kind'] && 'extra' === $e[1]['kind'] && ! isset( $e[0]['evil'] ) && 'a1' === $e[0]['id'] && '' !== $e[1]['id'], json_encode( $e ) );
t( 'stored year cost and contract cost are untouched (extras are added on top when shown)', 1000 === (int) $d['years'][0]['cost'] && 2000 === (int) $d['cost'] );
$r = $c->rl( 'PUT', 'records/contracts/exc1', array( 'data' => array_merge( $ct, array( 'extras' => 'nope' ) ) ) );
t( 'invalid extras value is stored as empty', 200 === $r['code'] && array() === ( $get( $c, 'exc1' )['extras'] ?? null ) );
$c->rl( 'PUT', 'records/contracts/exc1', array( 'data' => $ct ) );

echo "extras: export includes them in totals\n";
$r = $c->req( 'GET', '/?rest_route=/rl/v1/export/contracts&format=csv' );
t( 'export 200', 200 === $r['code'] );
$row = null; foreach ( preg_split( '/\r?\n/', trim( $r['body'] ) ) as $ln ) { if ( false !== strpos( $ln, 'Probe υπηρεσίες' ) ) { $row = str_getcsv( $ln ); } }
t( 'export has the extras columns', false !== strpos( $r['body'], 'ΕΠΙΠΡΟΣΘΕΤΕΣ/ΠΡΟΑΙΡΕΤΙΚΕΣ ΥΠΗΡΕΣΙΕΣ' ) && false !== strpos( $r['body'], 'ΕΤΗΣΙΟ ΠΟΣΟ ΥΠΗΡΕΣΙΩΝ' ) );
t( 'export row: total = 2000 + 2 x 170.56 and the services are listed', $row && 2341.12 === (float) $row[8] && false !== strpos( implode( '|', $row ), 'Προαιρετική: Υπηρεσία Α (120.56 €/έτος [03461])' ) && '170.56' === end( $row ), json_encode( $row ) );
t( 'export row: year 1 cost = 1000 + 170.56', $row && 1170.56 === (float) $row[11], json_encode( $row ) );

$clean( $c );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
