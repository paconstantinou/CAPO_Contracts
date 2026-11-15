<?php
/**
 * Checks the CONTENT of an upload, not only its extension (v3.14.0).
 *
 *  1. Magic bytes: files with a well-known binary format must really start like that format
 *     (a ".pdf" that is not a PDF is refused). Programs / scripts (Windows PE, ELF, Mach-O, shebang scripts, PHP) are refused
 *     whatever the extension says.
 *  2. Optional antivirus: when RL_CLAMSCAN_BIN is defined in wp-config.php (path of clamscan or clamdscan), the file is scanned
 *     before it is stored. Exit code 0 = clean, 1 = infected (refused), anything else = scanner problem (refused, fail closed,
 *     unless RL_CLAMSCAN_FAIL_OPEN is true). The "rl_av_scan" filter lets another scanner replace this.
 */
defined( 'ABSPATH' ) || exit;

final class RL_Upload_Guard {

	/** extension => list of allowed starting byte strings (hex). Only formats with a fixed signature. */
	private static function signatures() {
		$zip = array( '504b0304', '504b0506', '504b0708' );
		return array(
			'pdf'  => array( '25504446' ),
			'png'  => array( '89504e470d0a1a0a' ),
			'jpg'  => array( 'ffd8ff' ),
			'jpeg' => array( 'ffd8ff' ),
			'gif'  => array( '474946383761', '474946383961' ),
			'bmp'  => array( '424d' ),
			'docx' => $zip,
			'xlsx' => $zip,
			'pptx' => $zip,
			'odt'  => $zip,
			'ods'  => $zip,
			'odp'  => $zip,
			'zip'  => $zip,
			'7z'   => array( '377abcaf271c' ),
			'rar'  => array( '526172211a07' ),
			'gz'   => array( '1f8b' ),
			'rtf'  => array( '7b5c7274' ),
		);
	}

	/** Program / script signatures that are never an acceptable attachment. */
	private static function dangerous( $head ) {
		$h = bin2hex( substr( $head, 0, 4 ) );
		if ( 0 === strpos( $h, '4d5a' ) ) { // MZ: Windows exe / dll
			return 'Windows program';
		}
		if ( '7f454c46' === $h ) { // ELF
			return 'Linux program';
		}
		if ( in_array( $h, array( 'cafebabe', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe' ), true ) ) {
			return 'program';
		}
		$t = ltrim( substr( $head, 0, 16 ) );
		if ( 0 === strpos( $t, '#!' ) ) {
			return 'script';
		}
		if ( 0 === stripos( $t, '<?php' ) ) {
			return 'PHP script';
		}
		return '';
	}

	/** @return true|WP_Error */
	public static function check( $tmp, $name ) {
		$fh = @fopen( $tmp, 'rb' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		if ( ! $fh ) {
			return new WP_Error( 'rl_no_file', 'Upload failed', array( 'status' => 400 ) );
		}
		$head = (string) fread( $fh, 32 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fread
		fclose( $fh ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		$bad = self::dangerous( $head );
		if ( '' !== $bad ) {
			return new WP_Error( 'rl_bad_content', 'The file is a ' . $bad . ', not a document.', array( 'status' => 415 ) );
		}
		$ext = strtolower( pathinfo( (string) $name, PATHINFO_EXTENSION ) );
		$sig = self::signatures();
		if ( isset( $sig[ $ext ] ) ) {
			$hex = bin2hex( $head );
			$ok  = false;
			foreach ( $sig[ $ext ] as $s ) {
				if ( 0 === strpos( $hex, $s ) ) {
					$ok = true;
					break;
				}
			}
			if ( ! $ok ) {
				return new WP_Error( 'rl_bad_content', 'The content of the file does not match its type (.' . $ext . ').', array( 'status' => 415 ) );
			}
		}
		return self::scan( $tmp );
	}

	/** @return true|WP_Error */
	public static function scan( $tmp ) {
		$pre = apply_filters( 'rl_av_scan', null, $tmp );
		if ( null !== $pre ) {
			return true === $pre ? true : ( is_wp_error( $pre ) ? $pre : new WP_Error( 'rl_infected', 'The file was refused by the antivirus scan.', array( 'status' => 422 ) ) );
		}
		if ( ! defined( 'RL_CLAMSCAN_BIN' ) || '' === (string) RL_CLAMSCAN_BIN ) {
			return true;
		}
		$fail_open = defined( 'RL_CLAMSCAN_FAIL_OPEN' ) && RL_CLAMSCAN_FAIL_OPEN;
		$err       = function () use ( $fail_open ) {
			return $fail_open ? true : new WP_Error( 'rl_av_unavailable', 'The antivirus scan could not be completed, so the file was not stored.', array( 'status' => 503 ) );
		};
		if ( ! function_exists( 'proc_open' ) || ! is_executable( RL_CLAMSCAN_BIN ) ) {
			error_log( 'PROCURE360: RL_CLAMSCAN_BIN is not executable or proc_open is disabled' );
			return $err();
		}
		// Argument array, no shell: the file name cannot inject anything.
		$p = @proc_open( array( RL_CLAMSCAN_BIN, '--no-summary', $tmp ), array( 1 => array( 'pipe', 'w' ), 2 => array( 'pipe', 'w' ) ), $pipes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		if ( ! is_resource( $p ) ) {
			return $err();
		}
		stream_get_contents( $pipes[1] );
		stream_get_contents( $pipes[2] );
		fclose( $pipes[1] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		fclose( $pipes[2] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		$code = proc_close( $p );
		if ( 0 === $code ) {
			return true;
		}
		if ( 1 === $code ) {
			return new WP_Error( 'rl_infected', 'The file was refused by the antivirus scan.', array( 'status' => 422 ) );
		}
		error_log( 'PROCURE360: antivirus scanner exit code ' . $code );
		return $err();
	}
}
