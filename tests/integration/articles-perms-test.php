<?php
/**
 * Budget articles permissions (module "articles": create / edit / delete): HTTP integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php articles-perms-test.php http://127.0.0.1:8088 /path/to/wp-load.php
 *
 * Expects users admin (Super Admin), viewer1, editor1, manager1, nobody (passwords "Pw-<login>-12345!"). Env: RL_TEST_ADMIN_PASS.
 */
$base = rtrim( $argv[1] ?? 'http://127.0.0.1:8088', '/' );
$wp   = $argv[2] ?? ''; if ( ! $wp ) { die( "Usage: php articles-perms-test.php <base-url> <path/to/wp-load.php>\n" ); }
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

$ov = function ( $u, ...$pairs ) use ( $wp ) { return trim( shell_exec( 'php ' . escapeshellarg( __DIR__ . '/set-override.php' ) . ' ' . escapeshellarg( $wp ) . ' ' . escapeshellarg( $u ) . ' ' . implode( ' ', array_map( 'escapeshellarg', $pairs ) ) ) ); };
$c = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$row = fn( $code, $desc = 'd' ) => array( 'code' => $code, 'desc' => $desc, 'cat' => 'c', 'catDesc' => 'cd', 'split' => false );
$put = fn( $k, array $list ) => $k->rl( 'PUT', 'articles', array( 'articles' => $list ) );
$ids = fn( $r ) => array_column( $r['json']['articles'] ?? array(), 'code' );

echo "articles module\n";
$base_list = $put( $c, array( $row( 'P1', 'one' ), $row( 'P2', 'two' ) ) );
t( 'admin (Super Admin) can set the list', 200 === $base_list['code'] && array( 'P1', 'P2' ) === $ids( $base_list ), json_encode( $base_list['json'] ) );
$m = fn() => client( $base, 'manager1', 'Pw-manager1-12345!' );
$cur = array( $row( 'P1', 'one' ), $row( 'P2', 'two' ) );
t( 'manager has no articles permission by default', 403 === $put( $m(), $cur )['code'] );
t( 'editor and viewer neither', 403 === $put( client( $base, 'editor1', 'Pw-editor1-12345!' ), $cur )['code'] && 403 === $put( client( $base, 'viewer1', 'Pw-viewer1-12345!' ), $cur )['code'] );

echo "create only\n";
t( 'grant articles:create', 'ok' === $ov( 'manager1', 'articles:create=allow' ) );
$r = $put( $m(), array_merge( $cur, array( $row( 'P3', 'three' ) ) ) );
t( 'can add a new article', 200 === $r['code'] && in_array( 'P3', $ids( $r ), true ), $r['code'] . $r['body'] );
$r = $put( $m(), array( $row( 'P1', 'CHANGED' ), $row( 'P2', 'two' ), $row( 'P3', 'three' ) ) );
t( 'cannot change an existing article', 403 === $r['code'], $r['code'] );
$r = $put( $m(), array( $row( 'P1', 'one' ), $row( 'P3', 'three' ) ) );
t( 'cannot remove an article', 403 === $r['code'], $r['code'] );
t( 'nothing was changed by the refused requests', array( 'P1', 'P2', 'P3' ) === $ids( $put( $c, array( $row( 'P1', 'one' ), $row( 'P2', 'two' ), $row( 'P3', 'three' ) ) ) ) );

echo "edit only\n";
$ov( 'manager1', 'articles:create=', 'articles:edit=allow' );
$r = $put( $m(), array( $row( 'P1', 'CHANGED' ), $row( 'P2', 'two' ), $row( 'P3', 'three' ) ) );
t( 'can change an existing article', 200 === $r['code'] && 'CHANGED' === $r['json']['articles'][0]['desc'], $r['code'] . $r['body'] );
$r = $put( $m(), array( $row( 'P1', 'CHANGED' ), $row( 'P2', 'two' ), $row( 'P3', 'three' ), $row( 'P4' ) ) );
t( 'cannot add', 403 === $r['code'], $r['code'] );
$r = $put( $m(), array( $row( 'P1', 'CHANGED' ), $row( 'P2', 'two' ) ) );
t( 'cannot remove', 403 === $r['code'], $r['code'] );
$r = $put( $m(), array( $row( 'P1', 'CHANGED' ), $row( 'P2', 'two' ), $row( 'P3', 'three' ) ) );
t( 'saving the list unchanged is fine', 200 === $r['code'], $r['code'] );

echo "delete only\n";
$ov( 'manager1', 'articles:edit=', 'articles:delete=allow' );
$r = $put( $m(), array( $row( 'P1', 'CHANGED' ), $row( 'P2', 'two' ) ) );
t( 'can remove an article', 200 === $r['code'] && array( 'P1', 'P2' ) === $ids( $r ), $r['code'] . $r['body'] );
$r = $put( $m(), array( $row( 'P1', 'again' ), $row( 'P2', 'two' ) ) );
t( 'cannot change', 403 === $r['code'], $r['code'] );

echo "cleanup\n";
$ov( 'manager1', 'articles:delete=' );
t( 'overrides cleared', 403 === $put( $m(), $cur )['code'] );
/* restore the default list */
$src = file_get_contents( __DIR__ . '/../../application/renewal-ledger/includes/class-rl-settings.php' );
preg_match( "/<<<'TXT'\n(.*?)\nTXT;/s", $src, $mm );
$def = array();
foreach ( explode( "\n", $mm[1] ) as $ln ) { $p = array_map( 'trim', explode( '|', $ln ) ); $def[] = array( 'code' => $p[0], 'desc' => $p[1], 'cat' => $p[2], 'catDesc' => $p[3], 'split' => 'ΝΑΙ' === $p[4] ); }
$r = $put( $c, $def ); t( 'default list restored', 17 === count( $r['json']['articles'] ?? array() ) );
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
