<?php
/**
 * Runs when the plugin is deleted from the WordPress Admin.
 * Data is removed only if "Delete all data when the plugin is deleted" is ticked in Settings.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$am_settings = get_option( 'am_settings', array() );
if ( empty( $am_settings['delete_on_uninstall'] ) ) {
	return;
}

global $wpdb;
$am_p = $wpdb->prefix . 'am_';
foreach ( array( 'roles', 'role_grants', 'user_roles', 'user_access', 'user_overrides', 'modules', 'module_access', 'logs' ) as $am_t ) {
	$wpdb->query( "DROP TABLE IF EXISTS {$am_p}{$am_t}" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}
foreach ( array( 'am_settings', 'am_db_version', 'am_modules_hash' ) as $am_o ) {
	delete_option( $am_o );
}
$wpdb->query( "DELETE FROM {$wpdb->usermeta} WHERE meta_key = 'am_last_activity'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
wp_clear_scheduled_hook( 'am_prune_logs' );
