<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** REST API used by the page. Every route requires a logged-in, allowed user and the REST nonce. */
class RL_REST {

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function perm() {
		return is_user_logged_in() && RL_Settings::user_allowed();
	}

	public static function routes() {
		$coll = array(
			'validate_callback' => function ( $v ) {
				return in_array( $v, RL_DB::COLLECTIONS, true );
			},
		);
		$id = array(
			'validate_callback' => function ( $v ) {
				return (bool) preg_match( '/^[A-Za-z0-9_-]{1,64}$/', (string) $v );
			},
		);
		register_rest_route( 'rl/v1', '/records/(?P<coll>[a-z]+)', array(
			'methods'             => 'GET',
			'callback'            => array( __CLASS__, 'list_records' ),
			'permission_callback' => array( __CLASS__, 'perm' ),
			'args'                => array( 'coll' => $coll ),
		) );
		register_rest_route( 'rl/v1', '/records/(?P<coll>[a-z]+)/(?P<id>[A-Za-z0-9_-]+)', array(
			array(
				'methods'             => 'PUT',
				'callback'            => array( __CLASS__, 'put_record' ),
				'permission_callback' => array( __CLASS__, 'perm' ),
				'args'                => array( 'coll' => $coll, 'id' => $id ),
			),
			array(
				'methods'             => 'DELETE',
				'callback'            => array( __CLASS__, 'delete_record' ),
				'permission_callback' => array( __CLASS__, 'perm' ),
				'args'                => array( 'coll' => $coll, 'id' => $id ),
			),
		) );
		register_rest_route( 'rl/v1', '/files', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'upload_file' ),
			'permission_callback' => array( __CLASS__, 'perm' ),
		) );
		register_rest_route( 'rl/v1', '/files/(?P<id>[a-f0-9]{32})', array(
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_file' ),
				'permission_callback' => array( __CLASS__, 'perm' ),
			),
			array(
				'methods'             => 'DELETE',
				'callback'            => array( __CLASS__, 'delete_file' ),
				'permission_callback' => array( __CLASS__, 'perm' ),
			),
		) );
	}

	public static function list_records( $req ) {
		return rest_ensure_response( array( 'items' => RL_DB::list_records( $req['coll'] ) ) );
	}

	public static function put_record( $req ) {
		$body = $req->get_json_params();
		$data = is_array( $body ) && isset( $body['data'] ) ? $body['data'] : null;
		if ( ! is_array( $data ) ) {
			return new WP_Error( 'rl_bad_data', 'Missing data', array( 'status' => 400 ) );
		}
		$res = RL_DB::save_record( $req['coll'], $req['id'], $data, get_current_user_id() );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		return rest_ensure_response( array( 'ok' => true ) );
	}

	public static function delete_record( $req ) {
		RL_DB::delete_record( $req['coll'], $req['id'] );
		return rest_ensure_response( array( 'ok' => true ) );
	}

	public static function upload_file( $req ) {
		$files = $req->get_file_params();
		if ( empty( $files['file'] ) || ! isset( $files['file']['error'] ) || UPLOAD_ERR_OK !== (int) $files['file']['error'] ) {
			$code = ( ! empty( $files['file'] ) && in_array( (int) $files['file']['error'], array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) ) ? 'rl_too_large' : 'rl_no_file';
			return new WP_Error( $code, 'Upload failed', array( 'status' => 400 ) );
		}
		$f   = $files['file'];
		$res = RL_DB::store_file( $f['tmp_name'], $f['name'], (int) $f['size'], get_current_user_id() );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		return rest_ensure_response( $res );
	}

	public static function get_file( $req ) {
		$row = RL_DB::get_file( $req['id'] );
		$path = $row ? RL_DB::dir() . '/' . $row['stored_name'] : '';
		if ( ! $row || ! is_file( $path ) ) {
			return new WP_Error( 'rl_not_found', 'File not found', array( 'status' => 404 ) );
		}
		$inline = in_array( $row['mime'], array( 'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain' ), true );
		nocache_headers();
		header( 'Content-Type: ' . $row['mime'] );
		header( 'Content-Length: ' . filesize( $path ) );
		header( 'X-Content-Type-Options: nosniff' );
		header( "Content-Security-Policy: sandbox; default-src 'none'" );
		$ascii = preg_replace( '/[^A-Za-z0-9._-]/', '_', $row['orig_name'] );
		header( 'Content-Disposition: ' . ( $inline ? 'inline' : 'attachment' ) . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode( $row['orig_name'] ) );
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		exit;
	}

	public static function delete_file( $req ) {
		RL_DB::delete_file( $req['id'] );
		return rest_ensure_response( array( 'ok' => true ) );
	}
}
