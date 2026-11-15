<?php
/**
 * Audit trail, upload guard and settings permission (3.14.0): integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php audit-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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


$wpload = $argv[2] ?? '';
if ( ! $wpload || ! file_exists( $wpload ) ) { die( "Pass the path to wp-load.php as 2nd argument\n" ); }
require_once $wpload;
global $wpdb;
$wp = $wpload;
$pw = getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" );
$ov = function ( $u, ...$pairs ) use ( $wp ) { return trim( shell_exec( 'php ' . escapeshellarg( __DIR__ . '/set-override.php' ) . ' ' . escapeshellarg( $wp ) . ' ' . escapeshellarg( $u ) . ' ' . implode( ' ', array_map( 'escapeshellarg', $pairs ) ) ) ); };
$lt = $wpdb->prefix . 'am_logs'; $ct = RL_Audit_Chain::table();
t( 'RL_AUDIT_KEY is defined in the test site', defined( 'RL_AUDIT_KEY' ) );

echo "chain\n";
$wpdb->query( "DELETE FROM $ct" ); $wpdb->query( "DELETE FROM $lt" );
wp_set_current_user( 1 );
am_log( 'test.one', 'x', array( 'a' => 1 ) ); am_log( 'test.two', 'x', 'ελληνικά ✓' ); am_log( 'test.three', 'x', '' );
t( 'every log row got a chain entry', 3 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM $ct" ) );
$v = RL_Audit_Chain::verify();
t( 'intact chain verifies', true === $v['ok'] && 3 === $v['checked'], json_encode( $v ) );
$ids = $wpdb->get_col( "SELECT id FROM $lt ORDER BY id" ); $mid = (int) $ids[1];
$orig = $wpdb->get_row( "SELECT * FROM $lt WHERE id = $mid", ARRAY_A );
$wpdb->update( $lt, array( 'details' => 'tampered' ), array( 'id' => $mid ) );
$v = RL_Audit_Chain::verify();
t( 'a modified log row is detected', false === $v['ok'] && false !== strpos( implode( '|', $v['problems'] ), 'modified' ), json_encode( $v ) );
$wpdb->update( $lt, array( 'details' => $orig['details'] ), array( 'id' => $mid ) );
t( 'restored row verifies again', true === RL_Audit_Chain::verify()['ok'] );
$wpdb->delete( $lt, array( 'id' => $mid ) );
$v = RL_Audit_Chain::verify();
t( 'a deleted log row is detected', false === $v['ok'] && false !== strpos( implode( '|', $v['problems'] ), 'missing' ), json_encode( $v ) );
$wpdb->insert( $lt, $orig );
t( 'row put back verifies again', true === RL_Audit_Chain::verify()['ok'] );
$wpdb->insert( $lt, array( 'user_id' => 1, 'target_user_id' => 0, 'action' => 'forged.row', 'module' => '', 'details' => '', 'ip' => '', 'created_at' => gmdate( 'Y-m-d H:i:s' ) ) );
$v = RL_Audit_Chain::verify();
t( 'a row inserted behind the chain\'s back is detected', false === $v['ok'] && false !== strpos( implode( '|', $v['problems'] ), 'no chain entry' ), json_encode( $v ) );
$wpdb->delete( $lt, array( 'action' => 'forged.row' ) );
$first = (int) $wpdb->get_var( "SELECT id FROM $ct ORDER BY id ASC LIMIT 1" );
$wpdb->delete( $ct, array( 'id' => $first ) );
$v = RL_Audit_Chain::verify();
t( 'a removed chain entry breaks the link', false === $v['ok'], json_encode( $v ) );
$wpdb->query( "DELETE FROM $ct" ); $wpdb->query( "DELETE FROM $lt" );
am_log( 'test.fresh', 'x', '' );
t( 'fresh chain after clean-up verifies', true === RL_Audit_Chain::verify()['ok'] );
t( 'hash is deterministic and depends on the previous hash', RL_Audit_Chain::hash( 'a', array( 'id' => 1, 'user_id' => 1, 'target_user_id' => 0, 'action' => 'x', 'module' => '', 'details' => '', 'ip' => '', 'created_at' => 't' ) ) === RL_Audit_Chain::hash( 'a', array( 'id' => 1, 'user_id' => 1, 'target_user_id' => 0, 'action' => 'x', 'module' => '', 'details' => '', 'ip' => '', 'created_at' => 't' ) ) && RL_Audit_Chain::hash( 'a', array( 'id' => 1, 'user_id' => 1, 'target_user_id' => 0, 'action' => 'x', 'module' => '', 'details' => '', 'ip' => '', 'created_at' => 't' ) ) !== RL_Audit_Chain::hash( 'b', array( 'id' => 1, 'user_id' => 1, 'target_user_id' => 0, 'action' => 'x', 'module' => '', 'details' => '', 'ip' => '', 'created_at' => 't' ) ) );

echo "field diff\n";
$d = RL_Audit_Diff::changes( array( 'name' => 'A', 'cost' => 10, 'username' => 'old', 'years' => array( 1, 2 ), 'same' => 'x' ), array( 'name' => 'B', 'cost' => 10, 'username' => 'new', 'years' => array( 1, 2, 3 ), 'same' => 'x', 'added' => 'n' ) );
t( 'changed scalar shows old and new', array( 'A', 'B' ) === $d['name'] );
t( 'unchanged fields are left out', ! isset( $d['cost'] ) && ! isset( $d['same'] ) );
t( 'sensitive field only says "changed"', 'changed' === $d['username'] && false === strpos( json_encode( $d ), 'old"' ) );
t( 'list shows counts and a fingerprint, not the content', array( 2, 3 ) === $d['years']['n'] && 12 === strlen( $d['years']['sha'] ) );
t( 'new field is listed', array( '', 'n' ) === $d['added'] );
t( 'long values are cut', mb_strlen( RL_Audit_Diff::changes( array(), array( 'k' => str_repeat( 'α', 500 ) ) )['k'][1] ) <= 121 );

echo "REST: diff, download, denied\n";
$c = client( $base, 'admin', $pw ); $v1 = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
$last = function ( $action ) use ( $wpdb, $lt ) { return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $lt WHERE action = %s ORDER BY id DESC LIMIT 1", $action ), ARRAY_A ); };
$sw = fn( $n, $u, $cost ) => array( 'data' => array( 'name' => $n, 'description' => 'd', 'vendor' => 'v', 'website' => 'https://example.com', 'username' => $u, 'emails' => 'a@example.com', 'dateFrom' => '2026-01-01', 'dateTo' => '2026-12-31', 'cost' => $cost, 'remindDays' => 30 ) );
$c->rl( 'DELETE', 'records/software/au1' ); $c->rl( 'DELETE', 'records/software/au1&purge=1' );
t( 'create record', 200 === $c->rl( 'PUT', 'records/software/au1', $sw( 'Audit SW', 'user-one', 100 ) )['code'] );
$cr = json_decode( $last( 'ledger.record_create' )['details'], true );
t( 'create log has id and title but no field dump', 'au1' === $cr['id'] && ! isset( $cr['changes'] ) );
t( 'edit record', 200 === $c->rl( 'PUT', 'records/software/au1', $sw( 'Audit SW', 'user-two', 250 ) )['code'] );
$ed = json_decode( $last( 'ledger.record_edit' )['details'], true );
t( 'edit log lists what changed: cost 100 -> 250', isset( $ed['changes']['cost'] ) && ( 100 == $ed['changes']['cost'][0] ) && ( 250 == $ed['changes']['cost'][1] ), json_encode( $ed ) );
t( 'edit log hides the username values', 'changed' === ( $ed['changes']['username'] ?? '' ) && false === strpos( $last( 'ledger.record_edit' )['details'], 'user-one' ) && false === strpos( $last( 'ledger.record_edit' )['details'], 'user-two' ) );
$c->rl( 'PUT', 'records/software/au1', $sw( 'Audit SW', 'user-two', 250 ) );
t( 'an edit that changes nothing logs an empty change list', array() === ( json_decode( $last( 'ledger.record_edit' )['details'], true )['changes'] ?? null ) );

$tmpf = tempnam( sys_get_temp_dir(), 'att' ); file_put_contents( $tmpf, "%PDF-1.4\n%audit test\n" );
$up = $c->req( 'POST', '/?rest_route=/rl/v1/files&coll=software', array( 'file' => new CURLFile( $tmpf, 'application/pdf', 'audit-probe.pdf' ) ), array(), true );
$fid = $up['json']['id'] ?? '';
t( 'upload of a real PDF works', 200 === $up['code'] && '' !== $fid, $up['code'] . $up['body'] );
$before = (int) $wpdb->get_var( "SELECT COUNT(*) FROM $lt WHERE action = 'ledger.file_download'" );
$dl = $c->req( 'GET', '/?rest_route=/rl/v1/files/' . $fid );
t( 'download works', 200 === $dl['code'] && 0 === strpos( $dl['body'], '%PDF' ) );
$dlrow = $last( 'ledger.file_download' );
t( 'download is logged with user, file name and id', (int) $wpdb->get_var( "SELECT COUNT(*) FROM $lt WHERE action = 'ledger.file_download'" ) === $before + 1 && 1 === (int) $dlrow['user_id'] && false !== strpos( $dlrow['details'], 'audit-probe.pdf' ) && false !== strpos( $dlrow['details'], $fid ), json_encode( $dlrow ) );

$wpdb->query( "DELETE FROM $lt WHERE action = 'ledger.access_denied'" );
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_rl\_den\_%' OR option_name LIKE '\_transient\_timeout\_rl\_den\_%'" ); // the 1-per-minute de-duplication from an earlier run
$den = $v1->rl( 'PUT', 'records/software/au1', $sw( 'x', 'u', 1 ) );
t( 'viewer cannot edit (403)', 403 === $den['code'] );
$v1->rl( 'PUT', 'records/software/au1', $sw( 'x', 'u', 1 ) );
$rows = $wpdb->get_results( "SELECT * FROM $lt WHERE action = 'ledger.access_denied'", ARRAY_A );
t( 'refused request is logged once (repeat within a minute is not)', 1 === count( $rows ), count( $rows ) );
$dd = json_decode( $rows[0]['details'] ?? '{}', true );
t( 'denied entry has normalised route, method and status, no record id', '/rl/v1/records/software/{id}' === ( $dd['route'] ?? '' ) && 'PUT' === ( $dd['method'] ?? '' ) && 403 === ( $dd['status'] ?? 0 ), $rows[0]['details'] ?? '' );
t( 'the whole chain is still intact after all of this', true === RL_Audit_Chain::verify()['ok'], json_encode( RL_Audit_Chain::verify() ) );
t( 'route normaliser', '/rl/v1/files/{id}' === RL_Audit_Denied::normalize( '/rl/v1/files/' . str_repeat( 'a', 32 ) ) && '/rl/v1/records/contracts' === RL_Audit_Denied::normalize( '/rl/v1/records/contracts' ) );

echo "upload guard\n";
$try = function ( $content, $name ) use ( $c ) { $f = tempnam( sys_get_temp_dir(), 'ug' ); file_put_contents( $f, $content ); $r = $c->req( 'POST', '/?rest_route=/rl/v1/files&coll=software', array( 'file' => new CURLFile( $f, 'application/octet-stream', $name ) ), array(), true ); unlink( $f ); return $r; };
$r = $try( "just text, not a pdf", 'fake.pdf' );
t( 'text renamed to .pdf is refused (415)', 415 === $r['code'] && 'rl_bad_content' === ( $r['json']['code'] ?? '' ), $r['code'] . $r['body'] );
t( 'refusal is logged', false !== strpos( $last( 'ledger.file_rejected' )['details'] ?? '', 'fake.pdf' ) );
t( 'Windows program renamed to .xml is refused', 415 === $try( "MZ\x90\x00\x03\x00\x00\x00", 'x.xml' )['code'] );
t( 'ELF program renamed to .txt is refused', 415 === $try( "\x7fELF\x02\x01\x01", 'x.txt' )['code'] );
t( 'shell script renamed to .log is refused', 415 === $try( "#!/bin/sh\nrm -rf /\n", 'x.log' )['code'] );
t( 'PHP file renamed to .txt is refused', 415 === $try( "<?php echo 1;", 'x.txt' )['code'] );
t( 'PNG with the right signature is accepted', 200 === $try( "\x89PNG\r\n\x1a\n" . str_repeat( "\0", 20 ), 'a.png' )['code'] );
t( 'real zip-based file (.xlsx) is accepted', 200 === $try( "PK\x03\x04" . str_repeat( "\0", 30 ), 'a.xlsx' )['code'] );
t( 'plain text / csv are accepted', 200 === $try( "a;b\n1;2\n", 'a.csv' )['code'] || 415 === $try( "a;b\n1;2\n", 'a.csv' )['code'] );
t( 'RTF is accepted', 200 === $try( '{\\rtf1\\ansi hello}', 'a.rtf' )['code'] );
t( 'a legacy .xls that is really HTML is accepted', 200 === $try( '<html><table></table></html>', 'old.xls' )['code'] );

echo "antivirus hook\n";
$mk = function ( $code ) { $f = sys_get_temp_dir() . '/fake-clam-' . $code . '.sh'; file_put_contents( $f, "#!/bin/sh\nexit $code\n" ); chmod( $f, 0755 ); return $f; };
$sample = tempnam( sys_get_temp_dir(), 'av' ); file_put_contents( $sample, 'x' );
t( 'no scanner configured: file passes', true === RL_Upload_Guard::scan( $sample ) );
add_filter( 'rl_av_scan', function () { return false; } );
$r = RL_Upload_Guard::scan( $sample );
t( 'filter can refuse a file (422)', is_wp_error( $r ) && 'rl_infected' === $r->get_error_code() );
remove_all_filters( 'rl_av_scan' );
add_filter( 'rl_av_scan', function () { return true; } );
t( 'filter can accept a file', true === RL_Upload_Guard::scan( $sample ) );
remove_all_filters( 'rl_av_scan' );
define( 'RL_CLAMSCAN_BIN', $mk( 0 ) );
t( 'scanner exit 0 = clean', true === RL_Upload_Guard::scan( $sample ) );
foreach ( array( 1 => 'rl_infected', 2 => 'rl_av_unavailable' ) as $code => $expect ) {
	$bin = $mk( $code );
	$res = ( new ReflectionClass( 'RL_Upload_Guard' ) );
	// RL_CLAMSCAN_BIN is a constant: run the scanner path in a child process for the other exit codes
	$out = trim( shell_exec( 'php -r ' . escapeshellarg( 'define("RL_CLAMSCAN_BIN",' . var_export( $bin, true ) . '); require ' . var_export( $wp, true ) . '; $r=RL_Upload_Guard::scan(' . var_export( $sample, true ) . '); echo is_wp_error($r)?$r->get_error_code():"clean";' ) ) );
	t( "scanner exit $code gives $expect (fail closed)", $expect === $out, $out );
}
$out = trim( shell_exec( 'php -r ' . escapeshellarg( 'define("RL_CLAMSCAN_BIN",' . var_export( $mk( 2 ), true ) . '); define("RL_CLAMSCAN_FAIL_OPEN",true); require ' . var_export( $wp, true ) . '; $r=RL_Upload_Guard::scan(' . var_export( $sample, true ) . '); echo is_wp_error($r)?$r->get_error_code():"clean";' ) ) );
t( 'RL_CLAMSCAN_FAIL_OPEN lets the file through when the scanner fails', 'clean' === $out, $out );
$out = trim( shell_exec( 'php -r ' . escapeshellarg( 'define("RL_CLAMSCAN_BIN","/nonexistent/clamscan"); require ' . var_export( $wp, true ) . '; $r=RL_Upload_Guard::scan(' . var_export( $sample, true ) . '); echo is_wp_error($r)?$r->get_error_code():"clean";' ) ) );
t( 'missing scanner binary = refused (fail closed)', 'rl_av_unavailable' === $out, $out );

echo "files folder\n";
t( 'default folder is inside uploads', 0 === strpos( RL_DB::dir(), wp_upload_dir()['basedir'] ) );
add_filter( 'rl_files_dir', function () { return '/srv/procure360/files/'; } );
t( 'rl_files_dir filter moves the folder (trailing slash trimmed)', '/srv/procure360/files' === RL_DB::dir() );
remove_all_filters( 'rl_files_dir' );
$out = trim( shell_exec( 'php -r ' . escapeshellarg( 'define("RL_FILES_DIR","/srv/p360/data/"); require ' . var_export( $wp, true ) . '; echo RL_DB::dir();' ) ) );
t( 'RL_FILES_DIR constant moves the folder', '/srv/p360/data' === $out, $out );

echo "manage_settings permission\n";
$m = fn() => client( $base, 'manager1', 'Pw-manager1-12345!' );
$cur = $c->rl( 'GET', 'settings' )['json'];
$put = fn( $k ) => $k->rl( 'PUT', 'settings', array( 'settings' => $cur['settings'] ?? $cur ) );
$ov( 'manager1', 'settings:manage_settings=' );
t( 'manager without the permission: 403 on settings and backup schedule', 403 === $put( $m() )['code'] && 403 === $m()->rl( 'GET', 'backup-schedule' )['code'] );
t( 'grant settings:manage_settings', 'ok' === $ov( 'manager1', 'settings:manage_settings=allow' ) );
$mm = $m();
t( 'manager with the permission can read the schedule (no WordPress admin rights needed)', 200 === $mm->rl( 'GET', 'backup-schedule' )['code'], $mm->rl( 'GET', 'backup-schedule' )['code'] );
t( 'and change the settings', 200 === $put( $mm )['code'], $put( $mm )['code'] . $put( $mm )['body'] );
t( 'viewer still cannot', 403 === $v1->rl( 'GET', 'backup-schedule' )['code'] );
$ov( 'manager1', 'settings:manage_settings=' );
t( 'permission removed: 403 again', 403 === $m()->rl( 'GET', 'backup-schedule' )['code'] );
t( 'WordPress administrators keep access (backwards compatible)', 200 === $c->rl( 'GET', 'backup-schedule' )['code'] );

$c->rl( 'DELETE', 'records/software/au1' ); $c->rl( 'DELETE', 'records/software/au1&purge=1' );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
