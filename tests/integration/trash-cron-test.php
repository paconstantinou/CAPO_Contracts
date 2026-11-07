<?php
/* CLI: php tests/integration/trash-cron-test.php /path/to/wp-load.php
   Auto-purge of expired trash, retention setting, and that reminders skip trashed records. */
require $argv[1];
$ok = 0; $bad = 0;
function t( $n, $c ) { global $ok, $bad; if ( $c ) { $ok++; echo "  ok   $n\n"; } else { $bad++; echo "  FAIL $n\n"; } }
global $wpdb; $tbl = RL_DB::table_records();
$mk = fn( $n, $to ) => array( 'name' => $n, 'dateFrom' => '2026-01-01', 'dateTo' => $to, 'cost' => 1, 'remindDays' => 30, 'attachments' => array(), 'milestones' => array() );
foreach ( array( 'tc-old', 'tc-new', 'tc-live', 'tc-rem' ) as $i ) { RL_DB::delete_record( 'software', $i ); }
RL_DB::save_record( 'software', 'tc-old', $mk( 'old', '2026-12-31' ), 1 );
RL_DB::save_record( 'software', 'tc-new', $mk( 'new', '2026-12-31' ), 1 );
RL_DB::save_record( 'software', 'tc-live', $mk( 'live', '2026-12-31' ), 1 );
RL_DB::trash_record( 'software', 'tc-old', 1 ); RL_DB::trash_record( 'software', 'tc-new', 1 );
$wpdb->query( $wpdb->prepare( "UPDATE $tbl SET deleted_at = %s WHERE doc_id = 'tc-old'", gmdate( 'Y-m-d H:i:s', time() - 31 * DAY_IN_SECONDS ) ) );
$wpdb->query( $wpdb->prepare( "UPDATE $tbl SET deleted_at = %s WHERE doc_id = 'tc-new'", gmdate( 'Y-m-d H:i:s', time() - 29 * DAY_IN_SECONDS ) ) );
delete_option( 'rl_trash_days' );
t( 'default retention is 30 days', 30 === RL_Settings::trash_days() );
$n = RL_Cron::purge_trash();
t( 'one record older than 30 days was removed', 1 === $n );
t( 'the 31-day-old record is gone', null === RL_DB::get_record( 'software', 'tc-old' ) );
t( 'the 29-day-old record is still in the trash', RL_DB::is_trashed( 'software', 'tc-new' ) );
t( 'a live record is never touched', null !== RL_DB::get_record( 'software', 'tc-live' ) && ! RL_DB::is_trashed( 'software', 'tc-live' ) );
update_option( 'rl_trash_days', 0 );
$wpdb->query( "UPDATE $tbl SET deleted_at = '2000-01-01 00:00:00' WHERE doc_id = 'tc-new'" );
t( 'retention 0 = never purge automatically', 0 === RL_Cron::purge_trash() && RL_DB::is_trashed( 'software', 'tc-new' ) );
update_option( 'rl_trash_days', 7 );
t( 'custom retention applies', 1 === RL_Cron::purge_trash() && null === RL_DB::get_record( 'software', 'tc-new' ) );
/* reminders */
$soon = gmdate( 'Y-m-d', time() + 3 * DAY_IN_SECONDS );
RL_DB::save_record( 'software', 'tc-rem', $mk( 'ReminderProbe', $soon ), 1 );
$has = function () { foreach ( RL_Cron::collect() as $i ) { if ( 'ReminderProbe' === $i['title'] ) { return true; } } return false; };
t( 'a live record that expires soon is reminded', $has() );
RL_DB::trash_record( 'software', 'tc-rem', 1 );
t( 'a trashed record is NOT reminded', ! $has() );
RL_DB::delete_record( 'software', 'tc-rem' ); RL_DB::delete_record( 'software', 'tc-live' ); delete_option( 'rl_trash_days' );
echo "\n$ok passed, $bad failed\n"; exit( $bad ? 1 : 0 );
