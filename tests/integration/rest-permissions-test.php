<?php
/**
 * HTTP integration test of the PROCURE360 REST API against a live WordPress with
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

echo "anonymous\n";
$anon = new Client( $base );
foreach ( array( array( 'GET', 'records/software' ), array( 'GET', 'export/software' ), array( 'PUT', 'records/software/x1' ), array( 'DELETE', 'records/software/x1' ), array( 'POST', 'files' ), array( 'GET', 'files/' . str_repeat( 'a', 32 ) ) ) as $e ) {
	$r = $anon->rl( $e[0], $e[1], 'PUT' === $e[0] ? array( 'data' => array() ) : null );
	t( "anon {$e[0]} {$e[1]} is 401/403", in_array( $r['code'], array( 401, 403 ), true ), "got {$r['code']}" );
}

echo "no nonce (CSRF)\n";
$c = client( $base, 'admin', ( getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS (password of the local test admin)\n" ) ) );
$nonce = $c->nonce; $c->nonce = '';
$r = $c->rl( 'PUT', 'records/software/csrf1', $sw( 'CSRF' ) );
t( 'logged-in cookie without nonce cannot write', in_array( $r['code'], array( 401, 403 ), true ), "got {$r['code']}" );
$c->nonce = $nonce;

echo "super admin\n";
foreach ( array( 's1', 'new_viewer1', 'new_editor1', 'new_manager1', 'new_nobody', 'new_admin' ) as $leftover ) { $c->rl( 'DELETE', "records/software/$leftover" ); $c->rl( 'DELETE', "records/software/$leftover&purge=1" ); } // leftovers of an earlier run (delete = trash, then purge)
$r = $c->rl( 'PUT', 'records/software/s1', $sw( 'Alpha' ) ); t( 'create software', 200 === $r['code'], $r['body'] );
$r = $c->rl( 'PUT', 'records/contracts/c1', array( 'data' => array( 'title' => 'Σύμβαση Α', 'tender' => 'T-1', 'description' => '', 'contractor' => 'X', 'coordinator' => 'Y', 'months' => 14, 'dateFrom' => '2026-01-01', 'dateTo' => '2027-02-28', 'cost' => 1000, 'years' => array(), 'attachments' => array() ) ) ); t( 'create contract', 200 === $r['code'], $r['body'] );
$r = $c->rl( 'GET', 'records/software' ); t( 'super admin sees username', 'secretuser' === ( $r['json']['items'][0]['data']['username'] ?? '' ) );
t( 'password is no longer stored', ! array_key_exists( 'password', $r['json']['items'][0]['data'] ) && false === strpos( $r['body'], 'legacypass' ) );
t( 'emails normalised', 'a@example.com, b@example.com' === ( $r['json']['items'][0]['data']['emails'] ?? '' ), json_encode( $r['json']['items'][0]['data']['emails'] ?? null ) );
$r = $c->rl( 'PUT', 'records/software/bad_em', array( 'data' => array_merge( $sw( 'BadEm' )['data'], array( 'emails' => 'good@example.com, not-an-email' ) ) ) ); t( 'invalid notification e-mail rejected', 400 === $r['code'], "got {$r['code']}" );
$r = $c->rl( 'PUT', 'records/software/bad_em2', array( 'data' => array_merge( $sw( 'BadEm' )['data'], array( 'emails' => implode( ',', array_map( fn( $i ) => "u$i@example.com", range( 1, 21 ) ) ) ) ) ) ); t( 'more than 20 e-mails rejected', 400 === $r['code'], "got {$r['code']}" );
$r = $c->rl( 'PUT', 'records/software/s2', array( 'data' => array( 'name' => '' ) ) ); t( 'invalid record rejected (400)', 400 === $r['code'], "got {$r['code']}" );
$r = $c->rl( 'PUT', 'records/other/s2', $sw( 'x' ) ); t( 'unknown collection rejected', in_array( $r['code'], array( 400, 404 ), true ), "got {$r['code']}" );
$r = $c->rl( 'PUT', "records/software/a'b", $sw( 'x' ) ); t( 'bad id rejected', in_array( $r['code'], array( 400, 404 ), true ), "got {$r['code']}" );
$r = $c->rl( 'GET', 'export/software&format=csv' ); t( 'csv export has BOM + header', 200 === $r['code'] && "\xEF\xBB\xBF" === substr( $r['body'], 0, 3 ) && false !== strpos( $r['body'], 'Software Name' ) );
$r = $c->rl( 'GET', 'export/software&format=xlsx' ); t( 'xlsx export is a zip', 200 === $r['code'] && 'PK' === substr( $r['body'], 0, 2 ), "got {$r['code']}" );
$r = $c->rl( 'PUT', 'records/software/inj', array( 'data' => $sw( '=cmd|calc' )['data'] ) );
$r = $c->rl( 'GET', 'export/software&format=csv' ); t( 'CSV formula injection neutralised', false === strpos( $r['body'], ',=cmd' ) && false === strpos( $r['body'], "\n=cmd" ) );

echo "file upload\n";
$tmp = tempnam( sys_get_temp_dir(), 'up' ); file_put_contents( $tmp, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF" );
$up = $c->req( 'POST', '/?rest_route=/rl/v1/files', array( 'coll' => 'software', 'file' => new CURLFile( $tmp, 'application/pdf', 'inv.pdf' ) ), array(), true );
t( 'upload pdf', 200 === $up['code'] && ! empty( $up['json']['id'] ), $up['body'] );
$fid = $up['json']['id'] ?? '';
$bad = tempnam( sys_get_temp_dir(), 'up' ); file_put_contents( $bad, '<?php echo 1;' );
$r = $c->req( 'POST', '/?rest_route=/rl/v1/files', array( 'coll' => 'software', 'file' => new CURLFile( $bad, 'application/x-php', 'evil.php' ) ), array(), true );
t( 'php upload rejected', 200 !== $r['code'], "got {$r['code']}" );
$r = $c->rl( 'GET', "files/$fid" ); t( 'download own file', 200 === $r['code'] && '%PDF' === substr( $r['body'], 0, 4 ) );
t( 'download has nosniff', false !== stripos( $r['head'], 'x-content-type-options: nosniff' ) );

echo "roles\n";
$cases = array(
	'viewer1'  => array( 'view' => true, 'create' => false, 'edit' => false, 'delete' => false, 'export' => false, 'creds' => false ),
	'editor1'  => array( 'view' => true, 'create' => true, 'edit' => true, 'delete' => false, 'export' => false, 'creds' => false ),
	'manager1' => array( 'view' => true, 'create' => true, 'edit' => true, 'delete' => false, 'export' => true, 'creds' => false ),
	'nobody'   => array( 'view' => false, 'create' => false, 'edit' => false, 'delete' => false, 'export' => false, 'creds' => false ),
);
$ok = fn( $r ) => 200 === $r['code'];
foreach ( $cases as $u => $exp ) {
	echo " $u\n";
	$k = client( $base, $u, "Pw-$u-12345!" );
	$r = $k->rl( 'GET', 'records/software' ); t( "$u view", $ok( $r ) === $exp['view'], "got {$r['code']}" );
	if ( $exp['view'] ) {
		$un = $r['json']['items'][0]['data']['username'] ?? 'MISSING';
		t( "$u username hidden without credentials permission", '' === $un, "username=$un" );
	}
	$r = $k->rl( 'PUT', "records/software/new_$u", $sw( "N $u" ) ); t( "$u create", $ok( $r ) === $exp['create'], "got {$r['code']}" );
	$r = $k->rl( 'PUT', 'records/software/s1', $sw( 'Alpha edited' ) ); t( "$u edit", $ok( $r ) === $exp['edit'], "got {$r['code']}" );
	$r = $k->rl( 'DELETE', 'records/software/s1' ); t( "$u delete", $ok( $r ) === $exp['delete'], "got {$r['code']}" );
	$r = $k->rl( 'GET', 'export/software&format=csv' ); t( "$u export", $ok( $r ) === $exp['export'], "got {$r['code']}" );
	if ( $exp['export'] ) { t( "$u export has no credentials", false === strpos( $r['body'], 'secretuser' ) ); }
	$again = $c->req( 'POST', '/?rest_route=/rl/v1/files', array( 'coll' => 'software', 'file' => new CURLFile( $tmp, 'application/pdf', 'inv.pdf' ) ), array(), true );
	$fid = $again['json']['id'] ?? $fid;
	$r = $k->rl( 'GET', "files/$fid" ); t( "$u file download", $ok( $r ) === $exp['view'], "got {$r['code']}" );
	$r = $k->rl( 'DELETE', "files/$fid" ); t( "$u file delete", $ok( $r ) === $exp['edit'], "got {$r['code']}" );
	$r = $k->req( 'GET', '/?rest_route=/am/v1/me' ); t( "$u /am/v1/me works", 200 === $r['code'] );
	$r = $k->req( 'GET', '/wp-admin/admin.php?page=am-users' ); t( "$u cannot open AM admin screen", false === strpos( $r['body'], 'Users &amp; Access' ) && 200 !== $r['code'] || 200 === $r['code'] && false === strpos( $r['body'], 'am-matrix' ), "code {$r['code']}" );
}
// editor edit succeeded above: credentials must be preserved
$r = $c->rl( 'GET', 'records/software' );
$byid = array(); foreach ( $r['json']['items'] as $i ) { $byid[ $i['id'] ] = $i['data']; }
t( 'editor edit kept username', ( $byid['s1']['username'] ?? '' ) === 'secretuser' && 'Alpha edited' === ( $byid['s1']['name'] ?? '' ), json_encode( $byid['s1'] ?? null ) );

echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
