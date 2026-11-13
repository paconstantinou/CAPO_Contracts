<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Scheduled backup (3.13.0). Writes the same ZIP the Ρυθμίσεις page downloads (format 1:
 * manifest.json, data/<collection>.json, settings.json, articles.json, files/<id>) to a folder
 * chosen by an administrator, for example a mounted or UNC network path that the web server can write to.
 */
class RL_Backup {

	const HOOK    = 'rl_scheduled_backup';
	const OPTION  = 'rl_backup_schedule';
	const PREFIX  = 'PROCURE360-backup-';
	const MAX_LEN = 500;

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'cron' ) );
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 600, 'hourly', self::HOOK );
		}
	}

	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	/* ---------- settings ---------- */

	public static function defaults() {
		return array( 'enabled' => false, 'frequency' => 'weekly', 'path' => '', 'keep' => 8, 'lastRun' => '', 'lastOk' => false, 'lastMessage' => '', 'lastFile' => '' );
	}

	public static function get() {
		$raw = get_option( self::OPTION, array() );
		$raw = is_array( $raw ) ? $raw : array();
		$d   = self::defaults();
		$out = array_merge( $d, array_intersect_key( $raw, $d ) );
		$out['enabled']   = ! empty( $out['enabled'] );
		$out['frequency'] = 'monthly' === $out['frequency'] ? 'monthly' : 'weekly';
		$out['path']      = is_string( $out['path'] ) ? $out['path'] : '';
		$out['keep']      = max( 1, min( 100, (int) $out['keep'] ) );
		$out['lastOk']    = ! empty( $out['lastOk'] );
		return $out;
	}

	/** Settings plus the next planned run, for the screen. */
	public static function view() {
		$s         = self::get();
		$s['next'] = $s['enabled'] ? self::next_due( $s ) : '';
		return $s;
	}

	/** Validates the incoming settings; the path is checked for real (see check_path). @return array|WP_Error */
	public static function save( $in ) {
		$in  = is_array( $in ) ? $in : array();
		$cur = self::get();
		$new = $cur;
		$new['enabled']   = ! empty( $in['enabled'] );
		$new['frequency'] = isset( $in['frequency'] ) && 'monthly' === $in['frequency'] ? 'monthly' : 'weekly';
		$new['keep']      = isset( $in['keep'] ) && is_numeric( $in['keep'] ) ? max( 1, min( 100, (int) $in['keep'] ) ) : 8;
		$new['path']      = isset( $in['path'] ) ? trim( wp_strip_all_tags( (string) $in['path'] ) ) : '';
		if ( '' !== $new['path'] ) {
			$chk = self::check_path( $new['path'] );
			if ( is_wp_error( $chk ) ) {
				return $chk;
			}
		} elseif ( $new['enabled'] ) {
			return new WP_Error( 'rl_bad_path', 'Ορίστε τη διαδρομή του φακέλου για το προγραμματισμένο backup.', array( 'status' => 400 ) );
		}
		if ( $new['path'] !== $cur['path'] || $new['frequency'] !== $cur['frequency'] ) {
			$new['lastMessage'] = $cur['lastMessage'];
		}
		update_option( self::OPTION, $new, false );
		return self::view();
	}

	/**
	 * The folder must be an absolute path to an existing, writable directory, not a stream wrapper,
	 * and not inside the web site itself (a backup holds real data and must never be downloadable).
	 * @return true|WP_Error
	 */
	public static function check_path( $path ) {
		$bad = function ( $msg ) {
			return new WP_Error( 'rl_bad_path', $msg, array( 'status' => 400 ) );
		};
		if ( '' === $path || strlen( $path ) > self::MAX_LEN || false !== strpos( $path, "\0" ) ) {
			return $bad( 'Μη έγκυρη διαδρομή.' );
		}
		if ( preg_match( '#^[A-Za-z][A-Za-z0-9+.-]+://#', $path ) ) {
			return $bad( 'Επιτρέπονται μόνο διαδρομές φακέλου (π.χ. /mnt/backup ή \\\\server\\share\\backup), όχι διευθύνσεις με πρωτόκολλο.' );
		}
		$abs = preg_match( '#^([A-Za-z]:[\\\\/]|\\\\\\\\|//|/)#', $path );
		if ( ! $abs || preg_match( '#(^|[\\\\/])\.\.([\\\\/]|$)#', $path ) ) {
			return $bad( 'Δώσε πλήρη διαδρομή (χωρίς «..»).' );
		}
		if ( ! @is_dir( $path ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			return $bad( 'Ο φάκελος δεν βρέθηκε από τον server. Έλεγξε τη διαδρομή και ότι ο server έχει πρόσβαση στο δίκτυο.' );
		}
		if ( ! @is_writable( $path ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			return $bad( 'Ο server δεν έχει δικαίωμα εγγραφής στον φάκελο.' );
		}
		$real = realpath( $path );
		if ( false !== $real ) {
			$u     = wp_upload_dir();
			$roots = array_filter( array( realpath( ABSPATH ), realpath( $u['basedir'] ), realpath( WP_CONTENT_DIR ) ) );
			foreach ( $roots as $r ) {
				$r  = rtrim( str_replace( '\\', '/', $r ), '/' ) . '/';
				$rp = rtrim( str_replace( '\\', '/', $real ), '/' ) . '/';
				if ( 0 === stripos( $rp, $r ) ) {
					return $bad( 'Ο φάκελος είναι μέσα στο site (WordPress). Διάλεξε φάκελο εκτός του site, ώστε το backup να μην είναι προσβάσιμο από το web.' );
				}
			}
		}
		return true;
	}

	/* ---------- when ---------- */

	/** Local time (site zone) of the next run as ISO 8601, or '' when it never ran (then: as soon as the next hourly check). */
	public static function next_due( $s = null ) {
		$s = $s ? $s : self::get();
		if ( '' === $s['lastRun'] ) {
			return '';
		}
		try {
			$last = new DateTimeImmutable( $s['lastRun'] );
		} catch ( Exception $e ) {
			return '';
		}
		$next = $last->modify( 'monthly' === $s['frequency'] ? '+1 month' : '+7 days' );
		return $next->setTimezone( wp_timezone() )->format( 'c' );
	}

	public static function is_due( $s = null, $now = null ) {
		$s = $s ? $s : self::get();
		if ( ! $s['enabled'] || '' === $s['path'] ) {
			return false;
		}
		$nd = self::next_due( $s );
		if ( '' === $nd ) {
			return true;
		}
		$now = $now ? $now : time();
		return strtotime( $nd ) <= $now;
	}

	/** Hourly check. A failed run is retried at the next check, an hour later, but reported only once per day. */
	public static function cron() {
		$s = self::get();
		if ( self::is_due( $s ) ) {
			self::run( 'schedule' );
		}
	}

	/* ---------- the backup itself ---------- */

	private static function attachments( array $rec ) {
		$a = isset( $rec['attachments'] ) && is_array( $rec['attachments'] ) ? $rec['attachments'] : array();
		foreach ( isset( $rec['milestones'] ) && is_array( $rec['milestones'] ) ? $rec['milestones'] : array() as $m ) {
			if ( is_array( $m ) && ! empty( $m['attachments'] ) && is_array( $m['attachments'] ) ) {
				foreach ( $m['attachments'] as $x ) {
					$a[] = $x;
				}
			}
		}
		return $a;
	}

	/**
	 * Builds the ZIP at $zip_path. @return array|WP_Error { counts, files, missing }
	 */
	public static function build_zip( $zip_path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return new WP_Error( 'rl_no_zip', 'Η επέκταση PHP «zip» δεν είναι διαθέσιμη στον server.' );
		}
		$z = new ZipArchive();
		if ( true !== $z->open( $zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			return new WP_Error( 'rl_zip_open', 'Δεν δημιουργήθηκε το προσωρινό αρχείο ZIP.' );
		}
		$counts  = array();
		$files   = array();
		$missing = array();
		$seen    = array();
		foreach ( RL_Settings::CF_COLLECTIONS as $c ) {
			$list = array();
			foreach ( RL_DB::list_records( $c ) as $r ) {
				$rec    = array_merge( $r['data'], array( 'id' => $r['id'] ) );
				$list[] = $rec;
				foreach ( self::attachments( $rec ) as $a ) {
					if ( ! is_array( $a ) || empty( $a['id'] ) || isset( $seen[ $a['id'] ] ) ) {
						continue;
					}
					$seen[ $a['id'] ] = 1;
					$row              = RL_DB::get_file( (string) $a['id'] );
					$path             = $row ? RL_DB::dir() . '/' . $row['stored_name'] : '';
					if ( $row && is_file( $path ) && $z->addFile( $path, 'files/' . $a['id'] ) ) {
						$files[ $a['id'] ] = array( 'name' => (string) $row['orig_name'], 'size' => (int) $row['size'] );
					} else {
						$missing[] = isset( $a['name'] ) ? (string) $a['name'] : (string) $a['id'];
					}
				}
			}
			$counts[ $c ] = count( $list );
			$z->addFromString( 'data/' . $c . '.json', wp_json_encode( $list ) );
		}
		$z->addFromString( 'settings.json', wp_json_encode( RL_Settings::app_settings() ) );
		$z->addFromString( 'articles.json', wp_json_encode( RL_Settings::articles() ) );
		$z->addFromString(
			'manifest.json',
			wp_json_encode(
				array(
					'app'          => 'PROCURE360',
					'format'       => 1,
					'createdAt'    => gmdate( 'c' ),
					'counts'       => $counts,
					'files'        => (object) $files,
					'missingFiles' => $missing,
					'source'       => 'wordpress-scheduled',
				)
			)
		);
		if ( ! $z->close() ) {
			return new WP_Error( 'rl_zip_close', 'Δεν ολοκληρώθηκε η δημιουργία του ZIP (έλλειψη χώρου;).' );
		}
		return array( 'counts' => $counts, 'files' => count( $files ), 'missing' => $missing );
	}

	/** Backup files this plugin wrote in the folder, newest first. @return string[] file names */
	public static function list_backups( $dir ) {
		$out = array();
		foreach ( (array) @scandir( $dir ) as $f ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			if ( preg_match( '/^' . preg_quote( self::PREFIX, '/' ) . '\d{4}-\d{2}-\d{2}_\d{6}\.zip$/', $f ) ) {
				$out[] = $f;
			}
		}
		rsort( $out );
		return $out;
	}

	/**
	 * Makes a backup now and stores it in the configured folder.
	 * @param string $by 'schedule' or 'manual'
	 * @return array|WP_Error { file, counts, files, missing, removed }
	 */
	public static function run( $by = 'manual' ) {
		$s    = self::get();
		$res  = self::run_inner( $s );
		$upd  = self::get();
		$upd['lastRun'] = gmdate( 'c' );
		if ( is_wp_error( $res ) ) {
			$upd['lastOk']      = false;
			$upd['lastMessage'] = $res->get_error_message();
			$upd['lastFile']    = '';
		} else {
			$upd['lastOk']      = true;
			$upd['lastFile']    = $res['file'];
			$tot                = array_sum( $res['counts'] );
			$upd['lastMessage'] = sprintf( '%d εγγραφές, %d συνημμένα', $tot, $res['files'] ) . ( $res['missing'] ? sprintf( ' (λείπουν %d αρχεία)', count( $res['missing'] ) ) : '' ) . ( $res['removed'] ? sprintf( ', διαγράφηκαν %d παλιά backup', $res['removed'] ) : '' );
		}
		update_option( self::OPTION, $upd, false );
		if ( function_exists( 'am_log' ) ) {
			am_log( is_wp_error( $res ) ? 'backup_failed' : 'backup_created', 'settings', array( 'by' => $by, 'message' => $upd['lastMessage'] ) );
		}
		if ( is_wp_error( $res ) && 'schedule' === $by ) {
			self::notify_failure( $res->get_error_message() );
		}
		return $res;
	}

	private static function run_inner( array $s ) {
		if ( '' === $s['path'] ) {
			return new WP_Error( 'rl_bad_path', 'Δεν έχει οριστεί φάκελος για το backup.', array( 'status' => 400 ) );
		}
		$chk = self::check_path( $s['path'] );
		if ( is_wp_error( $chk ) ) {
			return $chk;
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 0 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		if ( ! function_exists( 'wp_tempnam' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		$tmp = wp_tempnam( 'rl-backup' );
		if ( ! $tmp ) {
			return new WP_Error( 'rl_tmp', 'Δεν δημιουργήθηκε προσωρινό αρχείο στον server.' );
		}
		$built = self::build_zip( $tmp );
		if ( is_wp_error( $built ) ) {
			@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
			return $built;
		}
		$dir   = rtrim( $s['path'], "/\\" );
		$name  = self::PREFIX . wp_date( 'Y-m-d_His' ) . '.zip';
		$final = $dir . DIRECTORY_SEPARATOR . $name;
		$part  = $final . '.part';
		$ok    = @copy( $tmp, $part ) && @rename( $part, $final ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
		if ( ! $ok || ! is_file( $final ) || filesize( $final ) < 22 ) {
			@unlink( $part ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
			return new WP_Error( 'rl_copy', 'Δεν γράφτηκε το αρχείο στον φάκελο (έλλειψη χώρου ή δικαιωμάτων;).' );
		}
		$removed = 0;
		foreach ( array_slice( self::list_backups( $dir ), $s['keep'] ) as $old ) {
			if ( @unlink( $dir . DIRECTORY_SEPARATOR . $old ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
				++$removed;
			}
		}
		return array( 'file' => $name, 'counts' => $built['counts'], 'files' => $built['files'], 'missing' => $built['missing'], 'removed' => $removed );
	}

	private static function notify_failure( $msg ) {
		if ( get_transient( 'rl_backup_failmail' ) ) {
			return;
		}
		set_transient( 'rl_backup_failmail', 1, DAY_IN_SECONDS );
		$to = RL_Cron::parse_emails( get_option( 'rl_recipients', '' ) );
		if ( ! $to ) {
			$to = array( get_option( 'admin_email' ) );
		}
		wp_mail( $to, 'PROCURE360: απέτυχε το προγραμματισμένο backup', "Το προγραμματισμένο backup δεν ολοκληρώθηκε.\n\n" . $msg . "\n\nΈλεγξε τη διαδρομή στις Ρυθμίσεις της εφαρμογής (καρτέλα ⚙ Ρυθμίσεις → Προγραμματισμένο backup)." );
	}
}
