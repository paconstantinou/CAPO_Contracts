<?php
/**
 * Scheduled backup to a folder (3.13.0): integration test against a live WordPress with
 * Application Management + PROCURE360 active.
 *
 *   php backup-schedule-test.php http://127.0.0.1:8088 /path/to/wp-load.php
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
$pw = getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" );
$c  = client( $base, 'admin', $pw );
$orig = get_option( RL_Backup::OPTION, null );
$dir = sys_get_temp_dir() . '/rl-bk-' . getmypid(); mkdir( $dir );
$cl = function () use ( $c ) { $c->rl( 'DELETE', 'records/contracts/bk1' ); $c->rl( 'DELETE', 'records/contracts/bk1&purge=1' ); };
$cl();

echo "permissions\n";
$anon = new Client( $base );
t( 'anonymous: 401', 401 === $anon->rl( 'GET', 'backup-schedule' )['code'] );
$v = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
t( 'viewer cannot read the schedule (403)', 403 === $v->rl( 'GET', 'backup-schedule' )['code'] );
t( 'viewer cannot change it (403)', 403 === $v->rl( 'PUT', 'backup-schedule', array( 'schedule' => array( 'enabled' => true, 'path' => $dir ) ) )['code'] );
t( 'viewer cannot run it (403)', 403 === $v->rl( 'POST', 'backup-schedule/run' )['code'] );
$m = client( $base, 'manager1', 'Pw-manager1-12345!' );
t( 'application manager without WordPress admin rights: 403', 403 === $m->rl( 'PUT', 'backup-schedule', array( 'schedule' => array( 'path' => $dir ) ) )['code'] );

echo "path validation\n";
$put = function ( $p, $extra = array() ) use ( $c ) { return $c->rl( 'PUT', 'backup-schedule', array( 'schedule' => array_merge( array( 'enabled' => true, 'frequency' => 'weekly', 'keep' => 3, 'path' => $p ), $extra ) ) ); };
t( 'relative path refused (400)', 400 === $put( 'backups/here' )['code'] );
t( 'path with .. refused', 400 === $put( $dir . '/../x' )['code'] );
t( 'stream wrapper refused (php://, http://, phar://)', 400 === $put( 'php://temp' )['code'] && 400 === $put( 'http://x/y' )['code'] && 400 === $put( 'phar:///tmp/x' )['code'] );
t( 'folder that does not exist refused', 400 === $put( $dir . '/nope' )['code'] );
t( 'folder inside the web site refused (uploads)', 400 === $put( wp_upload_dir()['basedir'] )['code'] );
t( 'folder inside the web site refused (wp-content)', 400 === $put( WP_CONTENT_DIR )['code'] );
t( 'enabled without a path refused', 400 === $put( '' )['code'] );
$r = $put( $dir );
t( 'valid folder saved; defaults and keep honoured', 200 === $r['code'] && true === $r['json']['schedule']['enabled'] && 3 === $r['json']['schedule']['keep'] && 'weekly' === $r['json']['schedule']['frequency'], json_encode( $r['json'] ) );
$r = $put( $dir, array( 'frequency' => 'bogus', 'keep' => 9999 ) );
t( 'unknown frequency becomes weekly, keep is clamped to 100', 'weekly' === $r['json']['schedule']['frequency'] && 100 === $r['json']['schedule']['keep'] );
$put( $dir, array( 'frequency' => 'monthly', 'keep' => 2 ) );
t( 'monthly accepted', 'monthly' === $c->rl( 'GET', 'backup-schedule' )['json']['schedule']['frequency'] );

echo "run now: contents of the backup\n";
$y = function ( $o ) { return gmdate( 'Y-m-d', time() + 86400 * $o ); };
$tmpf = tempnam( sys_get_temp_dir(), 'att' ); file_put_contents( $tmpf, "attachment-bytes-\xCE\xB1\xCE\xB2" );
$up = $c->req( 'POST', '/?rest_route=/rl/v1/files&coll=contracts', array( 'file' => new CURLFile( $tmpf, 'application/octet-stream', 'bk-probe.xml' ) ), array(), true );
$att = $up['json'] ?? array();
$rec = array( 'title' => 'Probe Backup', 'tender' => 'BK-1', 'months' => 12, 'dateFrom' => $y( -30 ), 'dateTo' => $y( 300 ), 'cost' => 100, 'years' => array( array( 'from' => $y( -30 ), 'to' => $y( 300 ), 'cost' => 100, 'remind' => 30 ) ),
	'attachments' => array( array( 'id' => $att['id'] ?? '', 'name' => $att['name'] ?? '', 'size' => $att['size'] ?? 0, 'type' => $att['type'] ?? '' ) ) );
$pr = $c->rl( 'PUT', 'records/contracts/bk1', array( 'data' => $rec ) );
t( 'probe contract with an attachment created', 200 === $pr['code'] && ! empty( $att['id'] ), json_encode( array( $pr['code'], $up['code'] ) ) );
file_put_contents( $dir . '/keep-me.txt', 'not a backup' );
$r = $c->rl( 'POST', 'backup-schedule/run' );
t( 'run now: 200 and a file name', 200 === $r['code'] && ! empty( $r['json']['result']['file'] ), json_encode( $r['json'] ) );
$f = $dir . '/' . ( $r['json']['result']['file'] ?? 'x' );
t( 'the file exists in the chosen folder and no .part file is left', is_file( $f ) && ! glob( $dir . '/*.part' ) );
t( 'file name follows PROCURE360-backup-YYYY-MM-DD_HHMMSS.zip', 1 === preg_match( '/^PROCURE360-backup-\d{4}-\d{2}-\d{2}_\d{6}\.zip$/', basename( $f ) ) );
$z = new ZipArchive(); $z->open( $f );
$man = json_decode( $z->getFromName( 'manifest.json' ), true );
t( 'manifest: app, format 1, counts and the attachment', 'PROCURE360' === $man['app'] && 1 === $man['format'] && $man['counts']['contracts'] >= 1 && isset( $man['files'][ $att['id'] ] ) && array() === $man['missingFiles'], json_encode( $man ) );
$ct = json_decode( $z->getFromName( 'data/contracts.json' ), true ); $mine = null;
foreach ( $ct as $x ) { if ( 'bk1' === $x['id'] ) { $mine = $x; } }
t( 'data/contracts.json holds the record as a flat object with its id', $mine && 'Probe Backup' === $mine['title'] );
t( 'all four data files, settings.json and articles.json are there', $z->getFromName( 'data/software.json' ) !== false && $z->getFromName( 'data/tenders.json' ) !== false && $z->getFromName( 'data/contractors.json' ) !== false && is_array( json_decode( $z->getFromName( 'settings.json' ), true ) ) && is_array( json_decode( $z->getFromName( 'articles.json' ), true ) ) );
t( 'the attachment bytes are inside (files/<id>)', "attachment-bytes-\xCE\xB1\xCE\xB2" === $z->getFromName( 'files/' . $att['id'] ) );
t( 'the backup holds no password field', false === stripos( $z->getFromName( 'data/software.json' ), '"password"' ) );
$z->close();
$s = $c->rl( 'GET', 'backup-schedule' )['json']['schedule'];
t( 'status recorded: lastOk, lastRun, lastFile, message', true === $s['lastOk'] && '' !== $s['lastRun'] && basename( $f ) === $s['lastFile'] && '' !== $s['lastMessage'], json_encode( $s ) );
t( 'next run is about one month after the last (monthly)', '' !== $s['next'] && abs( strtotime( $s['next'] ) - strtotime( '+1 month' ) ) < 3 * 86400 );

echo "retention\n";
sleep( 1 ); $c->rl( 'POST', 'backup-schedule/run' ); sleep( 1 ); $r = $c->rl( 'POST', 'backup-schedule/run' );
t( 'keep=2: only the two newest backups remain', 2 === count( glob( $dir . '/PROCURE360-backup-*.zip' ) ), json_encode( glob( $dir . '/*' ) ) );
t( 'the newest one is kept and files that are not backups are never touched', is_file( $dir . '/' . $r['json']['result']['file'] ) && is_file( $dir . '/keep-me.txt' ) );

echo "when is it due\n";
$base_s = RL_Backup::get();
$mk = function ( $freq, $ago ) use ( $base_s ) { return array_merge( $base_s, array( 'enabled' => true, 'frequency' => $freq, 'path' => $base_s['path'], 'lastRun' => gmdate( 'c', time() - $ago ) ) ); };
t( 'weekly: 6 days ago is not due, 8 days ago is due', ! RL_Backup::is_due( $mk( 'weekly', 6 * 86400 ) ) && RL_Backup::is_due( $mk( 'weekly', 8 * 86400 ) ) );
t( 'monthly: 20 days ago is not due, 40 days ago is due', ! RL_Backup::is_due( $mk( 'monthly', 20 * 86400 ) ) && RL_Backup::is_due( $mk( 'monthly', 40 * 86400 ) ) );
t( 'never ran: due at once', RL_Backup::is_due( array_merge( $mk( 'weekly', 0 ), array( 'lastRun' => '' ) ) ) );
t( 'disabled: never due', ! RL_Backup::is_due( array_merge( $mk( 'weekly', 99 * 86400 ), array( 'enabled' => false ) ) ) );

echo "scheduled run and failure\n";
$o = RL_Backup::get(); $o['lastRun'] = gmdate( 'c', time() - 9 * 86400 ); $o['frequency'] = 'weekly'; $o['enabled'] = true; update_option( RL_Backup::OPTION, $o, false );
$before = count( glob( $dir . '/PROCURE360-backup-*.zip' ) ); sleep( 1 );
do_action( RL_Backup::HOOK );
$after = RL_Backup::get();
t( 'the cron hook makes a backup when one is due', true === $after['lastOk'] && strtotime( $after['lastRun'] ) > time() - 30, json_encode( $after ) );
$n = count( glob( $dir . '/PROCURE360-backup-*.zip' ) ); do_action( RL_Backup::HOOK );
t( 'and does nothing again right after (not due)', $n === count( glob( $dir . '/PROCURE360-backup-*.zip' ) ) );
$o = RL_Backup::get(); $o['path'] = $dir . '/gone'; $o['lastRun'] = gmdate( 'c', time() - 9 * 86400 ); update_option( RL_Backup::OPTION, $o, false );
do_action( RL_Backup::HOOK ); $f2 = RL_Backup::get();
t( 'folder missing at run time: failure recorded with a message, no crash', false === $f2['lastOk'] && '' !== $f2['lastMessage'], json_encode( $f2 ) );
$r = $c->rl( 'POST', 'backup-schedule/run' );
t( 'run now with a bad folder answers 400 with the reason', 400 === $r['code'] && ! empty( $r['json']['message'] ) );

echo "the schedule is not part of the app settings (so a restore never overwrites it)\n";
t( 'settings.json inside a backup has no path', ! isset( RL_Settings::app_settings()['backup'] ) && ! isset( RL_Settings::app_settings()['path'] ) );
t( 'hourly cron event registered', false !== wp_next_scheduled( RL_Backup::HOOK ) );

$cl();
foreach ( glob( $dir . '/*' ) as $x ) { @unlink( $x ); } @rmdir( $dir ); @unlink( $tmpf );
if ( null === $orig ) { delete_option( RL_Backup::OPTION ); } else { update_option( RL_Backup::OPTION, $orig, false ); }
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
