<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Daily email digest. Same rules as the on-screen alerts. */
class RL_Cron {

	const HOOK = 'rl_daily_reminders';

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
	}

	/** Remove records that have been in the trash longer than the configured number of days. */
	public static function purge_trash() {
		$n = RL_DB::purge_expired( RL_Settings::trash_days() );
		if ( $n > 0 && function_exists( 'am_log' ) ) {
			am_log( 'ledger.trash_auto_purge', 'software', array( 'records' => $n, 'days' => RL_Settings::trash_days() ) );
		}
		return $n;
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 300, 'daily', self::HOOK );
		}
	}

	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	/** Whole days from today (site time zone) to a Y-m-d date. Null if invalid. */
	public static function days_until( $ymd ) {
		if ( ! is_string( $ymd ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd ) ) {
			return null;
		}
		$tz = wp_timezone();
		$d  = DateTimeImmutable::createFromFormat( '!Y-m-d', $ymd, $tz );
		if ( ! $d ) {
			return null;
		}
		$today = new DateTimeImmutable( 'today', $tz );
		return (int) $today->diff( $d )->format( '%r%a' );
	}

	private static function fmt( $ymd ) {
		return preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', (string) $ymd, $m ) ? $m[3] . '/' . $m[2] . '/' . $m[1] : '-';
	}

	private static function money( $v ) {
		return ( '' === $v || null === $v || ! is_numeric( $v ) ) ? '-' : '€' . number_format( (float) $v, 2, ',', '.' );
	}

	/**
	 * Items that need a reminder now.
	 * @return array[] each: key, title, kind (due|expired), days, date, label, cost
	 */
	public static function collect() {
		$items = self::collect_raw();
		$emails = array();
		foreach ( array( 'software', 'contracts' ) as $coll ) {
			foreach ( RL_DB::list_records( $coll ) as $r ) {
				$emails[ ( 'software' === $coll ? 'sw' : 'ct' ) . ':' . $r['id'] ] = self::parse_emails( isset( $r['data']['emails'] ) ? $r['data']['emails'] : '' );
				$emails[ 'ms:' . $coll . ':' . $r['id'] ] = $emails[ ( 'software' === $coll ? 'sw' : 'ct' ) . ':' . $r['id'] ];
			}
		}
		foreach ( $items as $i => $it ) {
			$parts = explode( ':', $it['key'] );
			$k     = 'ms' === $parts[0] ? 'ms:' . $parts[1] . ':' . $parts[2] : $parts[0] . ':' . $parts[1];
			$items[ $i ]['to'] = isset( $emails[ $k ] ) ? $emails[ $k ] : array();
		}
		return $items;
	}

	/** "a@x.gr, b@y.gr" -> valid addresses. */
	public static function parse_emails( $v ) {
		$out = array();
		foreach ( preg_split( '/[,;\s]+/', is_string( $v ) ? $v : '', -1, PREG_SPLIT_NO_EMPTY ) as $e ) {
			if ( is_email( $e ) ) {
				$out[] = $e;
			}
		}
		return array_values( array_unique( $out ) );
	}

	private static function collect_raw() {
		$items = array();
		$mails = array(); // record key => list of e-mail addresses (empty = default recipients)

		foreach ( RL_DB::list_records( 'software' ) as $r ) {
			$d = $r['data'];
			$days = self::days_until( isset( $d['dateTo'] ) ? $d['dateTo'] : '' );
			if ( null === $days ) {
				continue;
			}
			$remind = ! empty( $d['remindDays'] ) ? (int) $d['remindDays'] : 30;
			$title  = isset( $d['name'] ) ? (string) $d['name'] : '(χωρίς όνομα)';
			if ( $days < 0 && $days >= -30 ) {
				$items[] = array( 'key' => 'sw:' . $r['id'] . ':exp', 'title' => $title, 'kind' => 'expired', 'days' => $days, 'date' => $d['dateTo'], 'label' => 'Λογισμικό - έληξε', 'cost' => isset( $d['cost'] ) ? $d['cost'] : '' );
			} elseif ( $days >= 0 && $days <= $remind ) {
				$items[] = array( 'key' => 'sw:' . $r['id'] . ':due', 'title' => $title, 'kind' => 'due', 'days' => $days, 'date' => $d['dateTo'], 'label' => 'Λογισμικό - λήξη', 'cost' => isset( $d['cost'] ) ? $d['cost'] : '' );
			}
		}

		foreach ( RL_DB::list_records( 'contracts' ) as $r ) {
			$d     = $r['data'];
			$title = isset( $d['title'] ) ? (string) $d['title'] : '(χωρίς τίτλο)';
			if ( ! empty( $d['tender'] ) ) {
				$title .= ' (' . $d['tender'] . ')';
			}
			$end  = self::days_until( isset( $d['dateTo'] ) ? $d['dateTo'] : '' );
			$years = ( isset( $d['years'] ) && is_array( $d['years'] ) ) ? $d['years'] : array();
			if ( null !== $end && $end < 0 && $end >= -30 ) {
				$items[] = array( 'key' => 'ct:' . $r['id'] . ':exp', 'title' => $title, 'kind' => 'expired', 'days' => $end, 'date' => $d['dateTo'], 'label' => 'Σύμβαση - έληξε', 'cost' => isset( $d['cost'] ) ? $d['cost'] : '' );
				continue;
			}
			$n = count( $years );
			foreach ( $years as $i => $y ) {
				if ( ! is_array( $y ) ) {
					continue;
				}
				$days = self::days_until( isset( $y['to'] ) ? $y['to'] : '' );
				$remind = ! empty( $y['remind'] ) ? (int) $y['remind'] : 30;
				if ( null !== $days && $days >= 0 && $days <= $remind ) {
					$label = ( $i === $n - 1 ) ? 'Σύμβαση - λήξη σύμβασης' : 'Σύμβαση - λήξη έτους ' . ( $i + 1 );
					$items[] = array( 'key' => 'ct:' . $r['id'] . ':y' . ( $i + 1 ), 'title' => $title, 'kind' => 'due', 'days' => $days, 'date' => $y['to'], 'label' => $label, 'cost' => isset( $y['cost'] ) ? $y['cost'] : '' );
				}
			}
		}
		// Milestones of both collections: reminder 30/60 days before the due date; overdue ones for 30 days. Done ones are skipped.
		foreach ( array( 'software' => 'Λογισμικό', 'contracts' => 'Σύμβαση' ) as $coll => $kind_label ) {
			foreach ( RL_DB::list_records( $coll ) as $r ) {
				$d     = $r['data'];
				$title = 'software' === $coll ? ( isset( $d['name'] ) ? (string) $d['name'] : '(χωρίς όνομα)' ) : ( isset( $d['title'] ) ? (string) $d['title'] : '(χωρίς τίτλο)' );
				foreach ( ( isset( $d['milestones'] ) && is_array( $d['milestones'] ) ) ? $d['milestones'] : array() as $m ) {
					if ( ! is_array( $m ) || ! empty( $m['done'] ) || empty( $m['id'] ) ) {
						continue;
					}
					$days = self::days_until( isset( $m['due'] ) ? $m['due'] : '' );
					if ( null === $days ) {
						continue;
					}
					$remind = ( isset( $m['remind'] ) && 60 === (int) $m['remind'] ) ? 60 : 30;
					$label  = $kind_label . ' - milestone έτους ' . ( isset( $m['year'] ) ? (int) $m['year'] : 1 ) . ': ' . ( isset( $m['description'] ) ? $m['description'] : '' );
					if ( $days < 0 && $days >= -30 ) {
						$items[] = array( 'key' => 'ms:' . $coll . ':' . $r['id'] . ':' . $m['id'] . ':exp', 'title' => $title, 'kind' => 'expired', 'days' => $days, 'date' => $m['due'], 'label' => $label, 'cost' => '' );
					} elseif ( $days >= 0 && $days <= $remind ) {
						$items[] = array( 'key' => 'ms:' . $coll . ':' . $r['id'] . ':' . $m['id'] . ':due', 'title' => $title, 'kind' => 'due', 'days' => $days, 'date' => $m['due'], 'label' => $label, 'cost' => '' );
					}
				}
			}
		}
		return $items;
	}

	/**
	 * Send the digest. $force ignores the repeat interval (used by the "send now" button).
	 * @return int number of items included
	 */
	public static function run( $force = false ) {
		$force  = ( true === $force );
		if ( ! $force ) {
			self::purge_trash();
		}
		$repeat = max( 1, (int) get_option( 'rl_repeat_days', 7 ) );
		$sent   = get_option( 'rl_notified', array() );
		if ( ! is_array( $sent ) ) {
			$sent = array();
		}
		$today = wp_date( 'Y-m-d' );
		$send  = array();
		foreach ( self::collect() as $it ) {
			$last = isset( $sent[ $it['key'] ] ) ? $sent[ $it['key'] ] : '';
			if ( $force ) {
				$send[] = $it;
			} elseif ( '' === $last ) {
				$send[] = $it;
			} elseif ( 'expired' !== $it['kind'] ) {
				$since = self::days_until( $last );
				if ( null !== $since && -$since >= $repeat ) {
					$send[] = $it;
				}
			}
		}
		if ( ! $send ) {
			return 0;
		}

		usort( $send, function ( $a, $b ) {
			return $a['days'] <=> $b['days'];
		} );
		$default = array_filter( array_map( 'trim', explode( ',', (string) get_option( 'rl_recipients', '' ) ) ) );
		if ( ! $default ) {
			$default = array( get_option( 'admin_email' ) );
		}
		// Items go to the e-mail addresses of their own record; records without addresses use the default recipients.
		$groups = array();
		foreach ( $send as $it ) {
			$to  = ! empty( $it['to'] ) ? $it['to'] : $default;
			$set = array_values( array_unique( array_map( 'strtolower', $to ) ) );
			sort( $set );
			$key = implode( ',', $set );
			if ( ! isset( $groups[ $key ] ) ) {
				$groups[ $key ] = array( 'to' => $to, 'items' => array() );
			}
			$groups[ $key ]['items'][] = $it;
		}
		$site = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$url  = get_option( 'rl_app_url', '' );
		$ok   = false;
		$done = array();
		foreach ( $groups as $g ) {
			$lines = array();
			foreach ( $g['items'] as $it ) {
				$when    = $it['days'] < 0 ? 'πριν από ' . abs( $it['days'] ) . ' ημ.' : ( 0 === $it['days'] ? 'σήμερα' : 'σε ' . $it['days'] . ' ημ.' );
				$lines[] = '- ' . $it['title'] . ' [' . $it['label'] . ']: ' . self::fmt( $it['date'] ) . ' (' . $when . ')' . ( '' === $it['cost'] ? '' : ', κόστος ' . self::money( $it['cost'] ) );
			}
			$body = "Οι παρακάτω εγγραφές χρειάζονται ενέργεια:\n\n" . implode( "\n", $lines ) . "\n" . ( $url ? "\nΑνοίξτε το Renewal Ledger: " . $url . "\n" : '' );
			if ( wp_mail( $g['to'], '[' . $site . '] Renewal Ledger: ' . count( $g['items'] ) . ' εγγραφές χρειάζονται προσοχή', $body, array( 'Content-Type: text/plain; charset=UTF-8' ) ) ) {
				$ok   = true;
				$done = array_merge( $done, $g['items'] );
			}
		}
		if ( $ok && ! $force ) {
			foreach ( $done as $it ) {
				$sent[ $it['key'] ] = $today;
			}
			update_option( 'rl_notified', $sent, false );
		}
		return count( $done );
	}
}
