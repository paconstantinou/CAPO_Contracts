<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * MySQL/MariaDB storage through $wpdb. Only portable SQL is used on purpose
 * (no ON DUPLICATE KEY, no vendor functions), so the same queries are exercised
 * by the automated tests against SQLite.
 */
class AM_Store_WPDB implements AM_Store {

	/** @var wpdb */
	private $db;
	private $p;

	public function __construct( $wpdb = null ) {
		if ( null === $wpdb ) {
			global $wpdb;
		}
		$this->db = $wpdb;
		$this->p  = $wpdb->prefix . 'am_';
	}

	public function t( $name ) {
		return $this->p . $name;
	}

	/* ---------- schema ---------- */

	public static function install( $wpdb = null ) {
		if ( null === $wpdb ) {
			global $wpdb;
		}
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$p = $wpdb->prefix . 'am_';
		$c = $wpdb->get_charset_collate();

		dbDelta( "CREATE TABLE {$p}roles (
  slug varchar(60) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  is_system tinyint(1) NOT NULL DEFAULT 0,
  is_super tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (slug)
) $c;" );

		dbDelta( "CREATE TABLE {$p}role_grants (
  role_slug varchar(60) NOT NULL,
  module varchar(60) NOT NULL,
  action varchar(40) NOT NULL,
  PRIMARY KEY  (role_slug,module,action),
  KEY module (module)
) $c;" );

		dbDelta( "CREATE TABLE {$p}user_roles (
  user_id bigint(20) unsigned NOT NULL,
  role_slug varchar(60) NOT NULL,
  assigned_by bigint(20) unsigned NOT NULL DEFAULT 0,
  assigned_at datetime NOT NULL,
  PRIMARY KEY  (user_id,role_slug),
  KEY role_slug (role_slug)
) $c;" );

		dbDelta( "CREATE TABLE {$p}user_access (
  user_id bigint(20) unsigned NOT NULL,
  enabled tinyint(1) NOT NULL DEFAULT 0,
  updated_by bigint(20) unsigned NOT NULL DEFAULT 0,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (user_id)
) $c;" );

		dbDelta( "CREATE TABLE {$p}user_overrides (
  user_id bigint(20) unsigned NOT NULL,
  module varchar(60) NOT NULL,
  action varchar(40) NOT NULL,
  effect varchar(5) NOT NULL,
  set_by bigint(20) unsigned NOT NULL DEFAULT 0,
  set_at datetime NOT NULL,
  PRIMARY KEY  (user_id,module,action)
) $c;" );

		dbDelta( "CREATE TABLE {$p}modules (
  slug varchar(60) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  enabled tinyint(1) NOT NULL DEFAULT 1,
  registered tinyint(1) NOT NULL DEFAULT 1,
  source varchar(60) NOT NULL DEFAULT '',
  actions text NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (slug)
) $c;" );

		dbDelta( "CREATE TABLE {$p}module_access (
  module varchar(60) NOT NULL,
  subject_type varchar(5) NOT NULL,
  subject varchar(60) NOT NULL,
  PRIMARY KEY  (module,subject_type,subject)
) $c;" );

		dbDelta( "CREATE TABLE {$p}logs (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  target_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  action varchar(60) NOT NULL,
  module varchar(60) NOT NULL DEFAULT '',
  details text NOT NULL,
  ip varchar(45) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY user_id (user_id),
  KEY target_user_id (target_user_id),
  KEY action (action),
  KEY created_at (created_at)
) $c;" );
	}

	public static function table_names( $wpdb ) {
		$p = $wpdb->prefix . 'am_';
		return array_map( function ( $n ) use ( $p ) {
			return $p . $n;
		}, array( 'roles', 'role_grants', 'user_roles', 'user_access', 'user_overrides', 'modules', 'module_access', 'logs' ) );
	}

	/* ---------- helpers ---------- */

	private function now() {
		return gmdate( 'Y-m-d H:i:s' );
	}

