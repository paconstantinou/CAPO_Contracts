#!/usr/bin/env python3
"""Embeds application/guide/guide.html (the user guide, single source) into every build of the app.
Run by scripts/build.sh. Edit the guide only in application/guide/guide.html."""
import json,re,sys,os
root=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
def P(*a): return os.path.join(root,*a)
ver=re.search(r"'RL_VERSION', '([^']+)'",open(P('application','renewal-ledger','renewal-ledger.php'),encoding='utf-8').read()).group(1)
html=open(P('application','guide','guide.html'),encoding='utf-8').read().replace('{{VERSION}}',ver).strip()
block='/*GUIDE-START*/var GUIDE_HTML='+json.dumps(html,ensure_ascii=False).replace('</','<\\/')+';/*GUIDE-END*/'
targets=['application/renewal-ledger/assets/app.js','application/standalone/index.html','index.html','application/standalone/claude-artifact/renewal-ledger.html','application/standalone/windows/RenewalLedger/app/index.html']
for t in targets:
    s=open(P(*t.split('/')),encoding='utf-8').read()
    n=re.subn(r'/\*GUIDE-START\*/.*?/\*GUIDE-END\*/',lambda m:block,s,flags=re.S)
    if n[1]!=1: sys.exit('markers missing in '+t)
    open(P(*t.split('/')),'w',encoding='utf-8').write(n[0])
print('guide synced into',len(targets),'files (version',ver+')')
