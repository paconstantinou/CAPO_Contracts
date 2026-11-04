<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Facade used by WordPress hooks and by other plugins.
 *
 * Public PHP API for other plugins (all safe to call when this plugin is active):
 *   am_can( $module, $action, $user_id = 0 )           bool, no side effects
 *   AM::authorize( $module, $action, $user_id = 0 )    true | WP_Error (403 / 429), logs denials, rate-limits
 *   am_user_permissions( $user_id = 0 )                array module => actions
 *   am_is_super_admin( $user_id = 0 )                  bool
 *   am_log( $action, $module, $details, $target = 0 )  write an audit-log entry
 *   do_action( 'am_register_modules', AM_Registry )    declare modules (see class-am-registry.php)
 */
class AM {

	const OPTION_SETTINGS = 'am_settings';
	const CRON_PRUNE      = 'am_prune_logs';

	private static $store;
	private static $engine;
	private static $service;
	private static $settings;

	public static function defaults() {
		return array(
			'log_retention_days'  => 365,  // 0 = keep forever
			'rate_limit_per_min'  => 240,  // authorized requests per user per minute through AM::throttle()
			'denied_threshold'    => 30,   // denied attempts in 5 minutes before a 5 minute block
			'log_ip'              => 0,
			'delete_on_uninstall' => 0,
		);
	}

	public static function settings() {
		if ( null === self::$settings ) {
			$s              = get_option( self::OPTION_SETTINGS, array() );
			self::$settings = array_merge( self::defaults(), is_array( $s ) ? $s : array() );
		}
		return self::$settings;
	}

	public static function setting( $key ) {
		$s = self::settings();
		return isset( $s[ $key ] ) ? $s[ $key ] : null;
	}

	public static function save_settings( array $in ) {
		$d = self::defaults();
		$s = array(
			'log_retention_days'  => max( 0, min( 3650, (int) ( isset( $in['log_retention_days'] ) ? $in['log_retention_days'] : $d['log_retention_days'] ) ) ),
			'rate_limit_per_min'  => max( 30, min( 6000, (int) ( isset( $in['rate_limit_per_min'] ) ? $in['rate_limit_per_min'] : $d['rate_limit_per_min'] ) ) ),
			'denied_threshold'    => max( 5, min( 1000, (int) ( isset( $in['denied_threshold'] ) ? $in['denied_threshold'] : $d['denied_threshold'] ) ) ),
			'log_ip'              => empty( $in['log_ip'] ) ? 0 : 1,
			'delete_on_uninstall' => empty( $in['delete_on_uninstall'] ) ? 0 : 1,
		);
		update_option( self::OPTION_SETTINGS, $s, false );
		self::$settings = $s;
		return $s;
	}

	/* ---------- wiring ---------- */

	public static function store() {
		if ( ! self::$store ) {
			self::$store = new AM_Store_WPDB();
		}
		return self::$store;
	}

	public static function engine() {
		if ( ! self::$engine ) {
			self::$engine = new AM_Engine( self::store() );
		}
		return self::$engine;
	}

	public static function admin_capability() {
		return apply_filters( 'am_admin_capability', 'manage_options' );
	}

	public static function service() {
		if ( ! self::$service ) {
			self::$service = new AM_Service(
				self::store(),
				self::engine(),
				function ( $uid ) {
					return user_can( (int) $uid, AM::admin_capability() );
				},
				array( __CLASS__, 'write_log' ),
				function ( $uid ) {
					return (bool) get_userdata( (int) $uid );
				}
			);
		}
		return self::$service;
	}

	/** @var AM_Registry */
	private static $registry;

	public static function registry() {
		if ( ! self::$registry ) {
			self::$registry = new AM_Registry();
		}
		return self::$registry;
	}

	public static function init() {
		add_action( 'plugins_loaded', array( __CLASS__, 'maybe_upgrade' ), 5 );
		add_action( 'init', array( __CLASS__, 'boot_modules' ), 5 );
		add_action( 'wp_login', array( __CLASS__, 'on_login' ), 10, 2 );
		add_action( 'wp_logout', array( __CLASS__, 'on_logout' ) );
		add_action( 'wp_login_failed', array( __CLASS__, 'on_login_failed' ) );
		add_action( 'deleted_user', array( __CLASS__, 'on_user_deleted' ) );
		add_action( self::CRON_PRUNE, array( __CLASS__, 'prune' ) );
		AM_REST::init();
		AM_Admin::init();
	}

