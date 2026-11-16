<?php
/**
 * Contracts: one tender number = one contract (3.15.0). HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php contract-dup-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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
$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$ids = array( 'cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cdl1', 'cdl2', 'cdtn1', 'cdp1' );
$clean = function () use ( $c, $ids ) { foreach ( $ids as $i ) { foreach ( array( 'contracts', 'tenders' ) as $co ) { $c->rl( 'DELETE', "records/$co/$i" ); $c->rl( 'DELETE', "records/$co/$i&purge=1" ); } } };
$clean();
$ct = fn( $title, $num ) => array( 'data' => array( 'title' => $title, 'tender' => $num, 'description' => '', 'contractor' => 'ACME', 'months' => 12, 'dateFrom' => '2027-01-01', 'dateTo' => '2027-12-31', 'cost' => 100,
	'years' => array( array( 'from' => '2027-01-01', 'to' => '2027-12-31', 'cost' => 100, 'remind' => 30 ) ) ) );

echo "create\n";
t( 'first contract with the number is saved', 200 === $c->rl( 'PUT', 'records/contracts/cd1', $ct( 'Σύμβαση Α', '88/2027' ) )['code'] );
$r = $c->rl( 'PUT', 'records/contracts/cd2', $ct( 'Σύμβαση Β', '88/2027' ) );
t( 'second contract with the same number is refused (409 rl_duplicate_contract)', 409 === $r['code'] && 'rl_duplicate_contract' === ( $r['json']['code'] ?? '' ), $r['code'] . $r['body'] );
t( 'the error names the existing contract', false !== strpos( $r['json']['message'] ?? '', 'Σύμβαση Α' ) );
t( 'and nothing was saved', 404 === $c->rl( 'GET', 'records/contracts/cd2' )['code'] || ! in_array( 'cd2', array_column( $c->rl( 'GET', 'records/contracts' )['json']['items'] ?? array(), 'id' ), true ) );
t( 'spaces and case do not matter ( " 88 / 2027 " )', 409 === $c->rl( 'PUT', 'records/contracts/cd2', $ct( 'Σύμβαση Β', ' 88 / 2027 ' ) )['code'] );
t( 'letters: "ΔΙΑΓ-1" = "διαγ-1"', 200 === $c->rl( 'PUT', 'records/contracts/cd3', $ct( 'Γ', 'ΔΙΑΓ-1' ) )['code'] && 409 === $c->rl( 'PUT', 'records/contracts/cd4', $ct( 'Δ', 'διαγ-1' ) )['code'] );
t( 'a different number is fine', 200 === $c->rl( 'PUT', 'records/contracts/cd2', $ct( 'Σύμβαση Β', '89/2027' ) )['code'] );
t( 'a contract without a tender number is always fine (twice)', 200 === $c->rl( 'PUT', 'records/contracts/cd4', $ct( 'Χωρίς αριθμό 1', '' ) )['code'] && 200 === $c->rl( 'PUT', 'records/contracts/cd5', $ct( 'Χωρίς αριθμό 2', '' ) )['code'] );

echo "edit\n";
t( 'saving the same contract again with its own number works', 200 === $c->rl( 'PUT', 'records/contracts/cd1', $ct( 'Σύμβαση Α (ενημερωμένη)', '88/2027' ) )['code'] );
$r = $c->rl( 'PUT', 'records/contracts/cd2', $ct( 'Σύμβαση Β', '88/2027' ) );
t( 'changing a contract to a number used by another is refused', 409 === $r['code'] && 'rl_duplicate_contract' === ( $r['json']['code'] ?? '' ) );
t( 'changing to a free number works', 200 === $c->rl( 'PUT', 'records/contracts/cd2', $ct( 'Σύμβαση Β', '90/2027' ) )['code'] );

echo "legacy duplicates (created before 3.15.0) can still be edited\n";
RL_DB::save_record( 'contracts', 'cdl1', RL_DB::sanitize_record( 'contracts', $ct( 'Παλιά 1', '55/2020' )['data'] ), 1 );
RL_DB::save_record( 'contracts', 'cdl2', RL_DB::sanitize_record( 'contracts', $ct( 'Παλιά 2', '55/2020' )['data'] ), 1 );
t( 'editing a legacy duplicate without touching its number is allowed', 200 === $c->rl( 'PUT', 'records/contracts/cdl2', $ct( 'Παλιά 2 (διορθωμένη)', '55/2020' ) )['code'] );

echo "trash and restore\n";
$c->rl( 'DELETE', 'records/contracts/cd1' );
t( 'after the first contract is in the trash the number is free again', 200 === $c->rl( 'PUT', 'records/contracts/cd4', $ct( 'Νέα με τον αριθμό', '88/2027' ) )['code'] );
$r = $c->rl( 'POST', 'records/contracts/cd1/restore' );
t( 'restoring the old one is refused while the number is in use', 409 === $r['code'] && 'rl_duplicate_contract' === ( $r['json']['code'] ?? '' ), $r['code'] . $r['body'] );

echo "tender promotion\n";
$tnr = array( 'title' => 'Διαγωνισμός', 'tender' => '66/2027', 'description' => '', 'months' => 12, 'dateFrom' => '2027-01-01', 'dateTo' => '2027-12-31', 'cost' => 100, 'status' => 'active', 'years' => array( array( 'from' => '2027-01-01', 'to' => '2027-12-31', 'cost' => 100, 'remind' => 5 ) ) );
t( 'tender is saved', 200 === $c->rl( 'PUT', 'records/tenders/cdtn1', array( 'data' => $tnr ) )['code'] );
t( 'a contract may be created for the tender number of an active tender (promotion path)', 200 === $c->rl( 'PUT', 'records/contracts/cd5', $ct( 'Με αριθμό 66', '66/2027' ) )['code'] );
$r = $c->rl( 'POST', 'records/tenders/cdtn1/promote', array( 'contractId' => 'cdp1', 'data' => $ct( 'Προώθηση', '66/2027' )['data'] ) );
t( 'promoting a tender whose number a contract already has is refused (409)', 409 === $r['code'] && 'rl_duplicate_contract' === ( $r['json']['code'] ?? '' ), $r['code'] . $r['body'] );
t( 'and the tender stays active', 'active' === ( ( function () use ( $c ) { foreach ( $c->rl( 'GET', 'records/tenders' )['json']['items'] as $i ) { if ( 'cdtn1' === $i['id'] ) { return $i['data']['status']; } } } )() ) );
$c->rl( 'DELETE', 'records/contracts/cd5' ); $c->rl( 'DELETE', 'records/contracts/cd5&purge=1' );
$r = $c->rl( 'POST', 'records/tenders/cdtn1/promote', array( 'contractId' => 'cdp1', 'data' => $ct( 'Προώθηση', '66/2027' )['data'] ) );
t( 'after that contract is gone the promotion works', 200 === $r['code'], $r['code'] . $r['body'] );

$clean();
foreach ( $ids as $i ) { foreach ( array( 'contracts', 'tenders' ) as $co ) { RL_DB::delete_record( $co, $i ); } }
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
