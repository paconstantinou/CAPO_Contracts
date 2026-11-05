<?php
/** php emails-migration-test.php /path/to/wp-load.php - password clean-up and per-record reminder routing. */
$_SERVER['HTTP_HOST'] = '127.0.0.1'; $_SERVER['REMOTE_ADDR'] = '127.0.0.1'; $_SERVER['REQUEST_URI'] = '/';
require $argv[1];
$pass = 0; $fail = 0;
function t( $n, $c, $i = '' ) { global $pass, $fail; if ( $c ) { $pass++; echo "  ok   $n\n"; } else { $fail++; echo "  FAIL $n $i\n"; } }
global $wpdb;
$day = fn( $n ) => wp_date( 'Y-m-d', strtotime( ( $n >= 0 ? '+' : '' ) . $n . ' days', current_time( 'timestamp' ) ) );

echo "password clean-up\n";
$tbl = RL_DB::table_records();
$wpdb->insert( $tbl, array( 'collection' => 'software', 'doc_id' => 'legacy1', 'data' => wp_json_encode( array( 'name' => 'Legacy', 'username' => 'u', 'password' => 'rl1:AAAA', 'dateTo' => $day( 400 ) ) ), 'updated_by' => 1, 'updated_at' => current_time( 'mysql', true ) ) );
t( 'legacy row has a password in the database', false !== strpos( (string) $wpdb->get_var( "SELECT data FROM $tbl WHERE doc_id = 'legacy1'" ), 'password' ) );
$n = RL_DB::strip_passwords();
t( 'strip_passwords changed the row', $n >= 1, "n=$n" );
t( 'password gone from the database', false === strpos( (string) $wpdb->get_var( "SELECT data FROM $tbl WHERE doc_id = 'legacy1'" ), 'password' ) );
$rec = RL_DB::get_record( 'software', 'legacy1' );
t( 'username and name kept', 'u' === $rec['username'] && 'Legacy' === $rec['name'] );
t( 'sanitize_record drops password', ! array_key_exists( 'password', RL_DB::sanitize_record( 'software', array( 'name' => 'x', 'password' => 'p' ) ) ) );
RL_DB::delete_record( 'software', 'legacy1' );

echo "e-mail validation\n";
t( 'normalises, dedupes, case-insensitive', 'A@x.gr, b@y.gr' === RL_DB::v_emails( 'A@x.gr; b@y.gr,a@X.gr' ) );
t( 'empty is allowed', '' === RL_DB::v_emails( '' ) );
t( 'invalid rejected', is_wp_error( RL_DB::v_emails( 'ok@x.gr, nope' ) ) );
t( 'parse_emails ignores invalid', array( 'ok@x.gr' ) === RL_Cron::parse_emails( 'ok@x.gr, nope' ) );

echo "reminder routing\n";
update_option( 'rl_recipients', 'default@t.test' );
$mk = function ( $coll, $id, $extra ) use ( $day ) {
	if ( 'software' === $coll ) { $d = array_merge( array( 'name' => "T$id", 'dateFrom' => $day( -300 ), 'dateTo' => $day( 10 ), 'remindDays' => 30 ), $extra ); }
	else { $d = array_merge( array( 'title' => "T$id", 'months' => 12, 'dateFrom' => $day( -300 ), 'dateTo' => $day( 400 ), 'years' => array() ), $extra ); }
	RL_DB::save_record( $coll, $id, RL_DB::sanitize_record( $coll, $d ), 1 );
};
$mk( 'software', 'rt_a', array( 'emails' => 'x@t.test, y@t.test' ) );
$mk( 'software', 'rt_b', array() );
$mk( 'contracts', 'rt_c', array( 'emails' => 'z@t.test', 'milestones' => array( array( 'id' => 'q1', 'year' => 1, 'description' => 'Milestone Q', 'due' => $day( 5 ), 'remind' => 30 ) ) ) );
$mails = array();
add_filter( 'pre_wp_mail', function ( $null, $atts ) use ( &$mails ) { $mails[] = array( 'to' => (array) $atts['to'], 'body' => $atts['message'] ); return true; }, 10, 2 );
RL_Cron::run( true );
$find = function ( $to ) use ( &$mails ) { foreach ( $mails as $m ) { $x = $m['to']; sort( $x ); if ( $x === $to ) { return $m['body']; } } return null; };
$ab = $find( array( 'x@t.test', 'y@t.test' ) ); $cb = $find( array( 'z@t.test' ) ); $db = $find( array( 'default@t.test' ) );
t( 'record with 2 e-mails: one message to both', null !== $ab && false !== strpos( $ab, 'Trt_a' ) );
t( '...and it contains only its own items', null !== $ab && false === strpos( $ab, 'Trt_b' ) && false === strpos( $ab, 'Trt_c' ) );
t( 'milestone reminder goes to the contract e-mail', null !== $cb && false !== strpos( $cb, 'Milestone Q' ) && false === strpos( $cb, 'Trt_a' ) );
t( 'record without e-mails goes to default recipients', null !== $db && false !== strpos( $db, 'Trt_b' ) && false === strpos( $db, 'Trt_a' ) && false === strpos( $db, 'Milestone Q' ) );
foreach ( array( 'rt_a', 'rt_b' ) as $i ) { RL_DB::delete_record( 'software', $i ); } RL_DB::delete_record( 'contracts', 'rt_c' );
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
