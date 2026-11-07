<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Every operation that changes access settings. Each method:
 *  - requires the actor to be a WordPress administrator AND an application Super Admin
 *    (WordPress Administrator and application Super Admin are deliberately not the same thing),
 *  - refuses to change the actor's own access (no self-service privilege escalation),
 *  - never removes the last Super Admin,
 *  - writes an audit log entry,
 *  - returns true (or a value) on success and a WP_Error otherwise.
 */
class AM_Service {

	/** @var AM_Store */
	private $store;
	/** @var AM_Engine */
	private $engine;
	private $caps;        // callable( int $uid ): bool   "is WordPress administrator"
	private $logger;      // callable( array $row ): void
	private $user_exists; // callable( int $uid ): bool

	public function __construct( AM_Store $store, AM_Engine $engine, $caps, $logger, $user_exists ) {
		$this->store       = $store;
		$this->engine      = $engine;
		$this->caps        = $caps;
		$this->logger      = $logger;
		$this->user_exists = $user_exists;
	}

	/* ---------- guards ---------- */

	private function err( $code, $msg, $status = 403 ) {
		return new WP_Error( $code, $msg, array( 'status' => $status ) );
	}

	private function guard( $actor ) {
		$actor = (int) $actor;
		if ( $actor <= 0 || ! call_user_func( $this->caps, $actor ) ) {
			return $this->err( 'am_forbidden', 'Only WordPress administrators can change access settings.' );
		}
		if ( ! $this->engine->is_super( $actor ) ) {
			return $this->err( 'am_not_super', 'Only an application Super Admin can change access settings. Ask an existing Super Admin.' );
		}
		return true;
	}

	private function guard_target( $actor, $target ) {
		$target = (int) $target;
		if ( (int) $actor === $target ) {
			return $this->err( 'am_self', 'You cannot change your own access or permissions.' );
		}
		if ( $target <= 0 || ! call_user_func( $this->user_exists, $target ) ) {
			return $this->err( 'am_no_user', 'That WordPress user does not exist.', 404 );
		}
		return true;
	}

	private function log( $actor, $action, $module = '', $target = 0, $details = '' ) {
		call_user_func( $this->logger, array(
			'user_id'        => (int) $actor,
			'target_user_id' => (int) $target,
			'action'         => $action,
			'module'         => $module,
			'details'        => is_string( $details ) ? $details : wp_json_encode( $details ),
		) );
		$this->engine->flush();
	}

	/** Users that currently count as Super Admin (super role + access on + WordPress user exists). */
	public function super_admins( $exclude = 0 ) {
		$out    = array();
		$access = $this->store->get_all_user_access();
		foreach ( $this->store->get_roles() as $slug => $r ) {
			if ( empty( $r['is_super'] ) ) {
				continue;
			}
			foreach ( $this->store->users_with_role( $slug ) as $uid ) {
				if ( (int) $uid !== (int) $exclude && ! empty( $access[ $uid ] ) && call_user_func( $this->user_exists, (int) $uid ) ) {
					$out[ $uid ] = true;
				}
			}
		}
		return array_keys( $out );
	}

	private function slugify( $name ) {
		$s = strtolower( trim( (string) $name ) );
		$s = preg_replace( '/[^a-z0-9]+/', '_', $s );
		$s = trim( $s, '_' );
		if ( '' === $s ) {
			$s = 'role_' . substr( md5( (string) $name ), 0, 6 );
		}
		return substr( $s, 0, 40 );
	}

	private function valid_pairs( array $pairs ) {
		$mods = $this->engine->modules();
		$out  = array();
		foreach ( $pairs as $p ) {
			$parts = explode( ':', (string) $p, 2 );
			if ( 2 !== count( $parts ) || ! isset( $mods[ $parts[0] ] ) || ! isset( $this->engine->module_actions( $parts[0] )[ $parts[1] ] ) ) {
				return $this->err( 'am_bad_permission', 'Unknown permission: ' . $p, 400 );
			}
			$out[] = $p;
		}
		return array_values( array_unique( $out ) );
	}

