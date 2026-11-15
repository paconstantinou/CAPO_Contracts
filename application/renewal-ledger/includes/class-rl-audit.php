<?php
/**
 * Audit trail for PROCURE360 (v3.14.0).
 *
 *  - RL_Audit_Chain   tamper-evident HMAC-SHA256 chain over the Application Management activity log,
 *                     a syslog copy, and "wp procure360 audit-verify". Active only when RL_AUDIT_KEY is
 *                     defined in wp-config.php (outside the database) and Application Management >= 1.3.1
 *                     (it fires the am_log_written action).
 *  - RL_Audit_Diff    field-level "who changed what from what to what" for record edits.
 *  - RL_Audit_Denied  logs refused requests (401/403/429) on the rl/v1 namespace.
 */
defined( 'ABSPATH' ) || exit;


final class RL_Audit_Chain {

	const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'rl_audit_chain';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$t = self::table();
		dbDelta( "CREATE TABLE $t (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  log_id bigint(20) unsigned NOT NULL,
  prev_hash char(64) NOT NULL,
  row_hash char(64) NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY log_id (log_id),
  UNIQUE KEY prev_hash (prev_hash)
) {$wpdb->get_charset_collate()};" );
	}

	/** Canonical form of a log row: fixed field order, so the same row always gives the same bytes. */
	public static function canonical( array $r ) {
		return wp_json_encode( array(
			(int) $r['id'], (int) $r['user_id'], (int) $r['target_user_id'], (string) $r['action'],
			(string) $r['module'], (string) $r['details'], (string) $r['ip'], (string) $r['created_at'],
		), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	}

	private static function key() {
		if ( ! defined( 'RL_AUDIT_KEY' ) || strlen( RL_AUDIT_KEY ) < 32 ) {
			return null;
		}
		return RL_AUDIT_KEY;
	}

	public static function hash( $prev, array $row ) {
		return hash_hmac( 'sha256', $prev . '|' . self::canonical( $row ), self::key() );
	}

	/** Called for every activity-log row. Optimistic concurrency: UNIQUE(prev_hash) makes two writers that saw the same tail collide; the loser retries. */
	public static function on_log_written( array $row, $log_id ) {
		global $wpdb;
		$row = array_merge( array( 'user_id' => 0, 'target_user_id' => 0, 'action' => '', 'module' => '', 'details' => '', 'ip' => '', 'created_at' => '' ), $row, array( 'id' => (int) $log_id ) );
		if ( null === self::key() ) {
			// Chain is opt-in: without RL_AUDIT_KEY only the syslog copy is written.
			self::syslog( $row );
			return;
		}
		$t = self::table();
		$ok = false;
		for ( $i = 0; $i < 8; $i++ ) {
			$prev = $wpdb->get_var( "SELECT row_hash FROM $t ORDER BY id DESC LIMIT 1" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$prev = $prev ? $prev : self::GENESIS;
			$ok   = $wpdb->insert( $t, array( 'log_id' => (int) $log_id, 'prev_hash' => $prev, 'row_hash' => self::hash( $prev, $row ), 'created_at' => gmdate( 'Y-m-d H:i:s' ) ), array( '%d', '%s', '%s', '%s' ) );
			if ( $ok ) {
				break;
			}
			usleep( 20000 * ( $i + 1 ) );
		}
		if ( ! $ok ) {
			error_log( 'RL audit chain: could not append log ' . (int) $log_id );
		}
		self::syslog( $row );
	}

	/** Second copy outside the database (picked up by rsyslog / the SIEM agent). */
	public static function syslog( array $row ) {
		if ( function_exists( 'openlog' ) && function_exists( 'syslog' ) ) {
			openlog( 'procure360', LOG_PID, LOG_LOCAL6 );
			syslog( LOG_INFO, wp_json_encode( array( 'app' => 'PROCURE360', 'log_id' => $row['id'], 'user' => $row['user_id'], 'action' => $row['action'], 'module' => $row['module'], 'details' => $row['details'], 'ip' => $row['ip'], 'ts' => $row['created_at'] ), JSON_UNESCAPED_UNICODE ) );
			closelog();
		}
	}

	/**
	 * Re-computes the chain. @return array { ok, checked, problems[] }
	 * A problem is: a modified log row, a log row that was deleted, a broken link, or a log row without a chain entry.
	 */
	public static function verify( $from_chain_id = 0 ) {
		global $wpdb;
		$t   = self::table();
		$lt  = $wpdb->prefix . 'am_logs';
		$out = array( 'ok' => true, 'checked' => 0, 'problems' => array() );
		$bad = function ( $m ) use ( &$out ) {
			$out['ok'] = false;
			$out['problems'][] = $m;
		};
		if ( null === self::key() ) {
			$bad( 'RL_AUDIT_KEY is not defined (or shorter than 32 characters) in wp-config.php, so nothing can be verified' );
			return $out;
		}
		$prev = self::GENESIS;
		if ( $from_chain_id > 0 ) {
			$p = $wpdb->get_var( $wpdb->prepare( "SELECT row_hash FROM $t WHERE id = %d", $from_chain_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$prev = $p ? $p : self::GENESIS;
		}
		$last = (int) $from_chain_id; $max_log = 0;
		while ( true ) {
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE id > %d ORDER BY id ASC LIMIT 500", $last ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			if ( ! $rows ) {
				break;
			}
			foreach ( $rows as $c ) {
				$last = (int) $c['id'];
				++$out['checked'];
				$max_log = max( $max_log, (int) $c['log_id'] );
				$log = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $lt WHERE id = %d", $c['log_id'] ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				if ( ! $log ) {
					$bad( "log #{$c['log_id']} is missing from the activity log (deleted?)" );
				} elseif ( $c['prev_hash'] !== $prev ) {
					$bad( "chain link broken at chain #{$c['id']} (an entry before it was removed or reordered)" );
				} elseif ( ! hash_equals( $c['row_hash'], self::hash( $c['prev_hash'], $log ) ) ) {
					$bad( "log #{$c['log_id']} was modified after it was written" );
				}
				$prev = $c['row_hash'];
			}
		}
		$un = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $lt l WHERE l.id > %d AND NOT EXISTS (SELECT 1 FROM $t c WHERE c.log_id = l.id)", $max_log ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( $un > 0 ) {
			$bad( "$un log row(s) newer than the chain tail have no chain entry (chain writer was bypassed or switched off)" );
		}
		return $out;
	}
}

