<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Automatic tenders (3.20.0). Every year from 5 January, each contract that ends in the current year +1, +2 or +3 gets a tender in status
 * "pending" (Pending Approval), linked to the contract. The first request / daily cron run on or after 5 January does the work once
 * per year; contracts that already have a related tender (manual or automatic) are skipped, so repeating it never creates duplicates.
 * The same rules exist in the standalone app (atPlan() in app.js).
 */
class RL_Auto {

	const OPT = 'rl_auto_tn_year';
	/** Factor of the estimated cost: contract amounts + the increase set in the settings (default +10%: 100,000 becomes 110,000). */
	public static function factor() {
		$st = RL_Settings::app_settings();
		return 1 + ( isset( $st['autoPct'] ) ? (float) $st['autoPct'] : 10 ) / 100;
	}

	public static function init() {
		add_action( 'init', array( __CLASS__, 'maybe_run' ), 30 );
		add_action( RL_Cron::HOOK, array( __CLASS__, 'maybe_run' ), 20 );
	}

	public static function maybe_run() {
		$today = wp_date( 'Y-m-d' );
		$y     = substr( $today, 0, 4 );
		if ( $today < $y . '-01-05' || get_option( self::OPT ) === $y ) {
			return;
		}
		// Only one request may do the yearly run (add_option fails when the lock exists).
		$lock = self::OPT . '_lock_' . $y;
		if ( ! add_option( $lock, time(), '', false ) ) {
			if ( time() - (int) get_option( $lock ) < 600 ) {
				return;
			}
			update_option( $lock, time(), false );
		}
		$made = self::run( $today, 0 );
		update_option( self::OPT, $y, false );
		delete_option( $lock );
		if ( $made && function_exists( 'am_log' ) ) {
			am_log( 'ledger.tenders_auto_created', 'tenders', array( 'count' => count( $made ), 'year' => $y ) );
		}
	}

	/** Total cost of a contract with its additional services (no VAT). */
	public static function total( $c ) {
		$n = isset( $c['years'] ) && is_array( $c['years'] ) ? count( $c['years'] ) : 0;
		return round( ( isset( $c['cost'] ) ? (float) $c['cost'] : 0 ) + RL_DB::extras_sum( $c ) * $n, 2 );
	}

	private static function add_months( $iso, $k ) {
		$d = DateTime::createFromFormat( '!Y-m-d', $iso );
		if ( ! $d ) {
			return '';
		}
		$day = (int) $d->format( 'j' );
		$d->setDate( (int) $d->format( 'Y' ), (int) $d->format( 'n' ) + $k, 1 );
		$d->setDate( (int) $d->format( 'Y' ), (int) $d->format( 'n' ), min( $day, (int) $d->format( 't' ) ) );
		return $d->format( 'Y-m-d' );
	}

	private static function add_days( $iso, $k ) {
		$d = DateTime::createFromFormat( '!Y-m-d', $iso );
		return $d ? $d->modify( ( $k >= 0 ? '+' : '' ) . $k . ' day' )->format( 'Y-m-d' ) : '';
	}

	/** Same year split as the app: whole years of the duration (min. 1), the extra months go to year 1; the last year ends on the computed end date. */
	public static function years( $from, $months ) {
		$m = (int) round( $months );
		if ( ! $from || $m <= 0 ) {
			return array();
		}
		$n     = max( 1, (int) floor( $m / 12 ) );
		$first = $m < 12 ? $m : 12 + ( $m % 12 );
		$out   = array();
		$s     = $from;
		for ( $i = 0; $i < $n; $i++ ) {
			$len   = 0 === $i ? $first : 12;
			$e     = self::add_days( self::add_months( $s, $len ), -1 );
			$out[] = array( 'from' => $s, 'to' => $e, 'cost' => '' );
			$s     = self::add_days( $e, 1 );
		}
		$out[ count( $out ) - 1 ]['to'] = self::add_days( self::add_months( $from, $m ), -1 );
		return $out;
	}

