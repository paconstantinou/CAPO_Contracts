<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * REST API (namespace rl/v1). Every route asks the Application Management plugin for a
 * permission on the module (software or contracts) BEFORE doing anything. If that plugin is
 * missing, everything is refused. Cookie authentication needs the X-WP-Nonce header (CSRF protection).
 *
 * module permissions used here:
 *   view     list records, open attachments
 *   create   add records (and upload attachments to a new record)
 *   edit     change records, renew, upload and remove attachments
 *   delete   delete records
 *   export   download CSV/XLSX (server side)
 *   manage   bulk import from Excel (together with create)
 *   credentials (software only)  see and change the username
 */
class RL_REST {

	const COLLECTIONS = array( 'software', 'contracts', 'tenders' );

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function valid_coll( $v ) {
		return in_array( $v, self::COLLECTIONS, true );
	}

	/** @return true|WP_Error */
	public static function check( $module, $action ) {
		if ( ! class_exists( 'AM' ) || ! method_exists( 'AM', 'authorize' ) ) {
			return new WP_Error( 'rl_needs_am', 'The Application Management plugin must be active.', array( 'status' => 503 ) );
		}
		return AM::authorize( $module, $action );
	}

	private static function can( $module, $action ) {
		return class_exists( 'AM' ) && AM::can( $module, $action );
	}

	private static function log( $action, $module, $details ) {
		if ( function_exists( 'am_log' ) ) {
			am_log( $action, $module, $details );
		}
	}

