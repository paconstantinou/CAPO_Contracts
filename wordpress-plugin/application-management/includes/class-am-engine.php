<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The permission engine. Pure logic on top of an AM_Store, no WordPress calls,
 * so it can be tested exhaustively.
 *
 * Decision order (first match wins), deny by default:
 *  1. unknown user                                  -> deny
 *  2. application access switched off for the user   -> deny
 *  3. module unknown, switched off, or its plugin inactive -> deny
 *  4. action not defined by the module               -> deny
 *  5. explicit user override "deny"                  -> deny   (deny always beats allow)
 *  6. user holds a Super Admin role                  -> allow
 *  7. module is restricted and user/role not listed  -> deny
 *  8. explicit user override "allow"                 -> allow
 *  9. any of the user's roles grants the permission  -> allow
 * 10. otherwise                                      -> deny
 */
class AM_Engine {

	const STANDARD = array(
		'view'   => 'View',
		'create' => 'Create',
		'edit'   => 'Edit',
		'delete' => 'Delete',
		'export' => 'Export',
		'manage' => 'Manage',
	);

	/** @var AM_Store */
	private $store;
	private $c = array();

	public function __construct( AM_Store $store ) {
		$this->store = $store;
	}

	public function store() {
		return $this->store;
	}

	/** Forget everything read so far. Call after every write. */
	public function flush() {
		$this->c = array();
	}

	private function cached( $key, $fn ) {
		if ( ! array_key_exists( $key, $this->c ) ) {
			$this->c[ $key ] = $fn();
		}
		return $this->c[ $key ];
	}

	public function roles() {
		return $this->cached( 'roles', function () {
			return $this->store->get_roles();
		} );
	}

	public function modules() {
		return $this->cached( 'modules', function () {
			return $this->store->get_modules();
		} );
	}

	/** role slug => ["module:action", ...] */
	public function all_grants() {
		return $this->cached( 'grants', function () {
			return $this->store->get_all_role_grants();
		} );
	}

	/** Standard actions plus the custom actions the module declared. slug => label */
	public function module_actions( $module ) {
		$mods = $this->modules();
		if ( ! isset( $mods[ $module ] ) ) {
			return array();
		}
		$custom = isset( $mods[ $module ]['actions'] ) && is_array( $mods[ $module ]['actions'] ) ? $mods[ $module ]['actions'] : array();
		return array_merge( self::STANDARD, $custom );
	}

	public function user_state( $uid ) {
		$uid = (int) $uid;
		return $this->cached( 'u' . $uid, function () use ( $uid ) {
			$access = $this->store->get_user_access( $uid );
			$roles  = $this->roles();
			$slugs  = array();
			$super  = false;
			foreach ( $this->store->get_user_roles( $uid ) as $s ) {
				if ( isset( $roles[ $s ] ) ) {
					$slugs[] = $s;
					if ( ! empty( $roles[ $s ]['is_super'] ) ) {
						$super = true;
					}
				}
			}
			return array(
				'enabled'   => (bool) ( $access && ! empty( $access['enabled'] ) ),
				'roles'     => $slugs,
				'is_super'  => $super,
				'overrides' => $this->store->get_user_overrides( $uid ),
			);
		} );
	}

	/** Who counts as Super Admin: holds a Super Admin role AND has application access switched on. */
	public function is_super( $uid ) {
		$uid = (int) $uid;
		if ( $uid <= 0 ) {
			return false;
		}
		$st = $this->user_state( $uid );
		return $st['enabled'] && $st['is_super'];
	}

	/** @return array|null ['roles'=>string[],'users'=>int[]] or null when the module is open */
	private function gate( $module ) {
		return $this->cached( 'gate:' . $module, function () use ( $module ) {
			$g = $this->store->get_module_access( $module );
			if ( empty( $g['roles'] ) && empty( $g['users'] ) ) {
				return null;
			}
			return $g;
		} );
	}

	/** @return array ['allowed'=>bool,'reason'=>string] */
	public function explain( $uid, $module, $action ) {
		$uid  = (int) $uid;
		$deny = function ( $reason ) {
			return array( 'allowed' => false, 'reason' => $reason );
		};
		if ( $uid <= 0 ) {
			return $deny( 'no_user' );
		}
		$st = $this->user_state( $uid );
		if ( ! $st['enabled'] ) {
			return $deny( 'access_disabled' );
		}
		$mods = $this->modules();
		if ( ! isset( $mods[ $module ] ) ) {
			return $deny( 'module_unknown' );
		}
		if ( empty( $mods[ $module ]['enabled'] ) || empty( $mods[ $module ]['registered'] ) ) {
			return $deny( 'module_disabled' );
		}
		$actions = $this->module_actions( $module );
		if ( ! isset( $actions[ $action ] ) ) {
			return $deny( 'action_unknown' );
		}
		$key      = $module . ':' . $action;
		$override = isset( $st['overrides'][ $key ] ) ? $st['overrides'][ $key ] : '';
		if ( 'deny' === $override ) {
			return $deny( 'override_deny' );
		}
		if ( $st['is_super'] ) {
			return array( 'allowed' => true, 'reason' => 'super_admin' );
		}
		$gate = $this->gate( $module );
		if ( $gate ) {
			$in = in_array( $uid, array_map( 'intval', $gate['users'] ), true ) || (bool) array_intersect( $st['roles'], $gate['roles'] );
			if ( ! $in ) {
				return $deny( 'module_restricted' );
			}
		}
		if ( 'allow' === $override ) {
			return array( 'allowed' => true, 'reason' => 'override_allow' );
		}
		$grants = $this->all_grants();
		foreach ( $st['roles'] as $slug ) {
			if ( isset( $grants[ $slug ] ) && in_array( $key, $grants[ $slug ], true ) ) {
				return array( 'allowed' => true, 'reason' => 'role:' . $slug );
			}
		}
		return $deny( 'no_grant' );
	}

	public function can( $uid, $module, $action ) {
		$r = $this->explain( $uid, $module, $action );
		return $r['allowed'];
	}

	/** @return array<string,string[]> module => allowed actions (only modules with at least one) */
	public function permissions_for( $uid ) {
		$out = array();
		foreach ( $this->modules() as $slug => $m ) {
			$allowed = array();
			foreach ( array_keys( $this->module_actions( $slug ) ) as $a ) {
				if ( $this->can( $uid, $slug, $a ) ) {
					$allowed[] = $a;
				}
			}
			if ( $allowed ) {
				$out[ $slug ] = $allowed;
			}
		}
		return $out;
	}

	public static function reason_label( $reason ) {
		if ( 0 === strpos( $reason, 'role:' ) ) {
			return 'Granted by role "' . substr( $reason, 5 ) . '"';
		}
		$map = array(
			'no_user'           => 'Not a valid user',
			'access_disabled'   => 'Application access is switched off',
			'module_unknown'    => 'Unknown module',
			'module_disabled'   => 'Module is switched off or its plugin is inactive',
			'action_unknown'    => 'Permission not defined by the module',
			'override_deny'     => 'Denied by a user-specific override',
			'override_allow'    => 'Allowed by a user-specific override',
			'super_admin'       => 'Super Admin',
			'module_restricted' => 'Module is restricted to other roles or users',
			'no_grant'          => 'No role grants it (deny by default)',
		);
		return isset( $map[ $reason ] ) ? $map[ $reason ] : $reason;
	}
}
