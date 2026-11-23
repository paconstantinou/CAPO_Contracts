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

	const COLLECTIONS = array( 'software', 'contracts', 'tenders', 'contractors', 'provisions' );

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
				'route' => '/articles',
				'args'  => array(
					array(
						'methods'             => 'PUT',
						'callback'            => array( __CLASS__, 'save_articles' ),
						'permission_callback' => function () {
							/* Needs at least one of create / edit / delete on the module "articles"; save_articles() checks the exact ones. */
							if ( RL_Settings::can_edit_articles() ) {
								return true;
							}
							return self::check( 'articles', 'edit' ); // 403 (logged) or 503 when Application Management is missing
						},
					),
				),
			),
			array(
				'route' => '/settings',
				'args'  => array(
					array(
						'methods'             => 'GET',
						'callback'            => function () {
							return array( 'settings' => RL_Settings::app_settings() );
						},
						'permission_callback' => function () {
							return is_user_logged_in();
						},
					),
					array(
						'methods'             => 'PUT',
						'callback'            => array( __CLASS__, 'save_app_settings' ),
						'permission_callback' => function () {
							return self::can_manage_settings() ? true : new WP_Error( 'am_forbidden', 'Only administrators can change the settings.', array( 'status' => 403 ) );
						},
					),
				),
			),
			array(
				'route' => '/owners',
				'args'  => array(
					array(
						'methods'             => 'GET',
						'callback'            => function () {
							return array( 'items' => RL_Owners::eligible_users(), 'me' => get_current_user_id() );
						},
						'permission_callback' => function () {
							// The list of possible owners is for people who can add or change records.
							foreach ( RL_DB::OWNED as $m ) {
								if ( self::can( $m, 'create' ) || self::can( $m, 'edit' ) ) {
									return self::check( $m, self::can( $m, 'create' ) ? 'create' : 'edit' );
								}
							}
							return self::check( RL_DB::OWNED[0], 'create' ); // 401 / 403, logged
						},
					),
				),
			),
			array(
				'route' => '/owners/unassigned',
				'args'  => array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'list_unassigned' ),
						'permission_callback' => function () {
							return is_user_logged_in() ? ( self::can_manage_settings() ? true : new WP_Error( 'am_forbidden', 'Only administrators can assign owners.', array( 'status' => 403 ) ) ) : new WP_Error( 'rest_forbidden', 'Login required.', array( 'status' => 401 ) );
						},
					),
				),
			),
			array(
				'route' => '/owners/assign',
				'args'  => array(
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'assign_owners' ),
						'permission_callback' => function () {
							return is_user_logged_in() ? ( self::can_manage_settings() ? true : new WP_Error( 'am_forbidden', 'Only administrators can assign owners.', array( 'status' => 403 ) ) ) : new WP_Error( 'rest_forbidden', 'Login required.', array( 'status' => 401 ) );
						},
					),
				),
			),
			array(
				'route' => '/auto-tenders/run',
				'args'  => array(
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'run_auto_tenders' ),
						'permission_callback' => function () {
							return self::can_manage_settings() && self::can( 'tenders', 'create' ) ? true : new WP_Error( 'am_forbidden', 'Not allowed.', array( 'status' => 403 ) );
						},
					),
				),
			),
			array(
				'route' => '/note-template',
				'args'  => array(
					array(
						'methods'             => 'GET',
						'callback'            => function () {
							return array( 'template' => RL_Settings::note_template() );
						},
						'permission_callback' => function () {
							return is_user_logged_in() && ( self::can( 'software', 'view' ) || self::can_manage_settings() ) ? true : new WP_Error( 'am_forbidden', 'Not allowed.', array( 'status' => 403 ) );
						},
					),
					array(
						'methods'             => 'PUT',
						'callback'            => array( __CLASS__, 'save_note_template' ),
						'permission_callback' => function () {
							return self::can_manage_settings() ? true : new WP_Error( 'am_forbidden', 'Only administrators can change the note template.', array( 'status' => 403 ) );
						},
					),
					array(
						'methods'             => 'DELETE',
						'callback'            => array( __CLASS__, 'reset_note_template' ),
						'permission_callback' => function () {
							return self::can_manage_settings() ? true : new WP_Error( 'am_forbidden', 'Only administrators can change the note template.', array( 'status' => 403 ) );
						},
					),
				),
			),
			array(
				'route' => '/backup-schedule',
				'args'  => array(
					array(
						'methods'             => 'GET',
						'callback'            => function () {
							return array( 'schedule' => RL_Backup::view() );
						},
						'permission_callback' => array( __CLASS__, 'admin_only' ),
					),
					array(
						'methods'             => 'PUT',
						'callback'            => array( __CLASS__, 'save_backup_schedule' ),
						'permission_callback' => array( __CLASS__, 'admin_only' ),
					),
				),
			),
			array(
				'route' => '/backup-schedule/run',
				'args'  => array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'run_backup' ),
					'permission_callback' => array( __CLASS__, 'admin_only' ),
				),
			),
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
		$res  = null;
		if ( self::valid_coll( $coll ) ) {
			$res = self::check( $coll, $action );
		} else {
			foreach ( self::COLLECTIONS as $c ) {
				if ( self::can( $c, $action ) ) {
					$res = self::check( $c, $action );
					break;
				}
			}
			if ( null === $res ) {
				$res = self::check( self::COLLECTIONS[0], $action );
			}
		}
		// A person who sees only his or her own records only gets the files of those records (or files he or she uploaded and has not attached yet).
		if ( true === $res && $row ) {
			$restricted = RL_Owners::owned( $coll ) ? ! RL_Owners::sees_all( $coll ) : ! ( RL_Owners::sees_all( 'software' ) && RL_Owners::sees_all( 'contracts' ) && RL_Owners::sees_all( 'tenders' ) && RL_Owners::sees_all( 'provisions' ) );
			if ( $restricted && ! RL_DB::file_visible_to( $file_id, get_current_user_id() ) ) {
				return new WP_Error( 'rl_not_found', 'File not found', array( 'status' => 404 ) );
			}
		}
		return $res;
	}

	public static function save_articles( $req ) {
		$body = $req->get_json_params();
		$rows = is_array( $body ) && isset( $body['articles'] ) && is_array( $body['articles'] ) ? $body['articles'] : null;
		if ( null === $rows ) {
			return new WP_Error( 'rl_bad_request', 'Missing articles.', array( 'status' => 400 ) );
		}
		/* Adding needs "create", changing "edit", removing "delete" on the module "articles". */
		$diff = RL_Settings::diff_articles( RL_Settings::articles(), RL_Settings::normalize_articles( $rows ) );
		foreach ( $diff as $action => $codes ) {
			if ( $codes && ! self::can( 'articles', $action ) ) {
				$res = self::check( 'articles', $action );
				return is_wp_error( $res ) ? $res : new WP_Error( 'am_forbidden', 'You do not have permission to do this.', array( 'status' => 403 ) );
			}
		}
		$res = RL_Settings::save_articles( $rows );
		self::log( 'articles_saved', 'articles', array( 'count' => count( $res['articles'] ), 'kept' => $res['kept'] ) );
		return $res;
	}

	public static function admin_only() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_forbidden', 'Login required.', array( 'status' => 401 ) );
		}
		return self::can_manage_settings() ? true : new WP_Error( 'am_forbidden', 'Only administrators can change the backup schedule.', array( 'status' => 403 ) );
	}

	/**
	 * Settings tab, backup schedule and restore: WordPress administrators (manage_options, as before) OR anybody who has the
	 * "manage_settings" permission of the "Settings" module in Application Management (so a PROCURE360 administrator
	 * does not have to be a WordPress administrator).
	 */
	public static function can_manage_settings() {
		return current_user_can( 'manage_options' ) || self::can( 'settings', 'manage_settings' );
	}

	public static function save_backup_schedule( $req ) {
		$body = $req->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['schedule'] ) || ! is_array( $body['schedule'] ) ) {
			return new WP_Error( 'rl_bad_request', 'Missing schedule.', array( 'status' => 400 ) );
		}
		$s = RL_Backup::save( $body['schedule'] );
		if ( is_wp_error( $s ) ) {
			return $s;
		}
		self::log( 'backup_schedule_saved', 'settings', array( 'enabled' => $s['enabled'], 'frequency' => $s['frequency'], 'keep' => $s['keep'] ) );
		return array( 'schedule' => $s );
	}

	public static function run_backup() {
		$r = RL_Backup::run( 'manual' );
		if ( is_wp_error( $r ) ) {
			$st = $r->get_error_data();
			return new WP_Error( $r->get_error_code(), $r->get_error_message(), array( 'status' => is_array( $st ) && isset( $st['status'] ) ? $st['status'] : 500 ) );
		}
		return array( 'result' => $r, 'schedule' => RL_Backup::view() );
	}

	public static function save_note_template( $req ) {
		$body = $req->get_json_params();
		if ( ! is_array( $body ) || empty( $body['data'] ) || ! is_string( $body['data'] ) ) {
			return new WP_Error( 'rl_bad_request', 'Missing template.', array( 'status' => 400 ) );
		}
		$t = RL_Settings::save_note_template( isset( $body['name'] ) ? (string) $body['name'] : '', $body['data'] );
		if ( is_wp_error( $t ) ) {
			return $t;
		}
		self::log( 'note_template_saved', 'settings', array( 'name' => $t['name'], 'bytes' => $t['bytes'] ) );
		return array( 'template' => $t );
	}

	public static function reset_note_template() {
		RL_Settings::reset_note_template();
		self::log( 'note_template_reset', 'settings', array() );
		return array( 'template' => RL_Settings::note_template() );
	}

	public static function save_app_settings( $req ) {
		$body = $req->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['settings'] ) || ! is_array( $body['settings'] ) ) {
			return new WP_Error( 'rl_bad_request', 'Missing settings.', array( 'status' => 400 ) );
		}
		$s = RL_Settings::save_app_settings( $body['settings'] );
		self::log( 'settings_saved', 'settings', array( 'vat' => $s['vat'], 'remindDays' => $s['remindDays'], 'autoPct' => $s['autoPct'] ) );
		return array( 'settings' => $s );
	}

	/* ---------- records ---------- */

	public static function list_records( $req ) {
		$coll  = $req['coll'];
		$items = RL_DB::list_records( $coll, (bool) $req['trash'], RL_Owners::scope( $coll ) );
		if ( RL_Owners::owned( $coll ) ) {
			foreach ( $items as $i => $it ) {
				$items[ $i ]['ownerName'] = RL_Owners::name_of( $it['owner'] );
			}
		}
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
	/** Manual run of the yearly automatic tender creation (it ignores the 5 January date; contracts that already have a related tender are skipped, so it can be repeated safely). */
	public static function run_auto_tenders( $req ) {
		$res = RL_Auto::run( wp_date( 'Y-m-d' ), get_current_user_id() );
		return array( 'created' => count( $res ) );
	}

	public static function promote_tender( $req ) {
		$id     = $req['id'];
		$body   = $req->get_json_params();
		$cid    = is_array( $body ) && isset( $body['contractId'] ) ? (string) $body['contractId'] : '';
		$data   = is_array( $body ) && isset( $body['data'] ) && is_array( $body['data'] ) ? $body['data'] : null;
		$tender = RL_DB::get_record( 'tenders', $id );
		$t_own  = RL_DB::get_owner( 'tenders', $id );
		if ( ! $tender || RL_DB::is_trashed( 'tenders', $id ) || ! RL_Owners::may_touch( 'tenders', $t_own ) ) {
			return new WP_Error( 'rl_not_found', 'Tender not found.', array( 'status' => 404 ) );
		}
		// The new contract belongs to the owner of the tender (he or she becomes its coordinator) unless another user is named.
		$asked = RL_Owners::parse_asked( is_array( $body ) && isset( $body['ownerId'] ) ? $body['ownerId'] : null );
		if ( is_wp_error( $asked ) ) {
			return $asked;
		}
		$c_owner = null !== $asked ? $asked : (int) $t_own;
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
		$data['amendments']  = array(); // the history of the tender does not move to the contract
		$clean               = RL_DB::sanitize_record( 'contracts', $data );
		if ( is_wp_error( $clean ) ) {
			foreach ( $atts as $a ) {
				RL_DB::delete_file( $a['id'] );
			}
			return $clean;
		}
		$dup = ! empty( $clean['tender'] ) ? RL_DB::tender_with_number( $clean['tender'], $cid, 'contracts' ) : null;
		if ( $dup ) {
			foreach ( $atts as $a ) {
				RL_DB::delete_file( $a['id'] );
			}
			return new WP_Error( 'rl_duplicate_contract', 'A contract with tender number "' . $clean['tender'] . '" already exists' . self::dup_text( 'contracts', $dup ) . '.', array( 'status' => 409, 'existing' => self::dup_visible( 'contracts', $dup ) ? $dup['id'] : '' ) );
		}
		if ( $c_owner > 0 ) {
			$clean['coordinator'] = RL_Owners::coordinator_text( $c_owner, isset( $clean['coordinator'] ) ? $clean['coordinator'] : '' );
		}
		$res = RL_DB::save_record( 'contracts', $cid, $clean, get_current_user_id(), $c_owner );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$tender['status']     = 'promoted';
		$tender['promotedTo'] = $cid;
		$tender['statusAt']   = gmdate( 'Y-m-d' );
		$res                  = RL_DB::save_record( 'tenders', $id, $tender, get_current_user_id() ); // the tender keeps its owner
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		self::log( 'ledger.tender_promoted', 'tenders', array( 'id' => $id, 'title' => self::title_of( 'tenders', $tender ), 'contract' => $cid ) );
		self::log( 'ledger.record_create', 'contracts', array( 'id' => $cid, 'title' => $clean['title'], 'from_tender' => $id ) );
		return rest_ensure_response( array( 'ok' => true, 'contractId' => $cid ) );
	}

	/** May the current user see this record (an array with 'id')? Used so that a message never names a record the user cannot see. */
	private static function dup_visible( $coll, $dup ) {
		return RL_Owners::may_touch( $coll, RL_DB::get_owner( $coll, $dup['id'] ) );
	}

	/** ' ("Title")' / ' by the tender "Title"' when the user may see the other record, nothing otherwise. */
	private static function dup_text( $coll, $dup, $lead = '' ) {
		if ( ! self::dup_visible( $coll, $dup ) ) {
			return '' === $lead ? '' : ' by another record';
		}
		return '' === $lead ? ' ("' . $dup['title'] . '")' : ' ' . $lead . ' "' . $dup['title'] . '"';
	}

	public static function put_record( $req ) {
		$coll = $req['coll'];
		$id   = $req['id'];
		$body = $req->get_json_params();
		// Somebody else's record does not exist for a person who sees only his or her own records.
		$cur_owner = RL_DB::get_owner( $coll, $id ); // null = a new record
		if ( ! RL_Owners::may_touch( $coll, $cur_owner ) ) {
			return new WP_Error( 'rl_not_found', 'Record not found.', array( 'status' => 404 ) );
		}
		// Owner: a new record belongs to the person who saves it unless he or she names another user; only people who see all records may change the owner of an existing record.
		$owner_arg = null;
		if ( RL_Owners::owned( $coll ) ) {
			$asked = RL_Owners::parse_asked( is_array( $body ) && isset( $body['ownerId'] ) ? $body['ownerId'] : null );
			if ( is_wp_error( $asked ) ) {
				return $asked;
			}
			if ( null === $cur_owner ) {
				$owner_arg = null !== $asked ? $asked : (int) get_current_user_id();
			} elseif ( null !== $asked && RL_Owners::sees_all( $coll ) ) {
				$owner_arg = $asked;
			}
		}
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
			// A new tender may be created as "pending" (automatic creation). The related contract must exist, and the origin flag cannot be added or removed later.
			if ( '' !== $data['contractId'] && ! RL_DB::record_exists( 'contracts', $data['contractId'] ) ) {
				$data['contractId'] = '';
			}
			// Only the server-side automatic run (RL_Auto) sets the origin flag; through the REST API it is copied from the stored record, never from the request.
			$data['autoCreated'] = $old && ! empty( $old['autoCreated'] );
			$data['autoAt']      = $old && isset( $old['autoAt'] ) ? $old['autoAt'] : '';
			if ( ( ! $old || ( isset( $old['status'] ) ? $old['status'] : 'active' ) !== $data['status'] ) && 'cancelled' === $data['status'] ) {
				$data['statusAt'] = gmdate( 'Y-m-d' );
			}
		}
		if ( 'tenders' === $coll && ! empty( $data['tender'] ) ) {
			$dup = RL_DB::tender_with_number( $data['tender'], $id );
			if ( $dup ) {
				return new WP_Error( 'rl_duplicate_tender', 'Tender number "' . $data['tender'] . '" is already used' . self::dup_text( 'tenders', $dup, 'by the tender' ) . '.', array( 'status' => 409 ) );
			}
		}
		// Contracts: a new contract may not reuse the tender number of another contract; an existing one is only checked when its number changes.
		if ( 'contracts' === $coll && ! empty( $data['tender'] ) && ( ! $old || RL_DB::tender_key( isset( $old['tender'] ) ? $old['tender'] : '' ) !== RL_DB::tender_key( $data['tender'] ) ) ) {
			$dup = RL_DB::tender_with_number( $data['tender'], $id, 'contracts' );
			if ( $dup ) {
				return new WP_Error( 'rl_duplicate_contract', 'A contract with tender number "' . $data['tender'] . '" already exists' . self::dup_text( 'contracts', $dup ) . '.', array( 'status' => 409, 'existing' => self::dup_visible( 'contracts', $dup ) ? $dup['id'] : '' ) );
			}
		}
		// Amendment history is append-only: stored entries are kept exactly as they are, only entries with a new id (and a description) are added.
		$amended = array();
		if ( in_array( $coll, array( 'contracts', 'tenders' ), true ) ) {
			$keep = ( $old && ! empty( $old['amendments'] ) && is_array( $old['amendments'] ) ) ? $old['amendments'] : array();
			$have = array();
			foreach ( $keep as $k ) {
				$have[ $k['id'] ] = true;
			}
			foreach ( isset( $data['amendments'] ) ? (array) $data['amendments'] : array() as $a ) {
				if ( ! isset( $have[ $a['id'] ] ) && '' !== $a['description'] && count( $amended ) < 5 ) {
					$a['at']   = (int) round( microtime( true ) * 1000 );
					$amended[] = $a;
				}
			}
			$data['amendments'] = array_merge( $keep, $amended );
		}
		if ( 'contractors' === $coll ) {
			$dup = RL_DB::contractor_duplicate( $data['name'], $id );
			if ( $dup ) {
				return new WP_Error( 'rl_duplicate_contractor', 'A contractor with the same name already exists ("' . $dup['name'] . '").', array( 'status' => 409, 'existing' => $dup['id'] ) );
			}
		}
		// Contracts: the coordinator is the owner, so the text shown everywhere (list, exports, note) is the owner's name.
		$final_owner = null !== $owner_arg ? (int) $owner_arg : (int) $cur_owner;
		if ( 'contracts' === $coll && $final_owner > 0 ) {
			$data['coordinator'] = RL_Owners::coordinator_text( $final_owner, isset( $data['coordinator'] ) ? $data['coordinator'] : '' );
		}
		$res = RL_DB::save_record( $coll, $id, $data, get_current_user_id(), $owner_arg );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		foreach ( $amended as $a ) {
			self::log( 'tenders' === $coll ? 'ledger.tender_amended' : 'ledger.contract_amended', $coll, array( 'id' => $id, 'title' => $data['title'], 'amendment' => $a['id'], 'description' => $a['description'], 'cost' => array( $a['costBefore'], $a['costAfter'] ) ) );
		}
		if ( 'contractors' === $coll && $old && ( ! isset( $old['name'] ) || $old['name'] !== $data['name'] ) ) {
			RL_DB::refresh_contractor_name( $id, $data['name'], get_current_user_id() );
		}
		if ( 'tenders' === $coll && $old && isset( $old['status'] ) && $old['status'] !== $data['status'] ) {
			self::log( 'ledger.tender_' . $data['status'], $coll, array( 'id' => $id, 'title' => $data['title'] ) );
		}
		$title = in_array( $coll, array( 'software', 'contractors' ), true ) ? $data['name'] : $data['title'];
		$det = array( 'id' => $id, 'title' => $title );
		if ( null !== $owner_arg && (int) $owner_arg !== (int) $cur_owner ) {
			$det['owner'] = array( RL_Owners::name_of( $cur_owner ), RL_Owners::name_of( $owner_arg ) );
		}
		if ( $old ) {
			// Field-level diff. Sensitive fields are only marked "changed"; the whole entry must fit the 4000-char log column.
			$chg = RL_Audit_Diff::changes( $old, $data );
			if ( strlen( (string) wp_json_encode( $chg ) ) > 3000 ) {
				$chg = array_keys( $chg );
			}
			$det['changes'] = $chg;
		}
		self::log( $old ? 'ledger.record_edit' : 'ledger.record_create', $coll, $det );
		return rest_ensure_response( array( 'ok' => true ) );
	}

	private static function title_of( $coll, $rec ) {
		if ( ! is_array( $rec ) ) {
			return '';
		}
		$k = in_array( $coll, array( 'software', 'contractors' ), true ) ? 'name' : 'title';
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
		if ( ! RL_Owners::may_touch( $coll, RL_DB::get_owner( $coll, $id ) ) ) {
			return new WP_Error( 'rl_not_found', 'Record not found.', array( 'status' => 404 ) );
		}
		if ( $req['purge'] ) {
			if ( ! RL_DB::is_trashed( $coll, $id ) ) {
				return new WP_Error( 'rl_not_in_trash', 'Only records in the trash can be deleted permanently.', array( 'status' => 409 ) );
			}
			RL_DB::delete_record( $coll, $id );
			self::log( 'ledger.record_purge', $coll, array( 'id' => $id, 'title' => self::title_of( $coll, $old ) ) );
			return rest_ensure_response( array( 'ok' => true, 'purged' => true ) );
		}
		if ( 'contractors' === $coll ) {
			$used = RL_DB::contractor_contracts( $id );
			if ( $used ) {
				$seen = array_values( array_filter( $used, function ( $u ) {
					return self::dup_visible( 'contracts', $u );
				} ) );
				return new WP_Error( 'rl_contractor_in_use', 'This contractor is used by ' . count( $used ) . ' contract(s) and cannot be deleted.', array( 'status' => 409, 'contracts' => $seen ) );
			}
		}
		if ( RL_DB::trash_record( $coll, $id, get_current_user_id() ) ) {
			self::log( 'ledger.record_delete', $coll, array( 'id' => $id, 'title' => self::title_of( $coll, $old ), 'to_trash' => true ) );
		}
		return rest_ensure_response( array( 'ok' => true, 'trashed' => true ) );
	}

	public static function restore_record( $req ) {
		$coll = $req['coll'];
		$id   = $req['id'];
		if ( ! RL_Owners::may_touch( $coll, RL_DB::get_owner( $coll, $id ) ) ) {
			return new WP_Error( 'rl_not_in_trash', 'Record is not in the trash.', array( 'status' => 404 ) );
		}
		if ( 'tenders' === $coll ) {
			$rec = RL_DB::get_record( $coll, $id );
			$dup = ( $rec && ! empty( $rec['tender'] ) ) ? RL_DB::tender_with_number( $rec['tender'], $id ) : null;
			if ( $dup ) {
				return new WP_Error( 'rl_duplicate_tender', 'Tender number "' . $rec['tender'] . '" is already used' . self::dup_text( 'tenders', $dup, 'by the tender' ) . '.', array( 'status' => 409 ) );
			}
		}
		if ( 'contracts' === $coll ) {
			$rec = RL_DB::get_record( $coll, $id );
			$dup = ( $rec && ! empty( $rec['tender'] ) ) ? RL_DB::tender_with_number( $rec['tender'], $id, 'contracts' ) : null;
			if ( $dup ) {
				return new WP_Error( 'rl_duplicate_contract', 'A contract with tender number "' . $rec['tender'] . '" already exists' . self::dup_text( 'contracts', $dup ) . '.', array( 'status' => 409 ) );
			}
		}
		if ( 'contractors' === $coll ) {
			$rec = RL_DB::get_record( $coll, $id );
			$dup = $rec ? RL_DB::contractor_duplicate( isset( $rec['name'] ) ? $rec['name'] : '', $id ) : null;
			if ( $dup ) {
				return new WP_Error( 'rl_duplicate_contractor', 'A contractor with the same name already exists ("' . $dup['name'] . '").', array( 'status' => 409 ) );
			}
		}
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
		list( $head, $rows ) = RL_Export::table( $coll, $creds, RL_Owners::scope( $coll ) );
		$name = 'renewal-ledger-' . $coll . '-' . gmdate( 'Y-m-d' );
		self::log( 'ledger.export', $coll, array( 'format' => $format, 'rows' => count( $rows ) ) );

		nocache_headers();
		header( 'X-Content-Type-Options: nosniff' );
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		if ( 'xlsx' === $format ) {
			$path = RL_Export::xlsx( 'software' === $coll ? 'Software' : ( 'tenders' === $coll ? 'Tenders' : ( 'contractors' === $coll ? 'Contractors' : 'Contracts' ) ), $head, $rows );
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
			$post_max = (int) wp_convert_hr_to_bytes( (string) ini_get( 'post_max_size' ) );
			$too_big  = ( ! empty( $files['file'] ) && in_array( (int) $files['file']['error'], array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) )
				|| ( empty( $files['file'] ) && $post_max > 0 && isset( $_SERVER['CONTENT_LENGTH'] ) && (int) $_SERVER['CONTENT_LENGTH'] > $post_max ); // the whole request was dropped by PHP
			$code     = $too_big ? 'rl_too_large' : 'rl_no_file';
			return new WP_Error( $code, 'Upload failed', array( 'status' => 400 ) );
		}
		$f   = $files['file'];
		$chk = RL_Upload_Guard::check( $f['tmp_name'], $f['name'] );
		if ( is_wp_error( $chk ) ) {
			self::log( 'ledger.file_rejected', $coll, array( 'file' => sanitize_file_name( wp_basename( $f['name'] ) ), 'reason' => $chk->get_error_code() ) );
			return $chk;
		}
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
		self::log( 'ledger.file_download', (string) $row['collection'], array( 'file' => $row['orig_name'], 'id' => $row['id'] ) );
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

	/* ---------- owners ---------- */

	/** Records that have no owner yet (contracts of the time before 3.21, records created by an automatic run), with a matching proposal for each. For administrators. */
	public static function list_unassigned( $req ) {
		$out = array();
		foreach ( RL_DB::OWNED as $coll ) {
			foreach ( RL_DB::unowned( $coll ) as $r ) {
				$d     = $r['data'];
				$title = self::title_of( $coll, $d );
				$hint  = 'contracts' === $coll && isset( $d['coordinator'] ) ? (string) $d['coordinator'] : '';
				$sug   = '' !== $hint ? RL_Owners::suggest( $hint ) : 0;
				if ( ! $sug && $r['created_by'] > 0 && 'contracts' !== $coll ) {
					$sug = RL_Owners::is_eligible( $r['created_by'] ) ? (int) $r['created_by'] : 0;
				}
				$out[] = array( 'coll' => $coll, 'id' => $r['id'], 'title' => $title, 'coordinator' => $hint, 'createdBy' => RL_Owners::name_of( $r['created_by'] ), 'trashed' => $r['trashed'], 'suggested' => $sug );
			}
		}
		return array( 'items' => $out, 'users' => RL_Owners::eligible_users() );
	}

	/** Body: { items: [ { coll, id, owner } ] }. Sets the owner of records (for contracts also the coordinator text). */
	public static function assign_owners( $req ) {
		$body  = $req->get_json_params();
		$items = is_array( $body ) && isset( $body['items'] ) && is_array( $body['items'] ) ? array_slice( $body['items'], 0, 500 ) : null;
		if ( null === $items ) {
			return new WP_Error( 'rl_bad_request', 'Missing items.', array( 'status' => 400 ) );
		}
		$done = 0;
		foreach ( $items as $it ) {
			$coll = is_array( $it ) && isset( $it['coll'] ) ? (string) $it['coll'] : '';
			$id   = is_array( $it ) && isset( $it['id'] ) ? (string) $it['id'] : '';
			$own  = RL_Owners::parse_asked( is_array( $it ) && isset( $it['owner'] ) ? $it['owner'] : null );
			if ( is_wp_error( $own ) ) {
				return $own;
			}
			if ( null === $own || ! RL_Owners::owned( $coll ) || ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $id ) ) {
				continue;
			}
			$rec = RL_DB::get_record( $coll, $id );
			if ( ! $rec ) {
				continue;
			}
			if ( 'contracts' === $coll ) {
				$rec['coordinator'] = RL_Owners::coordinator_text( $own, isset( $rec['coordinator'] ) ? $rec['coordinator'] : '' );
			}
			if ( true === RL_DB::save_record( $coll, $id, $rec, get_current_user_id(), $own ) ) {
				++$done;
				self::log( 'ledger.owner_assigned', $coll, array( 'id' => $id, 'title' => self::title_of( $coll, $rec ), 'owner' => RL_Owners::name_of( $own ) ) );
			}
		}
		return rest_ensure_response( array( 'ok' => true, 'assigned' => $done ) );
	}
}
