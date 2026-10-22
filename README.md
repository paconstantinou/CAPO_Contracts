# CAPO Contracts – Renewal Ledger

Μητρώο ανανεώσεων λογισμικού και συμβάσεων, με ετήσιες υπενθυμίσεις, συνημμένα και εισαγωγή/εξαγωγή Excel.

| Έκδοση | Πού βρίσκεται | Πού αποθηκεύονται τα δεδομένα |
|---|---|---|
| **GitHub Pages** | `index.html` | Στον browser του χρήστη (IndexedDB), μόνο σε εκείνη τη συσκευή |
| **WordPress** | `wordpress/renewal-ledger.zip` (ή ο φάκελος `wordpress/renewal-ledger/`) | Στη βάση SQL του WordPress, τα αρχεία στο `wp-content/uploads/renewal-ledger/` |
| **Claude** | `claude-artifact/renewal-ledger.html` | Στον λογαριασμό Claude του χρήστη |

## GitHub Pages
Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)`. Η εφαρμογή ανοίγει στο `https://<owner>.github.io/<repo>/`.
Τα δεδομένα μένουν μόνο στον browser. Κάνε τακτικά «Export» ως αντίγραφο ασφαλείας (τα συνημμένα δεν περιλαμβάνονται στο Excel).

## WordPress
Οδηγίες στο `wordpress/renewal-ledger/README.txt`. Συνοπτικά: ανέβασε το zip στα Πρόσθετα, ενεργοποίησε, βάλε το shortcode `[renewal_ledger]` σε μια ιδιωτική σελίδα και όρισε ρόλους και email στις Ρυθμίσεις → Renewal Ledger.
