<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Server-side export (CSV and XLSX). The export permission is checked by the REST route,
 * and the file is built here from what the current user is allowed to see.
 */
class RL_Export {

	public static function can_xlsx() {
		return class_exists( 'ZipArchive' );
	}

	/** Cells that start with = + - @ would run as formulas in Excel. */
	private static function safe( $v ) {
		if ( is_string( $v ) && '' !== $v && in_array( $v[0], array( '=', '+', '-', '@', "\t", "\r" ), true ) ) {
			return "'" . $v;
		}
		return $v;
	}

	private static function status_software( $d ) {
		$days = RL_Cron::days_until( isset( $d['dateTo'] ) ? $d['dateTo'] : '' );
		if ( null === $days ) {
			return 'No date';
		}
		if ( $days < 0 ) {
			return 'Expired';
		}
		return $days <= ( ! empty( $d['remindDays'] ) ? (int) $d['remindDays'] : 30 ) ? 'Due soon' : 'Active';
	}

	private static function status_contract( $d ) {
		$end = RL_Cron::days_until( isset( $d['dateTo'] ) ? $d['dateTo'] : '' );
		if ( null === $end ) {
			return 'Χωρίς ημερομηνία';
		}
		if ( $end < 0 ) {
			return 'Έληξε';
		}
		foreach ( ( isset( $d['years'] ) && is_array( $d['years'] ) ) ? $d['years'] : array() as $y ) {
			$days = RL_Cron::days_until( isset( $y['to'] ) ? $y['to'] : '' );
			if ( null !== $days && $days >= 0 && $days <= ( ! empty( $y['remind'] ) ? (int) $y['remind'] : 30 ) ) {
				return 'Λήγει σύντομα';
			}
		}
		return 'Σε ισχύ';
	}

	/** Per contractor id: { active: number of active contracts, tenders: distinct tender numbers of those contracts }. Active = in force or expiring soon. */
	public static function contractor_stats() {
		$out = array();
		foreach ( RL_DB::list_records( 'contracts' ) as $r ) {
			$d  = $r['data'];
			$id = isset( $d['contractorId'] ) ? (string) $d['contractorId'] : '';
			if ( '' === $id ) {
				continue;
			}
			if ( ! isset( $out[ $id ] ) ) {
				$out[ $id ] = array( 'active' => 0, 'tenders' => array() );
			}
			$st = self::status_contract( $d );
			if ( 'Σε ισχύ' !== $st && 'Λήγει σύντομα' !== $st ) {
				continue;
			}
			$out[ $id ]['active']++;
			$k = RL_DB::tender_key( isset( $d['tender'] ) ? $d['tender'] : '' );
			if ( '' !== $k ) {
				$out[ $id ]['tenders'][ $k ] = trim( (string) $d['tender'] );
			}
		}
		return $out;
	}

