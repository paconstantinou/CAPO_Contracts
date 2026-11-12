<?php
/**
 * Attachment file types: HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php attachment-types-test.php http://127.0.0.1:8088
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
$tmp = tempnam( sys_get_temp_dir(), 'att' ); file_put_contents( $tmp, "<?xml version=\"1.0\"?><a xmlns=\"http://www.w3.org/1999/xhtml\"><script>alert(1)</script></a>" );
foreach ( array( 'xml', 'eml', 'msg', 'lic', 'json', 'rtf', '7z', 'cer', 'p7m', 'tiff', 'dwg' ) as $ext ) {
	$r = $c->req( 'POST', '/?rest_route=/rl/v1/files&coll=contracts', array( 'file' => new CURLFile( $tmp, 'application/octet-stream', 'probe.' . $ext ) ), array(), true );
	t( ".$ext accepted", 200 === $r['code'] && ! empty( $r['json']['id'] ), $r['code'] . ' ' . $r['body'] );
	if ( 'xml' === $ext && ! empty( $r['json']['id'] ) ) {
		$g = $c->req( 'GET', '/?rest_route=/rl/v1/files/' . $r['json']['id'] );
		t( 'xml is served as a download (attachment) with nosniff and a sandbox CSP', 200 === $g['code'] && false !== stripos( $g['head'], 'Content-Disposition: attachment' ) && false !== stripos( $g['head'], 'nosniff' ) && false !== stripos( $g['head'], 'sandbox' ), $g['head'] );
	}
	if ( ! empty( $r['json']['id'] ) ) { $c->rl( 'DELETE', 'files/' . $r['json']['id'] ); }
}
foreach ( array( 'exe', 'php', 'js', 'bat', 'svg', 'phtml' ) as $ext ) {
	$r = $c->req( 'POST', '/?rest_route=/rl/v1/files&coll=contracts', array( 'file' => new CURLFile( $tmp, 'application/octet-stream', 'probe.' . $ext ) ), array(), true );
	t( ".$ext still refused (415)", 415 === $r['code'], $r['code'] . ' ' . $r['body'] );
}
unlink( $tmp );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
