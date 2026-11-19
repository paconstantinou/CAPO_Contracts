<?php
/**
 * Renewal note template (3.18.0): GET / PUT / DELETE /note-template, validation and permissions. HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php note-template-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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
function mkdocx( $extra = array(), $withDoc = true ) {
	$f = tempnam( sys_get_temp_dir(), 'dx' ); $z = new ZipArchive(); $z->open( $f, ZipArchive::OVERWRITE );
	$z->addFromString( '[Content_Types].xml', '<Types/>' );
	if ( $withDoc ) { $z->addFromString( 'word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>[Software Name]</w:t></w:r></w:p></w:body></w:document>' ); }
	foreach ( $extra as $n => $d ) { $z->addFromString( $n, $d ); }
	$z->close(); $b = file_get_contents( $f ); unlink( $f ); return $b;
}
$put = fn( $cl, $name, $bin ) => $cl->rl( 'PUT', 'note-template', array( 'name' => $name, 'data' => base64_encode( $bin ) ) );
$c->rl( 'DELETE', 'note-template' );
echo "note template\n";
$r = $c->rl( 'GET', 'note-template' );
t( 'GET without custom template says custom:false', 200 === $r['code'] && false === ( $r['json']['template']['custom'] ?? null ) );
$good = mkdocx();
$r = $put( $c, 'Μιά/πρότυπο<x>.docx', $good );
t( 'admin can upload a valid docx', 200 === $r['code'], json_encode( $r['json'] ) );
$r = $c->rl( 'GET', 'note-template' ); $t = $r['json']['template'] ?? array();
t( 'GET returns it: custom, sanitized name, size, same bytes', true === ( $t['custom'] ?? null ) && false === strpbrk( $t['name'] ?? '/', '/\\<>' ) && (int) $t['bytes'] === strlen( $good ) && base64_decode( $t['data'] ) === $good, json_encode( array_diff_key( $t, array( 'data' => 1 ) ) ) );
t( 'upload is logged', (bool) $wpdb->get_var( "SELECT COUNT(*) FROM $lt WHERE action LIKE '%note_template_saved%'" ) );
t( 'not a zip refused', 400 === $put( $c, 'a.docx', 'hello world' )['code'] );
t( 'zip without word/document.xml refused', 400 === $put( $c, 'a.docx', mkdocx( array(), false ) )['code'] );
t( 'macro project refused', 400 === $put( $c, 'a.docx', mkdocx( array( 'word/vbaProject.bin' => 'x' ) ) )['code'] );
t( 'activeX / embedded binary refused', 400 === $put( $c, 'a.docx', mkdocx( array( 'word/activeX/activeX1.xml' => 'x' ) ) )['code'] );
t( 'invalid base64 refused', 400 === $c->rl( 'PUT', 'note-template', array( 'name' => 'a.docx', 'data' => '***not base64***' ) )['code'] );
t( 'missing data refused', 400 === $c->rl( 'PUT', 'note-template', array( 'name' => 'a.docx' ) )['code'] );
t( 'over 2 MB refused', in_array( $c->rl( 'PUT', 'note-template', array( 'name' => 'a.docx', 'data' => base64_encode( mkdocx( array( 'word/media/big.bin' => random_bytes( 2200000 ) ) ) ) ) )['code'], array( 400, 413 ), true ) );
$t2 = $c->rl( 'GET', 'note-template' )['json']['template'];
t( 'refused uploads did not replace the stored template', base64_decode( $t2['data'] ) === $good );
/* roles */
foreach ( array( 'viewer1', 'editor1', 'manager1' ) as $u ) {
	$x = client( $base, $u, 'Pw-' . $u . '-12345!' );
	$g = $x->rl( 'GET', 'note-template' ); $w = $put( $x, 'h.docx', $good ); $d = $x->rl( 'DELETE', 'note-template' );
	echo "  ($u: GET {$g['code']} PUT {$w['code']} DELETE {$d['code']})\n";
	t( "$u: may read the template (needs it to prepare notes) but cannot change or delete it", 200 === $g['code'] && 403 === $w['code'] && 403 === $d['code'] );
}
$n = client( $base, 'nobody', 'Pw-nobody-12345!' );
t( 'user without module access cannot read it', in_array( $n->rl( 'GET', 'note-template' )['code'], array( 401, 403 ), true ) );
$a = new Client( $base );
t( 'anonymous: refused', in_array( $a->rl( 'GET', 'note-template' )['code'], array( 401, 403 ), true ) );
t( 'template still intact after the refused attempts', base64_decode( $c->rl( 'GET', 'note-template' )['json']['template']['data'] ) === $good );
$r = $c->rl( 'DELETE', 'note-template' );
t( 'admin can reset', 200 === $r['code'] && false === ( $c->rl( 'GET', 'note-template' )['json']['template']['custom'] ?? null ) );
t( 'reset is logged', (bool) $wpdb->get_var( "SELECT COUNT(*) FROM $lt WHERE action LIKE '%note_template_reset%'" ) );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