	/** One cell: "Έτος 1: description - due (30d) [done]; ..." */
	private static function milestones( $d ) {
		$out = array();
		foreach ( ( isset( $d['milestones'] ) && is_array( $d['milestones'] ) ) ? $d['milestones'] : array() as $m ) {
			if ( ! is_array( $m ) ) {
				continue;
			}
			$due   = isset( $m['due'] ) && preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $m['due'], $x ) ? $x[3] . '/' . $x[2] . '/' . $x[1] : '-';
			$out[] = 'Έτος ' . ( isset( $m['year'] ) ? (int) $m['year'] : 1 ) . ': ' . self::g( $m, 'description' ) . ' - ' . $due . ' (' . ( isset( $m['remind'] ) ? (int) $m['remind'] : 30 ) . 'd)' . ( ! empty( $m['done'] ) ? ' [done]' : '' );
		}
		return implode( '; ', $out );
	}

	private static function budget( $d ) {
		$out = array();
		foreach ( ( isset( $d['budget'] ) && is_array( $d['budget'] ) ) ? $d['budget'] : array() as $p ) {
			$out[] = 'Έτος ' . (int) $p['year'] . ': ' . number_format( (float) $p['amount'], 2, '.', '' ) . ( ! empty( $p['article'] ) ? ' [' . RL_Settings::article_label( $p['article'] ) . ']' : '' );
		}
		return implode( '; ', $out );
	}

	private static function names( $d ) {
		$n = array();
		foreach ( ( isset( $d['attachments'] ) && is_array( $d['attachments'] ) ) ? $d['attachments'] : array() as $a ) {
			if ( ! empty( $a['name'] ) ) {
				$n[] = $a['name'];
			}
		}
		return implode( '; ', $n );
	}

	/**
	 * @param string $collection software|contracts
	 * @param bool   $with_credentials include usernames (software only)
	 * @return array [ header[], rows[][] ]
	 */
	public static function table( $collection, $with_credentials ) {
		$items = RL_DB::list_records( $collection );
		usort( $items, function ( $a, $b ) {
			return strcmp( isset( $a['data']['dateTo'] ) ? $a['data']['dateTo'] : '', isset( $b['data']['dateTo'] ) ? $b['data']['dateTo'] : '' );
		} );

		if ( 'software' === $collection ) {
			$head = array( 'Software Name', 'Description', 'Vendor', 'Website' );
			if ( $with_credentials ) {
				$head[] = 'Username';
			}
			$head = array_merge( $head, array( 'Date From', 'Date To', 'Cost excl. VAT (€)', 'Reminder (days before)', 'Notification emails', 'Cost breakdown', 'Attachments', 'Milestones', 'Status' ) );
			$rows = array();
			foreach ( $items as $it ) {
				$d   = $it['data'];
				$row = array( self::g( $d, 'name' ), self::g( $d, 'description' ), self::g( $d, 'vendor' ), self::g( $d, 'website' ) );
				if ( $with_credentials ) {
					$row[] = self::g( $d, 'username' );
				}
				$row[] = self::g( $d, 'dateFrom' );
				$row[] = self::g( $d, 'dateTo' );
				$row[] = isset( $d['cost'] ) ? (float) $d['cost'] : 0;
				$row[] = isset( $d['remindDays'] ) ? (int) $d['remindDays'] : 30;
				$row[] = self::g( $d, 'emails' );
				$row[] = self::budget( $d );
				$row[] = self::names( $d );
				$row[] = self::milestones( $d );
				$row[] = self::status_software( $d );
				$rows[] = $row;
			}
			return array( $head, $rows );
		}

		if ( 'contractors' === $collection ) {
			usort( $items, function ( $a, $b ) {
				return strcmp( self::g( $a['data'], 'name' ), self::g( $b['data'], 'name' ) );
			} );
			$stats = self::contractor_stats();
			$head  = array( 'ΟΝΟΜΑ', 'ΔΙΕΥΘΥΝΣΗ', 'ΔΙΕΥΘΥΝΣΗ (ΣΥΝΕΧΕΙΑ)', 'Τ.Κ.', 'ΠΟΛΗ', 'ΧΩΡΑ', 'ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ', 'EMAIL', 'ΤΗΛΕΦΩΝΟ', 'ΕΝΕΡΓΕΣ ΣΥΜΒΑΣΕΙΣ', 'ΑΡ. ΔΙΑΓΩΝΙΣΜΟΥ ΕΝΕΡΓΩΝ ΣΥΜΒΑΣΕΩΝ' );
			$rows  = array();
			foreach ( $items as $it ) {
				$d      = $it['data'];
				$s      = isset( $stats[ $it['id'] ] ) ? $stats[ $it['id'] ] : array( 'active' => 0, 'tenders' => array() );
				$rows[] = array( self::g( $d, 'name' ), self::g( $d, 'address' ), self::g( $d, 'address2' ), self::g( $d, 'postal' ), self::g( $d, 'city' ), self::g( $d, 'country' ), self::g( $d, 'contact' ), self::g( $d, 'email' ), self::g( $d, 'phone' ), (int) $s['active'], implode( ', ', array_values( $s['tenders'] ) ) );
			}
			return array( $head, $rows );
		}

		if ( 'tenders' === $collection ) {
			$max = 1;
			foreach ( $items as $it ) {
				$max = max( $max, isset( $it['data']['years'] ) && is_array( $it['data']['years'] ) ? count( $it['data']['years'] ) : 0 );
			}
			$head = array( 'ΟΝΟΜΑ ΔΙΑΓΩΝΙΣΜΟΥ', 'ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ', 'ΠΕΡΙΓΡΑΦΗ', 'ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)', 'ΕΚΤΙΜ. ΗΜΕΡ. ΕΝΑΡΞΗΣ', 'ΕΚΤΙΜ. ΗΜΕΡ. ΛΗΞΗΣ', 'ΕΚΤΙΜΩΜΕΝΟ ΚΟΣΤΟΣ' );
			for ( $i = 1; $i <= $max; $i++ ) {
				array_push( $head, "ΕΤΟΣ $i - ΗΜΕΡ.ΕΝΑΡΞΗΣ", "ΕΤΟΣ $i - ΗΜΕΡ.ΛΗΞΗΣ", "ΕΤΟΣ $i - ΚΟΣΤΟΣ" );
			}
			array_push( $head, 'ΣΥΝΗΜΜΕΝΑ', 'ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ', 'ΚΑΤΑΣΤΑΣΗ' );
			$labels = array( 'active' => 'Ενεργός', 'cancelled' => 'Ακυρώθηκε', 'promoted' => 'Προωθήθηκε σε Σύμβαση' );
			$rows   = array();
			foreach ( $items as $it ) {
				$d   = $it['data'];
				$row = array( self::g( $d, 'title' ), self::g( $d, 'tender' ), self::g( $d, 'description' ), isset( $d['months'] ) ? (int) $d['months'] : 0, self::g( $d, 'dateFrom' ), self::g( $d, 'dateTo' ), isset( $d['cost'] ) ? (float) $d['cost'] : 0 );
				$ys  = ( isset( $d['years'] ) && is_array( $d['years'] ) ) ? array_values( $d['years'] ) : array();
				for ( $i = 0; $i < $max; $i++ ) {
					$y = isset( $ys[ $i ] ) ? $ys[ $i ] : array();
					array_push( $row, self::g( $y, 'from' ), self::g( $y, 'to' ), ( isset( $y['cost'] ) && is_numeric( $y['cost'] ) ) ? (float) $y['cost'] : '' );
				}
				$st     = isset( $d['status'] ) ? $d['status'] : 'active';
				$row[]  = self::names( $d );
				$row[]  = self::budget( $d );
				$row[]  = isset( $labels[ $st ] ) ? $labels[ $st ] : $st;
				$rows[] = $row;
			}
			return array( $head, $rows );
		}

		$max = 1;
		foreach ( $items as $it ) {
			$max = max( $max, isset( $it['data']['years'] ) && is_array( $it['data']['years'] ) ? count( $it['data']['years'] ) : 0 );
		}
		$head = array( 'ΣΥΜΒΑΣΗ', 'ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ', 'ΠΕΡΙΓΡΑΦΗ', 'ΑΝΑΔΟΧΟΣ', 'ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ', 'ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ)', 'ΗΜΕΡ. ΕΝΑΡΞΗΣ', 'ΗΜΕΡ. ΛΗΞΗΣ', 'ΚΟΣΤΟΣ' );
		for ( $i = 1; $i <= $max; $i++ ) {
			array_push( $head, "ΕΤΟΣ $i - ΗΜΕΡ.ΕΝΑΡΞΗΣ", "ΕΤΟΣ $i - ΗΜΕΡ.ΛΗΞΗΣ", "ΕΤΟΣ $i - ΚΟΣΤΟΣ", "ΕΤΟΣ $i - ΥΠΕΝΘΥΜΙΣΗ (ΗΜΕΡΕΣ ΠΡΙΝ)" );
		}
		array_push( $head, 'ΣΥΝΗΜΜΕΝΑ', 'EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ', 'ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ', 'MILESTONES', 'ΚΑΤΑΣΤΑΣΗ', 'ΑΦΜ ΑΝΑΔΟΧΟΥ', 'ΔΙΕΥΘΥΝΣΗ ΑΝΑΔΟΧΟΥ', 'ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ ΑΝΑΔΟΧΟΥ', 'ΤΗΛΕΦΩΝΟ ΑΝΑΔΟΧΟΥ', 'EMAIL ΑΝΑΔΟΧΟΥ', 'ΑΝΤΙΠΡΟΣΩΠΟΣ ΑΝΑΔΟΧΟΥ (ΣΥΜΒΑΣΗΣ)', 'ΤΗΛΕΦΩΝΟ ΑΝΤΙΠΡΟΣΩΠΟΥ', 'EMAIL ΑΝΤΙΠΡΟΣΩΠΟΥ' );
		$cmap = array();
		foreach ( RL_DB::list_records( 'contractors' ) as $cr ) {
			$cmap[ $cr['id'] ] = $cr['data'];
		}
		$rows = array();
		foreach ( $items as $it ) {
			$d   = $it['data'];
			$row = array( self::g( $d, 'title' ), self::g( $d, 'tender' ), self::g( $d, 'description' ), self::g( $d, 'contractor' ), self::g( $d, 'coordinator' ), isset( $d['months'] ) ? (int) $d['months'] : 0, self::g( $d, 'dateFrom' ), self::g( $d, 'dateTo' ), isset( $d['cost'] ) ? (float) $d['cost'] : 0 );
			$ys  = ( isset( $d['years'] ) && is_array( $d['years'] ) ) ? array_values( $d['years'] ) : array();
			for ( $i = 0; $i < $max; $i++ ) {
				$y = isset( $ys[ $i ] ) ? $ys[ $i ] : array();
				array_push( $row, self::g( $y, 'from' ), self::g( $y, 'to' ), ( isset( $y['cost'] ) && is_numeric( $y['cost'] ) ) ? (float) $y['cost'] : '', isset( $y['remind'] ) ? (int) $y['remind'] : '' );
			}
			$row[]  = self::names( $d );
			$row[]  = self::g( $d, 'emails' );
			$row[]  = self::budget( $d );
			$row[]  = self::milestones( $d );
			$row[]  = self::status_contract( $d );
			$cid = self::g( $d, 'contractorId' );
			if ( '' !== $cid && isset( $cmap[ $cid ] ) ) {
				$c = $cmap[ $cid ];
				$addr = trim( implode( ', ', array_filter( array( self::g( $c, 'address' ), self::g( $c, 'address2' ), trim( self::g( $c, 'postal' ) . ' ' . self::g( $c, 'city' ) ), self::g( $c, 'country' ) ) ) ) );
				array_push( $row, '', $addr, self::g( $c, 'contact' ), self::g( $c, 'phone' ), self::g( $c, 'email' ) );
			} else {
				foreach ( array( 'contractorVat', 'contractorAddress', 'contractorContact', 'contractorPhone', 'contractorEmail' ) as $k ) {
					$row[] = self::g( $d, $k );
				}
			}
			array_push( $row, self::g( $d, 'repName' ), self::g( $d, 'repPhone' ), self::g( $d, 'repEmail' ) );
			$rows[] = $row;
		}
		return array( $head, $rows );
	}

	private static function g( $d, $k ) {
		return ( isset( $d[ $k ] ) && is_scalar( $d[ $k ] ) ) ? (string) $d[ $k ] : '';
	}

	/* ---------- writers ---------- */

	public static function csv( array $head, array $rows ) {
		$q = function ( $v ) {
			$v = is_string( $v ) ? self::safe( $v ) : (string) $v;
			return preg_match( '/[",\r\n;]/', $v ) ? '"' . str_replace( '"', '""', $v ) . '"' : $v;
		};
		$lines = array( implode( ',', array_map( $q, $head ) ) );
		foreach ( $rows as $r ) {
			$lines[] = implode( ',', array_map( $q, $r ) );
		}
		return "\xEF\xBB\xBF" . implode( "\r\n", $lines ) . "\r\n";
	}

	private static function col( $n ) {
		$s = '';
		for ( $n++; $n > 0; $n = intdiv( $n - 1, 26 ) ) {
			$s = chr( 65 + ( $n - 1 ) % 26 ) . $s;
		}
		return $s;
	}

	private static function xml( $s ) {
		$s = preg_replace( '/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', '', (string) $s );
		return htmlspecialchars( (string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8' );
	}

	/** @return string|false path of a temporary .xlsx file (caller deletes it) */
	public static function xlsx( $sheet, array $head, array $rows ) {
		if ( ! self::can_xlsx() ) {
			return false;
		}
		if ( ! function_exists( 'wp_tempnam' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		$path = wp_tempnam( 'rl-export' );
		$zip  = new ZipArchive();
		if ( true !== $zip->open( $path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			return false;
		}
		$sheetData = '';
		foreach ( array_merge( array( $head ), $rows ) as $ri => $row ) {
			$sheetData .= '<row r="' . ( $ri + 1 ) . '">';
			foreach ( array_values( $row ) as $ci => $v ) {
				$ref = self::col( $ci ) . ( $ri + 1 );
				if ( '' === $v || null === $v ) {
					continue;
				}
				if ( is_int( $v ) || is_float( $v ) ) {
					$sheetData .= '<c r="' . $ref . '"><v>' . $v . '</v></c>';
				} else {
					$sheetData .= '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' . self::xml( self::safe( (string) $v ) ) . '</t></is></c>';
				}
			}
			$sheetData .= '</row>';
		}
		$zip->addFromString( '[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' );
		$zip->addFromString( '_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' );
		$zip->addFromString( 'xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' . self::xml( $sheet ) . '" sheetId="1" r:id="rId1"/></sheets></workbook>' );
		$zip->addFromString( 'xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' );
		$zip->addFromString( 'xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' . $sheetData . '</sheetData></worksheet>' );
		$zip->close();
		return $path;
	}
}
