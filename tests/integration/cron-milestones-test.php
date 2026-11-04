<?php
/** php cron-milestones-test.php /path/to/wp-load.php  - milestone reminder selection (RL_Cron::collect). */
$_SERVER['HTTP_HOST'] = '127.0.0.1'; $_SERVER['REMOTE_ADDR'] = '127.0.0.1'; $_SERVER['REQUEST_URI'] = '/';
require $argv[1];
$pass = 0; $fail = 0;
function t( $n, $c, $i = '' ) { global $pass, $fail; if ( $c ) { $pass++; echo "  ok   $n\n"; } else { $fail++; echo "  FAIL $n $i\n"; } }
$day = fn( $n ) => wp_date( 'Y-m-d', strtotime( ( $n >= 0 ? '+' : '' ) . $n . ' days', current_time( 'timestamp' ) ) );
$ms = function ( $id, $due, $remind, $done = false ) { return array( 'id' => $id, 'year' => 1, 'description' => "M $id", 'due' => $due, 'remind' => $remind, 'comments' => '', 'done' => $done, 'attachments' => array() ); };
$rec = RL_DB::sanitize_record( 'software', array( 'name' => 'CronTest', 'dateFrom' => $day( -300 ), 'dateTo' => $day( 400 ), 'milestones' => array(
	$ms( 'a', $day( 20 ), 30 ), $ms( 'b', $day( 45 ), 30 ), $ms( 'c', $day( 45 ), 60 ), $ms( 'd', $day( 10 ), 30, true ), $ms( 'e', $day( -10 ), 30 ), $ms( 'f', $day( -40 ), 30 ), $ms( 'g', $day( 31 ), 30 ),
) ) );
RL_DB::save_record( 'software', 'crontest1', $rec, 1 );
$keys = array(); foreach ( RL_Cron::collect() as $i ) { if ( 0 === strpos( $i['key'], 'ms:software:crontest1:' ) ) { $keys[ substr( $i['key'], 22 ) ] = $i['kind']; } }
t( 'due in 20d with 30d alert is included', isset( $keys['a:due'] ) );
t( 'due in 45d with 30d alert is not', ! isset( $keys['b:due'] ) );
t( 'due in 45d with 60d alert is included', isset( $keys['c:due'] ) );
t( 'done milestone is skipped', ! isset( $keys['d:due'] ) );
t( 'overdue 10 days is reported as expired', ( $keys['e:exp'] ?? '' ) === 'expired' );
t( 'overdue 40 days is no longer reported', ! isset( $keys['f:exp'] ) );
t( 'due in 31d with 30d alert is not', ! isset( $keys['g:due'] ) );
RL_DB::delete_record( 'software', 'crontest1' );
echo "\n$pass passed, $fail failed\n"; exit( $fail ? 1 : 0 );
