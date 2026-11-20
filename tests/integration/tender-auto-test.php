<?php
/**
 * Tender amendments, contract link and automatic tenders (3.20.0): HTTP integration test against a live WordPress with
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


$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: ( getenv( 'RL_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) ) );
$get = function ( $k, $coll, $id ) { $r = $k->rl( 'GET', "records/$coll" ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };
$clean = function ( $k ) { foreach ( array( 'tat1', 'tac1' ) as $i ) { foreach ( array( 'tenders', 'contracts' ) as $co ) { $k->rl( 'DELETE', "records/$co/$i" ); $k->rl( 'DELETE', "records/$co/$i&purge=1" ); } } $r = $k->rl( 'GET', 'records/tenders' ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( ! empty( $i['data']['autoCreated'] ) && 0 === strpos( $i['data']['title'], 'TAT-' ) ) { $k->rl( 'DELETE', 'records/tenders/' . $i['id'] ); $k->rl( 'DELETE', 'records/tenders/' . $i['id'] . '&purge=1' ); } } };
$clean( $c );
$yr = (int) wp_date_year();
function wp_date_year() { return date( 'Y' ); }
$ctr = array( 'title' => 'TAT-Contract', 'tender' => 'TAT-1', 'description' => 'D', 'months' => 12, 'dateFrom' => ( $yr + 2 ) . '-01-01', 'dateTo' => ( $yr + 2 ) . '-12-31', 'cost' => 5000, 'years' => array( array( 'from' => ( $yr + 2 ) . '-01-01', 'to' => ( $yr + 2 ) . '-12-31', 'cost' => 5000 ) ) );
t( 'PUT contract ok', 200 === $c->rl( 'PUT', 'records/contracts/tac1', array( 'data' => $ctr ) )['code'] );
$tn = array( 'title' => 'TAT-manual', 'tender' => '', 'description' => 'x', 'months' => 12, 'dateFrom' => ( $yr + 3 ) . '-01-01', 'dateTo' => ( $yr + 3 ) . '-12-31', 'cost' => 800, 'years' => array( array( 'from' => ( $yr + 3 ) . '-01-01', 'to' => ( $yr + 3 ) . '-12-31', 'cost' => 800 ) ), 'contractId' => 'tac1', 'autoCreated' => true );
t( 'PUT tender with contract link ok', 200 === $c->rl( 'PUT', 'records/tenders/tat1', array( 'data' => $tn ) )['code'] );
$d = $get( $c, 'tenders', 'tat1' );
t( 'contractId stored', 'tac1' === $d['contractId'] );
t( 'client cannot mark a tender as automatic', empty( $d['autoCreated'] ), json_encode( $d ) );
$tn['contractId'] = 'nope';
$c->rl( 'PUT', 'records/tenders/tat1', array( 'data' => $tn ) );
t( 'unknown contract id is dropped', '' === $get( $c, 'tenders', 'tat1' )['contractId'] );
$tn['contractId'] = 'tac1';
$c->rl( 'PUT', 'records/tenders/tat1', array( 'data' => $tn ) );
/* amendments are append-only */
$am = array( 'id' => 'am1', 'date' => date( 'Y-m-d' ), 'description' => 'Αλλαγή κόστους', 'at' => 1, 'changes' => array(), 'costBefore' => 800, 'costAfter' => 900, 'before' => array() );
$tn['cost'] = 900; $tn['amendments'] = array( $am );
$r = $c->rl( 'PUT', 'records/tenders/tat1', array( 'data' => $tn ) );
t( 'tender amendment accepted', 200 === $r['code'], $r['body'] );
t( 'amendment stored', 1 === count( $get( $c, 'tenders', 'tat1' )['amendments'] ) );
$tn['amendments'] = array();
$c->rl( 'PUT', 'records/tenders/tat1', array( 'data' => $tn ) );
t( 'amendments cannot be removed', 1 === count( $get( $c, 'tenders', 'tat1' )['amendments'] ) );
/* pending status */
$tn['status'] = 'pending'; $tn['amendments'] = array( $am );
$c->rl( 'PUT', 'records/tenders/tat1', array( 'data' => $tn ) );
t( 'pending status accepted', 'pending' === $get( $c, 'tenders', 'tat1' )['status'] );
/* automatic run: contract tac1 already has a linked tender -> nothing for it; other contracts may exist, so only check idempotence */
$r1 = $c->rl( 'POST', 'auto-tenders/run', array() ); t( 'run endpoint ok', 200 === $r1['code'], $r1['body'] );
$r2 = $c->rl( 'POST', 'auto-tenders/run', array() ); t( 'second run creates nothing (idempotent)', 0 === $r2['json']['created'], $r2['body'] );
$r = $c->rl( 'GET', 'records/tenders' ); $n = 0; foreach ( $r['json']['items'] as $i ) { if ( 'tac1' === ( $i['data']['contractId'] ?? '' ) ) { $n++; } }
t( 'contract tac1 has exactly one related tender', 1 === $n, (string) $n );
/* without the linked tender the run creates a pending one with 10% cost */
$c->rl( 'DELETE', 'records/tenders/tat1' ); $c->rl( 'DELETE', 'records/tenders/tat1&purge=1' );
$r = $c->rl( 'POST', 'auto-tenders/run', array() ); t( 'run creates tender(s)', $r['json']['created'] >= 1, $r['body'] );
$r = $c->rl( 'GET', 'records/tenders' ); $a = null; foreach ( $r['json']['items'] as $i ) { if ( 'tac1' === ( $i['data']['contractId'] ?? '' ) ) { $a = $i['data']; } }
t( 'auto tender is pending, linked, automatic', $a && 'pending' === $a['status'] && ! empty( $a['autoCreated'] ), json_encode( $a ) );
t( 'auto tender copies name/description/duration', $a && 'TAT-Contract' === $a['title'] && 'D' === $a['description'] && 12 === (int) $a['months'] );
t( 'auto tender starts the day after the contract ends, cost = 10%', $a && ( $yr + 3 ) . '-01-01' === $a['dateFrom'] && ( $yr + 3 ) . '-12-31' === $a['dateTo'] && 500.0 === (float) $a['cost'], json_encode( $a ) );
$v = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
t( 'viewer cannot run the automatic creation', 403 === $v->rl( 'POST', 'auto-tenders/run', array() )['code'] );
$clean( $c );
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