	/** Route table. Kept separate so the tests can verify that every route has a permission check. */
	public static function route_table() {
		$coll = array( 'validate_callback' => array( __CLASS__, 'valid_coll' ) );
		$id   = array(
			'validate_callback' => function ( $v ) {
				return (bool) preg_match( '/^[A-Za-z0-9_-]{1,64}$/', (string) $v );
			},
		);
		return array(
			array(
				'route' => '/records/(?P<coll>[a-z]+)',
				'args'  => array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'list_records' ),
					'permission_callback' => function ( $req ) {
						// The trash is for people who may delete (and so restore) records.
						return self::check( $req['coll'], $req['trash'] ? 'delete' : 'view' );
					},
					'args'                => array( 'coll' => $coll ),
				),
			),
			array(
				'route' => '/records/(?P<coll>[a-z]+)/(?P<id>[A-Za-z0-9_-]+)',
				'args'  => array(
					array(
						'methods'             => 'PUT',
						'callback'            => array( __CLASS__, 'put_record' ),
						'permission_callback' => function ( $req ) {
							if ( ! self::valid_coll( $req['coll'] ) ) {
								return new WP_Error( 'rl_bad_coll', 'Unknown collection', array( 'status' => 404 ) );
							}
							return self::check( $req['coll'], RL_DB::record_exists( $req['coll'], $req['id'] ) ? 'edit' : 'create' );
						},
						'args'                => array( 'coll' => $coll, 'id' => $id ),
					),
					array(
						'methods'             => 'DELETE',
						'callback'            => array( __CLASS__, 'delete_record' ),
						'permission_callback' => function ( $req ) {
							// ?purge=1 removes a record from the trash for good and needs its own permission.
							return self::check( $req['coll'], $req['purge'] ? 'purge' : 'delete' );
						},
						'args'                => array( 'coll' => $coll, 'id' => $id ),
					),
				),
			),
			array(
				'route' => '/records/(?P<coll>[a-z]+)/(?P<id>[A-Za-z0-9_-]+)/restore',
				'args'  => array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'restore_record' ),
					'permission_callback' => function ( $req ) {
						return self::check( $req['coll'], 'delete' );
					},
					'args'                => array( 'coll' => $coll, 'id' => $id ),
				),
			),
			array(
				'route' => '/records/tenders/(?P<id>[A-Za-z0-9_-]+)/promote',
				'args'  => array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'promote_tender' ),
					'permission_callback' => function () {
						// A promote edits the tender and creates a contract: both permissions are needed.
						$a = self::check( 'tenders', 'edit' );
						return true === $a ? self::check( 'contracts', 'create' ) : $a;
					},
					'args'                => array( 'id' => $id ),
				),
			),
			array(
				'route' => '/export/(?P<coll>[a-z]+)',
				'args'  => array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'export' ),
					'permission_callback' => function ( $req ) {
						return self::check( $req['coll'], 'export' );
					},
					'args'                => array(
						'coll'   => $coll,
						'format' => array( 'default' => 'xlsx', 'validate_callback' => function ( $v ) {
							return in_array( $v, array( 'xlsx', 'csv' ), true );
						} ),
					),
				),
			),
			array(
				'route' => '/files',
				'args'  => array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'upload_file' ),
					'permission_callback' => function ( $req ) {
						$c = (string) $req->get_param( 'coll' );
						if ( ! is_user_logged_in() ) {
							return self::check( self::COLLECTIONS[0], 'view' ); // 401
						}
						if ( ! self::valid_coll( $c ) ) {
							return new WP_Error( 'rl_bad_coll', 'Unknown collection', array( 'status' => 400 ) );
						}
						return self::check( $c, self::can( $c, 'edit' ) ? 'edit' : 'create' );
					},
				),
			),
			array(
				'route' => '/files/(?P<id>[a-f0-9]{32})',
				'args'  => array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'get_file' ),
						'permission_callback' => function ( $req ) {
							return self::file_permission( $req['id'], 'view' );
						},
					),
					array(
						'methods'             => 'DELETE',
						'callback'            => array( __CLASS__, 'delete_file' ),
						'permission_callback' => function ( $req ) {
							return self::file_permission( $req['id'], 'edit' );
						},
					),
				),
			),
		);
	}

	public static function routes() {
		foreach ( self::route_table() as $r ) {
			register_rest_route( 'rl/v1', $r['route'], $r['args'] );
		}
	}

	/** A file follows the permissions of the module it was uploaded for. Older files without a module need the permission on either module. */
	private static function file_permission( $file_id, $action ) {
		$row  = RL_DB::get_file( $file_id );
		$coll = $row ? (string) $row['collection'] : '';
		if ( self::valid_coll( $coll ) ) {
			return self::check( $coll, $action );
		}
		foreach ( self::COLLECTIONS as $c ) {
			if ( self::can( $c, $action ) ) {
				return self::check( $c, $action );
			}
		}
		return self::check( self::COLLECTIONS[0], $action );
	}

	/* ---------- records ---------- */

	public static function list_records( $req ) {
		$coll  = $req['coll'];
		$items = RL_DB::list_records( $coll, (bool) $req['trash'] );
		if ( 'software' === $coll && ! self::can( 'software', 'credentials' ) ) {
			foreach ( $items as $i => $it ) {
				$items[ $i ]['data']['username'] = '';
			}
		}
		return rest_ensure_response( array( 'items' => $items ) );
	}

	/**
	 * Promote a tender to a contract in one step. Body: { contractId, data } where data is the (corrected) contract.
	 * The tender is kept for reference (status "promoted") and stops being counted in the budget.
	 */
	public static function promote_tender( $req ) {
		$id     = $req['id'];
		$body   = $req->get_json_params();
		$cid    = is_array( $body ) && isset( $body['contractId'] ) ? (string) $body['contractId'] : '';
		$data   = is_array( $body ) && isset( $body['data'] ) && is_array( $body['data'] ) ? $body['data'] : null;
		$tender = RL_DB::get_record( 'tenders', $id );
		if ( ! $tender || RL_DB::is_trashed( 'tenders', $id ) ) {
			return new WP_Error( 'rl_not_found', 'Tender not found.', array( 'status' => 404 ) );
		}
		if ( isset( $tender['status'] ) && 'active' !== $tender['status'] ) {
			return new WP_Error( 'rl_tender_closed', 'Only an active tender can be promoted.', array( 'status' => 409 ) );
		}
		if ( ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $cid ) || null === $data ) {
			return new WP_Error( 'rl_bad_data', 'Invalid data', array( 'status' => 400 ) );
		}
		if ( RL_DB::record_exists( 'contracts', $cid ) ) {
			return new WP_Error( 'rl_exists', 'A contract with this id already exists.', array( 'status' => 409 ) );
		}
		// Attachments of the tender are copied, so the contract owns its own files.
		$own = array();
		foreach ( ( isset( $tender['attachments'] ) && is_array( $tender['attachments'] ) ) ? $tender['attachments'] : array() as $a ) {
			if ( is_array( $a ) && ! empty( $a['id'] ) ) {
				$own[ $a['id'] ] = true;
			}
		}
		$atts = array();
		foreach ( ( isset( $data['attachments'] ) && is_array( $data['attachments'] ) ) ? $data['attachments'] : array() as $a ) {
			if ( is_array( $a ) && ! empty( $a['id'] ) && isset( $own[ $a['id'] ] ) ) {
				$c = RL_DB::copy_file( (string) $a['id'], 'contracts', get_current_user_id() );
				if ( $c ) {
					$atts[] = $c;
				}
			}
		}
		$data['attachments'] = $atts;
		$data['milestones']  = array();
		$clean               = RL_DB::sanitize_record( 'contracts', $data );
		if ( is_wp_error( $clean ) ) {
			foreach ( $atts as $a ) {
				RL_DB::delete_file( $a['id'] );
			}
			return $clean;
		}
		$res = RL_DB::save_record( 'contracts', $cid, $clean, get_current_user_id() );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$tender['status']     = 'promoted';
		$tender['promotedTo'] = $cid;
		$tender['statusAt']   = gmdate( 'Y-m-d' );
		$res                  = RL_DB::save_record( 'tenders', $id, $tender, get_current_user_id() );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		self::log( 'ledger.tender_promoted', 'tenders', array( 'id' => $id, 'title' => self::title_of( 'tenders', $tender ), 'contract' => $cid ) );
		self::log( 'ledger.record_create', 'contracts', array( 'id' => $cid, 'title' => $clean['title'], 'from_tender' => $id ) );
		return rest_ensure_response( array( 'ok' => true, 'contractId' => $cid ) );
	}

	public static function put_record( $req ) {
		$coll = $req['coll'];
		$id   = $req['id'];
		$body = $req->get_json_params();
		$data = is_array( $body ) && isset( $body['data'] ) ? $body['data'] : null;
		$data = RL_DB::sanitize_record( $coll, $data );
		if ( is_wp_error( $data ) ) {
			return $data;
		}
		if ( RL_DB::is_trashed( $coll, $id ) ) {
			return new WP_Error( 'rl_in_trash', 'This record is in the trash. Restore it first.', array( 'status' => 409 ) );
		}
		$old = RL_DB::get_record( $coll, $id );
		if ( 'software' === $coll && ! self::can( 'software', 'credentials' ) ) {
			// Without the credentials permission the stored values are kept as they are.
			$data['username'] = $old && isset( $old['username'] ) ? $old['username'] : '';
		}
		if ( 'tenders' === $coll ) {
			// "promoted" can only be set by the promote endpoint, and a promoted tender stays promoted.
			if ( $old && isset( $old['status'] ) && 'promoted' === $old['status'] ) {
				$data['status']     = 'promoted';
				$data['promotedTo'] = isset( $old['promotedTo'] ) ? $old['promotedTo'] : '';
				$data['statusAt']   = isset( $old['statusAt'] ) ? $old['statusAt'] : '';
			} elseif ( 'promoted' === $data['status'] ) {
				$data['status']     = 'active';
				$data['promotedTo'] = '';
			}
			if ( 'promoted' !== $data['status'] ) {
				$data['promotedTo'] = '';
			}
			if ( ( ! $old || ( isset( $old['status'] ) ? $old['status'] : 'active' ) !== $data['status'] ) && 'cancelled' === $data['status'] ) {
				$data['statusAt'] = gmdate( 'Y-m-d' );
			}
		}
		$res = RL_DB::save_record( $coll, $id, $data, get_current_user_id() );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		if ( 'tenders' === $coll && $old && isset( $old['status'] ) && $old['status'] !== $data['status'] ) {
			self::log( 'ledger.tender_' . $data['status'], $coll, array( 'id' => $id, 'title' => $data['title'] ) );
		}
		$title = 'software' === $coll ? $data['name'] : $data['title'];
		self::log( $old ? 'ledger.record_edit' : 'ledger.record_create', $coll, array( 'id' => $id, 'title' => $title ) );
		return rest_ensure_response( array( 'ok' => true ) );
	}

	private static function title_of( $coll, $rec ) {
		if ( ! is_array( $rec ) ) {
			return '';
		}
		$k = 'software' === $coll ? 'name' : 'title';
		return isset( $rec[ $k ] ) ? (string) $rec[ $k ] : '';
	}

	/**
	 * DELETE: moves the record to the trash (nothing is lost, it can be restored).
	 * DELETE ?purge=1: removes a record that is already in the trash for good, together with its attachments.
	 */
	public static function delete_record( $req ) {
		$coll = $req['coll'];
		$id   = $req['id'];
		$old  = RL_DB::get_record( $coll, $id );
		if ( ! $old ) {
			return rest_ensure_response( array( 'ok' => true ) );
		}
		if ( $req['purge'] ) {
			if ( ! RL_DB::is_trashed( $coll, $id ) ) {
				return new WP_Error( 'rl_not_in_trash', 'Only records in the trash can be deleted permanently.', array( 'status' => 409 ) );
			}
			RL_DB::delete_record( $coll, $id );
			self::log( 'ledger.record_purge', $coll, array( 'id' => $id, 'title' => self::title_of( $coll, $old ) ) );
			return rest_ensure_response( array( 'ok' => true, 'purged' => true ) );
		}
		if ( RL_DB::trash_record( $coll, $id, get_current_user_id() ) ) {
			self::log( 'ledger.record_delete', $coll, array( 'id' => $id, 'title' => self::title_of( $coll, $old ), 'to_trash' => true ) );
		}
		return rest_ensure_response( array( 'ok' => true, 'trashed' => true ) );
	}

	public static function restore_record( $req ) {
		$coll = $req['coll'];
		$id   = $req['id'];
		if ( ! RL_DB::restore_record( $coll, $id ) ) {
			return new WP_Error( 'rl_not_in_trash', 'Record is not in the trash.', array( 'status' => 404 ) );
		}
		self::log( 'ledger.record_restore', $coll, array( 'id' => $id, 'title' => self::title_of( $coll, RL_DB::get_record( $coll, $id ) ) ) );
		return rest_ensure_response( array( 'ok' => true ) );
	}

	/* ---------- export ---------- */

	public static function export( $req ) {
		$coll   = $req['coll'];
		$format = $req['format'] ? $req['format'] : 'xlsx';
		$creds  = 'software' === $coll && self::can( 'software', 'credentials' );
		list( $head, $rows ) = RL_Export::table( $coll, $creds );
		$name = 'renewal-ledger-' . $coll . '-' . gmdate( 'Y-m-d' );
		self::log( 'ledger.export', $coll, array( 'format' => $format, 'rows' => count( $rows ) ) );

		nocache_headers();
		header( 'X-Content-Type-Options: nosniff' );
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		if ( 'xlsx' === $format ) {
			$path = RL_Export::xlsx( 'software' === $coll ? 'Software' : ( 'tenders' === $coll ? 'Tenders' : 'Contracts' ), $head, $rows );
			if ( $path ) {
				header( 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' );
				header( 'Content-Disposition: attachment; filename="' . $name . '.xlsx"' );
				header( 'Content-Length: ' . filesize( $path ) );
				readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
				@unlink( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
				exit;
			}
			header( 'X-RL-Fallback: csv' ); // the PHP zip extension is missing
		}
		$out = RL_Export::csv( $head, $rows );
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="' . $name . '.csv"' );
		header( 'Content-Length: ' . strlen( $out ) );
		echo $out; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}

	/* ---------- files ---------- */

	public static function upload_file( $req ) {
		$coll  = (string) $req->get_param( 'coll' );
		$files = $req->get_file_params();
		if ( empty( $files['file'] ) || ! isset( $files['file']['error'] ) || UPLOAD_ERR_OK !== (int) $files['file']['error'] ) {
			$code = ( ! empty( $files['file'] ) && in_array( (int) $files['file']['error'], array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) ) ? 'rl_too_large' : 'rl_no_file';
			return new WP_Error( $code, 'Upload failed', array( 'status' => 400 ) );
		}
		$f   = $files['file'];
		$res = RL_DB::store_file( $f['tmp_name'], $f['name'], (int) $f['size'], get_current_user_id(), $coll );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		self::log( 'ledger.file_upload', $coll, array( 'file' => $res['name'], 'size' => $res['size'] ) );
		return rest_ensure_response( $res );
	}

	public static function get_file( $req ) {
		$row  = RL_DB::get_file( $req['id'] );
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
		$row = RL_DB::get_file( $req['id'] );
		RL_DB::delete_file( $req['id'] );
		if ( $row ) {
			self::log( 'ledger.file_delete', (string) $row['collection'], array( 'file' => $row['orig_name'] ) );
		}
		return rest_ensure_response( array( 'ok' => true ) );
	}
}
