<?php
/**
 * 3.22.0: when software is renewed, the invoices/receipts of the ending period move to that previous period.
 *   RL_TEST_ADMIN_PASS=... php software-history-files-test.php http://127.0.0.1:8088 /path/to/wp-load.php
 */
$base = rtrim( $argv[1] ?? 'http://127.0.0.1:8088', '/' );
$wpl = $argv[2] ?? '';
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




$A = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$yr = (int) date( 'Y' );
$A->rl( 'DELETE', 'records/software/hf1' ); $A->rl( 'DELETE', 'records/software/hf1&purge=1' );
$up = function ( $name ) use ( $A ) {
	$tmp = tempnam( sys_get_temp_dir(), 'hf' ); file_put_contents( $tmp, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF $name" );
	$r = $A->req( 'POST', '/?rest_route=/rl/v1/files&coll=software', array( 'file' => new CURLFile( $tmp, 'application/pdf', $name ) ), array(), true );
	return array( 'id' => $r['json']['id'] ?? '', 'name' => $name, 'size' => (int) ( $r['json']['sizeBytes'] ?? 0 ) );
};
$f1 = $up( 'invoice-old.pdf' ); $f2 = $up( 'licence.pdf' );
t( 'two files uploaded', '' !== $f1['id'] && '' !== $f2['id'] );
$base_d = array( 'name' => 'HF-soft', 'description' => '', 'vendor' => 'V', 'website' => '', 'username' => '', 'dateFrom' => ( $yr - 1 ) . '-01-01', 'dateTo' => ( $yr - 1 ) . '-12-31', 'cost' => 100, 'remindDays' => 30, 'emails' => '' );
$r = $A->rl( 'PUT', 'records/software/hf1', array( 'data' => $base_d + array( 'attachments' => array( $f1, $f2 ) ) ) );
t( 'software with two attachments saved', 200 === $r['code'], $r['body'] );
// renewal as the browser does it: invoice moves into the history entry, the licence stays
$ren = $base_d; $ren['dateFrom'] = $yr . '-01-01'; $ren['dateTo'] = $yr . '-12-31'; $ren['cost'] = 120;
$ren['history'] = array( array( 'from' => ( $yr - 1 ) . '-01-01', 'to' => ( $yr - 1 ) . '-12-31', 'cost' => 100, 'renewedOn' => date( 'Y-m-d' ), 'attachments' => array( $f1 ) ) );
$ren['attachments'] = array( $f2 );
$r = $A->rl( 'PUT', 'records/software/hf1', array( 'data' => $ren ) );
t( 'renewal saved', 200 === $r['code'], $r['body'] );
$g = function () use ( $A ) { foreach ( $A->rl( 'GET', 'records/software' )['json']['items'] ?? array() as $i ) { if ( 'hf1' === $i['id'] ) { return $i['data']; } } return null; };
$d = $g();
t( 'previous period holds the invoice', 'invoice-old.pdf' === ( $d['history'][0]['attachments'][0]['name'] ?? '' ), json_encode( $d['history'] ?? null ) );
t( 'current attachments keep only the licence', 1 === count( $d['attachments'] ?? array() ) && 'licence.pdf' === $d['attachments'][0]['name'] );
// a late invoice added straight to the previous period; unknown file ids are dropped
$ren['history'][0]['attachments'] = array( $f1, array( 'id' => str_repeat( 'a', 32 ), 'name' => 'ghost.pdf', 'size' => 1 ) );
$r = $A->rl( 'PUT', 'records/software/hf1', array( 'data' => $ren ) );
$d = $g();
t( 'unknown file id in a period is dropped', 200 === $r['code'] && 1 === count( $d['history'][0]['attachments'] ?? array() ), $r['body'] );
// the file of a previous period can be downloaded and is in the CSV export
t( 'file of the previous period downloads', 200 === $A->rl( 'GET', 'files/' . $f1['id'] )['code'] );
$x = $A->rl( 'GET', 'export/software' );
$xz = tempnam( sys_get_temp_dir(), 'hx' ); file_put_contents( $xz, $x['body'] ); $za = new ZipArchive(); $txt = '';
if ( true === $za->open( $xz ) ) { for ( $i = 0; $i < $za->numFiles; $i++ ) { $n = $za->getNameIndex( $i ); if ( preg_match( '#^xl/(sharedStrings|worksheets/sheet\\d+)\\.xml$#', $n ) ) { $txt .= $za->getFromIndex( $i ); } } }
t( 'export lists the previous period file with its period', false !== strpos( $txt, 'invoice-old.pdf [' . ( $yr - 1 ) . '-01-01' ), 'export is ' . strlen( $x['body'] ) . ' bytes' );
// permanent delete removes the files of the previous periods as well
$A->rl( 'DELETE', 'records/software/hf1' ); $A->rl( 'DELETE', 'records/software/hf1&purge=1' );
t( 'purge removes the previous-period file', 404 === $A->rl( 'GET', 'files/' . $f1['id'] )['code'] );
t( 'purge removes the current file', 404 === $A->rl( 'GET', 'files/' . $f2['id'] )['code'] );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
