<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Record owners (version 3.21).
 *
 * Software, contracts, tenders and general provisions have an owner. In Contracts the owner is the
 * contract coordinator (Συντονιστής), in the other modules the person responsible (Υπεύθυνος).
 * A user who has "view" but not "view_all" in a module only sees, and can only change, the records he or she owns.
 * The rule is enforced in the REST layer and in SQL (RL_DB::list_records), never only in the browser.
 */
class RL_Owners {

	/** Option that remembers that the one-off grant migration ran. */
	const OPT_GRANTS = 'rl_owner_grants';
	const OPT_BACKFILL = 'rl_owner_backfill';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'migrate' ), 20 ); // after Application Management has registered the modules (priority 5)
	}

	/** True when the module has owners. */
	public static function owned( $coll ) {
		return in_array( $coll, RL_DB::OWNED, true );
	}

	/**
	 * Does the current user see all the records of the module? Modules without owners always do.
	 * Super Admins and everybody who was given "view_all" see everything.
	 */
	public static function sees_all( $coll, $user_id = 0 ) {
		if ( ! self::owned( $coll ) ) {
			return true;
		}
		return class_exists( 'AM' ) && AM::can( $coll, 'view_all', $user_id );
	}

	/** Owner filter for RL_DB::list_records(): null = all records, otherwise the user id. */
	public static function scope( $coll ) {
		return self::sees_all( $coll ) ? null : (int) get_current_user_id();
	}

	/**
	 * May the current user act on this existing record? false for a record owned by somebody else (the caller answers "not found").
	 * @param int|null $owner owner of the record (RL_DB::get_owner()); null = the record does not exist
	 */
	public static function may_touch( $coll, $owner ) {
		if ( null === $owner || self::sees_all( $coll ) ) {
			return true;
		}
		return (int) $owner === (int) get_current_user_id();
	}

	/** Users who may own records: everybody who has been given access to the application. @return array of { id, name } */
	public static function eligible_users() {
		$out = array();
		if ( ! class_exists( 'AM' ) ) {
			return $out;
		}
		foreach ( AM::store()->get_all_user_access() as $uid => $enabled ) {
			if ( ! $enabled ) {
				continue;
			}
			$u = get_userdata( (int) $uid );
			if ( $u ) {
				$out[] = array( 'id' => (int) $uid, 'name' => (string) $u->display_name );
			}
		}
		usort( $out, function ( $a, $b ) {
			return strcasecmp( $a['name'], $b['name'] );
		} );
		return $out;
	}

	public static function is_eligible( $uid ) {
		$uid = (int) $uid;
		if ( $uid <= 0 || ! class_exists( 'AM' ) ) {
			return false;
		}
		$a = AM::store()->get_all_user_access();
		return ! empty( $a[ $uid ] ) && false !== get_userdata( $uid );
	}

	public static function name_of( $uid ) {
		$u = (int) $uid > 0 ? get_userdata( (int) $uid ) : false;
		return $u ? (string) $u->display_name : '';
	}

	public static function email_of( $uid ) {
		$u = (int) $uid > 0 ? get_userdata( (int) $uid ) : false;
		return ( $u && is_email( $u->user_email ) ) ? (string) $u->user_email : '';
	}

	/**
	 * The owner a request asks for.
	 * @param mixed $asked body value "ownerId" (null/absent = not given)
	 * @return int|WP_Error|null null = not given; int = a valid owner; WP_Error = not a user who may own records
	 */
	public static function parse_asked( $asked ) {
		if ( null === $asked || '' === $asked ) {
			return null;
		}
		if ( ! is_numeric( $asked ) || (int) $asked <= 0 || ! self::is_eligible( (int) $asked ) ) {
			return new WP_Error( 'rl_bad_owner', 'The owner must be a user who has access to PROCURE360.', array( 'status' => 400 ) );
		}
		return (int) $asked;
	}

	/** In Contracts the coordinator text always shows the owner's name (exports, search and the Word note use it). */
	public static function coordinator_text( $owner, $current_text ) {
		$n = self::name_of( $owner );
		return '' !== $n ? $n : (string) $current_text;
	}

	/**
	 * Matching proposal for the screen that assigns old records: a user whose name, login or e-mail equals the text, accents and case ignored. Only a single match is proposed.
	 * @return int 0 when there is no unique match
	 */
	public static function suggest( $text ) {
		$key = RL_DB::name_key( $text );
		if ( '' === $key ) {
			return 0;
		}
		$found = array();
		foreach ( self::eligible_users() as $u ) {
			$wp    = get_userdata( $u['id'] );
			$names = array( $u['name'], $wp->user_login, $wp->user_email, trim( $wp->first_name . ' ' . $wp->last_name ), trim( $wp->last_name . ' ' . $wp->first_name ) );
			foreach ( $names as $n ) {
				if ( '' !== trim( (string) $n ) && RL_DB::name_key( $n ) === $key ) {
					$found[ $u['id'] ] = true;
				}
			}
		}
		return 1 === count( $found ) ? (int) key( $found ) : 0;
	}

	/**
	 * One-off after the upgrade to 3.21 so that nobody loses access:
	 * every role (and every per-user override) that has "view" in a module also gets "view_all".
	 * The administrator then removes "view_all" from the roles that should only see their own records.
	 * Roles created later do not get it: they see only their own records until it is granted.
	 */
	public static function migrate() {
		if ( ! class_exists( 'AM' ) ) {
			return;
		}
		if ( '1' !== get_option( self::OPT_BACKFILL ) ) {
			RL_DB::backfill_owners();
			update_option( self::OPT_BACKFILL, '1', false );
		}
		if ( '1' === get_option( self::OPT_GRANTS ) ) {
			return;
		}
		$store = AM::store();
		foreach ( $store->get_all_role_grants() as $role => $pairs ) {
			$new = $pairs;
			foreach ( RL_DB::OWNED as $m ) {
				if ( in_array( $m . ':view', $pairs, true ) && ! in_array( $m . ':view_all', $pairs, true ) ) {
					$new[] = $m . ':view_all';
				}
			}
			if ( $new !== $pairs ) {
				$store->set_role_grants( $role, array_values( array_unique( $new ) ) );
			}
		}
		foreach ( array_keys( $store->get_all_user_access() ) as $uid ) {
			$ov = $store->get_user_overrides( (int) $uid );
			foreach ( RL_DB::OWNED as $m ) {
				if ( isset( $ov[ $m . ':view' ] ) && 'allow' === $ov[ $m . ':view' ] && ! isset( $ov[ $m . ':view_all' ] ) ) {
					$store->set_user_override( (int) $uid, $m, 'view_all', 'allow', 0 );
				}
			}
		}
		AM::engine()->flush();
		update_option( self::OPT_GRANTS, '1', false );
		if ( function_exists( 'am_log' ) ) {
			am_log( 'ledger.owners_migrated', 'settings', array( 'note' => 'view_all granted to every role and user that could view records' ) );
		}
	}
}
