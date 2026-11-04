<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WordPress Admin screens. The only place where users, roles and permissions are managed.
 *
 * Every state-changing request is a POST to admin-post.php that
 *  1. requires the WordPress administrator capability,
 *  2. verifies a per-operation nonce,
 *  3. goes through AM_Service, which applies the Super Admin / self-edit / last-Super-Admin rules.
 */
class AM_Admin {

	const PAGES = array(
		'am-dashboard'   => 'Dashboard',
		'am-users'       => 'Users & Access',
		'am-roles'       => 'Roles Management',
		'am-permissions' => 'Permissions Management',
		'am-modules'     => 'Module Management',
		'am-logs'        => 'Activity Logs',
		'am-settings'    => 'Settings',
	);

	const OPS = array( 'create_role', 'update_role', 'delete_role', 'save_grants', 'save_user', 'save_overrides', 'revoke_user', 'toggle_module', 'save_module_access', 'add_module', 'delete_module', 'save_settings', 'recover_super' );

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		foreach ( self::OPS as $op ) {
			add_action( 'admin_post_am_' . $op, function () use ( $op ) {
				AM_Admin::handle( $op );
			} );
		}
	}

	public static function menu() {
		$cap = AM::admin_capability();
		add_menu_page( 'Application Management', 'Application Management', $cap, 'am-dashboard', function () {
			AM_Admin::render( 'am-dashboard' );
		}, 'dashicons-shield-alt', 58 );
		foreach ( self::PAGES as $slug => $title ) {
			add_submenu_page( 'am-dashboard', $title, $title, $cap, $slug, function () use ( $slug ) {
				AM_Admin::render( $slug );
			} );
		}
	}

	public static function assets( $hook ) {
		if ( false === strpos( (string) $hook, 'am-' ) ) {
			return;
		}
		wp_enqueue_style( 'am-admin', AM_URL . 'assets/admin.css', array(), AM_VERSION );
		wp_enqueue_script( 'am-admin', AM_URL . 'assets/admin.js', array(), AM_VERSION, true );
	}

	/* =====================================================================
	 * helpers
	 * ===================================================================== */

	private static function url( $page, array $q = array() ) {
		return add_query_arg( $q, admin_url( 'admin.php?page=' . $page ) );
	}

	private static function writable() {
		return AM::engine()->is_super( get_current_user_id() );
	}

	private static function form_open( $op, $confirm = '' ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"' . ( $confirm ? ' data-am-confirm="' . esc_attr( $confirm ) . '"' : '' ) . '>';
		echo '<input type="hidden" name="action" value="am_' . esc_attr( $op ) . '">';
		wp_nonce_field( 'am_' . $op );
	}

	private static function btn( $label, $class = 'button button-primary' ) {
		echo '<button type="submit" class="' . esc_attr( $class ) . '"' . ( self::writable() ? '' : ' disabled title="Only a Super Admin can change this"' ) . '>' . esc_html( $label ) . '</button>';
	}

	private static function flash_set( $type, $msg ) {
		set_transient( 'am_flash_' . get_current_user_id(), array( 'type' => $type, 'msg' => $msg ), 120 );
	}

	private static function flash_show() {
		$k = 'am_flash_' . get_current_user_id();
		$f = get_transient( $k );
		if ( $f ) {
			delete_transient( $k );
			echo '<div class="notice notice-' . ( 'error' === $f['type'] ? 'error' : 'success' ) . ' is-dismissible"><p>' . esc_html( $f['msg'] ) . '</p></div>';
		}
	}

	private static function when( $mysql_gmt ) {
		if ( ! $mysql_gmt ) {
			return '—';
		}
		return esc_html( get_date_from_gmt( $mysql_gmt, 'Y-m-d H:i' ) );
	}

	private static function user_label( $uid ) {
		$uid = (int) $uid;
		if ( $uid <= 0 ) {
			return '—';
		}
		$u = get_userdata( $uid );
		return $u ? esc_html( $u->user_login ) . ' <span class="am-muted">#' . $uid . '</span>' : '<span class="am-muted">deleted user #' . $uid . '</span>';
	}

	private static function wp_role_names( $user ) {
		$names = wp_roles()->get_names();
		$out   = array();
		foreach ( (array) $user->roles as $r ) {
			$out[] = isset( $names[ $r ] ) ? translate_user_role( $names[ $r ] ) : $r;
		}
		return $out ? implode( ', ', $out ) : '—';
	}

	private static function perm_pairs_from_post( $g ) {
		$pairs = array();
		if ( is_array( $g ) ) {
			foreach ( $g as $m => $acts ) {
				if ( is_array( $acts ) ) {
					foreach ( $acts as $a => $v ) {
						$pairs[] = sanitize_key( $m ) . ':' . sanitize_key( $a );
					}
				}
			}
		}
		return $pairs;
	}

	/** "alice, 12, bob@example.com" -> [ids] ; WP_Error for anything not found */
	private static function resolve_users( $text ) {
		$ids = array();
		foreach ( preg_split( '/[\s,;]+/', (string) $text, -1, PREG_SPLIT_NO_EMPTY ) as $tok ) {
			$u = null;
			if ( ctype_digit( $tok ) ) {
				$u = get_userdata( (int) $tok );
			}
			if ( ! $u ) {
				$u = get_user_by( 'login', $tok );
			}
			if ( ! $u && is_email( $tok ) ) {
				$u = get_user_by( 'email', $tok );
			}
			if ( ! $u ) {
				return new WP_Error( 'am_no_user', 'No WordPress user matches "' . $tok . '".' );
			}
			$ids[] = (int) $u->ID;
		}
		return array_values( array_unique( $ids ) );
	}

	/* =====================================================================
	 * request handling
	 * ===================================================================== */

	public static function handle( $op ) {
		if ( ! current_user_can( AM::admin_capability() ) ) {
			wp_die( esc_html( 'You do not have permission to do this.' ), 403 );
		}
		check_admin_referer( 'am_' . $op );
		$actor = get_current_user_id();
		$p     = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above
		$svc   = AM::service();
		$ok    = 'Saved.';
		$res   = true;
		$s     = function ( $k ) use ( $p ) {
			return isset( $p[ $k ] ) && is_scalar( $p[ $k ] ) ? sanitize_text_field( $p[ $k ] ) : '';
		};
		$key   = function ( $k ) use ( $p ) {
			return isset( $p[ $k ] ) && is_scalar( $p[ $k ] ) ? sanitize_key( $p[ $k ] ) : '';
		};
		$list  = function ( $k ) use ( $p ) {
			return isset( $p[ $k ] ) && is_array( $p[ $k ] ) ? array_values( array_map( 'sanitize_key', $p[ $k ] ) ) : array();
		};

		switch ( $op ) {
			case 'create_role':
				$res = $svc->create_role( $actor, $s( 'name' ), $s( 'description' ) );
				$ok  = 'Role created.';
				break;
			case 'update_role':
				$res = $svc->update_role( $actor, $key( 'slug' ), $s( 'name' ), $s( 'description' ) );
				$ok  = 'Role updated.';
				break;
			case 'delete_role':
				$res = $svc->delete_role( $actor, $key( 'slug' ) );
				$ok  = 'Role deleted.';
				break;
			case 'save_grants':
				$res = $svc->set_role_grants( $actor, $key( 'slug' ), self::perm_pairs_from_post( isset( $p['g'] ) ? $p['g'] : array() ) );
				$ok  = 'Permissions saved. They apply immediately.';
				break;
			case 'save_user':
				$uid = isset( $p['user_id'] ) ? (int) $p['user_id'] : 0;
				$res = $svc->set_user_roles( $actor, $uid, $list( 'roles' ) );
				if ( true === $res ) {
					$res = $svc->set_user_access( $actor, $uid, ! empty( $p['enabled'] ) );
				}
				$ok = 'Access and roles saved. They apply immediately.';
				break;
			case 'save_overrides':
				$uid = isset( $p['user_id'] ) ? (int) $p['user_id'] : 0;
				$map = array();
				if ( isset( $p['ov'] ) && is_array( $p['ov'] ) ) {
					foreach ( $p['ov'] as $m => $acts ) {
						if ( is_array( $acts ) ) {
							foreach ( $acts as $a => $effect ) {
								$map[ sanitize_key( $m ) . ':' . sanitize_key( $a ) ] = is_scalar( $effect ) ? sanitize_key( $effect ) : '';
							}
						}
					}
				}
				$res = $svc->set_user_overrides( $actor, $uid, $map );
				$ok  = 'User-specific permissions saved.';
				break;
			case 'revoke_user':
				$res = $svc->revoke_user( $actor, isset( $p['user_id'] ) ? (int) $p['user_id'] : 0 );
				$ok  = 'All application rights of this user were revoked. The WordPress account is untouched.';
				break;
			case 'toggle_module':
				$res = $svc->set_module_enabled( $actor, $key( 'slug' ), ! empty( $p['enable'] ) );
				$ok  = ! empty( $p['enable'] ) ? 'Module switched on.' : 'Module switched off. Nobody can use it until you switch it on again.';
				break;
			case 'save_module_access':
				$users = self::resolve_users( isset( $p['users'] ) ? $p['users'] : '' );
				$res   = is_wp_error( $users ) ? $users : $svc->set_module_access( $actor, $key( 'slug' ), $list( 'roles' ), $users );
				$ok    = 'Module access saved.';
				break;
			case 'add_module':
				$extra = preg_split( '/[\s,;]+/', $s( 'custom_actions' ), -1, PREG_SPLIT_NO_EMPTY );
				$res   = $svc->add_manual_module( $actor, $s( 'slug' ), $s( 'name' ), $s( 'description' ), $extra ? $extra : array() );
				$ok    = 'Module added. Default roles received their standard permissions.';
				break;
			case 'delete_module':
				$res = $svc->delete_module( $actor, $key( 'slug' ) );
				$ok  = 'Module deleted.';
				break;
			case 'save_settings':
				$g = self::guard_settings( $actor );
				if ( true !== $g ) {
					$res = $g;
					break;
				}
				$before = AM::settings();
				$after  = AM::save_settings( array(
					'log_retention_days'  => isset( $p['log_retention_days'] ) ? $p['log_retention_days'] : null,
					'rate_limit_per_min'  => isset( $p['rate_limit_per_min'] ) ? $p['rate_limit_per_min'] : null,
					'denied_threshold'    => isset( $p['denied_threshold'] ) ? $p['denied_threshold'] : null,
					'log_ip'              => ! empty( $p['log_ip'] ),
					'delete_on_uninstall' => ! empty( $p['delete_on_uninstall'] ),
				) );
				AM::log( 'settings.update', '', array( 'from' => $before, 'to' => $after ) );
				$ok = 'Settings saved.';
				break;
			case 'recover_super':
				$res = empty( $p['confirm'] ) ? new WP_Error( 'am_confirm', 'Tick the confirmation box first.' ) : $svc->recover_super( $actor );
				$ok  = 'You are now a Super Admin.';
				break;
		}

		if ( is_wp_error( $res ) ) {
			self::flash_set( 'error', $res->get_error_message() );
		} else {
			self::flash_set( 'success', $ok );
		}
		$back = wp_get_referer();
		wp_safe_redirect( $back ? $back : self::url( 'am-dashboard' ) );
		exit;
	}

	private static function guard_settings( $actor ) {
		return AM::engine()->is_super( $actor ) ? true : new WP_Error( 'am_not_super', 'Only an application Super Admin can change settings.' );
	}

	/* =====================================================================
	 * screens
	 * ===================================================================== */

	public static function render( $slug ) {
		if ( ! current_user_can( AM::admin_capability() ) ) {
			wp_die( esc_html( 'You do not have permission to view this page.' ), 403 );
		}
		echo '<div class="wrap am-wrap"><h1>' . esc_html( self::PAGES[ $slug ] ) . '</h1>';
		echo '<nav class="am-nav">';
		foreach ( self::PAGES as $s => $t ) {
			echo '<a class="' . ( $s === $slug ? 'is-active' : '' ) . '" href="' . esc_url( self::url( $s ) ) . '">' . esc_html( $t ) . '</a>';
		}
		echo '</nav>';
		self::flash_show();
		if ( ! self::writable() ) {
			echo '<div class="notice notice-warning inline"><p>You can look around, but only an application <strong>Super Admin</strong> can change settings here. WordPress Administrators are not Super Admins automatically.</p></div>';
		}
		switch ( $slug ) {
			case 'am-users':
				if ( ! empty( $_GET['user'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
					self::screen_user( (int) $_GET['user'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				} else {
					self::screen_users();
				}
				break;
			case 'am-roles':
				self::screen_roles();
				break;
			case 'am-permissions':
				self::screen_permissions();
				break;
			case 'am-modules':
				self::screen_modules();
				break;
			case 'am-logs':
				self::screen_logs();
				break;
			case 'am-settings':
				self::screen_settings();
				break;
			default:
				self::screen_dashboard();
		}
		echo '</div>';
	}

	/* ---------- dashboard ---------- */

	private static function screen_dashboard() {
		$store  = AM::store();
		$engine = AM::engine();
		$access = $store->get_all_user_access();
		$on     = count( array_filter( $access ) );
		$supers = AM::service()->super_admins();
		$mods   = $engine->modules();
		$mods_on = count( array_filter( $mods, function ( $m ) {
			return $m['enabled'] && $m['registered'];
		} ) );
		$since  = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );
		$denied = $store->query_logs( array( 'action' => 'access.denied', 'from' => $since ), 1, 0 );
		$logins = $store->query_logs( array( 'action' => 'auth.login', 'from' => $since ), 1, 0 );

		if ( ! $supers ) {
			echo '<div class="notice notice-error inline"><p><strong>There is no Super Admin.</strong> Nobody can change access settings. <a href="' . esc_url( self::url( 'am-settings' ) ) . '">Open Settings to recover</a>.</p></div>';
		}
		foreach ( $mods as $m ) {
			if ( ! $m['registered'] ) {
				echo '<div class="notice notice-warning inline"><p>Module <strong>' . esc_html( $m['name'] ) . '</strong> is not available because the plugin that provides it is inactive. Nobody can use it until the plugin is active again.</p></div>';
			}
		}

		echo '<div class="am-cards">';
		$cards = array(
			array( 'Users with access', $on, self::url( 'am-users', array( 'status' => 'enabled' ) ) ),
			array( 'Super Admins', count( $supers ), self::url( 'am-users', array( 'role' => 'super_admin' ) ) ),
			array( 'Roles', count( $engine->roles() ), self::url( 'am-roles' ) ),
			array( 'Modules on', $mods_on . ' / ' . count( $mods ), self::url( 'am-modules' ) ),
			array( 'Denied requests, 24 h', $denied['total'], self::url( 'am-logs', array( 'action' => 'access.denied' ) ) ),
			array( 'Logins, 24 h', $logins['total'], self::url( 'am-logs', array( 'action' => 'auth.login' ) ) ),
		);
		foreach ( $cards as $c ) {
			echo '<a class="am-card" href="' . esc_url( $c[2] ) . '"><strong>' . esc_html( (string) $c[1] ) . '</strong><span>' . esc_html( $c[0] ) . '</span></a>';
		}
		echo '</div>';

		echo '<h2>Recent activity</h2>';
		self::log_table( $store->query_logs( array(), 10, 0 )['rows'] );
		echo '<p><a href="' . esc_url( self::url( 'am-logs' ) ) . '">All activity logs →</a></p>';
	}

	/* ---------- users ---------- */

	private static function screen_users() {
		$store  = AM::store();
		$engine = AM::engine();
		$q      = array(
			's'      => isset( $_GET['s'] ) ? sanitize_text_field( wp_unslash( $_GET['s'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'status' => isset( $_GET['status'] ) ? sanitize_key( $_GET['status'] ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'role'   => isset( $_GET['role'] ) ? sanitize_key( $_GET['role'] ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		);
		$paged  = max( 1, isset( $_GET['paged'] ) ? (int) $_GET['paged'] : 1 ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$per    = 20;
		$access = $store->get_all_user_access();
		$on_ids = array_keys( array_filter( $access ) );

		$args = array( 'number' => $per, 'paged' => $paged, 'orderby' => 'ID', 'order' => 'ASC', 'count_total' => true );
		if ( '' !== $q['s'] ) {
			$args['search']         = '*' . $q['s'] . '*';
			$args['search_columns'] = array( 'user_login', 'user_nicename', 'user_email', 'display_name' );
		}
		$include = null;
		if ( '' !== $q['role'] ) {
			$include = $store->users_with_role( $q['role'] );
		}
		if ( 'enabled' === $q['status'] ) {
			$include = null === $include ? $on_ids : array_values( array_intersect( $include, $on_ids ) );
		} elseif ( 'disabled' === $q['status'] && $on_ids ) {
			$args['exclude'] = $on_ids;
		}
		$empty = null !== $include && ! $include;
		if ( null !== $include && $include ) {
			$args['include'] = $include;
		}
		$query = $empty ? null : new WP_User_Query( $args );
		$users = $query ? $query->get_results() : array();
		$total = $query ? (int) $query->get_total() : 0;

		$roles = $engine->roles();
		echo '<form method="get" class="am-filters"><input type="hidden" name="page" value="am-users">';
		echo '<input type="search" name="s" value="' . esc_attr( $q['s'] ) . '" placeholder="Search username, name or email">';
		echo '<select name="status"><option value="">Any access status</option><option value="enabled"' . selected( $q['status'], 'enabled', false ) . '>Access enabled</option><option value="disabled"' . selected( $q['status'], 'disabled', false ) . '>Access disabled</option></select>';
		echo '<select name="role"><option value="">Any application role</option>';
		foreach ( $roles as $slug => $r ) {
			echo '<option value="' . esc_attr( $slug ) . '"' . selected( $q['role'], $slug, false ) . '>' . esc_html( $r['name'] ) . '</option>';
		}
		echo '</select> <button class="button">Filter</button> <a class="button-link" href="' . esc_url( self::url( 'am-users' ) ) . '">Reset</a></form>';

		$ids  = array_map( function ( $u ) {
			return (int) $u->ID;
		}, $users );
		$last = $store->last_activity( $ids );
		$mods = $engine->modules();

		echo '<div class="am-scroll"><table class="widefat striped am-table"><thead><tr>';
		foreach ( array( 'Username', 'Full name', 'Email', 'WP user ID', 'WordPress role', 'Application role', 'Access', 'Assigned permissions', 'Last activity', '' ) as $h ) {
			echo '<th>' . esc_html( $h ) . '</th>';
		}
		echo '</tr></thead><tbody>';
		if ( ! $users ) {
			echo '<tr><td colspan="10">No users match.</td></tr>';
		}
		foreach ( $users as $u ) {
			$st    = $engine->user_state( $u->ID );
			$perm  = $engine->permissions_for( $u->ID );
			$parts = array();
			foreach ( $perm as $m => $acts ) {
				$parts[] = esc_html( $mods[ $m ]['name'] ) . ' <span class="am-muted">' . count( $acts ) . '/' . count( $engine->module_actions( $m ) ) . '</span>';
			}
			$rn = array();
			foreach ( $st['roles'] as $r ) {
				$rn[] = esc_html( $roles[ $r ]['name'] );
			}
			$act = isset( $last[ $u->ID ] ) ? $last[ $u->ID ] : '';
			$seen = (int) get_user_meta( $u->ID, 'am_last_activity', true );
			if ( $seen && ( ! $act || strtotime( $act . ' UTC' ) < $seen ) ) {
				$act = gmdate( 'Y-m-d H:i:s', $seen );
			}
			echo '<tr>';
			echo '<td><strong>' . esc_html( $u->user_login ) . '</strong></td>';
			echo '<td>' . esc_html( $u->display_name ) . '</td>';
			echo '<td>' . esc_html( $u->user_email ) . '</td>';
			echo '<td>' . (int) $u->ID . '</td>';
			echo '<td>' . esc_html( self::wp_role_names( $u ) ) . '</td>';
			echo '<td>' . ( $rn ? implode( ', ', $rn ) : '<span class="am-muted">none</span>' ) . '</td>';
			echo '<td>' . ( $st['enabled'] ? '<span class="am-pill am-on">Enabled</span>' : '<span class="am-pill am-off">Disabled</span>' ) . '</td>';
			echo '<td>' . ( $parts ? implode( '<br>', $parts ) : '<span class="am-muted">none</span>' ) . ( $st['overrides'] ? '<br><span class="am-pill">' . count( $st['overrides'] ) . ' override(s)</span>' : '' ) . '</td>';
			echo '<td>' . self::when( $act ) . '</td>';
			echo '<td><a class="button" href="' . esc_url( self::url( 'am-users', array( 'user' => $u->ID ) ) ) . '">Manage</a></td>';
			echo '</tr>';
		}
		echo '</tbody></table></div>';

		$pages = (int) ceil( $total / $per );
		if ( $pages > 1 ) {
			echo '<div class="tablenav"><div class="tablenav-pages">' . wp_kses_post( paginate_links( array( 'base' => add_query_arg( 'paged', '%#%' ), 'format' => '', 'current' => $paged, 'total' => $pages ) ) ) . '</div></div>';
		}
		echo '<p class="am-muted">' . (int) $total . ' user(s). Disabling application access never deletes the WordPress account.</p>';
	}

	private static function screen_user( $uid ) {
		$u = get_userdata( $uid );
		echo '<p><a href="' . esc_url( self::url( 'am-users' ) ) . '">← All users</a></p>';
		if ( ! $u ) {
			echo '<p>That WordPress user does not exist.</p>';
			return;
		}
		$engine = AM::engine();
		$roles  = $engine->roles();
		$mods   = $engine->modules();
		$st     = $engine->user_state( $uid );
		$self   = ( get_current_user_id() === (int) $uid );

		echo '<h2>' . esc_html( $u->display_name ) . ' <span class="am-muted">(' . esc_html( $u->user_login ) . ', #' . (int) $uid . ', ' . esc_html( $u->user_email ) . ')</span></h2>';
		if ( $self ) {
			echo '<div class="notice notice-info inline"><p>This is your own account. You cannot change your own access or permissions; another Super Admin has to do it.</p></div>';
		}
		$dis = ( $self || ! self::writable() ) ? ' disabled' : '';

		echo '<div class="am-panel"><h3>Access and roles</h3>';
		self::form_open( 'save_user' );
		echo '<input type="hidden" name="user_id" value="' . (int) $uid . '">';
		echo '<p><label><input type="checkbox" name="enabled" value="1"' . checked( $st['enabled'], true, false ) . $dis . '> <strong>Application access enabled</strong></label><br><span class="am-muted">Switched off = the user cannot use any module, whatever the roles say.</span></p>';
		echo '<p class="am-checks">';
		foreach ( $roles as $slug => $r ) {
			echo '<label><input type="checkbox" name="roles[]" value="' . esc_attr( $slug ) . '"' . checked( in_array( $slug, $st['roles'], true ), true, false ) . $dis . '> ' . esc_html( $r['name'] ) . ( $r['is_super'] ? ' <span class="am-pill">all permissions</span>' : '' ) . '</label>';
		}
		echo '</p>';
		self::btn( 'Save access and roles' );
		echo '</form></div>';

		echo '<div class="am-panel"><h3>User-specific permissions</h3><p class="am-muted">An override beats the roles. <strong>Deny</strong> always wins over everything except switching access off. Leave on “Inherit” to follow the roles.</p>';
		self::form_open( 'save_overrides' );
		echo '<input type="hidden" name="user_id" value="' . (int) $uid . '"><div class="am-scroll"><table class="widefat striped am-table"><thead><tr><th>Module</th><th>Permission</th><th>Override</th><th>Effective result</th></tr></thead><tbody>';
		foreach ( $mods as $m => $mod ) {
			foreach ( $engine->module_actions( $m ) as $a => $label ) {
				$cur = isset( $st['overrides'][ $m . ':' . $a ] ) ? $st['overrides'][ $m . ':' . $a ] : '';
				$ex  = $engine->explain( $uid, $m, $a );
				echo '<tr><td>' . esc_html( $mod['name'] ) . '</td><td>' . esc_html( $label ) . '</td><td>';
				echo '<select name="ov[' . esc_attr( $m ) . '][' . esc_attr( $a ) . ']"' . $dis . '>';
				foreach ( array( '' => 'Inherit', 'allow' => 'Allow', 'deny' => 'Deny' ) as $v => $t ) {
					echo '<option value="' . esc_attr( $v ) . '"' . selected( $cur, $v, false ) . '>' . esc_html( $t ) . '</option>';
				}
				echo '</select></td><td>' . ( $ex['allowed'] ? '<span class="am-pill am-on">Allowed</span>' : '<span class="am-pill am-off">Denied</span>' ) . ' <span class="am-muted">' . esc_html( AM_Engine::reason_label( $ex['reason'] ) ) . '</span></td></tr>';
			}
		}
		echo '</tbody></table></div>';
		self::btn( 'Save user-specific permissions' );
		echo '</form></div>';

		echo '<div class="am-panel"><h3>Revoke</h3><p class="am-muted">Removes every role and override and switches application access off. The WordPress account stays.</p>';
		self::form_open( 'revoke_user', 'Revoke all application rights of this user?' );
		echo '<input type="hidden" name="user_id" value="' . (int) $uid . '">';
		self::btn( 'Revoke all rights', 'button button-secondary' );
		echo '</form></div>';
	}

	/* ---------- roles ---------- */

	private static function screen_roles() {
		$store  = AM::store();
		$engine = AM::engine();
		$grants = $engine->all_grants();
		$edit   = isset( $_GET['edit'] ) ? sanitize_key( $_GET['edit'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		echo '<div class="am-scroll"><table class="widefat striped am-table"><thead><tr><th>Role</th><th>Key</th><th>Type</th><th>Users</th><th>Permissions</th><th></th></tr></thead><tbody>';
		foreach ( $engine->roles() as $slug => $r ) {
			$n   = count( $store->users_with_role( $slug ) );
			$cnt = $r['is_super'] ? 'all' : ( isset( $grants[ $slug ] ) ? count( $grants[ $slug ] ) : 0 );
			echo '<tr><td><strong>' . esc_html( $r['name'] ) . '</strong><br><span class="am-muted">' . esc_html( $r['description'] ) . '</span></td>';
			echo '<td><code>' . esc_html( $slug ) . '</code></td><td>' . ( $r['is_system'] ? 'Built-in' : 'Custom' ) . '</td><td>' . (int) $n . '</td><td>' . esc_html( (string) $cnt ) . '</td><td>';
			echo '<a class="button" href="' . esc_url( self::url( 'am-roles', array( 'edit' => $slug ) ) ) . '">Rename</a> ';
			echo '<a class="button" href="' . esc_url( self::url( 'am-permissions', array( 'role' => $slug ) ) ) . '">Permissions</a> ';
			if ( ! $r['is_system'] && ! $r['is_super'] ) {
				echo '<span class="am-inline">';
				self::form_open( 'delete_role', 'Delete the role "' . $r['name'] . '"? ' . $n . ' user(s) will lose it.' );
				echo '<input type="hidden" name="slug" value="' . esc_attr( $slug ) . '">';
				self::btn( 'Delete', 'button button-link-delete' );
				echo '</form></span>';
			}
			echo '</td></tr>';
		}
		echo '</tbody></table></div>';

		$roles = $engine->roles();
		if ( $edit && isset( $roles[ $edit ] ) ) {
			echo '<div class="am-panel"><h3>Rename role</h3>';
			self::form_open( 'update_role' );
			echo '<input type="hidden" name="slug" value="' . esc_attr( $edit ) . '">';
			echo '<p><label>Name<br><input type="text" name="name" class="regular-text" maxlength="120" value="' . esc_attr( $roles[ $edit ]['name'] ) . '" required></label></p>';
			echo '<p><label>Description<br><input type="text" name="description" class="large-text" maxlength="500" value="' . esc_attr( $roles[ $edit ]['description'] ) . '"></label></p>';
			self::btn( 'Save' );
			echo '</form></div>';
		}

		echo '<div class="am-panel"><h3>Create a custom role</h3>';
		self::form_open( 'create_role' );
		echo '<p><label>Name<br><input type="text" name="name" class="regular-text" maxlength="120" required></label></p>';
		echo '<p><label>Description<br><input type="text" name="description" class="large-text" maxlength="500"></label></p>';
		echo '<p class="am-muted">A new role has no permissions. Choose them afterwards in Permissions Management.</p>';
		self::btn( 'Create role' );
		echo '</form></div>';
	}

	/* ---------- permissions ---------- */

	private static function screen_permissions() {
		$engine = AM::engine();
		$roles  = $engine->roles();
		$mods   = $engine->modules();
		$sel    = isset( $_GET['role'] ) ? sanitize_key( $_GET['role'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! isset( $roles[ $sel ] ) ) {
			$sel = 'manager' === $sel || isset( $roles['manager'] ) ? 'manager' : (string) key( $roles );
		}

		echo '<form method="get" class="am-filters"><input type="hidden" name="page" value="am-permissions"><label>Role <select name="role" onchange="this.form.submit()">';
		foreach ( $roles as $slug => $r ) {
			echo '<option value="' . esc_attr( $slug ) . '"' . selected( $sel, $slug, false ) . '>' . esc_html( $r['name'] ) . '</option>';
		}
		echo '</select></label> <noscript><button class="button">Show</button></noscript></form>';

		$role = $roles[ $sel ];
		if ( $role['is_super'] ) {
			echo '<p>The <strong>Super Admin</strong> role always has every permission of every module (including modules added later). It cannot be edited.</p>';
		} elseif ( ! $mods ) {
			echo '<p>No modules are registered yet. Install or activate a plugin that provides one, or add a module in Module Management.</p>';
		} else {
			$have = isset( $engine->all_grants()[ $sel ] ) ? $engine->all_grants()[ $sel ] : array();
			$cols = AM_Engine::STANDARD;
			foreach ( $mods as $m ) {
				foreach ( $m['actions'] as $a => $l ) {
					$cols[ $a ] = $l;
				}
			}
			echo '<p class="am-muted">Tick what this role may do. Nothing ticked = no access (deny by default). Changes apply to everyone holding the role immediately.</p>';
			self::form_open( 'save_grants' );
			echo '<input type="hidden" name="slug" value="' . esc_attr( $sel ) . '">';
			echo '<div class="am-scroll"><table class="widefat striped am-table am-matrix"><thead><tr><th>Module</th>';
			foreach ( $cols as $a => $l ) {
				echo '<th>' . esc_html( $l ) . '<br><a href="#" data-am-toggle="input[data-act=' . esc_attr( $a ) . ']" data-state="all">all</a> · <a href="#" data-am-toggle="input[data-act=' . esc_attr( $a ) . ']" data-state="none">none</a></th>';
			}
			echo '<th>Row</th></tr></thead><tbody>';
			foreach ( $mods as $m => $mod ) {
				$acts = $engine->module_actions( $m );
				echo '<tr><td><strong>' . esc_html( $mod['name'] ) . '</strong>' . ( ! $mod['enabled'] ? ' <span class="am-pill am-off">off</span>' : '' ) . ( ! $mod['registered'] ? ' <span class="am-pill am-off">inactive</span>' : '' ) . '</td>';
				foreach ( $cols as $a => $l ) {
					if ( isset( $acts[ $a ] ) ) {
						echo '<td><input type="checkbox" data-act="' . esc_attr( $a ) . '" data-mod="' . esc_attr( $m ) . '" name="g[' . esc_attr( $m ) . '][' . esc_attr( $a ) . ']" value="1"' . checked( in_array( $m . ':' . $a, $have, true ), true, false ) . ( self::writable() ? '' : ' disabled' ) . '></td>';
					} else {
						echo '<td class="am-muted">—</td>';
					}
				}
				echo '<td><a href="#" data-am-toggle="input[data-mod=' . esc_attr( $m ) . ']" data-state="all">all</a> · <a href="#" data-am-toggle="input[data-mod=' . esc_attr( $m ) . ']" data-state="none">none</a></td></tr>';
			}
			echo '</tbody></table></div>';
			self::btn( 'Save permissions' );
			echo '</form>';
		}
		echo '<h3>User-specific permissions</h3><p>To give one person more or less than their role, open the user in <a href="' . esc_url( self::url( 'am-users' ) ) . '">Users &amp; Access</a> and use the override table. A user can hold several roles; they receive the union of all their permissions, then overrides are applied.</p>';
		echo '<h3>How a decision is made</h3><ol class="am-order"><li>User has application access switched on, else <strong>deny</strong>.</li><li>Module exists, is switched on and its plugin is active, else <strong>deny</strong>.</li><li>Explicit user override <em>deny</em> → <strong>deny</strong>.</li><li>Super Admin → <strong>allow</strong>.</li><li>Module restricted to certain roles/users and the user is not listed → <strong>deny</strong>.</li><li>Explicit user override <em>allow</em> → <strong>allow</strong>.</li><li>Any of the user’s roles grants it → <strong>allow</strong>.</li><li>Otherwise <strong>deny</strong>.</li></ol>';
	}

	/* ---------- modules ---------- */

	private static function screen_modules() {
		$engine = AM::engine();
		$roles  = $engine->roles();
		$mods   = $engine->modules();
		echo '<p class="am-muted">Modules are the parts of applications that have their own permissions. Plugins register them automatically.</p>';
		if ( ! $mods ) {
			echo '<p>No modules yet.</p>';
		}
		foreach ( $mods as $slug => $m ) {
			$gate = AM::store()->get_module_access( $slug );
			$names = array();
			foreach ( $gate['users'] as $uid ) {
				$u       = get_userdata( $uid );
				$names[] = $u ? $u->user_login : '#' . $uid;
			}
			echo '<div class="am-panel"><h3>' . esc_html( $m['name'] ) . ' <code>' . esc_html( $slug ) . '</code> ';
			echo $m['registered'] ? ( $m['enabled'] ? '<span class="am-pill am-on">On</span>' : '<span class="am-pill am-off">Off</span>' ) : '<span class="am-pill am-off">Plugin inactive</span>';
			echo '</h3><p>' . esc_html( $m['description'] ) . ' <span class="am-muted">Source: ' . esc_html( $m['source'] ? $m['source'] : 'built-in' ) . '. Permissions: ' . esc_html( implode( ', ', array_values( $engine->module_actions( $slug ) ) ) ) . '.</span></p>';

			echo '<div class="am-inline">';
			self::form_open( 'toggle_module', $m['enabled'] ? 'Switch this module off? Nobody will be able to use it.' : '' );
			echo '<input type="hidden" name="slug" value="' . esc_attr( $slug ) . '"><input type="hidden" name="enable" value="' . ( $m['enabled'] ? '0' : '1' ) . '">';
			self::btn( $m['enabled'] ? 'Switch off' : 'Switch on', 'button' );
			echo '</form></div> ';
			if ( 'manual' === $m['source'] || ! $m['registered'] ) {
				echo '<div class="am-inline">';
				self::form_open( 'delete_module', 'Delete this module and its permissions?' );
				echo '<input type="hidden" name="slug" value="' . esc_attr( $slug ) . '">';
				self::btn( 'Delete module', 'button button-link-delete' );
				echo '</form></div>';
			}

			echo '<details><summary>Restrict who can use this module (' . ( $gate['roles'] || $gate['users'] ? 'restricted' : 'open to everyone with permissions' ) . ')</summary>';
			self::form_open( 'save_module_access' );
			echo '<input type="hidden" name="slug" value="' . esc_attr( $slug ) . '">';
			echo '<p class="am-muted">Leave everything empty for no restriction. If you choose roles and/or users, only they can use the module, in addition to having the permissions.</p><p class="am-checks">';
			foreach ( $roles as $rs => $r ) {
				echo '<label><input type="checkbox" name="roles[]" value="' . esc_attr( $rs ) . '"' . checked( in_array( $rs, $gate['roles'], true ), true, false ) . ( self::writable() ? '' : ' disabled' ) . '> ' . esc_html( $r['name'] ) . '</label>';
			}
			echo '</p><p><label>Specific users (usernames, emails or IDs, comma separated)<br><input type="text" class="large-text" name="users" value="' . esc_attr( implode( ', ', $names ) ) . '"' . ( self::writable() ? '' : ' disabled' ) . '></label></p>';
			self::btn( 'Save restriction' );
			echo '</form></details></div>';
		}

		echo '<div class="am-panel"><h3>Add a module manually</h3><p class="am-muted">For applications that are not WordPress plugins. Plugins that register their own modules do not need this.</p>';
		self::form_open( 'add_module' );
		echo '<p><label>Slug (letters, numbers, - and _)<br><input type="text" name="slug" class="regular-text" maxlength="40" required></label></p>';
		echo '<p><label>Name<br><input type="text" name="name" class="regular-text" maxlength="120" required></label></p>';
		echo '<p><label>Description<br><input type="text" name="description" class="large-text" maxlength="500"></label></p>';
		echo '<p><label>Extra permissions besides View, Create, Edit, Delete, Export, Manage (optional, comma separated)<br><input type="text" name="custom_actions" class="large-text"></label></p>';
		self::btn( 'Add module' );
		echo '</form></div>';
	}

	/* ---------- logs ---------- */

	private static function log_table( array $rows ) {
		echo '<div class="am-scroll"><table class="widefat striped am-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Target user</th><th>Details</th></tr></thead><tbody>';
		if ( ! $rows ) {
			echo '<tr><td colspan="6">Nothing recorded yet.</td></tr>';
		}
		foreach ( $rows as $r ) {
			echo '<tr><td>' . self::when( $r['created_at'] ) . '</td><td>' . ( (int) $r['user_id'] ? self::user_label( $r['user_id'] ) : '<span class="am-muted">anonymous</span>' ) . ( ! empty( $r['ip'] ) ? '<br><span class="am-muted">' . esc_html( $r['ip'] ) . '</span>' : '' ) . '</td>';
			echo '<td><code>' . esc_html( $r['action'] ) . '</code></td><td>' . esc_html( $r['module'] ) . '</td><td>' . ( (int) $r['target_user_id'] ? self::user_label( $r['target_user_id'] ) : '—' ) . '</td>';
			echo '<td class="am-details">' . esc_html( $r['details'] ) . '</td></tr>';
		}
		echo '</tbody></table></div>';
	}

	private static function screen_logs() {
		$f = array(
			'action' => isset( $_GET['action'] ) ? sanitize_text_field( wp_unslash( $_GET['action'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'module' => isset( $_GET['module'] ) ? sanitize_key( $_GET['module'] ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'user'   => isset( $_GET['user_id'] ) ? (int) $_GET['user_id'] : 0, // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'from'   => isset( $_GET['from'] ) ? sanitize_text_field( wp_unslash( $_GET['from'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'to'     => isset( $_GET['to'] ) ? sanitize_text_field( wp_unslash( $_GET['to'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		);
		$valid_date = function ( $d ) {
			return (bool) preg_match( '/^\d{4}-\d{2}-\d{2}$/', $d );
		};
		$query = array();
		if ( preg_match( '/^[a-z_.]{1,60}$/', $f['action'] ) ) {
			$query['action'] = $f['action'];
		}
		if ( $f['module'] ) {
			$query['module'] = $f['module'];
		}
		if ( $f['user'] ) {
			$query['user_id'] = $f['user'];
		}
		if ( $valid_date( $f['from'] ) ) {
			$query['from'] = get_gmt_from_date( $f['from'] . ' 00:00:00' );
		}
		if ( $valid_date( $f['to'] ) ) {
			$query['to'] = get_gmt_from_date( $f['to'] . ' 23:59:59' );
		}
		$paged = max( 1, isset( $_GET['paged'] ) ? (int) $_GET['paged'] : 1 ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$per   = 50;
		$res   = AM::store()->query_logs( $query, $per, ( $paged - 1 ) * $per );

		$groups = array(
			''             => 'All activity',
			'auth.'        => 'Login, logout, failed logins',
			'access.'      => 'Denied / blocked requests',
			'role.'        => 'Role changes',
			'user.'        => 'User access and permission changes',
			'module.'      => 'Module changes',
			'settings.'    => 'Settings changes',
			'app.'         => 'Application actions (data changes, exports)',
			'super.'       => 'Super Admin recovery',
		);
		echo '<form method="get" class="am-filters"><input type="hidden" name="page" value="am-logs"><select name="action">';
		foreach ( $groups as $v => $t ) {
			echo '<option value="' . esc_attr( $v ) . '"' . selected( $f['action'], $v, false ) . '>' . esc_html( $t ) . '</option>';
		}
		echo '</select><input type="text" name="module" value="' . esc_attr( $f['module'] ) . '" placeholder="Module"><input type="number" name="user_id" value="' . ( $f['user'] ? (int) $f['user'] : '' ) . '" placeholder="User ID" min="1"> From <input type="date" name="from" value="' . esc_attr( $f['from'] ) . '"> To <input type="date" name="to" value="' . esc_attr( $f['to'] ) . '"> <button class="button">Filter</button> <a class="button-link" href="' . esc_url( self::url( 'am-logs' ) ) . '">Reset</a></form>';

		self::log_table( $res['rows'] );
		$pages = (int) ceil( $res['total'] / $per );
		if ( $pages > 1 ) {
			echo '<div class="tablenav"><div class="tablenav-pages">' . wp_kses_post( paginate_links( array( 'base' => add_query_arg( 'paged', '%#%' ), 'format' => '', 'current' => $paged, 'total' => $pages ) ) ) . '</div></div>';
		}
		echo '<p class="am-muted">' . (int) $res['total'] . ' entr' . ( 1 === (int) $res['total'] ? 'y' : 'ies' ) . '. Times are shown in the site time zone. Passwords and other secrets are never written to the log.</p>';
	}

	/* ---------- settings ---------- */

	private static function screen_settings() {
		$s = AM::settings();
		self::form_open( 'save_settings' );
		$dis = self::writable() ? '' : ' disabled';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th><label for="am1">Keep activity logs (days)</label></th><td><input id="am1" type="number" min="0" max="3650" name="log_retention_days" value="' . (int) $s['log_retention_days'] . '"' . $dis . '><p class="description">0 keeps them forever. Older entries are removed once a day.</p></td></tr>';
		echo '<tr><th><label for="am2">Rate limit (requests per minute per user)</label></th><td><input id="am2" type="number" min="30" max="6000" name="rate_limit_per_min" value="' . (int) $s['rate_limit_per_min'] . '"' . $dis . '><p class="description">Applies to permission-checked application requests.</p></td></tr>';
		echo '<tr><th><label for="am3">Block after denied requests</label></th><td><input id="am3" type="number" min="5" max="1000" name="denied_threshold" value="' . (int) $s['denied_threshold'] . '"' . $dis . '><p class="description">This many denied requests within 5 minutes block that user for 5 minutes.</p></td></tr>';
		echo '<tr><th>Log IP addresses</th><td><label><input type="checkbox" name="log_ip" value="1"' . checked( ! empty( $s['log_ip'] ), true, false ) . $dis . '> Store the visitor IP address with each log entry</label><p class="description">Off by default for privacy (GDPR). Turn on only if you need it.</p></td></tr>';
		echo '<tr><th>When the plugin is deleted</th><td><label><input type="checkbox" name="delete_on_uninstall" value="1"' . checked( ! empty( $s['delete_on_uninstall'] ), true, false ) . $dis . '> Also delete all roles, permissions and logs</label><p class="description">Off by default: deleting the plugin keeps your data.</p></td></tr>';
		echo '</table>';
		self::btn( 'Save settings' );
		echo '</form>';

		$none = ! AM::service()->super_admins();
		echo '<div class="am-panel"><h3>Recover Super Admin access</h3>';
		if ( $none ) {
			echo '<p><strong>There is currently no Super Admin.</strong> A WordPress administrator can claim the role once. This is logged.</p>';
			self::form_open( 'recover_super' );
			echo '<p><label><input type="checkbox" name="confirm" value="1"> I understand that I will become a Super Admin.</label></p>';
			echo '<button type="submit" class="button button-primary">Make me Super Admin</button></form>';
		} else {
			echo '<p>Not needed: ' . count( AM::service()->super_admins() ) . ' Super Admin(s) exist. This option appears only when none is left.</p>';
		}
		echo '</div>';

		echo '<div class="am-panel"><h3>For developers</h3><p>Other plugins ask this plugin for permissions:</p><pre>if ( ! am_can( \'my_module\', \'edit\' ) ) { /* refuse */ }
$ok = AM::authorize( \'my_module\', \'delete\' ); // true | WP_Error 403/429, logs denials</pre><p>Declare modules on <code>am_register_modules</code>. REST: <code>GET /wp-json/am/v1/me</code>, <code>GET /wp-json/am/v1/check?module=&amp;action=</code>. See the API documentation in the repository.</p><p class="am-muted">Version ' . esc_html( AM_VERSION ) . '</p></div>';
	}
}