	/** Insert or update one row identified by $keys. */
	private function upsert( $table, array $keys, array $values ) {
		$where = array();
		$args  = array();
		foreach ( $keys as $k => $v ) {
			$where[] = "$k = " . ( is_int( $v ) ? '%d' : '%s' );
			$args[]  = $v;
		}
		$sql    = "SELECT COUNT(*) FROM $table WHERE " . implode( ' AND ', $where );
		$exists = (int) $this->db->get_var( $this->db->prepare( $sql, $args ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( $exists ) {
			if ( $values ) {
				$this->db->update( $table, $values, $keys );
			}
		} else {
			$this->db->insert( $table, array_merge( $keys, $values ) );
		}
	}

	private function in( array $values ) {
		return implode( ',', array_fill( 0, count( $values ), '%s' ) );
	}

	private function tx( $fn ) {
		$this->db->query( 'START TRANSACTION' );
		try {
			$fn();
			$this->db->query( 'COMMIT' );
		} catch ( \Throwable $e ) {
			$this->db->query( 'ROLLBACK' );
			throw $e;
		}
	}

	/* ---------- roles ---------- */

	private function role_row( $r ) {
		return array(
			'slug'        => $r['slug'],
			'name'        => $r['name'],
			'description' => $r['description'],
			'is_system'   => (int) $r['is_system'],
			'is_super'    => (int) $r['is_super'],
		);
	}

	public function get_roles() {
		$t    = $this->t( 'roles' );
		$rows = $this->db->get_results( "SELECT slug,name,description,is_system,is_super FROM $t ORDER BY is_system DESC, name ASC", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[ $r['slug'] ] = $this->role_row( $r );
		}
		return $out;
	}

	public function get_role( $slug ) {
		$roles = $this->get_roles();
		return isset( $roles[ $slug ] ) ? $roles[ $slug ] : null;
	}

	public function save_role( array $role ) {
		$t   = $this->t( 'roles' );
		$now = $this->now();
		if ( $this->get_role( $role['slug'] ) ) {
			$this->db->update( $t, array( 'name' => $role['name'], 'description' => $role['description'], 'updated_at' => $now ), array( 'slug' => $role['slug'] ) );
		} else {
			$this->db->insert( $t, array(
				'slug'        => $role['slug'],
				'name'        => $role['name'],
				'description' => $role['description'],
				'is_system'   => empty( $role['is_system'] ) ? 0 : 1,
				'is_super'    => empty( $role['is_super'] ) ? 0 : 1,
				'created_at'  => $now,
				'updated_at'  => $now,
			) );
		}
	}

	public function delete_role( $slug ) {
		$this->db->delete( $this->t( 'roles' ), array( 'slug' => $slug ) );
		$this->db->delete( $this->t( 'role_grants' ), array( 'role_slug' => $slug ) );
		$this->db->delete( $this->t( 'user_roles' ), array( 'role_slug' => $slug ) );
		$this->db->delete( $this->t( 'module_access' ), array( 'subject_type' => 'role', 'subject' => $slug ) );
	}

	/* ---------- grants ---------- */

	public function get_all_role_grants() {
		$t    = $this->t( 'role_grants' );
		$rows = $this->db->get_results( "SELECT role_slug,module,action FROM $t", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[ $r['role_slug'] ][] = $r['module'] . ':' . $r['action'];
		}
		return $out;
	}

	public function set_role_grants( $slug, array $pairs ) {
		$t = $this->t( 'role_grants' );
		$this->tx( function () use ( $t, $slug, $pairs ) {
			$this->db->delete( $t, array( 'role_slug' => $slug ) );
			foreach ( array_unique( $pairs ) as $pair ) {
				$parts = explode( ':', $pair, 2 );
				if ( 2 === count( $parts ) ) {
					$this->db->insert( $t, array( 'role_slug' => $slug, 'module' => $parts[0], 'action' => $parts[1] ) );
				}
			}
		} );
	}

	public function delete_module_grants( $module ) {
		$this->db->delete( $this->t( 'role_grants' ), array( 'module' => $module ) );
		$this->db->delete( $this->t( 'user_overrides' ), array( 'module' => $module ) );
	}

	/* ---------- user roles ---------- */

	public function get_user_roles( $user_id ) {
		$t = $this->t( 'user_roles' );
		return array_map( 'strval', (array) $this->db->get_col( $this->db->prepare( "SELECT role_slug FROM $t WHERE user_id = %d ORDER BY role_slug", (int) $user_id ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	public function set_user_roles( $user_id, array $slugs, $actor ) {
		$t   = $this->t( 'user_roles' );
		$now = $this->now();
		$this->tx( function () use ( $t, $user_id, $slugs, $actor, $now ) {
			$this->db->delete( $t, array( 'user_id' => (int) $user_id ) );
			foreach ( array_unique( $slugs ) as $s ) {
				$this->db->insert( $t, array( 'user_id' => (int) $user_id, 'role_slug' => $s, 'assigned_by' => (int) $actor, 'assigned_at' => $now ) );
			}
		} );
	}

	public function users_with_role( $slug ) {
		$t = $this->t( 'user_roles' );
		return array_map( 'intval', (array) $this->db->get_col( $this->db->prepare( "SELECT user_id FROM $t WHERE role_slug = %s ORDER BY user_id", $slug ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/* ---------- access ---------- */

	public function get_user_access( $user_id ) {
		$t = $this->t( 'user_access' );
		$r = $this->db->get_row( $this->db->prepare( "SELECT enabled,updated_by,updated_at FROM $t WHERE user_id = %d", (int) $user_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( ! $r ) {
			return null;
		}
		return array( 'enabled' => (bool) (int) $r['enabled'], 'updated_by' => (int) $r['updated_by'], 'updated_at' => $r['updated_at'] );
	}

	public function set_user_access( $user_id, $enabled, $actor ) {
		$this->upsert( $this->t( 'user_access' ), array( 'user_id' => (int) $user_id ), array( 'enabled' => $enabled ? 1 : 0, 'updated_by' => (int) $actor, 'updated_at' => $this->now() ) );
	}

	public function get_all_user_access() {
		$t    = $this->t( 'user_access' );
		$rows = $this->db->get_results( "SELECT user_id,enabled FROM $t", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[ (int) $r['user_id'] ] = (bool) (int) $r['enabled'];
		}
		return $out;
	}

	/* ---------- overrides ---------- */

	public function get_user_overrides( $user_id ) {
		$t    = $this->t( 'user_overrides' );
		$rows = $this->db->get_results( $this->db->prepare( "SELECT module,action,effect FROM $t WHERE user_id = %d", (int) $user_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[ $r['module'] . ':' . $r['action'] ] = $r['effect'];
		}
		return $out;
	}

	public function set_user_override( $user_id, $module, $action, $effect, $actor ) {
		$t = $this->t( 'user_overrides' );
		if ( null === $effect || '' === $effect ) {
			$this->db->delete( $t, array( 'user_id' => (int) $user_id, 'module' => $module, 'action' => $action ) );
			return;
		}
		$this->upsert( $t, array( 'user_id' => (int) $user_id, 'module' => $module, 'action' => $action ), array( 'effect' => 'deny' === $effect ? 'deny' : 'allow', 'set_by' => (int) $actor, 'set_at' => $this->now() ) );
	}

	public function clear_user_overrides( $user_id ) {
		$this->db->delete( $this->t( 'user_overrides' ), array( 'user_id' => (int) $user_id ) );
	}

	public function delete_user( $user_id ) {
		$uid = (int) $user_id;
		foreach ( array( 'user_roles', 'user_access', 'user_overrides' ) as $n ) {
			$this->db->delete( $this->t( $n ), array( 'user_id' => $uid ) );
		}
		$this->db->delete( $this->t( 'module_access' ), array( 'subject_type' => 'user', 'subject' => (string) $uid ) );
	}

	/* ---------- modules ---------- */

	public function get_modules() {
		$t    = $this->t( 'modules' );
		$rows = $this->db->get_results( "SELECT slug,name,description,enabled,registered,source,actions FROM $t ORDER BY name ASC", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$actions = json_decode( $r['actions'], true );
			$out[ $r['slug'] ] = array(
				'slug'        => $r['slug'],
				'name'        => $r['name'],
				'description' => $r['description'],
				'enabled'     => (bool) (int) $r['enabled'],
				'registered'  => (bool) (int) $r['registered'],
				'source'      => $r['source'],
				'actions'     => is_array( $actions ) ? $actions : array(),
			);
		}
		return $out;
	}

	public function save_module( array $m ) {
		$this->upsert(
			$this->t( 'modules' ),
			array( 'slug' => $m['slug'] ),
			array(
				'name'        => $m['name'],
				'description' => isset( $m['description'] ) ? $m['description'] : '',
				'enabled'     => empty( $m['enabled'] ) ? 0 : 1,
				'registered'  => array_key_exists( 'registered', $m ) && empty( $m['registered'] ) ? 0 : 1,
				'source'      => isset( $m['source'] ) ? $m['source'] : '',
				'actions'     => wp_json_encode( isset( $m['actions'] ) ? $m['actions'] : array() ),
				'created_at'  => $this->now(),
			)
		);
	}

	public function delete_module( $slug ) {
		$this->db->delete( $this->t( 'modules' ), array( 'slug' => $slug ) );
		$this->db->delete( $this->t( 'module_access' ), array( 'module' => $slug ) );
		$this->delete_module_grants( $slug );
	}

	public function get_module_access( $slug ) {
		$t    = $this->t( 'module_access' );
		$rows = $this->db->get_results( $this->db->prepare( "SELECT subject_type,subject FROM $t WHERE module = %s", $slug ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$out  = array( 'roles' => array(), 'users' => array() );
		foreach ( (array) $rows as $r ) {
			if ( 'role' === $r['subject_type'] ) {
				$out['roles'][] = $r['subject'];
			} else {
				$out['users'][] = (int) $r['subject'];
			}
		}
		sort( $out['roles'] );
		sort( $out['users'] );
		return $out;
	}

	public function set_module_access( $slug, array $roles, array $users ) {
		$t = $this->t( 'module_access' );
		$this->tx( function () use ( $t, $slug, $roles, $users ) {
			$this->db->delete( $t, array( 'module' => $slug ) );
			foreach ( array_unique( $roles ) as $r ) {
				$this->db->insert( $t, array( 'module' => $slug, 'subject_type' => 'role', 'subject' => (string) $r ) );
			}
			foreach ( array_unique( array_map( 'intval', $users ) ) as $u ) {
				$this->db->insert( $t, array( 'module' => $slug, 'subject_type' => 'user', 'subject' => (string) $u ) );
			}
		} );
	}

	/* ---------- logs ---------- */

	public function add_log( array $row ) {
		$this->db->insert( $this->t( 'logs' ), array(
			'user_id'        => (int) $row['user_id'],
			'target_user_id' => isset( $row['target_user_id'] ) ? (int) $row['target_user_id'] : 0,
			'action'         => (string) $row['action'],
			'module'         => isset( $row['module'] ) ? (string) $row['module'] : '',
			'details'        => isset( $row['details'] ) ? (string) $row['details'] : '',
			'ip'             => isset( $row['ip'] ) ? (string) $row['ip'] : '',
			'created_at'     => isset( $row['created_at'] ) ? $row['created_at'] : $this->now(),
		) );
	}

	private function log_where( array $f, array &$args ) {
		$w = array( '1=1' );
		if ( ! empty( $f['user_id'] ) ) {
			$w[]    = '(user_id = %d OR target_user_id = %d)';
			$args[] = (int) $f['user_id'];
			$args[] = (int) $f['user_id'];
		}
		if ( ! empty( $f['action'] ) ) {
			if ( '.' === substr( $f['action'], -1 ) ) {
				$w[]    = 'action LIKE %s';
				$args[] = $this->db->esc_like( $f['action'] ) . '%';
			} else {
				$w[]    = 'action = %s';
				$args[] = $f['action'];
			}
		}
		if ( ! empty( $f['module'] ) ) {
			$w[]    = 'module = %s';
			$args[] = $f['module'];
		}
		if ( ! empty( $f['from'] ) ) {
			$w[]    = 'created_at >= %s';
			$args[] = $f['from'];
		}
		if ( ! empty( $f['to'] ) ) {
			$w[]    = 'created_at <= %s';
			$args[] = $f['to'];
		}
		return implode( ' AND ', $w );
	}

	public function query_logs( array $filters, $limit, $offset ) {
		$t    = $this->t( 'logs' );
		$args = array();
		$where = $this->log_where( $filters, $args );
		$count_sql = "SELECT COUNT(*) FROM $t WHERE $where";
		$total = (int) ( $args ? $this->db->get_var( $this->db->prepare( $count_sql, $args ) ) : $this->db->get_var( $count_sql ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$sql   = "SELECT id,user_id,target_user_id,action,module,details,ip,created_at FROM $t WHERE $where ORDER BY id DESC LIMIT %d OFFSET %d";
		$a2    = array_merge( $args, array( (int) $limit, (int) $offset ) );
		$rows  = $this->db->get_results( $this->db->prepare( $sql, $a2 ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return array( 'rows' => (array) $rows, 'total' => $total );
	}

	public function last_activity( array $user_ids ) {
		$ids = array_values( array_filter( array_map( 'intval', $user_ids ) ) );
		if ( ! $ids ) {
			return array();
		}
		$t    = $this->t( 'logs' );
		$ph   = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$rows = $this->db->get_results( $this->db->prepare( "SELECT user_id, MAX(created_at) AS m FROM $t WHERE user_id IN ($ph) GROUP BY user_id", $ids ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[ (int) $r['user_id'] ] = $r['m'];
		}
		return $out;
	}

	public function prune_logs( $before ) {
		$t = $this->t( 'logs' );
		$n = (int) $this->db->get_var( $this->db->prepare( "SELECT COUNT(*) FROM $t WHERE created_at < %s", $before ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( $n ) {
			$this->db->query( $this->db->prepare( "DELETE FROM $t WHERE created_at < %s", $before ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		}
		return $n;
	}
}