	/** The tenders to create (data arrays, not yet saved). $contracts / $tenders: lists of record data. */
	public static function plan( $contracts, $tenders, $today ) {
		$f      = self::factor();
		$y      = (int) substr( $today, 0, 4 );
		$linked = array();
		foreach ( $tenders as $t ) {
			if ( ! empty( $t['data']['contractId'] ) ) {
				$linked[ $t['data']['contractId'] ] = true;
			}
		}
		$out = array();
		foreach ( $contracts as $row ) {
			$c  = $row['data'];
			$id = $row['id'];
			if ( ! empty( $c['archived'] ) || isset( $linked[ $id ] ) ) {
				continue;
			}
			$to = ! empty( $c['dateTo'] ) ? $c['dateTo'] : ( ! empty( $c['years'] ) ? end( $c['years'] )['to'] : '' );
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $to ) ) {
				continue;
			}
			$ty = (int) substr( $to, 0, 4 );
			$m  = (int) ( isset( $c['months'] ) ? $c['months'] : 0 );
			if ( $ty < $y + 1 || $ty > $y + 3 || $m <= 0 ) {
				continue;
			}
			$from  = self::add_days( $to, 1 );
			$years = self::years( $from, $m );
			$bud   = array();
			foreach ( isset( $c['budget'] ) && is_array( $c['budget'] ) ? $c['budget'] : array() as $p ) {
				if ( (int) $p['year'] >= 1 && (int) $p['year'] <= count( $years ) ) {
					$bud[] = array( 'year' => (int) $p['year'], 'article' => (string) $p['article'], 'amount' => round( (float) $p['amount'] * $f, 2 ) );
				}
			}
			foreach ( $years as $i => $yr ) {
				$cy = isset( $c['years'][ $i ]['cost'] ) ? $c['years'][ $i ]['cost'] : '';
				if ( '' !== $cy && null !== $cy ) {
					$years[ $i ]['cost'] = round( (float) $cy * $f, 2 );
				}
				$has = array_filter( $bud, function ( $p ) use ( $i ) { return (int) $p['year'] === $i + 1; } );
				if ( $has ) {
					$years[ $i ]['cost'] = round( array_sum( array_column( $has, 'amount' ) ), 2 );
				}
			}
			$out[ $ty . '-' . $id ] = array(
				'contract' => $id,
				'data'     => array(
					'title'       => $c['title'],
					'tender'      => '',
					'description' => isset( $c['description'] ) ? $c['description'] : '',
					'months'      => $m,
					'dateFrom'    => $from,
					'dateTo'      => $years ? $years[ count( $years ) - 1 ]['to'] : '',
					'cost'        => round( self::total( $c ) * $f, 2 ),
					'years'       => $years,
					'budget'      => $bud,
					'attachments' => array(),
					'status'      => 'pending',
					'statusAt'    => '',
					'promotedTo'  => '',
					'contractId'  => $id,
					'autoCreated' => true,
					'autoAt'      => $today,
					'amendments'  => array(),
				),
			);
		}
		ksort( $out );
		return array_values( $out );
	}

	/** Creates the planned tenders. @return string[] ids of the new tenders */
	public static function run( $today, $user_id = 0 ) {
		$contracts = RL_DB::list_records( 'contracts' );
		$plan      = self::plan( $contracts, RL_DB::list_records( 'tenders' ), $today );
		$ids       = array();
		$owners    = array(); // a planned tender belongs to the owner (coordinator) of its contract
		foreach ( $contracts as $c ) {
			$owners[ (string) $c['id'] ] = (int) $c['owner'];
		}
		foreach ( $plan as $p ) {
			$data = RL_DB::sanitize_record( 'tenders', $p['data'] );
			if ( is_wp_error( $data ) ) {
				continue;
			}
			$id = substr( md5( uniqid( 'rl', true ) ), 0, 16 );
			$owner = isset( $owners[ (string) $p['contract'] ] ) ? $owners[ (string) $p['contract'] ] : 0;
			if ( true === RL_DB::save_record( 'tenders', $id, $data, $user_id, $owner ) ) {
				$ids[] = $id;
				if ( function_exists( 'am_log' ) ) {
					am_log( 'ledger.tender_auto_created', 'tenders', array( 'id' => $id, 'title' => $data['title'], 'contract' => $p['contract'] ) );
				}
			}
		}
		return $ids;
	}
}
