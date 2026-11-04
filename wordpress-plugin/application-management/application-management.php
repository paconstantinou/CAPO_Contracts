<?php
/**
 * Plugin Name:       Application Management
 * Description:       Central user, role and permission management for applications that run on this WordPress site. Uses the existing WordPress users; everything is managed from the WordPress Admin.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       application-management
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AM_VERSION', '1.0.0' );
define( 'AM_FILE', __FILE__ );
define( 'AM_DIR', plugin_dir_path( __FILE__ ) );
define( 'AM_URL', plugin_dir_url( __FILE__ ) );

require_once AM_DIR . 'includes/interface-am-store.php';
require_once AM_DIR . 'includes/class-am-engine.php';
require_once AM_DIR . 'includes/class-am-registry.php';
require_once AM_DIR . 'includes/class-am-store-wpdb.php';
require_once AM_DIR . 'includes/class-am-service.php';
require_once AM_DIR . 'includes/class-am-rest.php';
require_once AM_DIR . 'includes/class-am-admin.php';
require_once AM_DIR . 'includes/class-am-core.php';

register_activation_hook( AM_FILE, array( 'AM', 'activate' ) );
register_deactivation_hook( AM_FILE, array( 'AM', 'deactivate' ) );

AM::init();
