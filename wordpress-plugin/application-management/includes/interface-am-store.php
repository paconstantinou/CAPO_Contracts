<?php
/**
 * Storage contract for Application Management.
 *
 * Two implementations exist: AM_Store_WPDB (production, MySQL/MariaDB through $wpdb)
 * and an in-memory one used by the automated tests. Both are run against the same
 * contract tests (tests/StoreContractTest.php).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

interface AM_Store {

	/* ---- roles ---- */

	/** @return array<string,array> slug => [slug,name,description,is_system,is_super] */
	public function get_roles();

	/** @return array|null */
	public function get_role( $slug );

	/** Insert a role, or update name/description of an existing one. is_system/is_super are only set on insert. */
	public function save_role( array $role );

	/** Removes the role, its grants, its user assignments and its module-access entries. */
	public function delete_role( $slug );

	/* ---- role grants (deny by default: only granted pairs are stored) ---- */

	/** @return array<string,string[]> role slug => list of "module:action" */
	public function get_all_role_grants();

	/** Replace the full grant set of a role. $pairs = list of "module:action". */
	public function set_role_grants( $slug, array $pairs );

	/** Remove every grant of a module (used when a module is deleted). */
	public function delete_module_grants( $module );

	/* ---- user <-> role ---- */

	/** @return string[] role slugs */
	public function get_user_roles( $user_id );

	public function set_user_roles( $user_id, array $slugs, $actor );

	/** @return int[] */
	public function users_with_role( $slug );

	/* ---- application access switch ---- */

	/** @return array|null [enabled(bool), updated_by, updated_at] */
	public function get_user_access( $user_id );

	public function set_user_access( $user_id, $enabled, $actor );

	/** @return array<int,bool> user id => enabled */
	public function get_all_user_access();

	/* ---- per-user overrides ---- */

	/** @return array<string,string> "module:action" => 'allow'|'deny' */
	public function get_user_overrides( $user_id );

	/** $effect = 'allow' | 'deny' | null (null removes the override) */
	public function set_user_override( $user_id, $module, $action, $effect, $actor );

	public function clear_user_overrides( $user_id );

	/** Remove all rows that belong to a user (used when the WordPress user is deleted). */
	public function delete_user( $user_id );

	/* ---- modules ---- */

	/** @return array<string,array> slug => [slug,name,description,enabled,registered,source,actions(map custom slug=>label)] */
	public function get_modules();

	public function save_module( array $module );

	public function delete_module( $slug );

	/** @return array ['roles'=>string[], 'users'=>int[]] */
	public function get_module_access( $slug );

	public function set_module_access( $slug, array $roles, array $users );

	/* ---- activity log ---- */

	/** $row keys: user_id, target_user_id, action, module, details, ip, created_at */
	public function add_log( array $row );

	/**
	 * Filters: user_id (actor OR target), action (exact or "prefix."), module, from, to (datetime strings).
	 * @return array ['rows'=>array[], 'total'=>int]  newest first
	 */
	public function query_logs( array $filters, $limit, $offset );

	/** @return array<int,string> user id => latest created_at as actor */
	public function last_activity( array $user_ids );

	/** @return int deleted rows */
	public function prune_logs( $before );
}
