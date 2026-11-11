<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Storage: two SQL tables (records, files) and a protected uploads folder.
 */
class RL_DB {

	const COLLECTIONS = array( 'software', 'contracts', 'tenders', 'contractors' );
	const MAX_FILE    = 20971520; // 20 MB
	const MAX_JSON    = 262144;   // 256 KB per record

	/** extension => mime type served back */
	/** Largest attachment the server accepts: 20 MB, or less when PHP / WordPress allow less (upload_max_filesize, post_max_size). */
	public static function max_upload() {
		$wp = function_exists( 'wp_max_upload_size' ) ? (int) wp_max_upload_size() : self::MAX_FILE;
		return max( 1, min( self::MAX_FILE, $wp ) );
	}

	/** A tender number compared without case and spaces: "12 / 2024" equals "12/2024". */
	public static function tender_key( $n ) {
		$n = preg_replace( '/\s+/u', '', is_scalar( $n ) ? (string) $n : '' );
		return function_exists( 'mb_strtoupper' ) ? mb_strtoupper( (string) $n, 'UTF-8' ) : strtoupper( (string) $n );
	}

	/** The live (not trashed) tender that already uses this number, other than $except_id. @return array|null { id, title } */
	public static function tender_with_number( $number, $except_id = '' ) {
		$key = self::tender_key( $number );
		if ( '' === $key ) {
			return null;
		}
		foreach ( self::list_records( 'tenders' ) as $r ) {
			if ( (string) $r['id'] !== (string) $except_id && self::tender_key( isset( $r['data']['tender'] ) ? $r['data']['tender'] : '' ) === $key ) {
				return array( 'id' => $r['id'], 'title' => isset( $r['data']['title'] ) ? (string) $r['data']['title'] : '' );
			}
		}
		return null;
	}

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
			'html' => 'text/html',
			'htm'  => 'text/html',
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
  deleted_at datetime DEFAULT NULL,
  deleted_by bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY coll_doc (collection,doc_id),
  KEY coll (collection),
  KEY trashed (collection,deleted_at)
) $charset;"
		);

		dbDelta(
			"CREATE TABLE $files (
  id char(32) NOT NULL,
  orig_name varchar(255) NOT NULL,
  stored_name varchar(80) NOT NULL,
  mime varchar(100) NOT NULL,
  size bigint(20) unsigned NOT NULL DEFAULT 0,
  collection varchar(20) NOT NULL DEFAULT '',
  uploaded_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id)
) $charset;"
		);
	}

	/* ---------- records ---------- */

	private static function pack( $collection, array $data ) {
		unset( $data['password'] ); // the application no longer stores passwords
		return wp_json_encode( $data );
	}

	private static function unpack( $collection, $json ) {
		$data = json_decode( $json, true );
		if ( ! is_array( $data ) ) {
			return array();
		}
		unset( $data['password'] );
		return $data;
	}

	/** One-off clean-up after the upgrade: remove passwords stored by older versions. @return int rows changed */
	public static function strip_passwords() {
		global $wpdb;
		$t = self::table_records();
		$n = 0;
		$rows = $wpdb->get_results( "SELECT id, data FROM $t WHERE collection = 'software' AND data LIKE '%\"password\"%'", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		foreach ( (array) $rows as $r ) {
			$d = json_decode( $r['data'], true );
			if ( is_array( $d ) && array_key_exists( 'password', $d ) ) {
				unset( $d['password'] );
				$wpdb->update( $t, array( 'data' => wp_json_encode( $d ) ), array( 'id' => (int) $r['id'] ), array( '%s' ), array( '%d' ) );
				++$n;
			}
		}
		return $n;
	}

	/**
	 * Records of a collection. Records in the trash are left out unless $trash is true.
	 * Trash rows also carry deleted_at (UTC) and deleted_by (display name).
	 */
	public static function list_records( $collection, $trash = false ) {
		global $wpdb;
		$t     = self::table_records();
		$where = $trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT doc_id, data, deleted_at, deleted_by FROM $t WHERE collection = %s AND $where ORDER BY id ASC", $collection ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out   = array();
		foreach ( (array) $rows as $r ) {
			$row = array(
				'id'   => $r['doc_id'],
				'data' => self::unpack( $collection, $r['data'] ),
			);
			if ( $trash ) {
				$u                  = $r['deleted_by'] ? get_userdata( (int) $r['deleted_by'] ) : false;
				$row['deleted_at']  = $r['deleted_at'];
				$row['deleted_by']  = $u ? $u->display_name : '';
			}
			$out[] = $row;
		}
		return $out;
	}

	/** How many records (live and in the trash) use each budget article code. @return array code => count */
	public static function article_usage() {
		$out = array();
		foreach ( array( 'software', 'contracts', 'tenders' ) as $c ) {
			foreach ( array( false, true ) as $tr ) {
				foreach ( self::list_records( $c, $tr ) as $r ) {
					$seen = array();
					foreach ( ( isset( $r['data']['budget'] ) && is_array( $r['data']['budget'] ) ) ? $r['data']['budget'] : array() as $p ) {
						$code = is_array( $p ) && isset( $p['article'] ) ? (string) $p['article'] : '';
						if ( '' !== $code && ! isset( $seen[ $code ] ) ) {
							$seen[ $code ] = 1;
							$out[ $code ]  = ( isset( $out[ $code ] ) ? $out[ $code ] : 0 ) + 1;
						}
					}
				}
			}
		}
		return $out;
	}

	/** A name compared without case and extra spaces. */
	public static function name_key( $n ) {
		$n = trim( preg_replace( '/\s+/u', ' ', is_scalar( $n ) ? (string) $n : '' ) );
		$n = strtr( $n, array( 'ά' => 'α', 'έ' => 'ε', 'ή' => 'η', 'ί' => 'ι', 'ϊ' => 'ι', 'ΐ' => 'ι', 'ό' => 'ο', 'ύ' => 'υ', 'ϋ' => 'υ', 'ΰ' => 'υ', 'ώ' => 'ω', 'Ά' => 'Α', 'Έ' => 'Ε', 'Ή' => 'Η', 'Ί' => 'Ι', 'Ϊ' => 'Ι', 'Ό' => 'Ο', 'Ύ' => 'Υ', 'Ϋ' => 'Υ', 'Ώ' => 'Ω' ) ); // accents do not matter
		return function_exists( 'mb_strtoupper' ) ? mb_strtoupper( (string) $n, 'UTF-8' ) : strtoupper( (string) $n );
	}

	/** The live contractor with the same name or the same VAT number (other than $except_id). @return array|null { id, name, by } */
	public static function contractor_duplicate( $name, $vat, $except_id = '' ) {
		$nk = self::name_key( $name );
		$vk = self::tender_key( $vat );
		foreach ( self::list_records( 'contractors' ) as $r ) {
			if ( (string) $r['id'] === (string) $except_id ) {
				continue;
			}
			$d = $r['data'];
			if ( ( '' !== $nk && self::name_key( isset( $d['name'] ) ? $d['name'] : '' ) === $nk ) || ( '' !== $vk && self::tender_key( isset( $d['vat'] ) ? $d['vat'] : '' ) === $vk ) ) {
				return array( 'id' => $r['id'], 'name' => isset( $d['name'] ) ? (string) $d['name'] : '', 'by' => ( '' !== $nk && self::name_key( isset( $d['name'] ) ? $d['name'] : '' ) === $nk ) ? 'name' : 'vat' );
			}
		}
		return null;
	}

	/** Live contracts that use this contractor. @return array of { id, title } */
	public static function contractor_contracts( $id ) {
		$out = array();
		foreach ( self::list_records( 'contracts' ) as $r ) {
			if ( isset( $r['data']['contractorId'] ) && (string) $r['data']['contractorId'] === (string) $id ) {
				$out[] = array( 'id' => $r['id'], 'title' => isset( $r['data']['title'] ) ? (string) $r['data']['title'] : '' );
			}
		}
		return $out;
	}

	/** After a contractor is renamed: refresh the name copy kept inside its contracts. */
	public static function refresh_contractor_name( $id, $name, $user_id ) {
		foreach ( self::list_records( 'contracts' ) as $r ) {
			if ( isset( $r['data']['contractorId'] ) && (string) $r['data']['contractorId'] === (string) $id && ( ! isset( $r['data']['contractor'] ) || $r['data']['contractor'] !== $name ) ) {
				$d               = $r['data'];
				$d['contractor'] = $name;
				self::save_record( 'contracts', $r['id'], $d, $user_id );
			}
		}
	}

	public static function is_trashed( $collection, $id ) {
		global $wpdb;
		$t = self::table_records();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE collection = %s AND doc_id = %s AND deleted_at IS NOT NULL", $collection, $id ) ) > 0; // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/** Move a record to the trash. Nothing is deleted: attachments and history stay. @return bool true if a live record was moved */
	public static function trash_record( $collection, $id, $user_id ) {
		global $wpdb;
		$t = self::table_records();
		$n = $wpdb->query( $wpdb->prepare( "UPDATE $t SET deleted_at = %s, deleted_by = %d WHERE collection = %s AND doc_id = %s AND deleted_at IS NULL", current_time( 'mysql', true ), $user_id, $collection, $id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $n > 0;
	}

	/** @return bool true if a trashed record was restored */
	public static function restore_record( $collection, $id ) {
		global $wpdb;
		$t = self::table_records();
		$n = $wpdb->query( $wpdb->prepare( "UPDATE $t SET deleted_at = NULL, deleted_by = 0 WHERE collection = %s AND doc_id = %s AND deleted_at IS NOT NULL", $collection, $id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $n > 0;
	}

	/** Permanently delete records that have been in the trash for more than $days days. @return int number removed */
	public static function purge_expired( $days ) {
		global $wpdb;
		if ( (int) $days < 1 ) {
			return 0;
		}
		$t     = self::table_records();
		$limit = gmdate( 'Y-m-d H:i:s', time() - (int) $days * DAY_IN_SECONDS );
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT collection, doc_id FROM $t WHERE deleted_at IS NOT NULL AND deleted_at < %s", $limit ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		foreach ( (array) $rows as $r ) {
			self::delete_record( $r['collection'], $r['doc_id'] );
		}
		return count( (array) $rows );
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

	/** PERMANENT delete (record row and its attachment files). Normal deleting goes through trash_record(). */
	public static function delete_record( $collection, $id ) {
		global $wpdb;
		$t   = self::table_records();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT data FROM $t WHERE collection = %s AND doc_id = %s", $collection, $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( $row ) {
			$data  = json_decode( $row['data'], true );
			$lists = array();
			if ( is_array( $data ) ) {
				if ( ! empty( $data['attachments'] ) && is_array( $data['attachments'] ) ) {
					$lists[] = $data['attachments'];
				}
				foreach ( ( ! empty( $data['milestones'] ) && is_array( $data['milestones'] ) ) ? $data['milestones'] : array() as $m ) {
					if ( is_array( $m ) && ! empty( $m['attachments'] ) && is_array( $m['attachments'] ) ) {
						$lists[] = $m['attachments'];
					}
				}
			}
			foreach ( $lists as $list ) {
				foreach ( $list as $a ) {
					if ( is_array( $a ) && ! empty( $a['id'] ) ) {
						self::delete_file( (string) $a['id'] );
					}
				}
			}
		}
		$wpdb->delete( $t, array( 'collection' => $collection, 'doc_id' => $id ), array( '%s', '%s' ) );
	}

	/* ---------- single records and validation ---------- */

	public static function get_record( $collection, $id ) {
		global $wpdb;
		$t   = self::table_records();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT data FROM $t WHERE collection = %s AND doc_id = %s", $collection, $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return $row ? self::unpack( $collection, $row['data'] ) : null;
	}

	public static function record_exists( $collection, $id ) {
		global $wpdb;
		$t = self::table_records();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE collection = %s AND doc_id = %s", $collection, $id ) ) > 0; // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	private static function v_str( $v, $max ) {
		$v = is_scalar( $v ) ? (string) $v : '';
		$v = str_replace( "\0", '', wp_check_invalid_utf8( $v ) );
		$v = trim( $v );
		return function_exists( 'mb_substr' ) ? mb_substr( $v, 0, $max ) : substr( $v, 0, $max );
	}

	private static function v_date( $v ) {
		if ( is_string( $v ) && preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m ) && checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ) {
			return $v;
		}
		return '';
	}

	/** @param bool $blank_ok keep an empty value as '' (used for optional per-year costs) */
	private static function v_num( $v, $blank_ok = false ) {
		if ( ( '' === $v || null === $v ) && $blank_ok ) {
			return '';
		}
		if ( ! is_numeric( $v ) ) {
			return 0;
		}
		return max( 0, min( 1000000000000, round( (float) $v, 2 ) ) );
	}

	private static function v_attachments( $list, $collection ) {
		$out = array();
		if ( is_array( $list ) ) {
			foreach ( array_slice( $list, 0, 50 ) as $a ) {
				if ( ! is_array( $a ) || empty( $a['id'] ) || ! preg_match( '/^[a-f0-9]{32}$/', (string) $a['id'] ) ) {
					continue;
				}
				$row = self::get_file( (string) $a['id'] );
				if ( ! $row || ( '' !== $row['collection'] && $row['collection'] !== $collection ) ) {
					continue; // unknown file, or a file that belongs to another module
				}
				$out[] = array( 'id' => $row['id'], 'name' => $row['orig_name'], 'size' => (int) $row['size'] );
			}
		}
		return $out;
	}

	/** Partial amounts per year with their budget article. */
	private static function v_budget( $list ) {
		$out = array();
		if ( ! is_array( $list ) ) {
			return $out;
		}
		foreach ( array_slice( $list, 0, 200 ) as $p ) {
			if ( ! is_array( $p ) || ! isset( $p['amount'] ) || '' === $p['amount'] || ! is_numeric( $p['amount'] ) || (float) $p['amount'] < 0 || (float) $p['amount'] > 1000000000 ) {
				continue;
			}
			$out[] = array(
				'year'    => max( 1, min( 60, isset( $p['year'] ) ? (int) $p['year'] : 1 ) ),
				'amount'  => round( (float) $p['amount'], 2 ),
				'article' => self::v_str( isset( $p['article'] ) ? $p['article'] : '', 200 ),
			);
		}
		return $out;
	}

	private static function budget_sum( $parts, $year = null ) {
		$t = 0.0;
		foreach ( $parts as $p ) {
			if ( null === $year || (int) $p['year'] === (int) $year ) {
				$t += $p['amount'];
			}
		}
		return round( $t, 2 );
	}

	/** "a@x.gr, b@y.gr" -> normalised string, or WP_Error. */
	public static function v_emails( $v ) {
		$list = array();
		foreach ( preg_split( '/[,;\s]+/', is_string( $v ) ? $v : '', -1, PREG_SPLIT_NO_EMPTY ) as $e ) {
			$e = sanitize_email( $e );
			if ( '' === $e || ! is_email( $e ) ) {
				return new WP_Error( 'rl_bad_email', 'Invalid e-mail address in notification emails.', array( 'status' => 400 ) );
			}
			if ( ! isset( $list[ strtolower( $e ) ] ) ) {
				$list[ strtolower( $e ) ] = $e;
			}
		}
		if ( count( $list ) > 20 ) {
			return new WP_Error( 'rl_bad_email', 'At most 20 notification e-mail addresses.', array( 'status' => 400 ) );
		}
		return implode( ', ', $list );
	}

	/** Milestones of a record: per year, with their own reminder (30 or 60 days), comments and attachments. */
	private static function v_milestones( $list, $collection ) {
		$out  = array();
		$seen = array();
		if ( ! is_array( $list ) ) {
			return $out;
		}
		foreach ( array_slice( $list, 0, 300 ) as $m ) {
			if ( ! is_array( $m ) ) {
				continue;
			}
			$id = isset( $m['id'] ) && is_string( $m['id'] ) && preg_match( '/^[A-Za-z0-9_-]{1,40}$/', $m['id'] ) ? $m['id'] : '';
			if ( '' === $id || isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			$desc        = self::v_str( isset( $m['description'] ) ? $m['description'] : '', 1000 );
			if ( '' === $desc ) {
				continue;
			}
			$remind = isset( $m['remind'] ) ? (int) $m['remind'] : 30;
			$out[]  = array(
				'id'          => $id,
				'year'        => max( 1, min( 60, isset( $m['year'] ) ? (int) $m['year'] : 1 ) ),
				'description' => $desc,
				'due'         => self::v_date( isset( $m['due'] ) ? $m['due'] : '' ),
				'remind'      => in_array( $remind, array( 30, 60 ), true ) ? $remind : 30,
				'comments'    => self::v_str( isset( $m['comments'] ) ? $m['comments'] : '', 4000 ),
				'done'        => ! empty( $m['done'] ),
				'attachments' => self::v_attachments( isset( $m['attachments'] ) ? $m['attachments'] : array(), $collection ),
			);
		}
		return $out;
	}

	/**
	 * Keep only the fields the application knows, with safe types and lengths.
	 * @return array|WP_Error
	 */
	public static function sanitize_record( $collection, $d ) {
		if ( ! is_array( $d ) ) {
			return new WP_Error( 'rl_bad_data', 'Invalid data', array( 'status' => 400 ) );
		}
		$g = function ( $k ) use ( $d ) {
			return isset( $d[ $k ] ) ? $d[ $k ] : '';
		};
		$emails = 'tenders' === $collection ? '' : self::v_emails( $g( 'emails' ) );
		if ( is_wp_error( $emails ) ) {
			return $emails;
		}
		$created = isset( $d['createdAt'] ) && is_numeric( $d['createdAt'] ) ? (int) $d['createdAt'] : (int) round( microtime( true ) * 1000 );
		if ( 'software' === $collection ) {
			$out = array(
				'name'        => self::v_str( $g( 'name' ), 200 ),
				'description' => self::v_str( $g( 'description' ), 2000 ),
				'vendor'      => self::v_str( $g( 'vendor' ), 200 ),
				'website'     => self::v_str( $g( 'website' ), 500 ),
				'username'    => self::v_str( $g( 'username' ), 200 ),
				'dateFrom'    => self::v_date( $g( 'dateFrom' ) ),
				'dateTo'      => self::v_date( $g( 'dateTo' ) ),
				'cost'        => self::v_num( $g( 'cost' ) ),
				'remindDays'  => max( 1, min( 365, (int) $g( 'remindDays' ) ?: 30 ) ),
				'emails'      => '',
				'budget'      => array(),
				'attachments' => self::v_attachments( $g( 'attachments' ), $collection ),
				'milestones'  => self::v_milestones( $g( 'milestones' ), $collection ),
				'history'     => array(),
				'createdAt'   => $created,
				'sample'      => ! empty( $d['sample'] ),
			);
			$out['emails'] = $emails;
			$out['budget'] = self::v_budget( $g( 'budget' ) );
			if ( $out['budget'] ) {
				$out['cost'] = self::budget_sum( $out['budget'] ); // the cost is the sum of the partial amounts
			}
			if ( '' === $out['name'] ) {
				return new WP_Error( 'rl_bad_data', 'Software Name is required.', array( 'status' => 400 ) );
			}
			if ( isset( $d['history'] ) && is_array( $d['history'] ) ) {
				foreach ( array_slice( $d['history'], 0, 200 ) as $h ) {
					if ( is_array( $h ) ) {
						$out['history'][] = array(
							'from'      => self::v_date( isset( $h['from'] ) ? $h['from'] : '' ),
							'to'        => self::v_date( isset( $h['to'] ) ? $h['to'] : '' ),
							'cost'      => self::v_num( isset( $h['cost'] ) ? $h['cost'] : 0 ),
							'renewedOn' => self::v_date( isset( $h['renewedOn'] ) ? $h['renewedOn'] : '' ),
						);
					}
				}
			}
			return $out;
		}
		if ( 'contractors' === $collection ) {
			$out = array(
				'name'      => self::v_str( $g( 'name' ), 300 ),
				'vat'       => self::v_str( $g( 'vat' ), 40 ),
				'address'   => self::v_str( $g( 'address' ), 300 ),
				'address2'  => self::v_str( $g( 'address2' ), 300 ),
				'postal'    => self::v_str( $g( 'postal' ), 20 ),
				'city'      => self::v_str( $g( 'city' ), 120 ),
				'region'    => self::v_str( $g( 'region' ), 120 ),
				'country'   => self::v_str( $g( 'country' ), 120 ),
				'contact'   => self::v_str( $g( 'contact' ), 200 ),
				'phone'     => self::v_str( $g( 'phone' ), 60 ),
				'email'     => self::v_str( $g( 'email' ), 300 ),
				'createdAt' => $created,
				'sample'    => ! empty( $d['sample'] ),
			);
			if ( '' === $out['name'] ) {
				return new WP_Error( 'rl_bad_data', 'Contractor name is required.', array( 'status' => 400 ) );
			}
			return $out;
		}
		if ( 'tenders' === $collection ) {
			$out = array(
				'title'       => self::v_str( $g( 'title' ), 300 ),
				'tender'      => self::v_str( $g( 'tender' ), 100 ),
				'description' => self::v_str( $g( 'description' ), 4000 ),
				'months'      => max( 0, min( 1200, (int) $g( 'months' ) ) ),
				'dateFrom'    => self::v_date( $g( 'dateFrom' ) ),
				'dateTo'      => self::v_date( $g( 'dateTo' ) ),
				'cost'        => self::v_num( $g( 'cost' ) ),
				'years'       => array(),
				'budget'      => self::v_budget( $g( 'budget' ) ),
				'attachments' => self::v_attachments( $g( 'attachments' ), $collection ),
				'status'      => in_array( $g( 'status' ), array( 'active', 'cancelled', 'promoted' ), true ) ? $g( 'status' ) : 'active',
				'statusAt'    => self::v_date( $g( 'statusAt' ) ),
				'promotedTo'  => preg_match( '/^[A-Za-z0-9_-]{1,64}$/', (string) $g( 'promotedTo' ) ) ? (string) $g( 'promotedTo' ) : '',
				'createdAt'   => $created,
				'sample'      => ! empty( $d['sample'] ),
			);
			if ( '' === $out['title'] ) {
				return new WP_Error( 'rl_bad_data', 'Tender name is required.', array( 'status' => 400 ) );
			}
			if ( isset( $d['years'] ) && is_array( $d['years'] ) ) {
				foreach ( array_slice( $d['years'], 0, 60 ) as $y ) {
					if ( is_array( $y ) ) {
						$out['years'][] = array(
							'from' => self::v_date( isset( $y['from'] ) ? $y['from'] : '' ),
							'to'   => self::v_date( isset( $y['to'] ) ? $y['to'] : '' ),
							'cost' => self::v_num( isset( $y['cost'] ) ? $y['cost'] : '', true ),
						);
					}
				}
			}
			foreach ( $out['years'] as $yi => $yr ) {
				if ( array_filter( $out['budget'], function ( $p ) use ( $yi ) { return (int) $p['year'] === $yi + 1; } ) ) {
					$out['years'][ $yi ]['cost'] = self::budget_sum( $out['budget'], $yi + 1 );
				}
			}
			return $out;
		}
		$out = array(
			'title'       => self::v_str( $g( 'title' ), 300 ),
			'tender'      => self::v_str( $g( 'tender' ), 100 ),
			'description' => self::v_str( $g( 'description' ), 4000 ),
			'contractor'  => self::v_str( $g( 'contractor' ), 300 ),
			'contractorVat'     => self::v_str( $g( 'contractorVat' ), 40 ),
			'contractorAddress' => self::v_str( $g( 'contractorAddress' ), 300 ),
			'contractorContact' => self::v_str( $g( 'contractorContact' ), 200 ),
			'contractorPhone'   => self::v_str( $g( 'contractorPhone' ), 60 ),
			'contractorEmail'   => self::v_str( $g( 'contractorEmail' ), 300 ),
			'coordinator' => self::v_str( $g( 'coordinator' ), 300 ),
			'months'      => max( 0, min( 1200, (int) $g( 'months' ) ) ),
			'dateFrom'    => self::v_date( $g( 'dateFrom' ) ),
			'dateTo'      => self::v_date( $g( 'dateTo' ) ),
			'cost'        => self::v_num( $g( 'cost' ) ),
			'years'       => array(),
			'emails'      => '',
			'budget'      => array(),
			'attachments' => self::v_attachments( $g( 'attachments' ), $collection ),
			'milestones'  => self::v_milestones( $g( 'milestones' ), $collection ),
			'createdAt'   => $created,
			'sample'      => ! empty( $d['sample'] ),
		);
		$out['emails'] = $emails;
		$out['budget'] = self::v_budget( $g( 'budget' ) );
		$out['contractorId'] = preg_match( '/^[A-Za-z0-9_-]{1,64}$/', (string) $g( 'contractorId' ) ) ? (string) $g( 'contractorId' ) : '';
		$out['repName']      = self::v_str( $g( 'repName' ), 200 );
		$out['repPhone']     = self::v_str( $g( 'repPhone' ), 60 );
		$out['repEmail']     = self::v_str( $g( 'repEmail' ), 300 );
		if ( '' !== $out['contractorId'] ) {
			$cr = self::get_record( 'contractors', $out['contractorId'] );
			if ( ! $cr || self::is_trashed( 'contractors', $out['contractorId'] ) ) {
				return new WP_Error( 'rl_bad_contractor', 'The selected contractor does not exist.', array( 'status' => 400 ) );
			}
			/* the contractor's own details live in the contractors list; the contract keeps only the name as a copy */
			$out['contractor'] = isset( $cr['name'] ) ? (string) $cr['name'] : '';
			foreach ( array( 'contractorVat', 'contractorAddress', 'contractorContact', 'contractorPhone', 'contractorEmail' ) as $k ) {
				$out[ $k ] = '';
			}
		}
		if ( '' === $out['title'] ) {
			return new WP_Error( 'rl_bad_data', 'Contract title is required.', array( 'status' => 400 ) );
		}
		if ( isset( $d['years'] ) && is_array( $d['years'] ) ) {
			foreach ( array_slice( $d['years'], 0, 60 ) as $y ) {
				if ( is_array( $y ) ) {
					$out['years'][] = array(
						'from'   => self::v_date( isset( $y['from'] ) ? $y['from'] : '' ),
						'to'     => self::v_date( isset( $y['to'] ) ? $y['to'] : '' ),
						'cost'   => self::v_num( isset( $y['cost'] ) ? $y['cost'] : '', true ),
						'remind' => max( 1, min( 365, (int) ( isset( $y['remind'] ) ? $y['remind'] : 30 ) ?: 30 ) ),
					);
				}
			}
		}
		foreach ( $out['years'] as $yi => $yr ) {
			if ( self::budget_sum( $out['budget'], $yi + 1 ) > 0 || array_filter( $out['budget'], function ( $p ) use ( $yi ) { return (int) $p['year'] === $yi + 1; } ) ) {
				$out['years'][ $yi ]['cost'] = self::budget_sum( $out['budget'], $yi + 1 ); // a year's cost is the sum of its partial amounts
			}
		}
		return $out;
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
	public static function store_file( $tmp, $orig_name, $size, $user_id, $collection = '' ) {
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
				'collection'  => (string) $collection,
				'uploaded_by' => (int) $user_id,
				'created_at'  => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', '%s', '%d', '%s', '%d', '%s' )
		);
		return array(
			'id'   => $id,
			'name' => $name,
			'size' => (int) $size,
			'type' => $map[ $ext ],
			'collection' => (string) $collection,
		);
	}

	public static function get_file( $id ) {
		global $wpdb;
		$t = self::table_files();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %s", $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/** Copy a stored file for another collection (used when a tender is promoted to a contract). @return array|false */
	public static function copy_file( $id, $collection, $user_id ) {
		global $wpdb;
		$row = self::get_file( $id );
		if ( ! $row ) {
			return false;
		}
		$src = self::dir() . '/' . $row['stored_name'];
		if ( ! is_file( $src ) ) {
			return false;
		}
		$new    = bin2hex( random_bytes( 16 ) );
		$stored = $new . '.dat';
		if ( ! @copy( $src, self::dir() . '/' . $stored ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			return false;
		}
		$wpdb->insert(
			self::table_files(),
			array(
				'id'          => $new,
				'orig_name'   => $row['orig_name'],
				'stored_name' => $stored,
				'mime'        => $row['mime'],
				'size'        => (int) $row['size'],
				'collection'  => (string) $collection,
				'uploaded_by' => (int) $user_id,
				'created_at'  => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', '%s', '%d', '%s', '%d', '%s' )
		);
		return array( 'id' => $new, 'name' => $row['orig_name'], 'size' => (int) $row['size'] );
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
