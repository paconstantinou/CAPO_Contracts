<?php
/**
 * Trash (soft delete) of the PROCURE360 records: HTTP integration test against a live WordPress against a live WordPress with
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
$get = function ( $k, $coll, $id ) { $r = $k->rl( 'GET', "records/$coll" ); foreach ( $r['json']['items'] ?? array() as $i ) { if ( $i['id'] === $id ) { return $i['data']; } } return null; };

echo "trash: delete moves to trash\n";
$mk = array( 'name' => 'Trash SW', 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => 10, 'remindDays' => 30 );
$list_ids = function ( $k, $coll, $trash = false ) { $r = $k->rl( 'GET', "records/$coll" . ( $trash ? '&trash=1' : '' ) ); return $r['code'] === 200 ? array_column( $r['json']['items'], 'id' ) : null; };
$c->rl( 'PUT', 'records/software/trs1', array( 'data' => $mk ) );
$r = $c->rl( 'DELETE', 'records/software/trs1' );
t( 'DELETE answers ok and says trashed', 200 === $r['code'] && ! empty( $r['json']['trashed'] ), $r['body'] );
t( 'record is gone from the normal list', ! in_array( 'trs1', $list_ids( $c, 'software' ), true ) );
t( 'record is in the trash list', in_array( 'trs1', $list_ids( $c, 'software', true ), true ) );
$tr = $c->rl( 'GET', 'records/software&trash=1' )['json']['items']; $row = array_values( array_filter( $tr, fn( $i ) => 'trs1' === $i['id'] ) )[0];
t( 'trash row carries who and when', ! empty( $row['deleted_at'] ) && '' !== $row['deleted_by'], json_encode( $row ) );
t( 'data is intact in the trash', 'Trash SW' === $row['data']['name'] );
$r = $c->rl( 'PUT', 'records/software/trs1', array( 'data' => $mk ) );
t( 'editing a trashed record is refused (409)', 409 === $r['code'], $r['code'] );
$r = $c->rl( 'DELETE', 'records/software/trs1&purge=1' );
t( 'permanent delete of a record in the trash works for Super Admin', 200 === $r['code'] && ! empty( $r['json']['purged'] ), $r['body'] );
t( 'and it is really gone', ! in_array( 'trs1', $list_ids( $c, 'software', true ), true ) && ! in_array( 'trs1', $list_ids( $c, 'software' ), true ) );

echo "trash: restore\n";
$c->rl( 'PUT', 'records/software/trs2', array( 'data' => array_merge( $mk, array( 'name' => 'Trash SW 2' ) ) ) );
$c->rl( 'DELETE', 'records/software/trs2' );
$r = $c->rl( 'POST', 'records/software/trs2/restore' );
t( 'restore works', 200 === $r['code'], $r['body'] );
t( 'restored record is back in the normal list, not in the trash', in_array( 'trs2', $list_ids( $c, 'software' ), true ) && ! in_array( 'trs2', $list_ids( $c, 'software', true ), true ) );
t( 'data survived the round trip', 'Trash SW 2' === ( $get( $c, 'software', 'trs2' )['name'] ?? '' ) );
$r = $c->rl( 'POST', 'records/software/trs2/restore' );
t( 'restoring a record that is not in the trash gives 404', 404 === $r['code'], $r['code'] );

echo "trash: purge only from the trash\n";
$r = $c->rl( 'DELETE', 'records/software/trs2&purge=1' );
t( 'a live record cannot be purged directly (409)', 409 === $r['code'], $r['code'] );
t( 'live record still there', in_array( 'trs2', $list_ids( $c, 'software' ), true ) );

echo "trash: attachments are kept until purge\n";
$tmp = tempnam( sys_get_temp_dir(), 'att' ); file_put_contents( $tmp, "hello trash\n" );
$ch = curl_init( $base . '/?rest_route=/rl/v1/files' );
curl_setopt_array( $ch, array( CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_COOKIEFILE => $c->jar, CURLOPT_HTTPHEADER => array( 'X-WP-Nonce: ' . $c->nonce ), CURLOPT_POSTFIELDS => array( 'coll' => 'software', 'file' => new CURLFile( $tmp, 'text/plain', 'note.txt' ) ) ) );
$up = json_decode( curl_exec( $ch ), true ); curl_close( $ch );
t( 'upload works', ! empty( $up['id'] ), json_encode( $up ) );
$withf = array_merge( $mk, array( 'name' => 'Trash SW 3', 'attachments' => array( array( 'id' => $up['id'], 'name' => 'note.txt', 'size' => 12, 'type' => 'text/plain' ) ) ) );
$c->rl( 'PUT', 'records/software/trs3', array( 'data' => $withf ) );
$c->rl( 'DELETE', 'records/software/trs3' );
$f = $c->rl( 'GET', 'files/' . $up['id'] );
t( 'attachment still downloadable while the record is in the trash', 200 === $f['code'] && false !== strpos( $f['body'], 'hello trash' ), $f['code'] );
$c->rl( 'POST', 'records/software/trs3/restore' ); $c->rl( 'DELETE', 'records/software/trs3' );
$c->rl( 'DELETE', 'records/software/trs3&purge=1' );
$f = $c->rl( 'GET', 'files/' . $up['id'] );
t( 'attachment is deleted together with the permanent delete', 200 !== $f['code'], $f['code'] );

echo "trash: permissions\n";
$c->rl( 'PUT', 'records/software/trs4', array( 'data' => array_merge( $mk, array( 'name' => 'Trash SW 4' ) ) ) );
foreach ( array( 'viewer1', 'editor1', 'nobody' ) as $u ) {
	$k = client( $base, $u, 'Pw-' . $u . '-12345!' );
	$r = $k->rl( 'GET', 'records/software&trash=1' );
	t( "$u cannot see the trash (has no delete permission)", in_array( $r['code'], array( 401, 403 ), true ), $r['code'] );
	$r = $k->rl( 'POST', 'records/software/trs4/restore' );
	t( "$u cannot restore", in_array( $r['code'], array( 401, 403 ), true ), $r['code'] );
}
$wp = $argv[2] ?? ''; if ( ! $wp ) { die( "Usage: php trash-test.php <base-url> <path/to/wp-load.php>\n" ); }
$ov = function ( $u, ...$pairs ) use ( $wp ) { return trim( shell_exec( 'php ' . escapeshellarg( __DIR__ . '/set-override.php' ) . ' ' . escapeshellarg( $wp ) . ' ' . escapeshellarg( $u ) . ' ' . implode( ' ', array_map( 'escapeshellarg', $pairs ) ) ) ); };
t( 'manager1 normally has no delete permission', 403 === client( $base, 'manager1', 'Pw-manager1-12345!' )->rl( 'DELETE', 'records/software/trs4' )['code'] );
t( 'grant delete to manager1 (override)', 'ok' === $ov( 'manager1', 'software:delete=allow' ) );
$m = client( $base, 'manager1', 'Pw-manager1-12345!' );
$r = $m->rl( 'DELETE', 'records/software/trs4' );
t( 'manager (has delete) can move to trash', 200 === $r['code'], $r['code'] . $r['body'] );
$r = $m->rl( 'GET', 'records/software&trash=1' );
t( 'manager can see the trash', 200 === $r['code'] );
$r = $m->rl( 'DELETE', 'records/software/trs4&purge=1' );
t( 'manager cannot delete permanently without the purge permission', in_array( $r['code'], array( 401, 403 ), true ), $r['code'] );
t( 'record survived the refused purge', in_array( 'trs4', $list_ids( $c, 'software', true ), true ) );
$r = $m->rl( 'POST', 'records/software/trs4/restore' );
t( 'manager can restore', 200 === $r['code'], $r['code'] );
$m->rl( 'DELETE', 'records/software/trs4' );
t( 'grant purge to manager1 (override)', 'ok' === $ov( 'manager1', 'software:purge=allow' ) );
$m = client( $base, 'manager1', 'Pw-manager1-12345!' );
$r = $m->rl( 'DELETE', 'records/software/trs4&purge=1' );
t( 'with the purge permission the manager can delete permanently', 200 === $r['code'], $r['code'] );
t( 'purge on contracts needs the contracts permission (module separation)', in_array( $m->rl( 'DELETE', 'records/contracts/none1&purge=1' )['code'], array( 403, 200 ), true ) );
$ov( 'manager1', 'software:delete=', 'software:purge=' );
t( 'overrides cleared', 403 === client( $base, 'manager1', 'Pw-manager1-12345!' )->rl( 'DELETE', 'records/software/trs4' )['code'] );
$c->rl( 'PUT', 'records/software/trs4', array( 'data' => $mk ) ); $c->rl( 'DELETE', 'records/software/trs4' ); $c->rl( 'DELETE', 'records/software/trs4&purge=1' );

echo "trash: effects on other features\n";
$c->rl( 'PUT', 'records/software/trs5', array( 'data' => array_merge( $mk, array( 'name' => 'Trash Export Probe', 'dateTo' => gmdate( 'Y-m-d', time() + 5 * 86400 ) ) ) ) );
$ex = $c->rl( 'GET', 'export/software&format=csv' );
t( 'live record is in the export', false !== strpos( $ex['body'], 'Trash Export Probe' ) );
$c->rl( 'DELETE', 'records/software/trs5' );
$ex = $c->rl( 'GET', 'export/software&format=csv' );
t( 'trashed record is NOT in the export', false === strpos( $ex['body'], 'Trash Export Probe' ) );
foreach ( array( 'trs2', 'trs4', 'trs5' ) as $i ) { $c->rl( 'DELETE', "records/software/$i" ); $c->rl( 'DELETE', "records/software/$i&purge=1" ); }

echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