	/* ---------- roles ---------- */

	/** @return string|WP_Error the new role slug */
	public function create_role( $actor, $name, $description = '' ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$name = trim( (string) $name );
		if ( '' === $name || strlen( $name ) > 120 ) {
			return $this->err( 'am_bad_name', 'Enter a role name (up to 120 characters).', 400 );
		}
		$base = $this->slugify( $name );
		$slug = $base;
		$i    = 2;
		while ( $this->store->get_role( $slug ) ) {
			$slug = substr( $base, 0, 36 ) . '_' . $i++;
		}
		$this->store->save_role( array( 'slug' => $slug, 'name' => $name, 'description' => substr( trim( (string) $description ), 0, 500 ), 'is_system' => 0, 'is_super' => 0 ) );
		$this->log( $actor, 'role.create', '', 0, array( 'role' => $slug, 'name' => $name ) );
		return $slug;
	}

	public function update_role( $actor, $slug, $name, $description = '' ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$role = $this->store->get_role( $slug );
		if ( ! $role ) {
			return $this->err( 'am_no_role', 'Role not found.', 404 );
		}
		$name = trim( (string) $name );
		if ( '' === $name || strlen( $name ) > 120 ) {
			return $this->err( 'am_bad_name', 'Enter a role name (up to 120 characters).', 400 );
		}
		$this->store->save_role( array( 'slug' => $slug, 'name' => $name, 'description' => substr( trim( (string) $description ), 0, 500 ) ) );
		$this->log( $actor, 'role.update', '', 0, array( 'role' => $slug, 'name' => $name ) );
		return true;
	}

	public function delete_role( $actor, $slug ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$role = $this->store->get_role( $slug );
		if ( ! $role ) {
			return $this->err( 'am_no_role', 'Role not found.', 404 );
		}
		if ( ! empty( $role['is_system'] ) || ! empty( $role['is_super'] ) ) {
			return $this->err( 'am_system_role', 'Built-in roles cannot be deleted.' );
		}
		$users = $this->store->users_with_role( $slug );
		if ( count( $users ) > 0 ) {
			// A role that people still hold is never deleted by accident: take it away from them first.
			return $this->err( 'am_role_in_use', 'This role is still assigned to ' . count( $users ) . ' user(s). Remove it from them first.', 409 );
		}
		$this->store->delete_role( $slug );
		$this->log( $actor, 'role.delete', '', 0, array( 'role' => $slug, 'users_affected' => count( $users ) ) );
		return true;
	}

