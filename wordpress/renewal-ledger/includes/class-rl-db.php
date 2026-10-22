<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Storage: two SQL tables (records, files) and a protected uploads folder.
 * Passwords of the "software" collection are encrypted before they reach the database.
 */
class RL_DB {

	const COLLECTIONS = array( 'software', 'contracts' );
	const MAX_FILE    = 20971520; // 20 MB
	const MAX_JSON    = 262144;   // 256 KB per record

	/** extension => mime type served back */
	public static function allowed_types() {
		return array(
			'pdf'  => 'application/pdf',
			'png'  => 'image/png',
			'jpg'  => 'image/jpeg',
			'jpeg' => 'image/jpeg',
			'gif'  => 'image/gif',
			'webp' => 'image/webp',
			'csv'  => 'text/csv',
			'txt'  => 'text/plain',
			'md'   => 'text/plain',
			'doc'  => 'application/msword',
			'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'xls'  => 'application/vnd.ms-excel',
			'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'ppt'  => 'application/vnd.ms-powerpoint',
			'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			'odt'  => 'application/vnd.oasis.opendocument.text',
			'ods'  => 'application/vnd.oasis.opendocument.spreadsheet',
			'zip'  => 'application/zip',
			'eml'  => 'message/rfc822',
		);
	}

	public static function table_records() {
		global $wpdb;
		return $wpdb->prefix . 'rl_records';
	}

	public static function table_files() {
		global $wpdb;
		return $wpdb->prefix . 'rl_files';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$records = self::table_records();
		$files   = self::table_files();

		dbDelta(
			"CREATE TABLE $records (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  collection varchar(20) NOT NULL,
  doc_id varchar(64) NOT NULL,
  data longtext NOT NULL,
  created_by bigint(20) unsigned NOT NULL DEFAULT 0,
  updated_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY coll_doc (collection,doc_id),
  KEY coll (collection)
) $charset;"
		);

