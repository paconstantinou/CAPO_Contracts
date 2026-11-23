#!/usr/bin/env python3
"""Embeds application/renewal-ledger/assets/app.js (the single source of the app code) into the standalone builds
(GitHub Pages index.html, Windows app, Claude-artifact copy). Run by scripts/build.sh BEFORE sync_guide.py.
The standalone builds differ from the WordPress file only in the storage note and, for the artifact copy, in how the page is wired
(document instead of #rl-app, /_blob/ download links). Run with --check to only verify that the builds are in sync."""
import os,re,sys
root=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
P=lambda *a:os.path.join(root,*a)
SRC=P('application','renewal-ledger','assets','app.js')
GUIDE=re.compile(r'/\*GUIDE-START\*/.*?/\*GUIDE-END\*/',re.S)
WP_NOTE='"Κοινές εγγραφές, αποθηκευμένες στον server. Οι υπενθυμίσεις στέλνονται και με email.":"Shared records, saved on the server. Reminders are also sent by email."'
SA_NOTE='"Αποθηκεύονται μόνο σε αυτόν τον browser και αυτή τη συσκευή. Κάνε τακτικά Εξαγωγή ως αντίγραφο ασφαλείας.":"Saved in this browser on this device only. Use Export regularly as a backup."'
ART_NOTE='"Οι εγγραφές σου είναι ιδιωτικές και αποθηκεύονται αυτόματα. Οι υπενθυμίσεις εμφανίζονται κάθε φορά που ανοίγεις την εφαρμογή.":"Your records are private to you and saved automatically. Reminders appear here whenever you open the ledger."'
ROOT_LINE='var ROOT=document.getElementById("rl-app");if(!ROOT)return;var $=function(s){return ROOT.querySelector(s)};'
def variant(app,kind):
    t=app.replace(WP_NOTE,SA_NOTE if kind=='std' else ART_NOTE)
    if kind=='art':
        t=t.replace(ROOT_LINE,'var $=function(s){return document.querySelector(s)};')
        t=t.replace('ROOT.addEventListener(','document.addEventListener(')
        # only the file lists that have a Remove button use real download links in the artifact copy
        fix=lambda l:re.sub(r'''<a href="#" data-blob="\'\+esc\(a\.id\)\+\'">\'\+esc\(a\.name\)\+\'</a>(<button type="button" class="btn small danger" data-(?:delfile|delhfile|act="msrmfile"))''',
                 lambda m:'''<a href="/_blob/\'+esc(a.id)+\'" target="_blank" rel="noopener" download="\'+esc(a.name)+\'">\'+esc(a.name)+\'</a>'''+m.group(1),l)
        t='\n'.join(l if '(p.attachments||[])' in l else fix(l) for l in t.split('\n')) # the provisions list keeps its plain links in the artifact copy
    return t
TARGETS=[('index.html','std'),('application/standalone/index.html','std'),('application/standalone/windows/RenewalLedger/app/index.html','std'),('application/standalone/claude-artifact/renewal-ledger.html','art')]
def main():
    app=open(SRC,encoding='utf-8').read(); check='--check' in sys.argv; bad=0
    for f,kind in TARGETS:
        v=variant(app,kind); s=open(P(*f.split('/')),encoding='utf-8').read()
        h=v[:120]; e=v[-120:]
        if s.count(h)!=1 or s.count(e)!=1: sys.exit('anchors not found (once) in '+f)
        i=s.find(h); j=s.find(e)+len(e); cur=s[i:j]
        if GUIDE.sub('G',cur)==GUIDE.sub('G',v): print('in sync   ',f); continue
        if check: print('OUT OF SYNC',f); bad+=1; continue
        open(P(*f.split('/')),'w',encoding='utf-8').write(s[:i]+v+s[j:]); print('updated   ',f)
    sys.exit(1 if bad else 0)
main()
