#!/usr/bin/env python3
"""Embeds the PROCURE360 logo into every build (header, favicon, Windows icon).
Source: application/branding/procure360-logo-original.png. To change the logo, replace that file and run this script."""
import base64,io,os,re,sys
import numpy as np
from PIL import Image
root=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
P=lambda *a:os.path.join(root,*a)
im=Image.open(P('application','branding','procure360-logo-original.png')).convert('RGB')
a=np.asarray(im).astype(float)
def transparent(img):
    a=np.asarray(img.convert('RGB')).astype(float)
    alpha=255-a.min(axis=2)            # white -> transparent, colours keep their strength
    alpha=np.clip(alpha*1.15,0,255)
    safe=np.maximum(alpha,1)[...,None]/255.0
    rgb=np.clip(255-(255-a)/safe,0,255)
    out=np.dstack([rgb,alpha]).astype('uint8')
    return Image.fromarray(out,'RGBA')
mask=(a.min(axis=2)<235)
ys,xs=np.where(mask); box=(xs.min()-6,ys.min()-6,xs.max()+7,ys.max()+7)
logo=transparent(im.crop(box))
w=440; logo=logo.resize((w,round(logo.height*w/logo.width)),Image.LANCZOS)
logo=logo.quantize(colors=96,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE)
buf=io.BytesIO(); logo.save(buf,'PNG',optimize=True)
logo_uri='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
# emblem (circle with the P) for favicon / Windows icon: left part of the logo
emb=im.crop((40,190,540,700)); emb=transparent(emb); side=max(emb.size); sq=Image.new('RGBA',(side,side),(0,0,0,0)); sq.paste(emb,((side-emb.width)//2,(side-emb.height)//2))
fav=sq.resize((64,64),Image.LANCZOS); b2=io.BytesIO(); fav.save(b2,'PNG',optimize=True)
fav_uri='data:image/png;base64,'+base64.b64encode(b2.getvalue()).decode()
sq.resize((256,256),Image.LANCZOS).save(P('application','standalone','windows','RenewalLedger','app','icon.ico'),sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
imgtag='<!--LOGO--><img class="logo" src="%s" alt="PROCURE360 – Plan · Procure · Manage · Forecast"><!--/LOGO-->'%logo_uri
favtag='<!--FAV--><link rel="icon" type="image/png" href="%s"><!--/FAV-->'%fav_uri
targets=['application/renewal-ledger/templates/app.html','application/standalone/index.html','index.html','application/standalone/claude-artifact/renewal-ledger.html','application/standalone/windows/RenewalLedger/app/index.html']
for t in targets:
    s=open(P(*t.split('/')),encoding='utf-8').read()
    if '<!--LOGO-->' not in s:
        m=re.search(r'<h1>PROCURE360</h1>',s); assert m,t
        s=s.replace(m.group(0),'<h1 class="sr-only">PROCURE360</h1>\n      <!--LOGO--><!--/LOGO-->',1)
    s=re.sub(r'<!--LOGO-->.*?<!--/LOGO-->',lambda m:imgtag,s,flags=re.S)
    if 'application/renewal-ledger/templates' not in t:
        if '<!--FAV-->' not in s:
            s=s.replace('<title>','<!--FAV--><!--/FAV-->\n<title>',1) if '<title>' in s else s
        s=re.sub(r'<!--FAV-->.*?<!--/FAV-->',lambda m:favtag,s,flags=re.S)
    open(P(*t.split('/')),'w',encoding='utf-8').write(s)
print('logo embedded; logo png %d KB'%(len(buf.getvalue())//1024))
