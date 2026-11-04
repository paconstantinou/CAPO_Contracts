<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Settings > Renewal Ledger. Who may use the application is NOT decided here:
 * users, roles and permissions are managed only in the Application Management plugin.
 */
class RL_Settings {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_post_rl_send_now', array( __CLASS__, 'send_now' ) );
	}

	public static function menu() {
		add_options_page( 'Renewal Ledger', 'Renewal Ledger', 'manage_options', 'renewal-ledger', array( __CLASS__, 'page' ) );
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
			'rl_repeat_days',
			array(
				'type'              => 'integer',
				'sanitize_callback' => function ( $v ) {
					return max( 1, min( 90, (int) $v ) );
				},
				'default'           => 7,
			)
		);
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
			<h1>Renewal Ledger</h1>
			<?php if ( isset( $_GET['rl_sent'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-success is-dismissible"><p>
					<?php
					$n = (int) $_GET['rl_sent']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
					echo $n > 0 ? esc_html( sprintf( 'Στάλθηκε email με %d εγγραφές.', $n ) ) : esc_html( 'Δεν υπάρχουν εγγραφές που να χρειάζονται υπενθύμιση αυτή τη στιγμή.' );
					?>
				</p></div>
			<?php endif; ?>

			<?php if ( ! $am ) : ?>
				<div class="notice notice-error"><p><strong>Το πρόσθετο Application Management δεν είναι ενεργό.</strong> Μέχρι να το ενεργοποιήσεις, κανείς δεν έχει πρόσβαση στα δεδομένα του Renewal Ledger.</p></div>
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
							<p class="description">Χωρισμένα με κόμμα. Αν μείνει κενό, χρησιμοποιείται το email διαχειριστή του site. Τα email περιέχουν τίτλους, ημερομηνίες και κόστος, ποτέ κωδικούς.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="rl_repeat_days">Επανάληψη υπενθύμισης (ημέρες)</label></th>
						<td>
							<input type="number" min="1" max="90" id="rl_repeat_days" name="rl_repeat_days" value="<?php echo esc_attr( $repeat ); ?>" class="small-text">
							<p class="description">Κάθε εγγραφή στέλνεται όταν μπει στο διάστημα υπενθύμισης και μετά ξανά ανά αυτό το διάστημα. Ένας έλεγχος τρέχει καθημερινά μέσω WP-Cron.</p>
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
