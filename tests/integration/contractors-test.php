<?php
/**
 * Contractors (Ανάδοχοι): HTTP integration test against a live WordPress with
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
$get = function ( $k, $coll, $id ) { $r = $k->rl( 'GET', "records/$coll" ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };
$clean = function ( $k ) { foreach ( array( 'ctr1', 'ctr2', 'ctr3' ) as $i ) { $k->rl( 'DELETE', "records/contractors/$i" ); $k->rl( 'DELETE', "records/contractors/$i&purge=1" ); } foreach ( array( 'ctc1', 'ctc2' ) as $i ) { $k->rl( 'DELETE', "records/contracts/$i" ); $k->rl( 'DELETE', "records/contracts/$i&purge=1" ); } };
$clean( $c ); $clean( $c );
$ctr = array( 'name' => '  Παράδειγμα  Α.Ε. ', 'vat' => 'EL 123456789', 'region' => 'X', 'address' => 'Οδός 1', 'address2' => 'Όροφος 2', 'postal' => '1065', 'city' => 'Λευκωσία', 'region' => 'Λευκωσία', 'country' => 'Κύπρος', 'contact' => 'Γιάννης', 'phone' => '22 123456', 'email' => 'a@example.com; b@example.com', 'evil' => 'x' );

echo "contractors: create and sanitize\n";
$r = $c->rl( 'PUT', 'records/contractors/ctr1', array( 'data' => $ctr ) );
t( 'PUT contractor ok', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'contractors', 'ctr1' );
t( 'fields stored, unknown and removed fields (VAT, region) dropped', 'Παράδειγμα Α.Ε.' === preg_replace( '/\s+/u', ' ', $d['name'] ) && '1065' === $d['postal'] && 'Κύπρος' === $d['country'] && ! isset( $d['evil'] ) && ! isset( $d['vat'] ) && ! isset( $d['region'] ), json_encode( $d ) );
$r = $c->rl( 'PUT', 'records/contractors/ctr2', array( 'data' => array( 'name' => '' ) ) );
t( 'name is required (400)', 400 === $r['code'] );

echo "contractors: uniqueness\n";
$r = $c->rl( 'PUT', 'records/contractors/ctr2', array( 'data' => array( 'name' => 'ΠΑΡΑΔΕΙΓΜΑ α.ε.', 'vat' => '' ) ) );
t( 'same name (case/space-insensitive) -> 409', 409 === $r['code'] && 'rl_duplicate_contractor' === ( $r['json']['code'] ?? '' ), $r['body'] );
$r = $c->rl( 'PUT', 'records/contractors/ctr2', array( 'data' => array( 'name' => 'Άλλος', 'vat' => 'el123456789' ) ) );
t( 'VAT is no longer a key: a different name is accepted', 200 === $r['code'], $r['body'] );
$c->rl( 'DELETE', 'records/contractors/ctr2' ); $c->rl( 'DELETE', 'records/contractors/ctr2&purge=1' );
$r = $c->rl( 'PUT', 'records/contractors/ctr1', array( 'data' => $ctr ) );
t( 'saving itself again is fine', 200 === $r['code'], $r['body'] );
$r = $c->rl( 'PUT', 'records/contractors/ctr2', array( 'data' => array( 'name' => 'Δεύτερος Ε.Π.Ε.', 'vat' => '' ) ) );
t( 'a different contractor is accepted', 200 === $r['code'], $r['body'] );

echo "contracts: link to a contractor\n";
$ct = array( 'title' => 'Σύμβαση Α', 'tender' => '12/2026', 'months' => 12, 'dateFrom' => gmdate( 'Y-m-d', time() - 86400 * 30 ), 'dateTo' => gmdate( 'Y-m-d', time() + 86400 * 300 ),
	'years' => array( array( 'from' => gmdate( 'Y-m-d', time() - 86400 * 30 ), 'to' => gmdate( 'Y-m-d', time() + 86400 * 300 ), 'cost' => 100, 'remind' => 30 ) ),
	'contractorId' => 'ctr1', 'contractor' => 'FAKE', 'contractorVat' => 'old', 'contractorPhone' => 'old', 'repName' => 'Μαρία Αντιπρόσωπος', 'repPhone' => '99 123456', 'repEmail' => 'rep@example.com' );
$r = $c->rl( 'PUT', 'records/contracts/ctc1', array( 'data' => $ct ) );
t( 'PUT contract with contractorId ok', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'contracts', 'ctc1' );
t( 'name copy comes from the contractor, legacy fields cleared', 'ctr1' === $d['contractorId'] && $d['contractor'] === $get( $c, 'contractors', 'ctr1' )['name'] && '' === $d['contractorVat'] && '' === $d['contractorPhone'], json_encode( $d ) );
t( 'representative fields stored', 'Μαρία Αντιπρόσωπος' === $d['repName'] && '99 123456' === $d['repPhone'] && 'rep@example.com' === $d['repEmail'] );
$bad = $ct; $bad['contractorId'] = 'nope';
$r = $c->rl( 'PUT', 'records/contracts/ctc2', array( 'data' => $bad ) );
t( 'unknown contractor -> 400', 400 === $r['code'] && 'rl_bad_contractor' === ( $r['json']['code'] ?? '' ), $r['body'] );
$free = $ct; $free['contractorId'] = ''; $free['contractor'] = 'Ελεύθερο κείμενο'; $free['contractorVat'] = '999';
$r = $c->rl( 'PUT', 'records/contracts/ctc2', array( 'data' => $free ) );
$d = $get( $c, 'contracts', 'ctc2' );
t( 'contract without a link keeps legacy text', 200 === $r['code'] && 'Ελεύθερο κείμενο' === $d['contractor'] && '999' === $d['contractorVat'] );

echo "contractors: rename refreshes the copy in contracts\n";
$ctr2 = $ctr; $ctr2['name'] = 'Νέο Όνομα Α.Ε.';
$r = $c->rl( 'PUT', 'records/contractors/ctr1', array( 'data' => $ctr2 ) );
t( 'rename ok', 200 === $r['code'], $r['body'] );
t( 'contract copy updated', 'Νέο Όνομα Α.Ε.' === $get( $c, 'contracts', 'ctc1' )['contractor'] );

echo "contractors: in use cannot be deleted\n";
$r = $c->rl( 'DELETE', 'records/contractors/ctr1' );
t( 'delete while used -> 409', 409 === $r['code'] && 'rl_contractor_in_use' === ( $r['json']['code'] ?? '' ), $r['body'] );
t( 'still listed', null !== $get( $c, 'contractors', 'ctr1' ) );
$r = $c->rl( 'DELETE', 'records/contractors/ctr2' );
t( 'unused contractor goes to the trash', 200 === $r['code'] && ! empty( $r['json']['trashed'] ), $r['body'] );
$r = $c->rl( 'GET', 'records/contractors&trash=1' );
t( 'listed in the trash', in_array( 'ctr2', array_column( $r['json']['items'] ?? array(), 'id' ), true ) );

echo "contractors: restore checks duplicates\n";
$r = $c->rl( 'PUT', 'records/contractors/ctr3', array( 'data' => array( 'name' => 'Δεύτερος Ε.Π.Ε.' ) ) );
t( 'name of a trashed contractor can be reused', 200 === $r['code'], $r['body'] );
$r = $c->rl( 'POST', 'records/contractors/ctr2/restore' );
t( 'restore while the name is taken -> 409', 409 === $r['code'], $r['body'] );
$c->rl( 'DELETE', 'records/contractors/ctr3' );
$r = $c->rl( 'POST', 'records/contractors/ctr2/restore' );
t( 'restore works once it is free', 200 === $r['code'], $r['body'] );
$r = $c->rl( 'PUT', 'records/contracts/ctc2', array( 'data' => array_merge( $ct, array( 'contractorId' => 'ctr3' ) ) ) );
t( 'cannot link a trashed contractor (400)', 400 === $r['code'], $r['body'] );

echo "contractors: export with counts\n";
$d = $get( $c, 'contracts', 'ctc1' );
$r = $c->req( 'GET', '/?rest_route=/rl/v1/export/contractors&format=csv' );
t( 'export csv 200', 200 === $r['code'], substr( $r['body'], 0, 200 ) );
t( 'csv has the count columns and the contractor row', false !== strpos( $r['body'], 'ΕΝΕΡΓΕΣ ΣΥΜΒΑΣΕΙΣ' ) && false === strpos( $r['body'], 'ΑΦΜ' ) && false !== strpos( $r['body'], 'Νέο Όνομα Α.Ε.' ) );
$lines = preg_split( '/\r?\n/', trim( $r['body'] ) ); $row = null; foreach ( $lines as $ln ) { if ( false !== strpos( $ln, 'Νέο Όνομα' ) ) { $row = str_getcsv( $ln ); } }
t( 'active contracts = 1 and the tender number is listed', $row && '12/2026' === end( $row ) && '1' === $row[ count( $row ) - 2 ], json_encode( $row ) );
$r = $c->req( 'GET', '/?rest_route=/rl/v1/export/contracts&format=csv' );
t( 'contracts export has contractor details and representative', false !== strpos( $r['body'], 'ΑΝΤΙΠΡΟΣΩΠΟΣ' ) && false !== strpos( $r['body'], 'Μαρία Αντιπρόσωπος' ) && false === strpos( $r['body'], 'EL 123456789' ), '' );

echo "contractors: permissions\n";
foreach ( array( 'nobody' ) as $u ) {
	$k = client( $base, $u, "Pw-$u-12345!" );
	t( "$u: list 403", 403 === $k->rl( 'GET', 'records/contractors' )['code'] );
	t( "$u: create 403", 403 === $k->rl( 'PUT', 'records/contractors/ctr9', array( 'data' => array( 'name' => 'X' ) ) )['code'] );
}
$v = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
t( 'viewer1: no access to contractors by default or can only view', in_array( $v->rl( 'GET', 'records/contractors' )['code'], array( 200, 403 ), true ) );
t( 'viewer1: cannot create', 403 === $v->rl( 'PUT', 'records/contractors/ctr9', array( 'data' => array( 'name' => 'X' ) ) )['code'] );
t( 'viewer1: cannot delete', 403 === $v->rl( 'DELETE', 'records/contractors/ctr1' )['code'] );

echo "cleanup\n";
$clean( $c ); $clean( $c );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