	public static function activate() {
		AM_Store_WPDB::install();
		AM_Registry::install_default_roles( self::store() );
		update_option( 'am_db_version', AM_VERSION, false );
		if ( ! wp_next_scheduled( self::CRON_PRUNE ) ) {
			wp_schedule_event( time() + 600, 'daily', self::CRON_PRUNE );
		}
		// The administrator who activates the plugin becomes the first Super Admin.
		$uid = get_current_user_id();
		if ( $uid && ! self::service()->super_admins() ) {
			$store = self::store();
			$roles = $store->get_user_roles( $uid );
			$roles[] = 'super_admin';
			$store->set_user_roles( $uid, array_values( array_unique( $roles ) ), $uid );
			$store->set_user_access( $uid, true, $uid );
			self::write_log( array( 'user_id' => $uid, 'target_user_id' => $uid, 'action' => 'activation.super_admin', 'details' => 'First Super Admin assigned to the administrator who activated the plugin.' ) );
		}
		self::engine()->flush();
		self::boot_modules( true );
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( self::CRON_PRUNE );
	}

	public static function maybe_upgrade() {
		if ( get_option( 'am_db_version' ) !== AM_VERSION ) {
			AM_Store_WPDB::install();
			AM_Registry::install_default_roles( self::store() );
			update_option( 'am_db_version', AM_VERSION, false );
		}
		if ( ! wp_next_scheduled( self::CRON_PRUNE ) ) {
			wp_schedule_event( time() + 600, 'daily', self::CRON_PRUNE );
		}
	}

	/** Let other plugins declare their modules, then persist the result. */
	public static function boot_modules( $force = false ) {
		$reg = self::registry();
		do_action( 'am_register_modules', $reg );
		$hash = $force ? '' : (string) get_option( 'am_modules_hash', '' );
		if ( $reg->sync( self::store(), $hash ) ) {
			update_option( 'am_modules_hash', md5( wp_json_encode( $reg->all() ) ), false );
			self::engine()->flush();
		}
	}

	/* ---------- authorization API ---------- */

	public static function current_user_id( $user_id = 0 ) {
		return $user_id ? (int) $user_id : (int) get_current_user_id();
	}

	public static function can( $module, $action, $user_id = 0 ) {
		return self::engine()->can( self::current_user_id( $user_id ), (string) $module, (string) $action );
	}

	/**
	 * Check a permission for an incoming request. Use this in every endpoint.
	 * Denials are written to the activity log (at most once a minute per user and permission)
	 * and too many denials in a row block the user for five minutes.
	 * @return true|WP_Error
	 */
	public static function authorize( $module, $action, $user_id = 0 ) {
		$uid = self::current_user_id( $user_id );
		if ( $uid <= 0 ) {
			return new WP_Error( 'am_not_logged_in', 'You must be logged in.', array( 'status' => 401 ) );
		}
		if ( get_transient( 'am_block_' . $uid ) ) {
			return new WP_Error( 'am_blocked', 'Too many denied requests. Try again in a few minutes.', array( 'status' => 429 ) );
		}
		$r = self::engine()->explain( $uid, (string) $module, (string) $action );
		if ( $r['allowed'] ) {
			if ( ! self::throttle( 'auth', $uid ) ) {
				return new WP_Error( 'am_rate_limited', 'Too many requests. Slow down.', array( 'status' => 429 ) );
			}
			self::touch_activity( $uid );
			return true;
		}
		self::note_denied( $uid, (string) $module, (string) $action, $r['reason'] );
		return new WP_Error( 'am_forbidden', 'You do not have permission to do this.', array( 'status' => 403 ) );
	}

