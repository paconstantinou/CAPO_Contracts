<?php
/**
 * Plugin Name: Renewal Ledger
 * Description: Μητρώο ανανεώσεων λογισμικού και συμβάσεων με ετήσιες υπενθυμίσεις, συνημμένα, εισαγωγή/εξαγωγή Excel και ειδοποιήσεις email. Τα δεδομένα αποθηκεύονται στη βάση SQL του WordPress.
 * Version: 1.0.0
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Text Domain: renewal-ledger
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RL_VERSION', '1.0.0' );
define( 'RL_DIR', plugin_dir_path( __FILE__ ) );
define( 'RL_URL', plugin_dir_url( __FILE__ ) );

require_once RL_DIR . 'includes/class-rl-db.php';
require_once RL_DIR . 'includes/class-rl-settings.php';
require_once RL_DIR . 'includes/class-rl-rest.php';
require_once RL_DIR . 'includes/class-rl-cron.php';

register_activation_hook( __FILE__, 'rl_activate' );
register_deactivation_hook( __FILE__, 'rl_deactivate' );

function rl_activate() {
	RL_DB::install();
	RL_DB::ensure_dir();
	RL_Cron::schedule();
}

function rl_deactivate() {
	RL_Cron::unschedule();
}

/* Create or update the tables after a plugin update, and make sure the cron event exists. */
add_action( 'plugins_loaded', function () {
	if ( get_option( 'rl_db_version' ) !== RL_VERSION ) {
		RL_DB::install();
		RL_DB::ensure_dir();
		update_option( 'rl_db_version', RL_VERSION );
	}
	RL_Cron::schedule();
} );

RL_Settings::init();
RL_REST::init();
RL_Cron::init();

/* [renewal_ledger] shortcode: place it on a page. The data itself is only served to allowed, logged-in users. */
add_shortcode( 'renewal_ledger', function () {
	if ( ! is_user_logged_in() ) {
		return '<p>' . esc_html__( 'Συνδέσου για να δεις το Renewal Ledger.', 'renewal-ledger' ) . ' <a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">' . esc_html__( 'Σύνδεση', 'renewal-ledger' ) . '</a></p>';
	}
	if ( ! RL_Settings::user_allowed() ) {
		return '<p>' . esc_html__( 'Δεν έχεις δικαίωμα πρόσβασης στο Renewal Ledger.', 'renewal-ledger' ) . '</p>';
	}

	if ( ! defined( 'DONOTCACHEPAGE' ) ) {
		define( 'DONOTCACHEPAGE', true );
	}
	$url = get_permalink();
	if ( $url && get_option( 'rl_app_url' ) !== $url ) {
		update_option( 'rl_app_url', $url, false );
	}

	wp_enqueue_style( 'rl-app', RL_URL . 'assets/app.css', array(), RL_VERSION );
	wp_enqueue_script( 'rl-xlsx', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', array(), '0.18.5', true );
	wp_enqueue_script( 'rl-shim', RL_URL . 'assets/wp-shim.js', array(), RL_VERSION, true );
	wp_enqueue_script( 'rl-app', RL_URL . 'assets/app.js', array( 'rl-xlsx', 'rl-shim' ), RL_VERSION, true );
	wp_add_inline_script(
		'rl-shim',
		'window.RL_CFG=' . wp_json_encode(
			array(
				'rest'   => esc_url_raw( rest_url( 'rl/v1/' ) ),
				'nonce'  => wp_create_nonce( 'wp_rest' ),
				'userId' => get_current_user_id(),
			)
		) . ';',
		'before'
	);

	$html = file_get_contents( RL_DIR . 'templates/app.html' );
	/* One line, so content filters (wpautop) cannot insert paragraphs. */
	return preg_replace( '/>\s+</', '><', $html );
} );
