<?php
/* CLI: php tests/integration/articles-test.php /path/to/wp-load.php
   Budget article list: default list, parsing (pipe/tab), ΝΑΙ/ΌΧΙ flag, label lookup, sanitising on save. */
require $argv[1];
$ok = 0; $bad = 0;
function t( $name, $cond ) { global $ok, $bad; if ( $cond ) { $ok++; echo "  ok   $name\n"; } else { $bad++; echo "  FAIL $name\n"; } }

delete_option( 'rl_budget_articles' );
$a = RL_Settings::articles();
t( 'default list has 17 articles', 17 === count( $a ) );
$split = array_filter( $a, function ( $x ) { return $x['split']; } );
t( '6 default articles have split = ΝΑΙ', 6 === count( $split ) );
t( '03461 is ΝΑΙ, 07651 is ΌΧΙ', $a[1]['code'] === '03461' && $a[1]['split'] && '07651' === $a[6]['code'] && ! $a[6]['split'] );
t( 'category and description kept', '03300' === $a[1]['cat'] && 'ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ' === $a[1]['catDesc'] );
t( 'label lookup', '03461 Συντήρηση Μηχανογραφικού Εξοπλισμού' === RL_Settings::article_label( '03461' ) && 'XYZ' === RL_Settings::article_label( 'XYZ' ) );
$p = RL_Settings::parse_articles( "A1 | Desc | C1 | CD | ΝΑΙ\nB2\tDesc2\tC2\tCD2\tΌΧΙ\n\nA1 | duplicate\n<b>X</b> | <script>y</script> | c | d | yes" );
t( 'parses pipe and tab, drops duplicates and blanks', 3 === count( $p ) && 'B2' === $p[1]['code'] );
t( 'flag parsing', $p[0]['split'] && ! $p[1]['split'] && $p[2]['split'] );
t( 'markup stripped', false === strpos( $p[2]['code'] . $p[2]['desc'], '<' ) );
t( 'round trip', RL_Settings::parse_articles( RL_Settings::serialize_articles( $p ) ) === $p );
update_option( 'rl_budget_articles', '' );
t( 'an emptied list stays empty (no silent fallback to default)', 0 === count( RL_Settings::articles() ) );
delete_option( 'rl_budget_articles' );

/* settings table posts rows; the sanitize callback turns them into the stored list */
$rows = array(
	array( 'code' => 'NEW1', 'desc' => 'Νέο | άρθρο', 'cat' => '09', 'catDesc' => 'Κατ', 'split' => 'NAI' ),
	array( 'code' => '03461', 'desc' => 'Άλλο', 'cat' => '03300', 'catDesc' => 'X', 'split' => 'OXI' ),
	array( 'code' => '', 'desc' => 'blank code row is ignored', 'cat' => '', 'catDesc' => '', 'split' => 'NAI' ),
	array( 'code' => 'NEW1', 'desc' => 'duplicate', 'cat' => '', 'catDesc' => '', 'split' => 'NAI' ),
);
RL_Settings::register();
$clean = apply_filters( 'sanitize_option_rl_budget_articles', $rows );
$list = RL_Settings::parse_articles( $clean );
t( 'table rows: blank and duplicate codes dropped', 2 === count( $list ) );
t( 'table rows: pipe inside a value cannot break the line format', 'Νέο   άρθρο' === $list[0]['desc'] || 'Νέο άρθρο' === preg_replace( '/\s+/u', ' ', $list[0]['desc'] ) );
t( 'table rows: split NAI -> true, OXI -> false', $list[0]['split'] && ! $list[1]['split'] );
update_option( 'rl_budget_articles', $clean );
t( 'saved list is used (new article available)', null !== array_values( array_filter( RL_Settings::articles(), function ( $x ) { return 'NEW1' === $x['code']; } ) )[0] );
delete_option( 'rl_budget_articles' );
echo "\n$ok passed, $bad failed\n"; exit( $bad ? 1 : 0 );
