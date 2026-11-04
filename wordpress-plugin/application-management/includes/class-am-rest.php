<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * REST API (namespace am/v1). Read-only and limited to the calling user:
 * all changes to roles and permissions happen in the WordPress Admin only.
 * Cookie authentication requires the X-WP-Nonce header, which protects against CSRF.
 */
class AM_REST {

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	/** Route table. Kept separate so the tests can verify that every route is protected. */
	public static function route_table() {
		return array(
			array(
				'route' => '/me',
				'args'  => array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'me' ),
					'permission_callback' => array( __CLASS__, 'logged_in' ),
				),
			),
			array(
				'route' => '/check',
				'args'  => array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'check' ),
					'permission_callback' => array( __CLASS__, 'logged_in' ),
					'args'                => array(
						'module' => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
						'action' => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
					),
				),
			),
		);
	}

	public static function routes() {
		foreach ( self::route_table() as $r ) {
			register_rest_route( 'am/v1', $r['route'], $r['args'] );
		}
	}

	public static function logged_in() {
		return is_user_logged_in();
	}

	/** Own permissions, for user interfaces that want to hide what the user cannot do. */
	public static function me() {
		$uid = get_current_user_id();
		if ( ! AM::throttle( 'me', $uid, 120 ) ) {
			return new WP_Error( 'am_rate_limited', 'Too many requests.', array( 'status' => 429 ) );
		}
		$engine = AM::engine();
		$st     = $engine->user_state( $uid );
		$mods   = array();
		foreach ( $engine->modules() as $slug => $m ) {
			$mods[ $slug ] = array( 'name' => $m['name'], 'enabled' => (bool) $m['enabled'] && (bool) $m['registered'] );
		}
		return rest_ensure_response( array(
			'user_id'     => $uid,
			'access'      => $st['enabled'],
			'roles'       => $st['roles'],
			'super_admin' => $engine->is_super( $uid ),
			'permissions' => $engine->permissions_for( $uid ),
			'modules'     => $mods,
		) );
	}

	/** Ask whether the CURRENT user may do something. Never reports on other users. */
	public static function check( $req ) {
		$uid = get_current_user_id();
		if ( ! AM::throttle( 'check', $uid, 240 ) ) {
			return new WP_Error( 'am_rate_limited', 'Too many requests.', array( 'status' => 429 ) );
		}
		return rest_ensure_response( array( 'allowed' => AM::can( (string) $req['module'], (string) $req['action'], $uid ) ) );
	}
}
