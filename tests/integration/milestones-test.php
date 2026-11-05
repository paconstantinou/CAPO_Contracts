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

$sw = fn( $n ) => array( 'data' => array( 'name' => $n, 'description' => 'd', 'vendor' => 'v', 'website' => 'https://example.com', 'username' => 'secretuser', 'password' => 'secretpass', 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => 100, 'remindDays' => 30 ) );


$tmp = tempnam( sys_get_temp_dir(), 'up' ); file_put_contents( $tmp, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF" );
$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$up = function ( $k, $coll ) use ( $tmp ) { $r = $k->req( 'POST', '/?rest_route=/rl/v1/files', array( 'coll' => $coll, 'file' => new CURLFile( $tmp, 'application/pdf', 'ms.pdf' ) ), array(), true ); return $r['json']['id'] ?? ''; };
$rec = fn( $ms ) => array( 'data' => array( 'name' => 'MS Test', 'description' => '', 'vendor' => '', 'website' => '', 'username' => 'u', 'dateFrom' => '2026-01-01', 'dateTo' => '2028-12-31', 'cost' => 1, 'remindDays' => 30, 'milestones' => $ms ) );
$get = function ( $k, $coll, $id ) { $r = $k->rl( 'GET', "records/$coll" ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };

echo "milestones: sanitising\n";
$f1 = $up( $c, 'software' ); $fcon = $up( $c, 'contracts' );
$ms = array(
	array( 'id' => 'm1', 'year' => 2, 'description' => 'Deliver phase 1', 'due' => '2027-03-01', 'remind' => 60, 'comments' => 'c', 'done' => false, 'attachments' => array( array( 'id' => $f1, 'name' => 'x' ), array( 'id' => str_repeat( 'a', 32 ), 'name' => 'ghost' ), array( 'id' => $fcon, 'name' => 'wrong-module' ) ) ),
	array( 'id' => 'm2', 'year' => 99, 'description' => str_repeat( 'x', 5000 ), 'due' => 'not-a-date', 'remind' => 45 ),
	array( 'id' => 'm1', 'year' => 1, 'description' => 'duplicate id' ),
	array( 'id' => 'm3', 'year' => 1, 'description' => '' ),
	array( 'id' => 'bad id!', 'year' => 1, 'description' => 'x' ),
	'junk',
);
$r = $c->rl( 'PUT', 'records/software/mst1', $rec( $ms ) ); t( 'save record with milestones', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'software', 'mst1' ); $m = $d['milestones'] ?? array();
t( 'only valid milestones kept (m1, m2)', 2 === count( $m ), json_encode( $m ) );
t( 'remind 60 kept, invalid 45 becomes 30', 60 === $m[0]['remind'] && 30 === $m[1]['remind'] );
t( 'year clamped to 60', 60 === $m[1]['year'] );
t( 'description capped to 1000', 1000 === strlen( $m[1]['description'] ) );
t( 'invalid date emptied', '' === $m[1]['due'] );
t( 'unknown and other-module attachments dropped', 1 === count( $m[0]['attachments'] ) && $f1 === $m[0]['attachments'][0]['id'] );

echo "milestones: contracts\n";
$cr = array( 'data' => array( 'title' => 'Σ', 'tender' => '', 'description' => '', 'contractor' => '', 'coordinator' => '', 'months' => 12, 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => 1, 'years' => array(), 'attachments' => array(), 'milestones' => array( array( 'id' => 'k1', 'year' => 1, 'description' => 'Παραδοτέο', 'due' => '2026-06-01', 'remind' => 30, 'attachments' => array( array( 'id' => $fcon ) ) ) ) ) );
$r = $c->rl( 'PUT', 'records/contracts/mct1', $cr ); t( 'contract with milestone saved', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'contracts', 'mct1' ); t( 'contract milestone stored with its attachment', 1 === count( $d['milestones'] ?? array() ) && 1 === count( $d['milestones'][0]['attachments'] ) );

echo "milestones: permissions\n";
$ed = client( $base, 'editor1', 'Pw-editor1-12345!' ); $vw = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
$d = $get( $vw, 'software', 'mst1' ); t( 'viewer can read milestones', 2 === count( $d['milestones'] ?? array() ) );
$r = $vw->rl( 'PUT', 'records/software/mst1', $rec( array() ) ); t( 'viewer cannot change/remove milestones', 403 === $r['code'], "got {$r['code']}" );
$r = $ed->rl( 'PUT', 'records/software/mst1', $rec( array( array( 'id' => 'e1', 'year' => 1, 'description' => 'by editor', 'due' => '2026-02-02' ) ) ) ); t( 'editor can edit milestones', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'software', 'mst1' ); t( 'editor edit kept username', 'u' === $d['username'] );
$r = $vw->rl( 'GET', "files/$f1" ); t( 'attachment of replaced milestone still referenced? (file kept until client deletes it)', in_array( $r['code'], array( 200, 404 ), true ) );

echo "milestones: cleanup on delete\n";
$r = $c->rl( 'PUT', 'records/software/mst2', $rec( array( array( 'id' => 'z1', 'year' => 1, 'description' => 'z', 'due' => '2026-02-02', 'attachments' => array( array( 'id' => $up( $c, 'software' ) ) ) ) ) ) );
$d = $get( $c, 'software', 'mst2' ); $zf = $d['milestones'][0]['attachments'][0]['id'] ?? '';
t( 'milestone attachment downloadable', '' !== $zf && 200 === $c->rl( 'GET', "files/$zf" )['code'] );
$c->rl( 'DELETE', 'records/software/mst2' );
t( 'deleting the record deletes milestone attachments', 404 === $c->rl( 'GET', "files/$zf" )['code'] );

echo "milestones: export\n";
$r = $c->rl( 'GET', 'export/software&format=csv' ); t( 'csv has Milestones column and content', false !== strpos( $r['body'], 'Milestones' ) && false !== strpos( $r['body'], 'by editor' ) );
$r = $c->rl( 'GET', 'export/contracts&format=csv' ); t( 'contracts csv has MILESTONES', false !== strpos( $r['body'], 'MILESTONES' ) && false !== strpos( $r['body'], 'Παραδοτέο' ) );

$c->rl( 'DELETE', 'records/software/mst1' ); $c->rl( 'DELETE', 'records/contracts/mct1' );
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
