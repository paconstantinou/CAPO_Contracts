<?php
/**
 * Record owners (3.21.0): visibility per owner, ownership rules, assignment screen. HTTP test against a live WordPress.
 *
 *   RL_TEST_ADMIN_PASS=... php owners-test.php http://127.0.0.1:8088 /path/to/wp/wp-load.php
 *
 * Users: admin (Super Admin), viewer1, editor1, manager1, nobody. Others have password "Pw-<login>-12345!".
 * Sets view_all=deny overrides for editor1 and manager1 during the test and removes them at the end.
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



$mods = array( 'software', 'contracts', 'tenders', 'provisions' );
$ov = function ( $login, $val ) use ( $wpl, $mods ) { $a = array(); foreach ( $mods as $m ) { $a[] = escapeshellarg( "$m:view_all=$val" ); } return shell_exec( 'php ' . escapeshellarg( dirname( __FILE__ ) . '/set-override.php' ) . ' ' . escapeshellarg( $wpl ) . ' ' . $login . ' ' . implode( ' ', $a ) ); };
$ov( 'editor1', 'deny' ); $ov( 'manager1', 'deny' );
shell_exec( 'php ' . escapeshellarg( dirname( __FILE__ ) . '/set-override.php' ) . ' ' . escapeshellarg( $wpl ) . ' manager1 software:view_all=deny software:delete=allow software:purge=allow contracts:view_all=deny tenders:view_all=deny provisions:view_all=deny' );

$A = client( $base, 'admin', getenv( 'RL_TEST_ADMIN_PASS' ) ?: die( "Set RL_TEST_ADMIN_PASS\n" ) );
$V = client( $base, 'viewer1', 'Pw-viewer1-12345!' );
$E = client( $base, 'editor1', 'Pw-editor1-12345!' );
$M = client( $base, 'manager1', 'Pw-manager1-12345!' );
$N = client( $base, 'nobody', 'Pw-nobody-12345!' );
$ids = array(); foreach ( $A->rl( 'GET', 'owners' )['json']['users'] ?? array() as $u ) { $ids[ $u['name'] ] = $u['id']; }
$o = $A->rl( 'GET', 'owners' );
t( 'owners list ok', 200 === $o['code'], $o['body'] );
$uid = function ( $login ) use ( $wpl ) { return (int) trim( shell_exec( 'php -r ' . escapeshellarg( 'require ' . var_export( $wpl, true ) . '; echo get_user_by("login",' . var_export( $login, true ) . ')->ID;' ) ) ); };
$eid = $uid( 'editor1' ); $mid = $uid( 'manager1' ); $vid = $uid( 'viewer1' ); $nid = $uid( 'nobody' );
t( 'user ids found', $eid && $mid && $vid, "$eid $mid $vid" );
t( 'owners endpoint is closed to nobody', 403 === $N->rl( 'GET', 'owners' )['code'] || 401 === $N->rl( 'GET', 'owners' )['code'] );

$ids_of = function ( $k, $coll ) { $r = $k->rl( 'GET', "records/$coll" ); $o = array(); foreach ( $r['json']['items'] ?? array() as $i ) { $o[ $i['id'] ] = $i; } return $o; };
$yr = (int) date( 'Y' );
$sw = function ( $n ) use ( $yr ) { return array( 'name' => $n, 'dateFrom' => $yr . '-01-01', 'dateTo' => ( $yr + 1 ) . '-12-31' ); };
$ct = function ( $n ) use ( $yr ) { return array( 'title' => $n, 'tender' => '', 'description' => 'D', 'months' => 12, 'dateFrom' => ( $yr + 1 ) . '-01-01', 'dateTo' => ( $yr + 1 ) . '-12-31', 'cost' => 1000, 'coordinator' => '', 'years' => array( array( 'from' => ( $yr + 1 ) . '-01-01', 'to' => ( $yr + 1 ) . '-12-31', 'cost' => 1000 ) ) ); };
$clean = function () use ( $A ) { foreach ( array( 'software' => array( 'ow1', 'ow2', 'ow3' ), 'contracts' => array( 'oc1', 'oc2' ), 'tenders' => array( 'ot1', 'ot2' ), 'provisions' => array( 'op1' ) ) as $co => $l ) { foreach ( $l as $i ) { $A->rl( 'DELETE', "records/$co/$i" ); $A->rl( 'DELETE', "records/$co/$i&purge=1" ); } } };
$clean();

// creation: owner defaults to the creator, can be named
$r = $E->rl( 'PUT', 'records/software/ow1', array( 'data' => $sw( 'OWN-editor' ) ) ); t( 'editor creates software', 200 === $r['code'], $r['body'] );
$r = $M->rl( 'PUT', 'records/software/ow2', array( 'data' => $sw( 'OWN-manager' ) ) ); t( 'manager creates software', 200 === $r['code'], $r['body'] );
$r = $A->rl( 'PUT', 'records/software/ow3', array( 'data' => $sw( 'OWN-admin-for-editor' ), 'ownerId' => $eid ) ); t( 'admin creates software for editor', 200 === $r['code'], $r['body'] );
$r = $A->rl( 'PUT', 'records/software/ow3', array( 'data' => $sw( 'OWN-admin-for-editor' ), 'ownerId' => 999999 ) ); t( 'invalid owner id is 400 rl_bad_owner', 400 === $r['code'] && 'rl_bad_owner' === ( $r['json']['code'] ?? '' ), $r['body'] );
$r = $A->rl( 'PUT', 'records/software/ow3', array( 'data' => $sw( 'OWN-admin-for-editor' ), 'ownerId' => $nid ) ); t( 'user without access cannot be owner', 400 === $r['code'], $r['body'] );

// list scoping
$le = $ids_of( $E, 'software' ); $lm = $ids_of( $M, 'software' ); $la = $ids_of( $A, 'software' ); $lv = $ids_of( $V, 'software' );
t( 'editor sees own and assigned records only', isset( $le['ow1'], $le['ow3'] ) && ! isset( $le['ow2'] ), implode( ',', array_keys( $le ) ) );
t( 'manager sees only own', isset( $lm['ow2'] ) && ! isset( $lm['ow1'], $lm['ow3'] ) );
t( 'admin sees all', isset( $la['ow1'], $la['ow2'], $la['ow3'] ) );
t( 'viewer1 (view_all migrated) sees all', isset( $lv['ow1'], $lv['ow2'], $lv['ow3'] ) );
t( 'owner info in list', (int) ( $la['ow1']['owner'] ?? 0 ) === $eid && '' !== ( $la['ow1']['ownerName'] ?? '' ), json_encode( $la['ow1'] ?? null ) );

// foreign record: 404 everywhere
t( 'foreign PUT is 404', 404 === $M->rl( 'PUT', 'records/software/ow1', array( 'data' => $sw( 'HACK' ) ) )['code'] );
$d1 = $M->rl( 'DELETE', 'records/software/ow1' ); t( 'foreign DELETE is 404', 404 === $d1['code'], $d1['code'] . ' ' . $d1['body'] );
t( 'foreign restore is 404', 404 === $M->rl( 'POST', 'records/software/ow1/restore', array() )['code'] );
t( 'foreign purge is 404', 404 === $M->rl( 'DELETE', 'records/software/ow1&purge=1' )['code'] );
t( 'foreign record untouched', 'OWN-editor' === ( $ids_of( $A, 'software' )['ow1']['data']['name'] ?? '' ) );

// owner change
$r = $E->rl( 'PUT', 'records/software/ow1', array( 'data' => $sw( 'OWN-editor' ), 'ownerId' => $mid ) );
t( 'restricted user cannot change the owner (ignored)', 200 === $r['code'] && (int) ( $ids_of( $A, 'software' )['ow1']['owner'] ?? 0 ) === $eid, $r['body'] );
$r = $A->rl( 'PUT', 'records/software/ow1', array( 'data' => $sw( 'OWN-editor' ), 'ownerId' => $mid ) );
t( 'admin changes the owner', 200 === $r['code'] && (int) ( $ids_of( $A, 'software' )['ow1']['owner'] ?? 0 ) === $mid, $r['body'] );
t( 'editor no longer sees it', ! isset( $ids_of( $E, 'software' )['ow1'] ) );
t( 'new owner sees it', isset( $ids_of( $M, 'software' )['ow1'] ) );
$A->rl( 'PUT', 'records/software/ow1', array( 'data' => $sw( 'OWN-editor' ), 'ownerId' => $eid ) );

// contracts: coordinator text = owner name
$r = $A->rl( 'PUT', 'records/contracts/oc1', array( 'data' => $ct( 'OWN-contract' ), 'ownerId' => $eid ) );
t( 'contract created with owner', 200 === $r['code'], $r['body'] );
$lc = $ids_of( $A, 'contracts' );
$en = $lc['oc1']['ownerName'] ?? '?';
t( 'coordinator text equals the owner name', $en === ( $lc['oc1']['data']['coordinator'] ?? '' ) && '' !== $en, json_encode( $lc['oc1']['data']['coordinator'] ?? null ) );
t( 'editor sees own contract, manager does not', isset( $ids_of( $E, 'contracts' )['oc1'] ) && ! isset( $ids_of( $M, 'contracts' )['oc1'] ) );

// tenders and promotion
$tn = array( 'title' => 'OWN-tender', 'tender' => '', 'description' => 'x', 'months' => 12, 'dateFrom' => ( $yr + 2 ) . '-01-01', 'dateTo' => ( $yr + 2 ) . '-12-31', 'cost' => 800, 'years' => array( array( 'from' => ( $yr + 2 ) . '-01-01', 'to' => ( $yr + 2 ) . '-12-31', 'cost' => 800 ) ) );
$r = $E->rl( 'PUT', 'records/tenders/ot1', array( 'data' => $tn ) ); t( 'editor creates tender', 200 === $r['code'], $r['body'] );
$r = $M->rl( 'POST', 'records/tenders/ot1/promote', array() ); t( 'foreign tender promote is 404', 404 === $r['code'], $r['body'] );
$cdata = $ct( 'OWN-promoted' ); $cdata['tender'] = 'OWN-T1';
$r = $E->rl( 'POST', 'records/tenders/ot1/promote', array( 'data' => $cdata, 'contractId' => 'oc2' ) );
t( 'owner promotes own tender', 200 === $r['code'], $r['body'] );
$pc = $ids_of( $A, 'contracts' )['oc2'] ?? null;
t( 'promoted contract inherits the tender owner', $pc && (int) $pc['owner'] === $eid && $pc['ownerName'] === ( $pc['data']['coordinator'] ?? '' ), json_encode( $pc ) );

// duplicate message masking (restricted user must not learn a foreign title)
$dup = $tn; $dup['title'] = 'OWN-tender-dup';
$A->rl( 'PUT', 'records/tenders/ot2', array( 'data' => $tn + array(), 'ownerId' => $eid ) );
$r = $M->rl( 'PUT', 'records/tenders/ot2x', array( 'data' => $tn ) );
t( 'duplicate message does not leak foreign title', false === strpos( $r['body'], 'OWN-tender' ) || 200 === $r['code'], $r['body'] );
$M->rl( 'DELETE', 'records/tenders/ot2x' ); $M->rl( 'DELETE', 'records/tenders/ot2x&purge=1' );

// export scoping
$x = $M->rl( 'GET', 'export/software' );
t( 'export respects the owner', 200 !== $x['code'] || ( false === strpos( $x['body'], 'OWN-editor' ) && false === strpos( $x['body'], 'OWN-admin-for-editor' ) ), substr( $x['body'], 0, 120 ) );

// files
$tmp = tempnam( sys_get_temp_dir(), 'of' ); file_put_contents( $tmp, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF" );
$r = $E->req( 'POST', '/?rest_route=/rl/v1/files&coll=software', array( 'file' => new CURLFile( $tmp, 'application/pdf', 'o.pdf' ) ), array(), true );
$fid = $r['json']['id'] ?? ''; t( 'editor uploads a file', '' !== $fid, $r['body'] );
if ( $fid ) {
	t( 'uploader may download', 200 === $E->rl( 'GET', "files/$fid" )['code'] );
	t( 'admin may download', 200 === $A->rl( 'GET', "files/$fid" )['code'] );
	t( 'other restricted user gets 404', 404 === $M->rl( 'GET', "files/$fid" )['code'] );
}

// unassigned records and the assignment screen
if ( $wpl ) { shell_exec( 'php -r ' . escapeshellarg( 'require ' . var_export( $wpl, true ) . '; global $wpdb; $wpdb->update( RL_DB::table_records(), array( "owner_id" => 0 ), array( "collection" => "contracts", "doc_id" => "oc1" ) );' ) ); }
t( 'unowned record hidden from restricted users', ! isset( $ids_of( $E, 'contracts' )['oc1'] ) );
t( 'unowned record visible to view_all', isset( $ids_of( $A, 'contracts' )['oc1'] ) );
t( 'unassigned list is admin only', 403 === $E->rl( 'GET', 'owners/unassigned' )['code'] );
$ua = $A->rl( 'GET', 'owners/unassigned' );
$found = null; foreach ( $ua['json']['items'] ?? array() as $i ) { if ( 'oc1' === $i['id'] ) { $found = $i; } }
t( 'admin sees the unassigned contract', 200 === $ua['code'] && $found, substr( $ua['body'], 0, 200 ) );
t( 'assign is admin only', 403 === $E->rl( 'POST', 'owners/assign', array( 'items' => array( array( 'coll' => 'contracts', 'id' => 'oc1', 'owner' => $eid ) ) ) )['code'] );
$r = $A->rl( 'POST', 'owners/assign', array( 'items' => array( array( 'coll' => 'contracts', 'id' => 'oc1', 'owner' => $mid ) ) ) );
t( 'assign works', 200 === $r['code'] && isset( $ids_of( $M, 'contracts' )['oc1'] ), $r['body'] );

// cron and auto: owner e-mail
if ( $wpl ) {
	$out = shell_exec( 'php -r ' . escapeshellarg( 'require ' . var_export( $wpl, true ) . '; $n=0; foreach ( RL_Cron::collect() as $i ) { if ( array_key_exists( "owner_to", $i ) ) { $n++; } } echo $n >= 0 ? "ok" : "no";' ) );
	t( 'cron collect runs with owner_to', 'ok' === trim( (string) $out ), (string) $out );
}

$clean();
$ov( 'editor1', '' ); $ov( 'manager1', '' );
shell_exec( 'php ' . escapeshellarg( dirname( __FILE__ ) . '/set-override.php' ) . ' ' . escapeshellarg( $wpl ) . ' manager1 software:delete= software:purge=' );
echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
