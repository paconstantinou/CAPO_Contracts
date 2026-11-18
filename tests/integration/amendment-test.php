<?php
/**
 * Contract amendments are append-only (3.16.0). HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php amendment-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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
$c->rl( 'DELETE', 'records/contracts/am1' ); $c->rl( 'DELETE', 'records/contracts/am1&purge=1' );
$ct = fn( $cost, $am = array() ) => array( 'data' => array( 'title' => 'Σύμβαση τροποποίησης', 'tender' => 'AM-77/2027', 'description' => '', 'contractor' => 'ACME', 'months' => 12, 'dateFrom' => '2027-01-01', 'dateTo' => '2027-12-31', 'cost' => $cost,
	'years' => array( array( 'from' => '2027-01-01', 'to' => '2027-12-31', 'cost' => $cost, 'remind' => 30 ) ), 'amendments' => $am ) );
$A = fn( $id, $desc, $b, $a ) => array( 'id' => $id, 'date' => '2027-06-01', 'description' => $desc, 'at' => 1, 'changes' => array( array( 'label' => 'ΚΟΣΤΟΣ', 'old' => "€$b", 'new' => "€$a" ) ), 'costBefore' => $b, 'costAfter' => $a,
	'before' => array( 'title' => 'x', 'tender' => 'AM-77/2027', 'months' => 12, 'dateFrom' => '2027-01-01', 'dateTo' => '2027-12-31', 'cost' => $b, 'years' => array( array( 'from' => '2027-01-01', 'to' => '2027-12-31', 'cost' => $b ) ), 'budget' => array(), 'extras' => array() ) );
$get = function () use ( $c ) { foreach ( $c->rl( 'GET', 'records/contracts' )['json']['items'] as $i ) { if ( 'am1' === $i['id'] ) { return $i['data']; } } return null; };

echo "amendments\n";
t( 'contract without amendments is saved', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1000 ) )['code'] );
t( 'a new amendment is stored', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1500, array( $A( 'a1', 'ΤΕΑΑ', 1000, 1500 ) ) ) )['code'] && 1 === count( $get()['amendments'] ) );
$s = $get()['amendments'][0];
t( 'its fields survive (description, costs, changes, before snapshot)', 'ΤΕΑΑ' === $s['description'] && 1000 == $s['costBefore'] && 1500 == $s['costAfter'] && 'ΚΟΣΤΟΣ' === $s['changes'][0]['label'] && 1000 == $s['before']['cost'] );
t( 'server stamps the time of the amendment', $s['at'] > 1000000000000, $s['at'] );
t( 'saving the contract again with an empty list does not delete the history', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1500, array() ) )['code'] && 1 === count( $get()['amendments'] ) );
t( 'an old entry sent back with a changed description keeps its original text', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1500, array( $A( 'a1', 'ΞΕΧΑΣΕ ΤΟ', 1, 2 ) ) ) )['code'] && 'ΤΕΑΑ' === $get()['amendments'][0]['description'] && 1000 == $get()['amendments'][0]['costBefore'] );
t( 'a second amendment is appended after the first', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1800, array( $A( 'a1', 'x', 1, 1 ), $A( 'a2', 'ΚΕΑΑ', 1500, 1800 ) ) ) )['code'] && array( 'a1', 'a2' ) === array_column( $get()['amendments'], 'id' ) );
t( 'an entry without a description is dropped', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1800, array( $A( 'a3', '', 1800, 1900 ) ) ) )['code'] && 2 === count( $get()['amendments'] ) );
$many = array(); for ( $i = 0; $i < 9; $i++ ) { $many[] = $A( 'n' . $i, 'Μ' . $i, 1, 2 ); }
$c->rl( 'PUT', 'records/contracts/am1', $ct( 1800, $many ) );
t( 'at most 5 new amendments per save', 7 === count( $get()['amendments'] ), count( $get()['amendments'] ) );
t( 'a contract edited without touching amendments keeps them', 200 === $c->rl( 'PUT', 'records/contracts/am1', $ct( 1800 ) )['code'] && 7 === count( $get()['amendments'] ) );
$row = $wpdb->get_row( "SELECT * FROM $lt WHERE action = 'ledger.contract_amended' ORDER BY id DESC LIMIT 1", ARRAY_A );
t( 'every amendment is written to the activity log', $row && false !== strpos( $row['details'], 'am1' ), json_encode( $row ) );
t( 'the audit chain is still intact', ! defined( 'RL_AUDIT_KEY' ) || true === RL_Audit_Chain::verify()['ok'] );
$c->rl( 'DELETE', 'records/contracts/am1' ); $c->rl( 'DELETE', 'records/contracts/am1&purge=1' );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
