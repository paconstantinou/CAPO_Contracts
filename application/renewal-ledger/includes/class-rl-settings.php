<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Settings > PROCURE360. Who may use the application is NOT decided here:
 * users, roles and permissions are managed only in the Application Management plugin.
 */
class RL_Settings {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_post_rl_send_now', array( __CLASS__, 'send_now' ) );
	}

	public static function menu() {
		add_options_page( 'PROCURE360', 'PROCURE360', 'manage_options', 'renewal-ledger', array( __CLASS__, 'page' ) );
	}

	public static function register() {
		register_setting(
			'rl_settings',
			'rl_recipients',
			array(
				'type'              => 'string',
				'sanitize_callback' => function ( $v ) {
					$list = array_filter( array_map( 'sanitize_email', array_map( 'trim', explode( ',', (string) $v ) ) ) );
					return implode( ', ', $list );
				},
				'default'           => '',
			)
		);
		register_setting(
			'rl_settings',
			'rl_budget_articles',
			array(
				'type'              => 'string',
				'sanitize_callback' => function ( $v ) {
					if ( is_array( $v ) ) { // rows from the table: code, desc, cat, catDesc, split
						$lines = array();
						foreach ( $v as $row ) {
							if ( ! is_array( $row ) ) {
								continue;
							}
							$g = function ( $k ) use ( $row ) {
								return isset( $row[ $k ] ) ? str_replace( array( '|', "\t", "\r", "\n" ), ' ', (string) $row[ $k ] ) : '';
							};
							$lines[] = implode( ' | ', array( $g( 'code' ), $g( 'desc' ), $g( 'cat' ), $g( 'catDesc' ), ! empty( $row['split'] ) && 'NAI' === $row['split'] ? 'ΝΑΙ' : 'ΌΧΙ' ) );
						}
						$v = implode( "\n", $lines );
					}
					$new = self::parse_articles( (string) $v );
					/* An article that records still use can not be removed or renamed: it is kept, so no amount loses its article by accident. */
					$have = array_column( $new, 'code' );
					$kept = array();
					foreach ( RL_DB::article_usage() as $code => $n ) {
						if ( ! in_array( (string) $code, $have, true ) ) {
							foreach ( self::articles() as $old ) {
								if ( (string) $old['code'] === (string) $code ) {
									$new[]  = $old;
									$kept[] = $code . ' (' . $n . ')';
								}
							}
						}
					}
					if ( $kept && function_exists( 'add_settings_error' ) ) {
						add_settings_error( 'rl_budget_articles', 'rl_art_kept', 'Τα άρθρα ' . implode( ', ', $kept ) . ' χρησιμοποιούνται σε εγγραφές και δεν διαγράφηκαν ούτε άλλαξαν κωδικό. Αν θέλεις να φύγουν, πρώτα άλλαξε το άρθρο στις εγγραφές που το χρησιμοποιούν.', 'warning' );
					}
					return self::serialize_articles( $new );
				},
				'default'           => self::default_articles_text(),
			)
		);
		register_setting(
			'rl_settings',
			'rl_repeat_days',
			array(
				'type'              => 'integer',
				'sanitize_callback' => function ( $v ) {
					return max( 1, min( 90, (int) $v ) );
				},
				'default'           => 7,
			)
		);
		register_setting(
			'rl_settings',
			'rl_trash_days',
			array(
				'type'              => 'integer',
				'sanitize_callback' => function ( $v ) {
					return max( 0, min( 3650, (int) $v ) );
				},
				'default'           => 30,
			)
		);
	}

	/** Days a deleted record stays in the trash before it is removed for good. 0 = never remove automatically. */
	public static function trash_days() {
		return max( 0, (int) get_option( 'rl_trash_days', 30 ) );
	}

	/** Default list of the organisation's budget articles: code | description | category | category description | split per year (ΝΑΙ/ΌΧΙ). */
	public static function default_articles_text() {
		return <<<'TXT'
03460 | Τηλεπικοινωνιακός, Μηχανογραφικός και Άλλος Εξοπλισμός | 03300 | ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ | ΝΑΙ
03461 | Συντήρηση Μηχανογραφικού Εξοπλισμού | 03300 | ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ | ΝΑΙ
03462 | Συντήρηση Τηλεπικοινωνιακού Εξοπλισμού | 03300 | ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ | ΝΑΙ
03466 | Συντήρηση Εξοπλισμού Γραφείου | 03300 | ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ | ΝΑΙ
03468 | Συντήρηση Άλλου Εξοπλισμού | 03300 | ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ | ΝΑΙ
03583 | Αγορά Υπηρεσιών | 03580 | ΣΥΜΒΑΣΗ ΥΠΗΡΕΣΙΩΝ | ΝΑΙ
07651 | Αγορά Μηχανολογικού και Ηλεκτρονικού Εξοπλισμού | 07650 | ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ | ΌΧΙ
07654 | Αγορά Εξοπλισμού Γραφείων | 07650 | ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ | ΌΧΙ
07655 | Αγορά Τηλεπικοινωνιακού Εξοπλισμού | 07650 | ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ | ΌΧΙ
07661 | Αγορά Ηλεκτρονικών Συστημάτων Ασφάλειας | 07650 | ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ | ΌΧΙ
07663 | Αγορά Συστημάτων Πυρασφάλειας | 07650 | ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ | ΌΧΙ
07681 | Αγορά Μηχανογραφικού Εξοπλισμού, Προγραμμάτων και Υπηρεσιών | 07650 | ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ | ΌΧΙ
07755 | Εφαρμογή του Προτύπου ISO 27002 | 07750 | ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ | ΌΧΙ
07758 | Δορυφορικές Εικόνες | 07750 | ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ | ΌΧΙ
07759 | Ανάπτυξη Συστήματος Διαχείρισης Μέτρων του Προγράμματος Αγροτικής Ανάπτυξης | 07750 | ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ | ΌΧΙ
07760 | Επανασχεδιασμός Ολοκληρωμένου Συστήματος Διαχείρισης και Ελέγχου (ΟΣΔΕ) | 07750 | ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ | ΌΧΙ
07761 | Ανάπτυξη Μηχανογραφικών Συστημάτων για την Νέα Κοινή Αγροτική Πολιτική (ΚΑΠ) | 07750 | ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ | ΌΧΙ
TXT;
	}

	/**
	 * Parse "code | description | category | category description | ΝΑΙ/ΌΧΙ" lines (tabs work too, so a paste from Excel is fine).
	 * "ΝΑΙ" = the amount is spread over the calendar years of the period by month; anything else = whole amount in the start year.
	 */
	public static function parse_articles( $text ) {
		$out = array();
		foreach ( preg_split( '/\r?\n/', (string) $text ) as $line ) {
			$p = array_map( 'trim', preg_split( '/\t|\|/', $line ) );
			$code = isset( $p[0] ) ? mb_substr( sanitize_text_field( $p[0] ), 0, 40 ) : '';
			if ( '' === $code || isset( $out[ $code ] ) ) {
				continue;
			}
			$flag = isset( $p[4] ) ? mb_strtoupper( $p[4] ) : '';
			$out[ $code ] = array(
				'code'    => $code,
				'desc'    => isset( $p[1] ) ? mb_substr( sanitize_text_field( $p[1] ), 0, 200 ) : '',
				'cat'     => isset( $p[2] ) ? mb_substr( sanitize_text_field( $p[2] ), 0, 40 ) : '',
				'catDesc' => isset( $p[3] ) ? mb_substr( sanitize_text_field( $p[3] ), 0, 200 ) : '',
				'split'   => (bool) preg_match( '/^(Ν|N|YES|Y)/u', $flag ),
			);
			if ( count( $out ) >= 500 ) {
				break;
			}
		}
		return array_values( $out );
	}

	public static function serialize_articles( $list ) {
		$lines = array();
		foreach ( $list as $a ) {
			$lines[] = implode( ' | ', array( $a['code'], $a['desc'], $a['cat'], $a['catDesc'], $a['split'] ? 'ΝΑΙ' : 'ΌΧΙ' ) );
		}
		return implode( "\n", $lines );
	}

	/** Budget articles for the drop-down and the budget sheet (structured). */
	public static function articles() {
		$raw = get_option( 'rl_budget_articles', false );
		return self::parse_articles( false === $raw ? self::default_articles_text() : $raw );
	}

	/** "code description" for an article code, or the stored text if unknown. */
	public static function article_label( $code ) {
		foreach ( self::articles() as $a ) {
			if ( $a['code'] === $code ) {
				return trim( $a['code'] . ' ' . $a['desc'] );
			}
		}
		return (string) $code;
	}

	public static function send_now() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Forbidden', 403 );
		}
		check_admin_referer( 'rl_send_now' );
		$n = RL_Cron::run( true );
		wp_safe_redirect( add_query_arg( array( 'page' => 'renewal-ledger', 'rl_sent' => (int) $n ), admin_url( 'options-general.php' ) ) );
		exit;
	}

	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$to     = get_option( 'rl_recipients', '' );
		$repeat = (int) get_option( 'rl_repeat_days', 7 );
		$url    = get_option( 'rl_app_url', '' );
		$am     = class_exists( 'AM' );
		?>
		<div class="wrap">
			<h1>PROCURE360</h1>
			<?php if ( isset( $_GET['rl_sent'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-success is-dismissible"><p>
					<?php
					$n = (int) $_GET['rl_sent']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
					echo $n > 0 ? esc_html( sprintf( 'Στάλθηκε email με %d εγγραφές.', $n ) ) : esc_html( 'Δεν υπάρχουν εγγραφές που να χρειάζονται υπενθύμιση αυτή τη στιγμή.' );
					?>
				</p></div>
			<?php endif; ?>

			<?php if ( ! $am ) : ?>
				<div class="notice notice-error"><p><strong>Το πρόσθετο Application Management δεν είναι ενεργό.</strong> Μέχρι να το ενεργοποιήσεις, κανείς δεν έχει πρόσβαση στα δεδομένα του PROCURE360.</p></div>
			<?php else : ?>
				<div class="notice notice-info inline"><p>Ποιος μπορεί να βλέπει, να δημιουργεί, να επεξεργάζεται, να διαγράφει ή να εξάγει ορίζεται <strong>μόνο</strong> από το
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=am-users' ) ); ?>">Application Management → Users &amp; Access</a>.
					Τα modules είναι <code>software</code> και <code>contracts</code>.</p></div>
			<?php endif; ?>

			<p>Για να εμφανίσεις την εφαρμογή, δημιούργησε μια σελίδα (ιδανικά ιδιωτική) και πρόσθεσε μέσα το shortcode <code>[renewal_ledger]</code>.
				<?php if ( $url ) : ?>
					Τρέχουσα σελίδα: <a href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $url ); ?></a>
				<?php endif; ?>
			</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'rl_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="rl_recipients">Παραλήπτες email υπενθυμίσεων</label></th>
						<td>
							<input type="text" class="regular-text" id="rl_recipients" name="rl_recipients" value="<?php echo esc_attr( $to ); ?>" placeholder="<?php echo esc_attr( get_option( 'admin_email' ) ); ?>">
							<p class="description">Χωρισμένα με κόμμα. Χρησιμοποιούνται για εγγραφές που δεν έχουν δικά τους email ειδοποιήσεων (το πεδίο «Notification emails» κάθε εγγραφής υπερισχύει). Αν μείνει κενό, χρησιμοποιείται το email διαχειριστή του site. Τα email περιέχουν τίτλους, ημερομηνίες και κόστος, ποτέ κωδικούς.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="rl_repeat_days">Επανάληψη υπενθύμισης (ημέρες)</label></th>
						<td>
							<input type="number" min="1" max="90" id="rl_repeat_days" name="rl_repeat_days" value="<?php echo esc_attr( $repeat ); ?>" class="small-text">
							<p class="description">Κάθε εγγραφή στέλνεται όταν μπει στο διάστημα υπενθύμισης και μετά ξανά ανά αυτό το διάστημα. Ένας έλεγχος τρέχει καθημερινά μέσω WP-Cron.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="rl_trash_days">Παραμονή στον Κάδο (ημέρες)</label></th>
						<td>
							<input type="number" min="0" max="3650" id="rl_trash_days" name="rl_trash_days" value="<?php echo esc_attr( self::trash_days() ); ?>" class="small-text">
							<p class="description">Όταν διαγράφεις μια εγγραφή, πηγαίνει στον Κάδο και μπορεί να επαναφερθεί. Μετά από αυτές τις ημέρες διαγράφεται οριστικά (μαζί με τα συνημμένα της). 0 = ποτέ αυτόματα· τότε διαγράφεται μόνο με ρητή «Οριστική διαγραφή» από άτομο με το σχετικό δικαίωμα.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Άρθρα προϋπολογισμού</th>
						<td>
							<table class="widefat striped" id="rl-art-table" style="max-width:1100px">
								<thead><tr><th>Κωδικός</th><th>Περιγραφή άρθρου</th><th>Κατηγορία</th><th>Περιγραφή κατηγορίας</th><th>Ποσό ανάλυσης ανά έτος</th><th>Σε χρήση</th><th></th></tr></thead>
								<tbody>
								<?php $usage = RL_DB::article_usage(); foreach ( self::articles() as $i => $a ) : $used = isset( $usage[ $a['code'] ] ) ? (int) $usage[ $a['code'] ] : 0; ?>
									<tr>
										<td><input type="text" name="rl_budget_articles[<?php echo (int) $i; ?>][code]" value="<?php echo esc_attr( $a['code'] ); ?>" size="8"></td>
										<td><input type="text" name="rl_budget_articles[<?php echo (int) $i; ?>][desc]" value="<?php echo esc_attr( $a['desc'] ); ?>" class="large-text"></td>
										<td><input type="text" name="rl_budget_articles[<?php echo (int) $i; ?>][cat]" value="<?php echo esc_attr( $a['cat'] ); ?>" size="8"></td>
										<td><input type="text" name="rl_budget_articles[<?php echo (int) $i; ?>][catDesc]" value="<?php echo esc_attr( $a['catDesc'] ); ?>" class="large-text"></td>
										<td><select name="rl_budget_articles[<?php echo (int) $i; ?>][split]"><option value="NAI" <?php selected( $a['split'] ); ?>>ΝΑΙ</option><option value="OXI" <?php selected( ! $a['split'] ); ?>>ΌΧΙ</option></select></td>
										<td><?php echo $used ? esc_html( $used . ' εγγραφές' ) : '—'; ?></td>
										<td><button type="button" class="button-link-delete rl-art-del" <?php echo $used ? 'disabled title="Χρησιμοποιείται σε εγγραφές — δεν μπορεί να διαγραφεί"' : ''; ?>>Διαγραφή</button></td>
									</tr>
								<?php endforeach; ?>
								</tbody>
							</table>
							<p><button type="button" class="button" id="rl-art-add">+ Προσθήκη νέου άρθρου</button></p>
							<p class="description">Η στήλη «Ποσό ανάλυσης ανά έτος»: ΝΑΙ = το ποσό κατανέμεται ανά μήνα στα ημερολογιακά έτη της περιόδου (καρτέλα Προϋπολογισμός), ΌΧΙ = ολόκληρο στο έτος έναρξης. Οι εγγραφές αποθηκεύουν τον ΚΩΔΙΚΟ του άρθρου, γι' αυτό ένα άρθρο που χρησιμοποιείται σε εγγραφές (στήλη «Σε χρήση») δεν μπορεί να διαγραφεί ούτε να αλλάξει κωδικό. Πάτησε «Αποθήκευση αλλαγών» κάτω.</p>
							<script>
							(function(){
								var t=document.querySelector('#rl-art-table tbody');
								function renumber(){[].forEach.call(t.rows,function(r,i){[].forEach.call(r.querySelectorAll('[name]'),function(n){n.name=n.name.replace(/rl_budget_articles\[\d+\]/,'rl_budget_articles['+i+']')})})}
								document.getElementById('rl-art-add').addEventListener('click',function(){
									var r=t.insertRow(-1);
									r.innerHTML='<td><input type="text" name="rl_budget_articles[0][code]" size="8"></td><td><input type="text" name="rl_budget_articles[0][desc]" class="large-text"></td><td><input type="text" name="rl_budget_articles[0][cat]" size="8"></td><td><input type="text" name="rl_budget_articles[0][catDesc]" class="large-text"></td><td><select name="rl_budget_articles[0][split]"><option value="NAI">ΝΑΙ</option><option value="OXI" selected>ΌΧΙ</option></select></td><td>—</td><td><button type="button" class="button-link-delete rl-art-del">Διαγραφή</button></td>';
									renumber();r.querySelector('input').focus();
								});
								t.addEventListener('click',function(e){var b=e.target.closest('.rl-art-del');if(b&&!b.disabled){b.closest('tr').remove();renumber()}});
							})();
							</script>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<h2>Δοκιμή</h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="rl_send_now">
				<?php wp_nonce_field( 'rl_send_now' ); ?>
				<?php submit_button( 'Αποστολή τώρα email υπενθυμίσεων', 'secondary', 'submit', false ); ?>
				<p class="description">Στέλνει αμέσως όσες εγγραφές είναι εντός διαστήματος υπενθύμισης ή έληξαν τις τελευταίες 30 ημέρες.</p>
			</form>
		</div>
		<?php
	}
}
