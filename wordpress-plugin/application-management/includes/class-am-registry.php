<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Default roles and the module registry.
 *
 * Other plugins declare their modules on the `am_register_modules` action:
 *
 *   add_action( 'am_register_modules', function ( AM_Registry $registry ) {
 *       $registry->register( 'invoices', array(
 *           'name'        => 'Invoices',
 *           'description' => 'Customer invoices',
 *           'actions'     => array( 'approve' => 'Approve invoices' ),   // optional custom permissions
 *           'presets'     => array( 'editor' => array(), 'manager' => array() ),   // optional: replace the default grants of a role
 *       ) );
 *   } );
 *
 * Every module automatically gets the six standard permissions
 * (view, create, edit, delete, export, manage).
 */
class AM_Registry {

	/** Preset grants given to the default roles when a module is first seen. '*' = every action of the module. */
	const PRESETS = array(
		'administrator' => array( '*' ),
		'manager'       => array( 'view', 'create', 'edit', 'export' ),
		'editor'        => array( 'view', 'create', 'edit' ),
		'viewer'        => array( 'view' ),
		'custom'        => array(),
	);

	private $defs = array();

	/** @return string|WP_Error the normalised slug */
	public function register( $slug, array $args ) {
		$slug = self::clean_slug( $slug );
		if ( '' === $slug ) {
			return new WP_Error( 'am_bad_module', 'Invalid module slug.' );
		}
		$actions = array();
		if ( ! empty( $args['actions'] ) && is_array( $args['actions'] ) ) {
			foreach ( $args['actions'] as $a => $label ) {
				$a = self::clean_slug( $a );
				if ( '' !== $a && ! isset( AM_Engine::STANDARD[ $a ] ) ) {
					$actions[ $a ] = (string) $label;
				}
			}
		}
		$this->defs[ $slug ] = array(
			'slug'        => $slug,
			'name'        => isset( $args['name'] ) ? (string) $args['name'] : $slug,
			'description' => isset( $args['description'] ) ? (string) $args['description'] : '',
			'source'      => isset( $args['source'] ) ? (string) $args['source'] : '',
			'actions'     => $actions,
			'presets'     => ( ! empty( $args['presets'] ) && is_array( $args['presets'] ) ) ? $args['presets'] : array(),
		);
		return $slug;
	}

	public function all() {
		return $this->defs;
	}

	public static function clean_slug( $s ) {
		$s = strtolower( (string) $s );
		$s = preg_replace( '/[^a-z0-9_-]+/', '_', $s );
		return substr( trim( $s, '_-' ), 0, 40 );
	}

	/** Create the default roles if they do not exist yet. */
	public static function install_default_roles( AM_Store $store ) {
		$roles = array(
			'super_admin'   => array( 'Super Admin', 'Full control of every module. Can manage access settings.', 1, 1 ),
			'administrator' => array( 'Administrator', 'All permissions of every module (not Super Admin).', 1, 0 ),
			'manager'       => array( 'Manager', 'View, create, edit and export.', 1, 0 ),
			'editor'        => array( 'Editor', 'View, create and edit.', 1, 0 ),
			'viewer'        => array( 'Viewer', 'View only.', 1, 0 ),
			'custom'        => array( 'Custom Role', 'Example role with no permissions. Edit or delete it.', 0, 0 ),
		);
		foreach ( $roles as $slug => $r ) {
			if ( ! $store->get_role( $slug ) ) {
				$store->save_role( array( 'slug' => $slug, 'name' => $r[0], 'description' => $r[1], 'is_system' => $r[2], 'is_super' => $r[3] ) );
			}
		}
	}

	/**
	 * Persist registered modules. Existing modules keep their enabled flag and the grants
	 * an administrator chose; new modules get the preset grants.
	 * @return bool true when something was written
	 */
	public function sync( AM_Store $store, $previous_hash = '' ) {
		$hash = md5( wp_json_encode( $this->defs ) );
		if ( $hash === $previous_hash ) {
			return false;
		}
		$existing = $store->get_modules();
		$grants   = $store->get_all_role_grants();
		foreach ( $this->defs as $slug => $d ) {
			$is_new = ! isset( $existing[ $slug ] );
			$store->save_module( array(
				'slug'        => $slug,
				'name'        => $d['name'],
				'description' => $d['description'],
				'enabled'     => $is_new ? 1 : (int) $existing[ $slug ]['enabled'],
				'registered'  => 1,
				'source'      => $d['source'],
				'actions'     => $d['actions'],
			) );
			if ( $is_new ) {
				self::apply_presets( $store, $slug, array_merge( array_keys( AM_Engine::STANDARD ), array_keys( $d['actions'] ) ), $grants, $d['presets'] );
				$grants = $store->get_all_role_grants(); // the next module must see the grants just written
			}
		}
		foreach ( $existing as $slug => $m ) {
			if ( ! isset( $this->defs[ $slug ] ) && 'manual' !== $m['source'] && $m['registered'] ) {
				$m['registered'] = 0;
				$store->save_module( $m );
			}
		}
		return true;
	}

	/** Give each preset role its default grants for one module. */
	public static function apply_presets( AM_Store $store, $module, array $actions, ?array $all_grants = null, array $override = array() ) {
		if ( null === $all_grants ) {
			$all_grants = $store->get_all_role_grants();
		}
		foreach ( self::PRESETS as $role => $list ) {
			if ( isset( $override[ $role ] ) && is_array( $override[ $role ] ) ) {
				$list = $override[ $role ];
			}
			if ( ! $store->get_role( $role ) || ! $list ) {
				continue;
			}
			$give = in_array( '*', $list, true ) ? $actions : array_values( array_intersect( $list, $actions ) );
			if ( ! $give ) {
				continue;
			}
			$current = isset( $all_grants[ $role ] ) ? $all_grants[ $role ] : array();
			foreach ( $give as $a ) {
				$current[] = $module . ':' . $a;
			}
			$store->set_role_grants( $role, array_values( array_unique( $current ) ) );
			$all_grants[ $role ] = $current;
		}
	}
}