	/** Replace the permissions of a role. $pairs = list of "module:action". */
	public function set_role_grants( $actor, $slug, array $pairs ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$role = $this->store->get_role( $slug );
		if ( ! $role ) {
			return $this->err( 'am_no_role', 'Role not found.', 404 );
		}
		if ( ! empty( $role['is_super'] ) ) {
			return $this->err( 'am_super_immutable', 'The Super Admin role always has every permission and cannot be edited.' );
		}
		$valid = $this->valid_pairs( $pairs );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}
		$old = isset( $this->store->get_all_role_grants()[ $slug ] ) ? $this->store->get_all_role_grants()[ $slug ] : array();
		$this->store->set_role_grants( $slug, $valid );
		$this->log( $actor, 'role.permissions', '', 0, array(
			'role'    => $slug,
			'added'   => array_values( array_diff( $valid, $old ) ),
			'removed' => array_values( array_diff( $old, $valid ) ),
		) );
		return true;
	}

	/* ---------- users ---------- */

	public function set_user_roles( $actor, $uid, array $slugs ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$t = $this->guard_target( $actor, $uid );
		if ( true !== $t ) {
			return $t;
		}
		$roles = $this->store->get_roles();
		$slugs = array_values( array_unique( array_map( 'strval', $slugs ) ) );
		foreach ( $slugs as $s ) {
			if ( ! isset( $roles[ $s ] ) ) {
				return $this->err( 'am_no_role', 'Role not found: ' . $s, 400 );
			}
		}
		$had_super = $this->engine->is_super( $uid );
		$will_super = false;
		foreach ( $slugs as $s ) {
			if ( ! empty( $roles[ $s ]['is_super'] ) ) {
				$will_super = true;
			}
		}
		if ( $had_super && ! $will_super && ! $this->super_admins( $uid ) ) {
			return $this->err( 'am_last_super', 'This is the last Super Admin. Assign another Super Admin first.' );
		}
		$old = $this->store->get_user_roles( $uid );
		$this->store->set_user_roles( (int) $uid, $slugs, (int) $actor );
		$this->log( $actor, 'user.roles', '', $uid, array( 'from' => $old, 'to' => $slugs ) );
		return true;
	}

	public function set_user_access( $actor, $uid, $enabled ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$t = $this->guard_target( $actor, $uid );
		if ( true !== $t ) {
			return $t;
		}
		if ( ! $enabled && $this->engine->is_super( $uid ) && ! $this->super_admins( $uid ) ) {
			return $this->err( 'am_last_super', 'This is the last Super Admin. Assign another Super Admin first.' );
		}
		$this->store->set_user_access( (int) $uid, (bool) $enabled, (int) $actor );
		$this->log( $actor, $enabled ? 'user.access_enabled' : 'user.access_disabled', '', $uid );
		return true;
	}

	/**
	 * Save per-user overrides. $map = "module:action" => 'allow' | 'deny' | '' (inherit).
	 * Only the differences from what is stored are written.
	 */
	public function set_user_overrides( $actor, $uid, array $map ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$t = $this->guard_target( $actor, $uid );
		if ( true !== $t ) {
			return $t;
		}
		$valid = $this->valid_pairs( array_keys( $map ) );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}
		$old     = $this->store->get_user_overrides( $uid );
		$changes = array();
		foreach ( $map as $key => $effect ) {
			$effect = in_array( $effect, array( 'allow', 'deny' ), true ) ? $effect : '';
			$before = isset( $old[ $key ] ) ? $old[ $key ] : '';
			if ( $before === $effect ) {
				continue;
			}
			list( $m, $a ) = explode( ':', $key, 2 );
			$this->store->set_user_override( (int) $uid, $m, $a, '' === $effect ? null : $effect, (int) $actor );
			$changes[ $key ] = array( $before, $effect );
		}
		if ( $changes ) {
			$this->log( $actor, 'user.overrides', '', $uid, $changes );
		}
		return true;
	}

	/** Remove roles and overrides and switch access off. */
	public function revoke_user( $actor, $uid ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$t = $this->guard_target( $actor, $uid );
		if ( true !== $t ) {
			return $t;
		}
		if ( $this->engine->is_super( $uid ) && ! $this->super_admins( $uid ) ) {
			return $this->err( 'am_last_super', 'This is the last Super Admin. Assign another Super Admin first.' );
		}
		$this->store->set_user_roles( (int) $uid, array(), (int) $actor );
		$this->store->clear_user_overrides( (int) $uid );
		$this->store->set_user_access( (int) $uid, false, (int) $actor );
		$this->log( $actor, 'user.revoked', '', $uid );
		return true;
	}

	/* ---------- modules ---------- */

	public function set_module_enabled( $actor, $module, $enabled ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$mods = $this->engine->modules();
		if ( ! isset( $mods[ $module ] ) ) {
			return $this->err( 'am_no_module', 'Module not found.', 404 );
		}
		$m            = $mods[ $module ];
		$m['enabled'] = $enabled ? 1 : 0;
		$this->store->save_module( $m );
		$this->log( $actor, $enabled ? 'module.enabled' : 'module.disabled', $module );
		return true;
	}

	/** Restrict a module to some roles and/or users. Empty lists = no restriction. */
	public function set_module_access( $actor, $module, array $roles, array $users ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		if ( ! isset( $this->engine->modules()[ $module ] ) ) {
			return $this->err( 'am_no_module', 'Module not found.', 404 );
		}
		$all = $this->store->get_roles();
		foreach ( $roles as $r ) {
			if ( ! isset( $all[ $r ] ) ) {
				return $this->err( 'am_no_role', 'Role not found: ' . $r, 400 );
			}
		}
		$users = array_values( array_unique( array_map( 'intval', $users ) ) );
		foreach ( $users as $u ) {
			if ( $u <= 0 || ! call_user_func( $this->user_exists, $u ) ) {
				return $this->err( 'am_no_user', 'WordPress user does not exist: ' . $u, 400 );
			}
		}
		$this->store->set_module_access( $module, array_values( array_unique( $roles ) ), $users );
		$this->log( $actor, 'module.access', $module, 0, array( 'roles' => array_values( $roles ), 'users' => $users ) );
		return true;
	}

	/** Declare a module by hand (for applications that are not WordPress plugins). */
	public function add_manual_module( $actor, $slug, $name, $description = '', array $custom_actions = array() ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$slug = AM_Registry::clean_slug( $slug );
		$name = trim( (string) $name );
		if ( '' === $slug || '' === $name ) {
			return $this->err( 'am_bad_module', 'Enter a module slug and a name.', 400 );
		}
		if ( isset( $this->engine->modules()[ $slug ] ) ) {
			return $this->err( 'am_exists', 'A module with this slug already exists.', 409 );
		}
		$actions = array();
		foreach ( $custom_actions as $a ) {
			$a = AM_Registry::clean_slug( $a );
			if ( '' !== $a && ! isset( AM_Engine::STANDARD[ $a ] ) ) {
				$actions[ $a ] = ucfirst( str_replace( array( '_', '-' ), ' ', $a ) );
			}
		}
		$this->store->save_module( array( 'slug' => $slug, 'name' => $name, 'description' => substr( (string) $description, 0, 500 ), 'enabled' => 1, 'registered' => 1, 'source' => 'manual', 'actions' => $actions ) );
		AM_Registry::apply_presets( $this->store, $slug, array_merge( array_keys( AM_Engine::STANDARD ), array_keys( $actions ) ) );
		$this->log( $actor, 'module.add', $slug, 0, array( 'name' => $name ) );
		return $slug;
	}

	public function delete_module( $actor, $module ) {
		$g = $this->guard( $actor );
		if ( true !== $g ) {
			return $g;
		}
		$mods = $this->engine->modules();
		if ( ! isset( $mods[ $module ] ) ) {
			return $this->err( 'am_no_module', 'Module not found.', 404 );
		}
		if ( 'manual' !== $mods[ $module ]['source'] && $mods[ $module ]['registered'] ) {
			return $this->err( 'am_module_active', 'This module is provided by an active plugin. Deactivate the plugin or switch the module off instead.' );
		}
		$this->store->delete_module( $module );
		$this->log( $actor, 'module.delete', $module );
		return true;
	}

	/* ---------- recovery ---------- */

	/**
	 * Emergency path: only works when NO valid Super Admin exists (for example the only one was deleted
	 * from WordPress). A WordPress administrator can then claim the role. Logged.
	 */
	public function recover_super( $actor ) {
		$actor = (int) $actor;
		if ( $actor <= 0 || ! call_user_func( $this->caps, $actor ) ) {
			return $this->err( 'am_forbidden', 'Only WordPress administrators can do this.' );
		}
		if ( $this->super_admins() ) {
			return $this->err( 'am_has_super', 'A Super Admin already exists. Ask them to assign the role.' );
		}
		$roles = $this->store->get_roles();
		if ( ! isset( $roles['super_admin'] ) ) {
			return $this->err( 'am_no_role', 'The Super Admin role is missing. Re-activate the plugin.', 500 );
		}
		$current = $this->store->get_user_roles( $actor );
		$current[] = 'super_admin';
		$this->store->set_user_roles( $actor, array_values( array_unique( $current ) ), $actor );
		$this->store->set_user_access( $actor, true, $actor );
		$this->log( $actor, 'super.recovered', '', $actor, 'Super Admin role claimed by a WordPress administrator because no Super Admin existed.' );
		return true;
	}
}
