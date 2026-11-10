<?php
/**
 * Tenders (Διαγωνισμοί): HTTP integration test against a live WordPress with
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

$sw = fn( $n ) => array( 'data' => array( 'name' => $n, 'description' => 'd', 'vendor' => 'v', 'website' => 'https://example.com', 'username' => 'secretuser', 'password' => 'legacypass', 'emails' => 'a@example.com; b@example.com', 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => 100, 'remindDays' => 30 ) );



$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$ids = function ( $k, $coll, $trash = false ) { $r = $k->rl( 'GET', "records/$coll" . ( $trash ? '&trash=1' : '' ) ); return 200 === $r['code'] ? array_column( $r['json']['items'], 'id' ) : null; };
$get = function ( $k, $coll, $id ) { $r = $k->rl( 'GET', "records/$coll" ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };
$clean = function ( $k ) { foreach ( array( 'tnt1', 'tnt2', 'tnt3', 'tnc1' ) as $i ) { foreach ( array( 'tenders', 'contracts' ) as $co ) { $k->rl( 'DELETE', "records/$co/$i" ); $k->rl( 'DELETE', "records/$co/$i&purge=1" ); } } };
$clean( $c );

echo "tenders: create and sanitize\n";
$tn = array( 'title' => 'Νέος Διαγωνισμός', 'tender' => 'ΔΙΑΓ-77/2027', 'description' => 'Περιγραφή', 'months' => 24, 'dateFrom' => '2027-03-15', 'dateTo' => '2029-03-14', 'cost' => 99999,
	'years' => array( array( 'from' => '2027-03-15', 'to' => '2028-03-14', 'cost' => 0, 'remind' => 5 ), array( 'from' => '2028-03-15', 'to' => '2029-03-14', 'cost' => 0 ) ),
	'budget' => array( array( 'year' => 1, 'article' => '2420', 'amount' => 600 ), array( 'year' => 1, 'article' => '2430', 'amount' => 400 ), array( 'year' => 2, 'article' => '2420', 'amount' => 700 ) ),
	'status' => 'promoted', 'promotedTo' => 'x', 'contractor' => 'SHOULD-NOT-STAY', 'emails' => 'bad' );
$r = $c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $tn ) );
t( 'PUT tender ok', 200 === $r['code'], $r['body'] );
$d = $get( $c, 'tenders', 'tnt1' );
t( 'stored with name and number', 'Νέος Διαγωνισμός' === $d['title'] && 'ΔΙΑΓ-77/2027' === $d['tender'] );
t( 'client cannot set status promoted -> active', 'active' === $d['status'] && '' === $d['promotedTo'], json_encode( $d ) );
t( 'contract-only fields are dropped (contractor, emails, milestones)', ! isset( $d['contractor'] ) && ! isset( $d['emails'] ) && ! isset( $d['milestones'] ) );
t( 'years carry no reminder', 2 === count( $d['years'] ) && ! isset( $d['years'][0]['remind'] ) );
t( 'year cost = sum of partial amounts', 1000.0 == $d['years'][0]['cost'] && 700.0 == $d['years'][1]['cost'], json_encode( $d['years'] ) );
$r = $c->rl( 'PUT', 'records/tenders/tnt2', array( 'data' => array( 'title' => '' ) ) );
t( 'name is required (400)', 400 === $r['code'] );

echo "tenders: cancel\n";
$d['status'] = 'cancelled';
$r = $c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $d ) );
$d2 = $get( $c, 'tenders', 'tnt1' );
t( 'cancel stores status and date', 200 === $r['code'] && 'cancelled' === $d2['status'] && ! empty( $d2['statusAt'] ), json_encode( $d2 ) );
t( 'cancelled tender keeps its data for reference', 2 === count( $d2['budget'] ?? array() ) + 1 || count( $d2['budget'] ) >= 3 );
$r = $c->rl( 'POST', 'records/tenders/tnt1/promote', array( 'contractId' => 'tnc1', 'data' => array( 'title' => 'X' ) ) );
t( 'a cancelled tender cannot be promoted (409)', 409 === $r['code'], $r['body'] );
$d2['status'] = 'active';
$c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $d2 ) );
t( 'cancelled tender can be re-activated', 'active' === $get( $c, 'tenders', 'tnt1' )['status'] );

echo "tenders: promote\n";
$f = $c->req( 'POST', '/?rest_route=/rl/v1/files', array( 'coll' => 'tenders', 'file' => curl_file_create( __FILE__, 'text/plain', 'x.txt' ) ), array(), true );
$up = $c->req( 'POST', '/?rest_route=/rl/v1/files&coll=tenders', array( 'file' => new CURLFile( __DIR__ . '/set-override.php', 'application/pdf', 'spec.pdf' ) ), array(), true );
$att = $up['json'] ?? null;
if ( $att && ! empty( $att['id'] ) ) {
	$d['attachments'] = array( array( 'id' => $att['id'] ) );
	$d['status'] = 'active';
	$c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $d ) );
}
$cur = $get( $c, 'tenders', 'tnt1' );
t( 'tender has an attachment', ! empty( $cur['attachments'] ), json_encode( $up['body'] ) );
$contract = array( 'title' => 'Σύμβαση από διαγωνισμό', 'tender' => 'ΔΙΑΓ-77/2027', 'description' => 'Περιγραφή', 'contractor' => 'ACME', 'months' => 24, 'dateFrom' => '2027-04-01', 'dateTo' => '2029-03-31', 'cost' => 1700,
	'years' => array( array( 'from' => '2027-04-01', 'to' => '2028-03-31', 'cost' => 0, 'remind' => 30 ), array( 'from' => '2028-04-01', 'to' => '2029-03-31', 'cost' => 0, 'remind' => 30 ) ),
	'budget' => $tn['budget'], 'attachments' => $cur['attachments'] );
$r = $c->rl( 'POST', 'records/tenders/tnt1/promote', array( 'contractId' => 'tnc1', 'data' => $contract ) );
t( 'promote ok', 200 === $r['code'] && ! empty( $r['json']['ok'] ), $r['body'] );
$ct = $get( $c, 'contracts', 'tnc1' );
t( 'contract created with the corrected values', $ct && 'ACME' === $ct['contractor'] && '2027-04-01' === $ct['dateFrom'] );
t( 'contract keeps the partial amounts', $ct && 3 === count( $ct['budget'] ) && 1000.0 == $ct['years'][0]['cost'] );
$tt = $get( $c, 'tenders', 'tnt1' );
t( 'tender is marked promoted and points to the contract', 'promoted' === $tt['status'] && 'tnc1' === $tt['promotedTo'], json_encode( $tt ) );
if ( ! empty( $cur['attachments'] ) ) {
	t( 'contract got its own copy of the attachment', ! empty( $ct['attachments'] ) && $ct['attachments'][0]['id'] !== $cur['attachments'][0]['id'] );
	$g = $c->rl( 'GET', 'files/' . $ct['attachments'][0]['id'] );
	t( 'copied attachment downloads', 200 === $g['code'] );
	$g = $c->rl( 'GET', 'files/' . $cur['attachments'][0]['id'] );
	t( 'original attachment still downloads', 200 === $g['code'] );
}
$r = $c->rl( 'POST', 'records/tenders/tnt1/promote', array( 'contractId' => 'tnc2', 'data' => $contract ) );
t( 'a promoted tender cannot be promoted twice (409)', 409 === $r['code'] );
$tt['status'] = 'active'; $tt['promotedTo'] = '';
$c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $tt ) );
$tt = $get( $c, 'tenders', 'tnt1' );
t( 'a promoted tender stays promoted on edit', 'promoted' === $tt['status'] && 'tnc1' === $tt['promotedTo'] );
$r = $c->rl( 'POST', 'records/tenders/nope/promote', array( 'contractId' => 'tnc9', 'data' => $contract ) );
t( 'promote of an unknown tender is 404', 404 === $r['code'] );
$c->rl( 'PUT', 'records/tenders/tnt3', array( 'data' => array( 'title' => 'Δεύτερος' ) ) );
$r = $c->rl( 'POST', 'records/tenders/tnt3/promote', array( 'contractId' => 'tnc1', 'data' => $contract ) );
t( 'promote onto an existing contract id is refused (409)', 409 === $r['code'] );
$r = $c->rl( 'POST', 'records/tenders/tnt3/promote', array( 'contractId' => 'tnc5', 'data' => array( 'title' => '' ) ) );
t( 'promote with an invalid contract is refused (400) and the tender stays active', 400 === $r['code'] && 'active' === $get( $c, 'tenders', 'tnt3' )['status'] );

echo "tenders: trash, export, permissions\n";
$r = $c->rl( 'DELETE', 'records/tenders/tnt3' );
t( 'delete moves tender to trash', ! empty( $r['json']['trashed'] ) && in_array( 'tnt3', $ids( $c, 'tenders', true ), true ) );
$r = $c->rl( 'POST', 'records/tenders/tnt3/restore' );
t( 'restore works', 200 === $r['code'] && in_array( 'tnt3', $ids( $c, 'tenders' ), true ) );
$r = $c->req( 'GET', '/?rest_route=/rl/v1/export/tenders&format=csv' );
t( 'CSV export contains the tender and its status', 200 === $r['code'] && false !== strpos( $r['body'], 'ΔΙΑΓ-77/2027' ) && false !== strpos( $r['body'], 'Προωθήθηκε' ), substr( $r['body'], 0, 200 ) );
$anon = new Client( $base );
t( 'anonymous cannot list tenders', in_array( $anon->rl( 'GET', 'records/tenders' )['code'], array( 401, 403 ), true ) );
foreach ( array( 'viewer1', 'nobody' ) as $u ) {
	$k = client( $base, $u, 'Pw-' . $u . '-12345!' );
	$r1 = $k->rl( 'PUT', 'records/tenders/tnt2', array( 'data' => array( 'title' => 'no' ) ) );
	$r2 = $k->rl( 'POST', 'records/tenders/tnt1/promote', array( 'contractId' => 'tnc7', 'data' => $contract ) );
	t( "$u cannot create or promote tenders", in_array( $r1['code'], array( 401, 403 ), true ) && in_array( $r2['code'], array( 401, 403 ), true ), $r1['code'] . '/' . $r2['code'] );
	t( "$u: nothing was created", null === $get( $c, 'tenders', 'tnt2' ) && null === $get( $c, 'contracts', 'tnc7' ) );
}
echo "tender numbers are unique\n";
$clean( $c );
$mkt = function ( $title, $num ) { return array( 'title' => $title, 'tender' => $num, 'months' => 12, 'dateFrom' => '2028-01-01', 'dateTo' => '2028-12-31', 'cost' => 10, 'years' => array( array( 'from' => '2028-01-01', 'to' => '2028-12-31', 'cost' => 10 ) ) ); };
$r = $c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $mkt( 'Πρώτος', 'ΑΡ-5/2028' ) ) ); t( 'first tender with the number is saved', 200 === $r['code'], $r['code'] );
$r = $c->rl( 'PUT', 'records/tenders/tnt2', array( 'data' => $mkt( 'Δεύτερος', 'ΑΡ-5/2028' ) ) ); t( 'same number on another tender: 409', 409 === $r['code'] && 'rl_duplicate_tender' === ( $r['json']['code'] ?? '' ), $r['code'] . $r['body'] );
$r = $c->rl( 'PUT', 'records/tenders/tnt2', array( 'data' => $mkt( 'Δεύτερος', ' αρ-5 / 2028 ' ) ) ); t( 'case and spaces do not make it different: 409', 409 === $r['code'], $r['code'] );
t( 'nothing was saved by the refused requests', null === $get( $c, 'tenders', 'tnt2' ) );
$r = $c->rl( 'PUT', 'records/tenders/tnt1', array( 'data' => $mkt( 'Πρώτος (αλλαγή)', 'ΑΡ-5/2028' ) ) ); t( 'a tender can be saved again with its own number', 200 === $r['code'], $r['code'] );
$r = $c->rl( 'PUT', 'records/tenders/tnt2', array( 'data' => $mkt( 'Χωρίς αριθμό Α', '' ) ) ); $r2 = $c->rl( 'PUT', 'records/tenders/tnt3', array( 'data' => $mkt( 'Χωρίς αριθμό Β', '' ) ) );
t( 'tenders without a number are not treated as duplicates', 200 === $r['code'] && 200 === $r2['code'] );
foreach ( array( 'tnt2', 'tnt3' ) as $i ) { $c->rl( 'DELETE', "records/tenders/$i" ); $c->rl( 'DELETE', "records/tenders/$i&purge=1" ); }
$c->rl( 'DELETE', 'records/tenders/tnt1' );
$r = $c->rl( 'PUT', 'records/tenders/tnt2', array( 'data' => $mkt( 'Νέος με τον ίδιο αριθμό', 'ΑΡ-5/2028' ) ) ); t( 'the number of a trashed tender can be used again', 200 === $r['code'], $r['code'] );
$r = $c->rl( 'POST', 'records/tenders/tnt1/restore' ); t( 'restoring the trashed tender is refused while its number is in use: 409', 409 === $r['code'] && 'rl_duplicate_tender' === ( $r['json']['code'] ?? '' ), $r['code'] . $r['body'] );
$c->rl( 'DELETE', 'records/tenders/tnt2' ); $c->rl( 'DELETE', 'records/tenders/tnt2&purge=1' );
$r = $c->rl( 'POST', 'records/tenders/tnt1/restore' ); t( 'it can be restored once the number is free', 200 === $r['code'], $r['code'] );

echo "contract: contractor details\n";
$k = array( 'title' => 'Με στοιχεία αναδόχου', 'tender' => 'Χ-1', 'contractor' => 'Ανάδοχος ΑΕ', 'contractorVat' => 'CY123', 'contractorAddress' => 'Οδός 1', 'contractorContact' => 'Μαρία', 'contractorPhone' => '+357 22 123456', 'contractorEmail' => 'a@x.com; b@y.org', 'months' => 12, 'dateFrom' => '2028-01-01', 'dateTo' => '2028-12-31', 'cost' => 5, 'years' => array( array( 'from' => '2028-01-01', 'to' => '2028-12-31', 'cost' => 5, 'remind' => 30 ) ) );
$r = $c->rl( 'PUT', 'records/contracts/tnc1', array( 'data' => $k ) ); t( 'contract with contractor details is saved', 200 === $r['code'], $r['code'] . $r['body'] );
$g = $get( $c, 'contracts', 'tnc1' );
t( 'contractor details are stored', $g && 'CY123' === $g['contractorVat'] && 'Οδός 1' === $g['contractorAddress'] && 'Μαρία' === $g['contractorContact'] && '+357 22 123456' === $g['contractorPhone'] && 'a@x.com; b@y.org' === $g['contractorEmail'], json_encode( $g ) );
$ex = $c->req( 'GET', '/?rest_route=/rl/v1/export/contracts&format=csv' );
t( 'the Excel/CSV export has the new contractor columns', false !== strpos( $ex['body'], 'ΤΗΛΕΦΩΝΟ ΑΝΑΔΟΧΟΥ' ) && false !== strpos( $ex['body'], '+357 22 123456' ), substr( $ex['body'], 0, 200 ) );
$c->rl( 'DELETE', 'records/contracts/tnc1' );
$clean( $c );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