		dbDelta(
			"CREATE TABLE $files (
  id char(32) NOT NULL,
  orig_name varchar(255) NOT NULL,
  stored_name varchar(80) NOT NULL,
  mime varchar(100) NOT NULL,
  size bigint(20) unsigned NOT NULL DEFAULT 0,
  uploaded_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id)
) $charset;"
		);
	}

	/* ---------- encryption of stored passwords ---------- */

	private static function key() {
		$material = ( defined( 'AUTH_KEY' ) ? AUTH_KEY : '' ) . ( defined( 'SECURE_AUTH_KEY' ) ? SECURE_AUTH_KEY : '' ) . DB_NAME;
		return hash( 'sha256', $material, true );
	}

	public static function encrypt( $plain ) {
		if ( ! function_exists( 'openssl_encrypt' ) || $plain === '' ) {
			return $plain;
		}
		$iv  = random_bytes( 12 );
		$tag = '';
		$ct  = openssl_encrypt( $plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag );
		if ( false === $ct ) {
			return $plain;
		}
		return 'rl1:' . base64_encode( $iv . $tag . $ct );
	}

	public static function decrypt( $value ) {
		if ( ! is_string( $value ) || strpos( $value, 'rl1:' ) !== 0 ) {
			return $value;
		}
		$raw = base64_decode( substr( $value, 4 ), true );
		if ( false === $raw || strlen( $raw ) < 29 ) {
			return '';
		}
		$pt = openssl_decrypt( substr( $raw, 28 ), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr( $raw, 0, 12 ), substr( $raw, 12, 16 ) );
		return false === $pt ? '' : $pt;
	}

	/* ---------- records ---------- */

	private static function pack( $collection, array $data ) {
		if ( 'software' === $collection && isset( $data['password'] ) && is_string( $data['password'] ) ) {
			$data['password'] = self::encrypt( $data['password'] );
		}
		return wp_json_encode( $data );
	}

	private static function unpack( $collection, $json ) {
		$data = json_decode( $json, true );
		if ( ! is_array( $data ) ) {
			return array();
		}
		if ( 'software' === $collection && isset( $data['password'] ) ) {
			$data['password'] = self::decrypt( $data['password'] );
		}
		return $data;
	}

	public static function list_records( $collection ) {
		global $wpdb;
		$t    = self::table_records();
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT doc_id, data FROM $t WHERE collection = %s ORDER BY id ASC", $collection ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[] = array(
				'id'   => $r['doc_id'],
				'data' => self::unpack( $collection, $r['data'] ),
			);
		}
		return $out;
	}

	/** @return true|WP_Error */
	public static function save_record( $collection, $id, $data, $user_id ) {
		global $wpdb;
		if ( ! is_array( $data ) ) {
			return new WP_Error( 'rl_bad_data', 'Invalid data', array( 'status' => 400 ) );
		}
		$json = self::pack( $collection, $data );
		if ( false === $json || strlen( $json ) > self::MAX_JSON ) {
			return new WP_Error( 'rl_too_big', 'Record too large', array( 'status' => 413 ) );
		}
		$t   = self::table_records();
		$now = current_time( 'mysql', true );
		$sql = $wpdb->prepare(
			"INSERT INTO $t (collection, doc_id, data, created_by, updated_by, created_at, updated_at) VALUES (%s, %s, %s, %d, %d, %s, %s) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$collection,
			$id,
			$json,
			$user_id,
			$user_id,
			$now,
			$now
		);
		if ( false === $wpdb->query( $sql ) ) { // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return new WP_Error( 'rl_db', 'Database error', array( 'status' => 500 ) );
		}
		return true;
	}

	public static function delete_record( $collection, $id ) {
		global $wpdb;
		$t   = self::table_records();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT data FROM $t WHERE collection = %s AND doc_id = %s", $collection, $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( $row ) {
			$data = json_decode( $row['data'], true );
			if ( is_array( $data ) && ! empty( $data['attachments'] ) && is_array( $data['attachments'] ) ) {
				foreach ( $data['attachments'] as $a ) {
					if ( is_array( $a ) && ! empty( $a['id'] ) ) {
						self::delete_file( (string) $a['id'] );
					}
				}
			}
		}
		$wpdb->delete( $t, array( 'collection' => $collection, 'doc_id' => $id ), array( '%s', '%s' ) );
	}

	/* ---------- files ---------- */

	public static function dir() {
		$u = wp_upload_dir();
		return trailingslashit( $u['basedir'] ) . 'renewal-ledger';
	}

	public static function ensure_dir() {
		$dir = self::dir();
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		if ( is_dir( $dir ) ) {
			if ( ! file_exists( $dir . '/.htaccess' ) ) {
				file_put_contents( $dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n" );
			}
			if ( ! file_exists( $dir . '/index.php' ) ) {
				file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" );
			}
		}
	}

	/** @return array|WP_Error */
	public static function store_file( $tmp, $orig_name, $size, $user_id ) {
		global $wpdb;
		$name = sanitize_file_name( wp_basename( $orig_name ) );
		$ext  = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$map  = self::allowed_types();
		if ( ! isset( $map[ $ext ] ) ) {
			return new WP_Error( 'rl_bad_type', 'File type not allowed', array( 'status' => 415 ) );
		}
		if ( $size > self::MAX_FILE ) {
			return new WP_Error( 'rl_too_large', 'File too large', array( 'status' => 413 ) );
		}
		self::ensure_dir();
		$id     = bin2hex( random_bytes( 16 ) );
		$stored = $id . '.dat';
		if ( ! @move_uploaded_file( $tmp, self::dir() . '/' . $stored ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			return new WP_Error( 'rl_move', 'Could not store the file', array( 'status' => 500 ) );
		}
		$wpdb->insert(
			self::table_files(),
			array(
				'id'          => $id,
				'orig_name'   => $name,
				'stored_name' => $stored,
				'mime'        => $map[ $ext ],
				'size'        => (int) $size,
				'uploaded_by' => (int) $user_id,
				'created_at'  => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', '%s', '%d', '%d', '%s' )
		);
		return array(
			'id'   => $id,
			'name' => $name,
			'size' => (int) $size,
			'type' => $map[ $ext ],
		);
	}

	public static function get_file( $id ) {
		global $wpdb;
		$t = self::table_files();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %s", $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	public static function delete_file( $id ) {
		global $wpdb;
		$row = self::get_file( $id );
		if ( ! $row ) {
			return false;
		}
		$path = self::dir() . '/' . $row['stored_name'];
		if ( is_file( $path ) ) {
			@unlink( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
		}
		$wpdb->delete( self::table_files(), array( 'id' => $id ), array( '%s' ) );
		return true;
	}
}