	private static function note_denied( $uid, $module, $action, $reason ) {
		$key = 'am_dl_' . md5( $uid . '|' . $module . '|' . $action );
		if ( ! get_transient( $key ) ) {
			set_transient( $key, 1, 60 );
			self::log( 'access.denied', $module, array( 'permission' => $action, 'reason' => $reason ) );
		}
		$ck = 'am_dc_' . $uid;
		$n  = (int) get_transient( $ck ) + 1;
		set_transient( $ck, $n, 300 );
		if ( $n >= (int) self::setting( 'denied_threshold' ) ) {
			set_transient( 'am_block_' . $uid, 1, 300 );
			delete_transient( $ck );
			self::log( 'access.blocked', $module, 'Temporarily blocked after repeated denied requests.' );
		}
	}

	/** Simple per-user rate limit. @return bool true while under the limit */
	public static function throttle( $bucket, $user_id, $limit = 0, $window = 60 ) {
		$limit = $limit ? (int) $limit : (int) self::setting( 'rate_limit_per_min' );
		$key   = 'am_rl_' . $bucket . '_' . (int) $user_id;
		$n     = (int) get_transient( $key );
		if ( $n >= $limit ) {
			return false;
		}
		set_transient( $key, $n + 1, $window );
		return true;
	}

	public static function touch_activity( $uid ) {
		$last = (int) get_user_meta( $uid, 'am_last_activity', true );
		if ( time() - $last > 300 ) {
			update_user_meta( $uid, 'am_last_activity', time() );
		}
	}

	/* ---------- audit log ---------- */

	/** Write an audit entry as the current user. */
	public static function log( $action, $module = '', $details = '', $target = 0 ) {
		self::write_log( array(
			'user_id'        => get_current_user_id(),
			'target_user_id' => (int) $target,
			'action'         => $action,
			'module'         => $module,
			'details'        => is_string( $details ) ? $details : wp_json_encode( $details ),
		) );
	}

	public static function write_log( array $row ) {
		if ( self::setting( 'log_ip' ) && ! isset( $row['ip'] ) && ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
			$row['ip'] = substr( sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ), 0, 45 );
		}
		$row['details']    = isset( $row['details'] ) ? substr( (string) $row['details'], 0, 4000 ) : '';
		$row['created_at'] = gmdate( 'Y-m-d H:i:s' );
		self::store()->add_log( $row );
	}

	public static function on_login( $login, $user ) {
		self::write_log( array( 'user_id' => (int) $user->ID, 'action' => 'auth.login', 'details' => '' ) );
	}

	public static function on_logout( $user_id = 0 ) {
		$uid = $user_id ? (int) $user_id : (int) get_current_user_id();
		if ( $uid ) {
			self::write_log( array( 'user_id' => $uid, 'action' => 'auth.logout', 'details' => '' ) );
		}
	}

	public static function on_login_failed( $username ) {
		self::write_log( array( 'user_id' => 0, 'action' => 'auth.login_failed', 'details' => 'Username: ' . substr( sanitize_user( (string) $username, true ), 0, 60 ) ) );
	}

	public static function on_user_deleted( $user_id ) {
		self::store()->delete_user( (int) $user_id );
		self::engine()->flush();
		self::write_log( array( 'user_id' => get_current_user_id(), 'target_user_id' => (int) $user_id, 'action' => 'user.deleted', 'details' => 'WordPress user deleted; application access removed.' ) );
	}

	public static function prune() {
		$days = (int) self::setting( 'log_retention_days' );
		if ( $days > 0 ) {
			self::store()->prune_logs( gmdate( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS ) );
		}
	}
}

/* ---------- procedural helpers for other plugins ---------- */

function am_can( $module, $action, $user_id = 0 ) {
	return AM::can( $module, $action, $user_id );
}

function am_user_permissions( $user_id = 0 ) {
	return AM::engine()->permissions_for( AM::current_user_id( $user_id ) );
}

function am_is_super_admin( $user_id = 0 ) {
	return AM::engine()->is_super( AM::current_user_id( $user_id ) );
}

function am_log( $action, $module = '', $details = '', $target = 0 ) {
	AM::log( $action, $module, $details, $target );
}

/** Declare a module right away (the `am_register_modules` action is the preferred way). */
function am_register_module( $slug, array $args ) {
	return AM::registry()->register( $slug, $args );
}