/** Field-level change summary for the audit trail ("who changed what from what to what"). */
final class RL_Audit_Diff {

	/** Fields whose values must never be copied into the log (only "changed"). */
	const SENSITIVE = array( 'username', 'password', 'contractorEmail', 'contractorPhone', 'email', 'emails' );

	/** Bookkeeping fields the server rewrites on every save: not a user change. */
	const IGNORE = array( 'createdAt', 'updatedAt' );

	/** Compact (< 4000 chars, the limit of am_logs.details) list of changed fields. @return array [ field => [old, new] | 'changed' ] */
	public static function changes( $old, array $new, $max_value = 120 ) {
		$old = is_array( $old ) ? $old : array();
		$out = array();
		foreach ( array_unique( array_merge( array_keys( $old ), array_keys( $new ) ) ) as $k ) {
			$a = array_key_exists( $k, $old ) ? $old[ $k ] : null;
			$b = array_key_exists( $k, $new ) ? $new[ $k ] : null;
			if ( in_array( $k, self::IGNORE, true ) || self::norm( $a ) === self::norm( $b ) ) {
				continue;
			}
			if ( in_array( $k, self::SENSITIVE, true ) ) {
				$out[ $k ] = 'changed';
			} elseif ( is_array( $a ) || is_array( $b ) ) {
				// lists (years, budget lines, milestones, attachments, custom fields): count and a short fingerprint, not the content
				$out[ $k ] = array( 'n' => array( is_array( $a ) ? count( $a ) : 0, is_array( $b ) ? count( $b ) : 0 ), 'sha' => substr( hash( 'sha256', wp_json_encode( $b ) ), 0, 12 ) );
			} else {
				$out[ $k ] = array( self::cut( $a, $max_value ), self::cut( $b, $max_value ) );
			}
		}
		return $out;
	}

	private static function norm( $v ) {
		if ( is_array( $v ) ) {
			return wp_json_encode( $v );
		}
		return null === $v || '' === $v ? '' : (string) $v;
	}

	private static function cut( $v, $n ) {
		$v = null === $v ? '' : (string) $v;
		return function_exists( 'mb_substr' ) && mb_strlen( $v ) > $n ? mb_substr( $v, 0, $n ) . '…' : $v;
	}
}

/** Refused requests on rl/v1, at most once a minute per user + route + method + status. */
final class RL_Audit_Denied {

	public static function init() {
		add_filter( 'rest_post_dispatch', array( __CLASS__, 'filter' ), 10, 3 );
	}

	/** Strips record / file ids so that one log line does not leak or multiply per id. */
	public static function normalize( $route ) {
		return preg_replace( array( '#^(/rl/v1/records/[a-z]+)/[A-Za-z0-9_-]+#', '#^(/rl/v1/files)/[a-f0-9]{32}#' ), '$1/{id}', (string) $route );
	}

	public static function filter( $result, $server, $request ) {
		$route = (string) $request->get_route();
		if ( 0 !== strpos( $route, '/rl/v1/' ) || ! function_exists( 'am_log' ) ) {
			return $result;
		}
		$status = $result instanceof WP_REST_Response ? (int) $result->get_status() : 0;
		if ( ! in_array( $status, array( 401, 403, 429 ), true ) ) {
			return $result;
		}
		$uid = get_current_user_id();
		$key = 'rl_den_' . md5( $uid . '|' . $route . '|' . $request->get_method() . '|' . $status );
		if ( ! get_transient( $key ) ) {
			set_transient( $key, 1, 60 );
			am_log( 'ledger.access_denied', '', array( 'route' => self::normalize( $route ), 'method' => $request->get_method(), 'status' => $status ) );
		}
		return $result;
	}
}

RL_Audit_Denied::init();
/* The chain table has its own version, so it is created even when the plugin version did not change. */
add_action( 'plugins_loaded', function () {
	if ( get_option( 'rl_audit_chain_db' ) !== '1.0.0' ) {
		RL_Audit_Chain::install();
		update_option( 'rl_audit_chain_db', '1.0.0', false );
	}
} );
add_action( 'am_log_written', array( 'RL_Audit_Chain', 'on_log_written' ), 10, 2 );
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'procure360 audit-verify', function ( $args, $assoc ) {
		$r = RL_Audit_Chain::verify( (int) ( isset( $assoc['from'] ) ? $assoc['from'] : 0 ) );
		WP_CLI::log( sprintf( 'Checked %d chain entries.', $r['checked'] ) );
		foreach ( $r['problems'] as $p ) {
			WP_CLI::warning( $p );
		}
		$r['ok'] ? WP_CLI::success( 'The audit trail is intact.' ) : WP_CLI::error( 'The audit trail FAILED verification.' );
	} );
}
