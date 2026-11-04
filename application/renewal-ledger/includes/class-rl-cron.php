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
		$items = array();

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
		return $items;
	}

	/**
	 * Send the digest. $force ignores the repeat interval (used by the "send now" button).
	 * @return int number of items included
	 */
	public static function run( $force = false ) {
		$force  = ( true === $force );
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
		$lines = array();
		foreach ( $send as $it ) {
			$when    = $it['days'] < 0 ? 'πριν από ' . abs( $it['days'] ) . ' ημ.' : ( 0 === $it['days'] ? 'σήμερα' : 'σε ' . $it['days'] . ' ημ.' );
			$lines[] = '- ' . $it['title'] . ' [' . $it['label'] . ']: ' . self::fmt( $it['date'] ) . ' (' . $when . '), κόστος ' . self::money( $it['cost'] );
		}
		$site = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$url  = get_option( 'rl_app_url', '' );
		$body = "Οι παρακάτω εγγραφές χρειάζονται ενέργεια:\n\n" . implode( "\n", $lines ) . "\n" . ( $url ? "\nΑνοίξτε το Renewal Ledger: " . $url . "\n" : '' );

		$to = array_filter( array_map( 'trim', explode( ',', (string) get_option( 'rl_recipients', '' ) ) ) );
		if ( ! $to ) {
			$to = array( get_option( 'admin_email' ) );
		}
		$ok = wp_mail( $to, '[' . $site . '] Renewal Ledger: ' . count( $send ) . ' εγγραφές χρειάζονται προσοχή', $body, array( 'Content-Type: text/plain; charset=UTF-8' ) );
		if ( $ok && ! $force ) {
			foreach ( $send as $it ) {
				$sent[ $it['key'] ] = $today;
			}
			update_option( 'rl_notified', $sent, false );
		}
		return $ok ? count( $send ) : 0;
	}
}
