(function(){
"use strict";
var ROOT=document.getElementById("rl-app");if(!ROOT)return;var $=function(s){return ROOT.querySelector(s)};
var FIELDS=[
 {k:"name",l:"Software Name",q:"What is the name of the software?",req:1,ph:"e.g. Microsoft 365 Business"},
 {k:"description",l:"Description",q:"Add a short description.",ta:1,ph:"What it is used for"},
 {k:"vendor",l:"Vendor",q:"Who is the vendor?",ph:"e.g. Microsoft"},
 {k:"website",l:"Website",q:"What is the website address?",ph:"https://"},
 {k:"username",l:"Username",q:"What is the username?"},
 {k:"dateFrom",l:"Date From",q:"When does the subscription start?",date:1,req:1},
 {k:"dateTo",l:"Date To",q:"When does it expire?",date:1,req:1},
 {k:"cost",l:"Cost excl. VAT (€)",q:"What is the cost excluding VAT (€)?",num:1,req:1},
 {k:"emails",l:"Notification emails",q:"Which e-mail addresses should receive the reminders? For several, separate them with a comma (,) or a semicolon (;) (optional).",ta:1,email:1,hint:"For several addresses use a comma (,) or a semicolon (;)",ph:"name@example.com, other@example.com"}
];
var REMIND=[7,14,30,60,90];
var S={items:[],contracts:[],tenders:[],contractors:[],trash:{sw:[],ct:[],tn:[],co:[]},cat:"sw",loaded:{},uid:null,db:null,assets:null,dl:null,filter:"all",q:"",open:null,openCat:null,cw:null,impCat:null,mem:false,unsub:null};

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function pad(n){return (n<10?"0":"")+n}
function iso(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function todayIso(){return iso(new Date())}
function parseIso(s){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");if(!m)return null;var d=new Date(+m[1],+m[2]-1,+m[3]);return isNaN(d)?null:d}
function addDays(s,n){var d=parseIso(s);if(!d)return "";d.setDate(d.getDate()+n);return iso(d)}
function addYear(s){var d=parseIso(s);if(!d)return "";d.setFullYear(d.getFullYear()+1);d.setDate(d.getDate()-1);return iso(d)}
function fmtDate(s){var d=parseIso(s);return d?pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear():"—"}
function money(n){var v=Number(n);return isFinite(v)?"€"+v.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
function daysLeft(s){var d=parseIso(s),t=parseIso(todayIso());return d?Math.round((d-t)/864e5):null}
function status(it){
  var d=daysLeft(it.dateTo);
  if(d==null)return {k:"ok",t:"No date",d:null};
  if(d<0)return {k:"bad",t:"Expired",d:d};
  if(d<=(+it.remindDays||30))return {k:"warn",t:"Due soon",d:d};
  return {k:"ok",t:"Active",d:d};
}
function dayText(d){if(d==null)return "";if(d<0)return Math.abs(d)+" day"+(Math.abs(d)==1?"":"s")+" ago";if(d==0)return "today";return "in "+d+" day"+(d==1?"":"s")}
function toast(m){
  if(toastUndo.pend){var p=toastUndo.pend;toastUndo.pend=null;clearTimeout(toastUndo.h);p.exp&&p.exp()}
  var t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(function(){t.hidden=true},3200)
}
/* A message with an Undo button for 8 s. onExpire runs when the time is up (or when another message replaces it), e.g. to really delete a file. */
function toastUndo(msg,onUndo,onExpire,el){
  if(toastUndo.pend){var p=toastUndo.pend;toastUndo.pend=null;p.exp&&p.exp()}
  clearTimeout(toast.h);clearTimeout(toastUndo.h);
  var t=$("#toast");t.innerHTML=esc(msg)+' <button type="button" class="toast-undo" data-act="undo">'+(el?"Αναίρεση":"Undo")+'</button>';t.hidden=false;
  toastUndo.pend={exp:onExpire};toastUndo.fn=onUndo;
  toastUndo.h=setTimeout(function(){var q=toastUndo.pend;toastUndo.pend=null;t.hidden=true;q&&q.exp&&q.exp()},8000);
}
function doUndo(){var f=toastUndo.fn;toastUndo.pend=null;toastUndo.fn=null;clearTimeout(toastUndo.h);$("#toast").hidden=true;if(f)f()}
function norm(o){
  return {name:String(o.name||"").trim(),description:String(o.description||"").trim(),vendor:String(o.vendor||"").trim(),
    website:String(o.website||"").trim(),username:String(o.username||"").trim(),emails:String(o.emails||"").trim(),
    dateFrom:o.dateFrom||"",dateTo:o.dateTo||"",cost:o.cost===""||o.cost==null?0:Number(o.cost),
    remindDays:+o.remindDays||30,attachments:o.attachments||[],history:o.history||[],milestones:o.milestones||[],budget:o.budget||[],custom:o.custom||{},createdAt:o.createdAt||Date.now(),sample:!!o.sample};
}
function uid(){return "s"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

/* ---------- Ρυθμίσεις: general settings, custom fields, backup / restore (3.12.0) ---------- */
var ST_COLLS=["software","contracts","tenders","contractors"];
var ST_CAT={sw:"software",ct:"contracts",tn:"tenders",co:"contractors"};
var ST_NAMES={software:"Online Renewals",contracts:"Συμβάσεις",tenders:"Διαγωνισμοί",contractors:"Ανάδοχοι"};
var CF_TYPES={text:"Κείμενο",number:"Αριθμός / Ποσό",date:"Ημερομηνία",select:"Λίστα επιλογών (drop-down)"};
var ST_CACHE=null;
function stNorm(s){
  s=s&&typeof s==="object"?s:{};
  var vat=Number(s.vat);vat=s.vat===""||s.vat==null||!isFinite(vat)?19:Math.max(0,Math.min(100,vat));
  var rd=Math.round(Number(s.remindDays));rd=isFinite(rd)&&rd>=1?Math.min(365,rd):30;
  var cf={},cfs=s.customFields&&typeof s.customFields==="object"?s.customFields:{};
  ST_COLLS.forEach(function(c){
    var seen={};cf[c]=(Array.isArray(cfs[c])?cfs[c]:[]).filter(function(f){
      if(!f||!/^[A-Za-z0-9_-]{1,40}$/.test(String(f.id||""))||!String(f.label||"").trim()||seen[f.id])return false;seen[f.id]=1;return true;
    }).slice(0,30).map(function(f){
      var t=CF_TYPES[f.type]?f.type:"text";
      return {id:String(f.id),label:String(f.label).trim().slice(0,80),type:t,options:t==="select"&&Array.isArray(f.options)?f.options.map(function(o){return String(o).trim().slice(0,100)}).filter(function(o,i,a){return o&&a.indexOf(o)===i}).slice(0,50):[]};
    });
  });
  return {vat:vat,remindDays:rd,customFields:cf};
}
function stGet(){
  if(ST_CACHE)return ST_CACHE;
  var s=null;
  if(window.RL_CFG&&window.RL_CFG.settings)s=window.RL_CFG.settings;
  else{try{s=JSON.parse(localStorage.getItem("rl.settings")||"null")}catch(e){}}
  return (ST_CACHE=stNorm(s));
}
async function stSave(obj){
  obj=stNorm(obj);
  if(window.RL_SAVE_SETTINGS){
    try{var res=await window.RL_SAVE_SETTINGS(obj);window.RL_CFG.settings=res.settings||obj}
    catch(e){toast(e&&e.status===403?"Μόνο οι διαχειριστές μπορούν να αλλάξουν τις ρυθμίσεις":"Αποτυχία αποθήκευσης ρυθμίσεων: "+((e&&e.message)||""));return false}
  }else{try{localStorage.setItem("rl.settings",JSON.stringify(obj))}catch(e){toast("Δεν ήταν δυνατή η αποθήκευση των ρυθμίσεων σε αυτόν τον browser");return false}}
  ST_CACHE=null;return true;
}
function bdVat(){return stGet().vat/100}
function defRemind(){return stGet().remindDays}

/* custom fields: descriptors that plug into the existing forms (keys are "cf_<id>") */
function cfDescs(coll){
  return stGet().customFields[coll].map(function(f){
    return {k:"cf_"+f.id,l:f.label,q:f.label+";",cf:1,id:f.id,num:f.type==="number",date:f.type==="date",opts:f.type==="select"?f.options:null};
  });
}
function cfInput(f,v,id){
  v=v==null?"":v;
  if(f.opts){
    var o=f.opts.slice();if(v!==""&&o.indexOf(String(v))<0)o.push(String(v));
    return '<select id="'+id+'"><option value="">—</option>'+o.map(function(x){return '<option value="'+esc(x)+'"'+(String(v)===x?" selected":"")+'>'+esc(x)+'</option>'}).join("")+'</select>';
  }
  if(f.date)return '<input id="'+id+'" type="date" value="'+esc(v)+'">';
  if(f.num)return '<input id="'+id+'" type="number" step="any" inputmode="decimal" value="'+esc(v)+'" autocomplete="off">';
  return '<input id="'+id+'" type="text" value="'+esc(v)+'" autocomplete="off">';
}
function cfErr(f,v){
  if(v==null||String(v).trim()==="")return "";
  if(f.num&&!isFinite(Number(v)))return f.l+": πρέπει να είναι αριθμός.";
  if(f.date&&!parseIso(v))return f.l+": μη έγκυρη ημερομηνία.";
  return "";
}
function cfLoad(d,coll){
  cfDescs(coll).forEach(function(f){if(d[f.k]===undefined)d[f.k]=d.custom&&d.custom[f.id]!=null?d.custom[f.id]:""});
}
function cfApply(rec,d,coll){
  var c={};
  cfDescs(coll).forEach(function(f){
    var v=d[f.k];if(v===""||v==null)return;
    c[f.id]=f.num?Number(v):String(v).trim();
  });
  Object.keys(rec).forEach(function(k){if(/^cf_/.test(k))delete rec[k]});
  rec.custom=c;return rec;
}
function cfShow(f,v){
  if(v===""||v==null)return "—";
  if(f.type==="date")return fmtDate(v);
  if(f.type==="number")return Number(v).toLocaleString("en-GB",{maximumFractionDigits:4});
  return String(v);
}
function cfDetail(rec,coll){
  var defs=stGet().customFields[coll];if(!defs.length)return "";
  var c=rec.custom||{};
  return '<div class="sec"><h3>Πρόσθετα πεδία</h3><dl class="kv wl">'+defs.map(function(f){return '<dt>'+esc(f.label)+'</dt><dd'+(f.type==="number"?' class="num"':'')+'>'+esc(cfShow(f,c[f.id]))+'</dd>'}).join("")+'</dl></div>';
}
function cfCols(cat){
  var coll=ST_CAT[cat];if(!coll)return [];
  return stGet().customFields[coll].map(function(f){
    var val=function(it){var v=(it.custom||{})[f.id];return v==null?"":v};
    return cdef("cf_"+f.id,f.label,0,"1fr",{
      v:function(it){var v=val(it);return f.type==="number"&&v!==""?'<span class="num">'+esc(cfShow(f,v))+'</span>':'<span class="sub">'+esc(cfShow(f,v))+'</span>'},
      s:function(it){var v=val(it);return f.type==="number"&&v!==""?Number(v):v}
    });
  });
}
function swF(){return FIELDS.concat(cfDescs("software"))}
function coF(){return CO_BASE.concat(cfDescs("contractors"))}
function colsAll(cat){return COLS[cat].concat(cfCols(cat))}
/* export columns (Excel / CSV): one column per custom field, rows in the same order as the base export */
function cfHead(coll){return stGet().customFields[coll].map(function(f){return f.label})}
function cfRow(coll,rec){var c=rec.custom||{};return stGet().customFields[coll].map(function(f){var v=c[f.id];return v==null?"":f.type==="number"&&v!==""?Number(v):v})}
function ctHead(n){return ctHead0(n).concat(cfHead("contracts"))}
function ctRowsOut(n){var l=S.contracts.slice().sort(function(a,b){return (a.dateTo||"").localeCompare(b.dateTo||"")});return ctRowsOut0(n).map(function(r,i){return r.concat(cfRow("contracts",l[i]))})}
function tnHead(n){return tnHead0(n).concat(cfHead("tenders"))}
function tnRowsOut(n){var l=S.tenders.slice().sort(function(a,b){return (a.dateFrom||"").localeCompare(b.dateFrom||"")});return tnRowsOut0(n).map(function(r,i){return r.concat(cfRow("tenders",l[i]))})}
function coHead(){return coHead0().concat(cfHead("contractors"))}
function coRowsOut(){var l=(S.contractors||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name),"el",{sensitivity:"base"})});return coRowsOut0().map(function(r,i){return r.concat(cfRow("contractors",l[i]))})}
function swHead(){return HEAD.concat(cfHead("software"))}
function swRowsOut(){var l=S.items.slice().sort(function(a,b){return (a.dateTo||"").localeCompare(b.dateTo||"")});return rowsOut().map(function(r,i){return r.concat(cfRow("software",l[i]))})}

/* ---------- minimal ZIP (stored) writer / reader for the backup ---------- */
var CRC_T=null;
function crc32(u8){
  if(!CRC_T){CRC_T=new Int32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CRC_T[n]=c}}
  var c2=-1;for(var i=0;i<u8.length;i++)c2=CRC_T[(c2^u8[i])&255]^(c2>>>8);
  return (c2^-1)>>>0;
}
function u8cat(parts){var n=0;parts.forEach(function(p){n+=p.length});var o=new Uint8Array(n),k=0;parts.forEach(function(p){o.set(p,k);k+=p.length});return o}
function zipBuild(entries){
  var enc=new TextEncoder(),parts=[],cen=[],off=0;
  entries.forEach(function(e){
    var nm=enc.encode(e.name),crc=crc32(e.data),sz=e.data.length;
    var lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(12,0x21,true);lh.setUint32(14,crc,true);lh.setUint32(18,sz,true);lh.setUint32(22,sz,true);lh.setUint16(26,nm.length,true);
    parts.push(new Uint8Array(lh.buffer),nm,e.data);
    var ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(14,0x21,true);ch.setUint32(16,crc,true);ch.setUint32(20,sz,true);ch.setUint32(24,sz,true);ch.setUint16(28,nm.length,true);ch.setUint32(42,off,true);
    cen.push(new Uint8Array(ch.buffer),nm);
    off+=30+nm.length+sz;
  });
  var cs=0;cen.forEach(function(p){cs+=p.length});
  var eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true);eo.setUint16(8,entries.length,true);eo.setUint16(10,entries.length,true);eo.setUint32(12,cs,true);eo.setUint32(16,off,true);
  return u8cat(parts.concat(cen,[new Uint8Array(eo.buffer)]));
}
async function zipRead(buf){
  var u8=new Uint8Array(buf),dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),dec=new TextDecoder("utf-8"),eo=-1,i;
  for(i=u8.length-22;i>=Math.max(0,u8.length-65557);i--){if(dv.getUint32(i,true)===0x06054b50){eo=i;break}}
  if(eo<0)throw new Error("Το αρχείο δεν είναι έγκυρο ZIP.");
  var n=dv.getUint16(eo+10,true),p=dv.getUint32(eo+16,true),out={};
  for(i=0;i<n;i++){
    if(dv.getUint32(p,true)!==0x02014b50)throw new Error("Αλλοιωμένο αρχείο ZIP.");
    var method=dv.getUint16(p+10,true),crc=dv.getUint32(p+16,true),csz=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
    var name=dec.decode(u8.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
    var st=lho+30+dv.getUint16(lho+26,true)+dv.getUint16(lho+28,true),raw=u8.subarray(st,st+csz),data;
    if(method===0)data=raw;
    else if(method===8&&typeof DecompressionStream!=="undefined"){data=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())}
    else throw new Error("Μη υποστηριζόμενη συμπίεση ZIP. Χρησιμοποίησε ένα backup που δημιούργησε το PROCURE360.");
    if(crc32(data)!==crc)throw new Error("Το αρχείο «"+name+"» είναι αλλοιωμένο (αποτυχία ελέγχου CRC).");
    out[name]=data;
  }
  return out;
}

/* ---------- backup ---------- */
function bkAtts(rec){
  var a=(rec.attachments||[]).slice();
  (rec.milestones||[]).forEach(function(m){(m.attachments||[]).forEach(function(x){a.push(x)})});
  return a;
}
function bkData(){return {software:S.items,contracts:S.contracts,tenders:S.tenders,contractors:S.contractors}}
async function bkCreate(){
  var enc=new TextEncoder(),st=$("#bkMsg"),say=function(t){if(st)st.textContent=t};
  var data=bkData(),entries=[],counts={},files={},missing=[],canRead=!!(S.assets&&S.assets.read);
  say("Συλλογή δεδομένων…");
  ST_COLLS.forEach(function(c){
    var list=(data[c]||[]).map(function(x){return Object.assign({},x)});counts[c]=list.length;
    entries.push({name:"data/"+c+".json",data:enc.encode(JSON.stringify(list))});
  });
  var seen={};
  for(var ci=0;ci<ST_COLLS.length;ci++){
    var list=data[ST_COLLS[ci]]||[];
    for(var i=0;i<list.length;i++){
      var at=bkAtts(list[i]);
      for(var j=0;j<at.length;j++){
        var a=at[j];if(!a||!a.id||seen[a.id])continue;seen[a.id]=1;
        if(!canRead){missing.push(a.name||a.id);continue}
        say("Συνημμένα: "+(a.name||a.id)+"…");
        try{var b=await S.assets.read(a.id);if(!b)throw new Error("empty");
          var bytes=new Uint8Array(await b.arrayBuffer());
          entries.push({name:"files/"+a.id,data:bytes});files[a.id]={name:a.name||a.id,size:bytes.length}}
        catch(e){missing.push(a.name||a.id)}
      }
    }
  }
  entries.push({name:"settings.json",data:enc.encode(JSON.stringify(stGet()))});
  entries.push({name:"articles.json",data:enc.encode(JSON.stringify(articles()))});
  entries.unshift({name:"manifest.json",data:enc.encode(JSON.stringify({app:"PROCURE360",format:1,createdAt:new Date().toISOString(),counts:counts,files:files,missingFiles:missing}))});
  say("Δημιουργία αρχείου…");
  var zip=zipBuild(entries),name="PROCURE360-backup-"+todayIso()+".zip";
  var ok=false;
  if(!S.dl){say("Οι λήψεις δεν είναι διαθέσιμες σε αυτό το περιβάλλον.");return}
  try{await S.dl.save({filename:name,data:zip});ok=true}catch(e){if(e&&e.code==="declined"){say("");return}say("Δεν ήταν δυνατή η αποθήκευση του αρχείου.");return}
  try{localStorage.setItem("rl.lastBackup",new Date().toISOString())}catch(e){}
  var tot=0;ST_COLLS.forEach(function(c){tot+=counts[c]});
  say("Το backup αποθηκεύτηκε: "+name+" ("+tot+" εγγραφές, "+Object.keys(files).length+" συνημμένα"+(missing.length?", δεν συμπεριλήφθηκαν "+missing.length+" συνημμένα: "+missing.slice(0,5).join(", ")+(missing.length>5?"…":""):"")+").");
  if(ok)stFreshInfo();
}
/* ---------- restore ---------- */
function bkPick(){
  var inp=document.createElement("input");inp.type="file";inp.accept=".zip,application/zip";
  inp.onchange=function(){if(inp.files&&inp.files[0])bkLoad(inp.files[0])};inp.click();
}
async function bkLoad(f){
  S.bkResult="";var box=$("#bkRestore");if(!box)return;
  box.innerHTML='<p class="hint">Ανάγνωση «'+esc(f.name)+'»…</p>';
  try{
    var z=await zipRead(await f.arrayBuffer()),dec=new TextDecoder("utf-8");
    var man=z["manifest.json"]?JSON.parse(dec.decode(z["manifest.json"])):null;
    if(!man||man.app!=="PROCURE360")throw new Error("Αυτό δεν είναι backup του PROCURE360.");
    if(man.format!==1)throw new Error("Μη υποστηριζόμενη έκδοση backup ("+man.format+").");
    var data={};
    ST_COLLS.forEach(function(c){var e=z["data/"+c+".json"];var l=e?JSON.parse(dec.decode(e)):[];data[c]=Array.isArray(l)?l.filter(function(x){return x&&/^[A-Za-z0-9_-]{1,64}$/.test(String(x.id||""))}):[]});
    S.bk={zip:z,man:man,data:data,settings:z["settings.json"]?JSON.parse(dec.decode(z["settings.json"])):null,articles:z["articles.json"]?JSON.parse(dec.decode(z["articles.json"])):null};
    bkPreview();
  }catch(e){S.bk=null;box.innerHTML='<p class="err">'+esc(e&&e.message||"Αποτυχία ανάγνωσης του backup")+'</p>'}
}
function bkExisting(c){var m={};(bkData()[c]||[]).forEach(function(x){m[x.id]=x});return m}
function bkPreview(){
  var b=S.bk,box=$("#bkRestore");if(!b||!box)return;
  var rows=ST_COLLS.map(function(c){
    var ex=bkExisting(c),nw=0,up=0;b.data[c].forEach(function(r){ex[r.id]?up++:nw++});
    return '<tr><td>'+esc(ST_NAMES[c])+'</td><td class="num">'+b.data[c].length+'</td><td class="num">'+nw+'</td><td class="num">'+up+'</td></tr>';
  }).join("");
  var nf=Object.keys(b.man.files||{}).length,miss=(b.man.missingFiles||[]).length;
  box.innerHTML='<div class="sec"><h3>Προεπισκόπηση restore</h3><p class="hint">Backup από '+esc(String(b.man.createdAt||"").replace("T"," ").slice(0,16))+' · '+nf+' συνημμένα'+(miss?' · '+miss+' συνημμένα δεν είχαν συμπεριληφθεί στο backup':'')+'</p>'+
   '<div class="tbl"><table><thead><tr><th>Καρτέλα</th><th class="num">Στο backup</th><th class="num">Νέες</th><th class="num">Θα αντικατασταθούν</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
   '<p class="hint">Οι εγγραφές με το ίδιο αναγνωριστικό αντικαθίστανται από την έκδοση του backup. <b>Δεν διαγράφεται τίποτα</b>: ό,τι υπάρχει τώρα και δεν υπάρχει στο backup μένει όπως είναι.</p>'+
   '<label class="chk"><input type="checkbox" id="bkSet"'+(b.settings?' checked':' disabled')+'> Επαναφορά ρυθμίσεων και custom fields</label> '+
   '<label class="chk"><input type="checkbox" id="bkArt"'+(b.articles?' checked':' disabled')+'> Επαναφορά άρθρων προϋπολογισμού</label>'+
   '<div class="actions"><button class="btn primary" type="button" data-act="bkgo">Επαναφορά τώρα</button><button class="btn" type="button" data-act="bkcancel">Άκυρο</button></div></div>';
}
async function bkRun(){
  var b=S.bk,box=$("#bkRestore");if(!b||!box||S.bkBusy)return;
  var wantSet=!!($("#bkSet")&&$("#bkSet").checked),wantArt=!!($("#bkArt")&&$("#bkArt").checked);
  if(!window.confirm("Να γίνει επαναφορά από το backup; Οι εγγραφές με το ίδιο αναγνωριστικό θα αντικατασταθούν."))return;
  S.bkBusy=true;
  var lines=[],errs=[],log=function(t){box.innerHTML='<p class="hint">'+esc(t)+'</p>'};
  try{
    if(wantSet&&b.settings){log("Επαναφορά ρυθμίσεων…");if(await stSave(b.settings))lines.push("Ρυθμίσεις: επαναφέρθηκαν");else errs.push("Ρυθμίσεις: δεν αποθηκεύτηκαν")}
    if(wantArt&&b.articles){
      log("Επαναφορά άρθρων…");
      try{
        var al=(b.articles||[]).filter(function(a){return a&&a.code});
        if(window.RL_SAVE_ARTICLES){var rr=await window.RL_SAVE_ARTICLES(al);window.RL_CFG.articles=rr.articles}
        else{localStorage.setItem("rl.articles",JSON.stringify(al))}
        lines.push("Άρθρα: "+al.length)
      }catch(e){errs.push("Άρθρα: "+((e&&e.message)||"αποτυχία"))}
    }
    var order=["contractors","tenders","contracts","software"],cat={software:"sw",contracts:"ct",tenders:"tn",contractors:"co"},map={};
    for(var oi=0;oi<order.length;oi++){
      var c=order[oi],ok=0,bad=0,ex=bkExisting(c);
      for(var i=0;i<b.data[c].length;i++){
        var r=Object.assign({},b.data[c][i]),id=r.id;delete r.id;
        log(ST_NAMES[c]+": "+(i+1)+" / "+b.data[c].length+"…");
        try{
          if(window.RL_TRASH&&!ex[id]){try{await window.RL_TRASH.restore(collName(cat[c]),id)}catch(e){}}/* WordPress: a record in the trash must be taken out of it before it can be written again */
          await bkFiles(r,ex[id],c,b);
          if(await save(id,r,cat[c]))ok++;else{bad++;if(errs.length<12)errs.push(ST_NAMES[c]+" «"+(r.title||r.name||id)+"»: δεν αποθηκεύτηκε")}
        }catch(e){bad++;if(errs.length<12)errs.push(ST_NAMES[c]+" «"+(r.title||r.name||id)+"»: "+((e&&e.message)||"σφάλμα"))}
      }
      lines.push(ST_NAMES[c]+": "+ok+" επαναφέρθηκαν"+(bad?", "+bad+" απέτυχαν":""));
    }
  }finally{S.bkBusy=false;S.bk=null}
  ST_CACHE=null;render();
  S.bkResult='<div class="sec"><h3>Ολοκληρώθηκε η επαναφορά</h3><ul class="files">'+lines.map(function(x){return '<li>'+esc(x)+'</li>'}).join("")+'</ul>'+(errs.length?'<p class="err">Προβλήματα:<br>'+errs.map(esc).join("<br>")+'</p>':'')+'</div>';
  var again=$("#bkRestore");if(again)again.innerHTML=S.bkResult;
}
/* attachments of a restored record: reuse a file the record already has (same name and size), otherwise upload it from the backup */
async function bkFiles(rec,existing,coll,b){
  var cache=bkFiles.cache||(bkFiles.cache={});
  var fix=async function(list){
    var out=[];
    for(var i=0;i<(list||[]).length;i++){
      var a=list[i];if(!a||!a.id)continue;
      var have=existing&&bkAtts(existing).filter(function(x){return x.name===a.name&&Number(x.size)===Number(a.size)})[0];
      if(have){out.push(Object.assign({},a,{id:have.id}));continue}
      var bytes=b.zip["files/"+a.id];
      if(!bytes||!S.assets||!S.assets.upload)continue;
      if(cache[b.man.createdAt+a.id]){out.push(Object.assign({},a,{id:cache[b.man.createdAt+a.id]}));continue}
      var ext=(String(a.name||"").split(".").pop()||"").toLowerCase(),type=MIME[ext]||"application/octet-stream";
      var f=new File([bytes],a.name||"file",{type:type});
      var r=await S.assets.upload(f,{type:type,coll:coll});
      cache[b.man.createdAt+a.id]=r.id;out.push({id:r.id,name:a.name,size:r.sizeBytes||a.size});
    }
    return out;
  };
  if(rec.attachments)rec.attachments=await fix(rec.attachments);
  if(Array.isArray(rec.milestones))for(var m=0;m<rec.milestones.length;m++){if(rec.milestones[m]&&rec.milestones[m].attachments)rec.milestones[m].attachments=await fix(rec.milestones[m].attachments)}
}

/* ---------- the Ρυθμίσεις page ---------- */
function stCanEdit(){return !window.RL_CFG||window.RL_CFG.canManage!==false}
function stLast(){var v="";try{v=localStorage.getItem("rl.lastBackup")||""}catch(e){}return v}
function stFreshInfo(){var e=$("#bkLast");if(e)e.innerHTML=stLastHtml()}
function stLastHtml(){
  var v=stLast();if(!v)return '<span class="err">Δεν έχει γίνει backup από αυτόν τον browser.</span>';
  var d=Math.floor((Date.now()-Date.parse(v))/864e5);
  return 'Τελευταίο backup από αυτόν τον browser: <b>'+esc(v.replace("T"," ").slice(0,16))+'</b>'+(d>=30?' <span class="err">(πριν από '+d+' ημέρες — κάνε νέο backup)</span>':'');
}
function stFieldRow(coll,f,i,isNew){
  return '<div class="cfrow" data-coll="'+coll+'" data-i="'+i+'" data-id="'+esc(f.id)+'" data-new="'+(isNew?1:0)+'">'+
   '<label class="f">Όνομα πεδίου<input type="text" data-cf="label" maxlength="80" value="'+esc(f.label)+'" placeholder="π.χ. Κωδικός CPV"></label>'+
   '<label class="f">Τύπος'+(isNew?'<select data-cf="type">'+Object.keys(CF_TYPES).map(function(t){return '<option value="'+t+'"'+(f.type===t?" selected":"")+'>'+CF_TYPES[t]+'</option>'}).join("")+'</select>':'<input type="text" disabled value="'+esc(CF_TYPES[f.type])+'"><input type="hidden" data-cf="type" value="'+f.type+'">')+'</label>'+
   '<label class="f cfopt"'+(f.type==="select"?'':' hidden')+'>Επιλογές (μία ανά γραμμή)<textarea data-cf="options" rows="3">'+esc((f.options||[]).join("\n"))+'</textarea></label>'+
   '<button type="button" class="btn small danger" data-act="cfdel" data-coll="'+coll+'" data-i="'+i+'">Διαγραφή</button></div>';
}
function stCollect(){
  var root=$("#stRoot");if(!root)return null;
  var s={vat:($("#stVat")||{}).value,remindDays:($("#stRem")||{}).value,customFields:{}};
  ST_COLLS.forEach(function(c){s.customFields[c]=[]});
  [].forEach.call(root.querySelectorAll(".cfrow"),function(r){
    var g=function(k){var n=r.querySelector('[data-cf="'+k+'"]');return n?n.value:""};
    var t=g("type");
    s.customFields[r.dataset.coll].push({id:r.dataset.id,label:g("label"),type:t,options:t==="select"?g("options").split(/\r?\n/):[],_new:r.dataset.new==="1"});
  });
  return s;
}
function stRaw(){return S.stDraft||stGet()}
function renderStPage(){
  var tabs=document.querySelectorAll(".tabs .tab");[].forEach.call(tabs,function(t){t.setAttribute("aria-selected",String(t.id==="tabSt"))});
  ["#btnAdd","#btnImport","#btnExport","#q"].forEach(function(s){var n=$(s);if(n)n.style.display="none"});
  $("#stats").innerHTML="";$("#alerts").innerHTML="";$("#chips").innerHTML="";$("#stats").setAttribute("lang","el");
  $("#note").textContent="Ρυθμίσεις της εφαρμογής: backup και restore, custom fields και γενικές ρυθμίσεις.";
  var st=stRaw(),can=stCanEdit();
  var cfHtml=ST_COLLS.map(function(c){
    var l=st.customFields[c]||[],ex=stGet().customFields[c].map(function(f){return f.id});
    return '<div class="cfgrp"><h4>'+esc(ST_NAMES[c])+'</h4>'+(l.length?l.map(function(f,i){return stFieldRow(c,f,i,ex.indexOf(f.id)<0)}).join(""):'<p class="hint">Δεν υπάρχουν πρόσθετα πεδία.</p>')+
     '<div><button type="button" class="btn small" data-act="cfadd" data-coll="'+c+'">+ Νέο πεδίο</button></div></div>';
  }).join("");
  var n=0;ST_COLLS.forEach(function(c){n+=(bkData()[c]||[]).length});
  var h='<div id="stRoot" lang="el">'+
   '<div class="stcard"><h3>Backup &amp; Restore</h3>'+
   '<p class="hint">Το backup είναι ένα αρχείο .zip με <b>όλες τις εγγραφές</b> (Online Renewals, Συμβάσεις, Διαγωνισμοί, Ανάδοχοι), τα <b>συνημμένα</b>, τις <b>ρυθμίσεις/custom fields</b> και τα άρθρα προϋπολογισμού. Δεν περιλαμβάνει τον κάδο. Περιέχει πραγματικά δεδομένα (και usernames): φύλαξέ το σε ασφαλές μέρος.</p>'+
   '<p class="hint" id="bkLast">'+stLastHtml()+'</p>'+
   '<div class="actions"><button type="button" class="btn primary" data-act="bkdo">⬇ Λήψη backup ('+n+' εγγραφές)</button>'+(can?'<button type="button" class="btn" data-act="bkpick">⬆ Restore από αρχείο…</button>':'')+'</div>'+
   '<p class="hint" id="bkMsg"></p><div id="bkRestore"></div></div>'+
   '<div class="stcard"><h3>Γενικές ρυθμίσεις</h3><div class="stgrid">'+
   '<label class="f">Ποσοστό ΦΠΑ Προϋπολογισμού (%)<small>Τα ποσά των εγγραφών είναι χωρίς ΦΠΑ· ο Προϋπολογισμός τα εμφανίζει με ΦΠΑ.</small><input id="stVat" type="number" step="0.01" min="0" max="100" value="'+esc(st.vat)+'"'+(can?'':' disabled')+'></label>'+
   '<label class="f">Προεπιλεγμένη υπενθύμιση ετών σύμβασης (ημέρες πριν τη λήξη)<small>Ισχύει για τα νέα έτη σύμβασης· κάθε έτος αλλάζει ξεχωριστά.</small><input id="stRem" type="number" step="1" min="1" max="365" value="'+esc(st.remindDays)+'"'+(can?'':' disabled')+'></label></div></div>'+
   '<div class="stcard"><h3>Custom fields</h3><p class="hint">Πρόσθετα πεδία για κάθε καρτέλα. Εμφανίζονται στη φόρμα, στις λεπτομέρειες, στις στήλες της λίστας (⚙ Στήλες) και στο Excel/CSV. Ο τύπος ενός πεδίου δεν αλλάζει αφού αποθηκευτεί. Αν διαγράψεις ένα πεδίο, οι τιμές του δεν εμφανίζονται πια και αφαιρούνται από κάθε εγγραφή όταν αυτή αποθηκευτεί ξανά.</p>'+cfHtml+'</div>'+
   (can?'<div class="actions"><button type="button" class="btn primary" data-act="stsave">Αποθήκευση ρυθμίσεων</button></div><div class="err" id="stErr"></div>':'<p class="hint">Μόνο οι διαχειριστές αλλάζουν τις ρυθμίσεις.</p>')+
   '<div class="stcard"><h3>Πληροφορίες</h3><p class="hint">'+(window.RL_CFG?'Τα δεδομένα αποθηκεύονται στη βάση του WordPress.':'Τα δεδομένα αποθηκεύονται <b>μόνο σε αυτόν τον browser</b> (όχι στο cloud). Κάνε backup τακτικά και πριν καθαρίσεις τα δεδομένα του browser.')+'</p>'+
   '<p class="hint">Εγγραφές: '+n+' · Άρθρα προϋπολογισμού: '+articles().length+'</p></div></div>';
  $("#list").innerHTML=h;
  if(S.bk)bkPreview();else if(S.bkResult){var br=$("#bkRestore");if(br)br.innerHTML=S.bkResult}
}
async function stSaveClick(){
  var s=stCollect();if(!s)return;var e="",err=$("#stErr");
  var vat=Number(s.vat),rd=Number(s.remindDays);
  if(s.vat===""||!isFinite(vat)||vat<0||vat>100)e="ΦΠΑ: δώσε αριθμό από 0 έως 100.";
  else if(s.remindDays===""||!isFinite(rd)||rd<1||rd>365||Math.floor(rd)!==rd)e="Υπενθύμιση: δώσε ακέραιο αριθμό ημερών από 1 έως 365.";
  ST_COLLS.forEach(function(c){
    if(e)return;var seen={};
    s.customFields[c].forEach(function(f){
      if(e)return;var lab=String(f.label||"").trim();
      if(!lab)e=ST_NAMES[c]+": κάθε custom field χρειάζεται όνομα.";
      else if(seen[lab.toLowerCase()])e=ST_NAMES[c]+": το πεδίο «"+lab+"» υπάρχει δύο φορές.";
      else if(f.type==="select"&&!f.options.some(function(o){return o.trim()}))e=ST_NAMES[c]+": το πεδίο «"+lab+"» χρειάζεται τουλάχιστον μία επιλογή.";
      seen[lab.toLowerCase()]=1;
    });
  });
  if(e){if(err)err.textContent=e;return}
  if(await stSave(s)){S.stDirty=false;S.stDraft=null;toast("Οι ρυθμίσεις αποθηκεύτηκαν");render()}
}
function stAction(act,b){
  switch(act){
    case "stsave":stSaveClick();return true;
    case "cfadd":{var s=stNorm2(stCollect()||stGet());s.customFields[b.dataset.coll].push({id:"f"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),label:"",type:"text",options:[]});S.stDraft=s;S.stDirty=true;renderStPage();return true}
    case "cfdel":{var s2=stCollect();if(!s2)return true;var l=s2.customFields[b.dataset.coll],i=+b.dataset.i,f=l[i];
      if(f&&!f._new){var used=(bkData()[b.dataset.coll]||[]).filter(function(r){return r.custom&&r.custom[f.id]!=null}).length;
        if(!window.confirm("Να διαγραφεί το πεδίο «"+(f.label||"")+"»;"+(used?" "+used+" εγγραφές έχουν τιμή σε αυτό· δεν θα εμφανίζεται πια.":"")))return true}
      l.splice(i,1);S.stDraft=stNorm2(s2);S.stDirty=true;renderStPage();return true}
    case "bkdo":bkCreate();return true;
    case "bkpick":bkPick();return true;
    case "bkgo":bkRun();return true;
    case "bkcancel":S.bk=null;S.bkResult="";{var bx=$("#bkRestore");if(bx)bx.innerHTML=""}return true;
  }
  return false;
}
/* keeps unsaved rows (also with empty names) while the page is edited, unlike stNorm which drops them */
function stNorm2(s){
  var o={vat:s.vat,remindDays:s.remindDays,customFields:{}};
  ST_COLLS.forEach(function(c){o.customFields[c]=(s.customFields[c]||[]).map(function(f){return {id:f.id,label:f.label||"",type:CF_TYPES[f.type]?f.type:"text",options:Array.isArray(f.options)?f.options:[]}})});
  return o;
}
document.addEventListener("input",function(e){
  if(S.cat!=="st"||!e.target||!e.target.closest||!e.target.closest("#stRoot"))return;
  S.stDirty=true;
});
document.addEventListener("change",function(e){
  var t=e.target;if(S.cat!=="st"||!t||!t.matches||!t.matches('[data-cf="type"]'))return;
  var row=t.closest(".cfrow"),o=row&&row.querySelector(".cfopt");if(o)o.hidden=t.value!=="select";
});

/* ---------- storage ---------- */
function col(n){return S.db.doc("data/users/"+S.uid+"/app").collection(n||"software")}
var CATS={sw:{c:"software",k:"items"},ct:{c:"contracts",k:"contracts"},tn:{c:"tenders",k:"tenders"},co:{c:"contractors",k:"contractors"}};
function ctLike(c){return c==="ct"||c==="tn"}
function listOf(cat){return S[(CATS[cat]||CATS.sw).k]}
function getItem(cat,id){return listOf(cat).find(function(x){return x.id===id})}
function saveErr(e){
  var c=e&&e.code,m={rl_duplicate_contractor:"Υπάρχει ήδη ανάδοχος με το ίδιο όνομα.",rl_duplicate_tender:"Ο αριθμός διαγωνισμού υπάρχει ήδη σε άλλον διαγωνισμό.",rl_bad_contractor:"Ο επιλεγμένος ανάδοχος δεν υπάρχει πια. Επίλεξε άλλον."};
  return m[c]||"Could not save ("+(c||"error")+")";
}
async function save(id,rec,cat){
  cat=cat||"sw";
  if(S.db&&S.uid){try{await col(collName(cat)).doc(id).set(rec)}catch(e){toast(saveErr(e));return false}}
  else{var L=listOf(cat),i=L.findIndex(function(x){return x.id===id}),o=Object.assign({id:id},rec);if(i>=0)L[i]=o;else L.push(o);render()}
  return true;
}
/* Deleting never destroys: the record goes to the trash (WordPress: on the server; here: kept with a deletedAt mark) and can be restored. */
var TRASH_DAYS=30;
function trashDays(){return window.RL_TRASH?(window.RL_TRASH.days||0):TRASH_DAYS}
function collName(cat){return (CATS[cat]||CATS.sw).c}
function recName(cat,it){return cat==="sw"||cat==="co"?(it.name||""):(it.title||"")}
async function remove(id,cat){
  cat=cat||"sw";var it=getItem(cat,id);if(!it)return false;
  if(window.RL_TRASH){try{await col(collName(cat)).doc(id).delete()}catch(e){toast(e&&e.code==="rl_contractor_in_use"?"Ο ανάδοχος χρησιμοποιείται σε συμβάσεις και δεν μπορεί να διαγραφεί.":"Could not delete");return false}loadTrash(cat)}
  else if(S.db&&S.uid){var rec=strip(it);rec.deletedAt=Date.now();try{await col(collName(cat)).doc(id).set(rec)}catch(e){toast("Could not delete");return false}}
  else{var k=CATS[cat].k;S[k]=S[k].filter(function(x){return x.id!==id});S.trash[cat].push(Object.assign({},it,{deletedAt:Date.now()}));render()}
  return true;
}
/* trash lists: S.trash.sw / S.trash.ct hold {id,...record,_at (ms),_by} */
function trashFromDocs(cat,docs){S.trash[cat]=docs.map(function(d){return Object.assign({id:d.id},d.data(),{_at:d.data().deletedAt||0})})}
async function loadTrash(cat){
  if(!window.RL_TRASH||!window.RL_TRASH.can(collName(cat)))return;
  try{var l=await window.RL_TRASH.list(collName(cat));S.trash[cat]=l.map(function(x){return Object.assign({id:x.id},x.data,{_at:x.at,_by:x.by})});render()}catch(e){}
}
async function restoreItem(cat,id){
  var it=(S.trash[cat]||[]).find(function(x){return x.id===id});if(!it)return false;
  if(cat==="co"){var dq=coDup(it.name,"",id);if(dq){toast("Δεν επαναφέρθηκε: υπάρχει ήδη ανάδοχος με το ίδιο όνομα («"+dq.name+"»)");return false}}
  if(cat==="tn"){var dp=tnDup(it.tender,id);if(dp){toast("Δεν επαναφέρθηκε: ο αριθμός διαγωνισμού «"+it.tender+"» χρησιμοποιείται ήδη από τον διαγωνισμό «"+dp.title+"»");return false}}
  if(window.RL_TRASH){try{await window.RL_TRASH.restore(collName(cat),id)}catch(e){toast("Could not restore");return false}await loadTrash(cat);return true}
  var rec=strip(it);delete rec.deletedAt;delete rec._at;delete rec._by;
  if(S.db&&S.uid){try{await col(collName(cat)).doc(id).set(rec)}catch(e){toast("Could not restore");return false}}
  else{S.trash[cat]=S.trash[cat].filter(function(x){return x.id!==id});listOf(cat).push(Object.assign({id:id},rec));render()}
  return true;
}
async function purgeItem(cat,id){
  var it=(S.trash[cat]||[]).find(function(x){return x.id===id});if(!it)return false;
  if(window.RL_TRASH){try{await window.RL_TRASH.purge(collName(cat),id)}catch(e){toast("Could not delete");return false}await loadTrash(cat);return true}
  var files=(it.attachments||[]).concat((it.milestones||[]).reduce(function(a,m){return a.concat(m.attachments||[])},[]));
  if(S.db&&S.uid){try{await col(collName(cat)).doc(id).delete()}catch(e){toast("Could not delete");return false}}
  else{S.trash[cat]=S.trash[cat].filter(function(x){return x.id!==id});render()}
  if(S.assets)for(var i=0;i<files.length;i++){if(fileInUse(files[i].id,cat,id))continue;try{await S.assets.delete(files[i].id)}catch(_){}}
  return true;
}
/* browser versions: remove records that have been in the trash longer than TRASH_DAYS */
async function autoPurge(){
  if(window.RL_TRASH||!TRASH_DAYS)return;
  var lim=Date.now()-TRASH_DAYS*864e5;
  ["sw","ct","tn","co"].forEach(function(c){(S.trash[c]||[]).filter(function(x){return x._at&&x._at<lim}).forEach(function(x){purgeItem(c,x.id)})});
}
/* a file may be referenced by two records (a promoted tender and its contract in the browser builds): only delete it when nothing else uses it */
function fileInUse(fid,xcat,xid){
  var hit=false;
  function chk(cat,l){(l||[]).forEach(function(r){if(hit||(cat===xcat&&r.id===xid))return;var a=(r.attachments||[]).concat((r.milestones||[]).reduce(function(q,m){return q.concat(m.attachments||[])},[]));if(a.some(function(f){return f.id===fid}))hit=true})}
  chk("sw",S.items);chk("ct",S.contracts);chk("tn",S.tenders);["sw","ct","tn"].forEach(function(c){chk(c,S.trash[c])});
  return hit;
}
function byId(id){return S.items.find(function(x){return x.id===id})}
function strip(it){var o=Object.assign({},it);delete o.id;return o}

/* ---------- list rendering ---------- */
function filtered(){
  var q=S.q.toLowerCase();
  return sortList("sw",S.items.filter(function(it){
    var st=status(it).k;
    if(S.filter==="expired"&&st!=="bad")return false;
    if(S.filter==="due"&&st!=="warn")return false;
    if(S.filter==="active"&&st!=="ok")return false;
    if(!q)return true;
    return [it.name,it.vendor,it.website,it.description].join(" ").toLowerCase().indexOf(q)>=0;
  }));
}
function renderSw(){
  var all=S.items,exp=0,due=0,act=0,spend=0;
  all.forEach(function(it){var s=status(it).k;if(s==="bad")exp++;else if(s==="warn")due++;else act++;if(s!=="bad")spend+=Number(it.cost)||0});
  $("#stats").innerHTML=
    '<div class="stat"><b>'+all.length+'</b><span>Software</span></div>'+
    '<div class="stat bad"><b>'+exp+'</b><span>Expired</span></div>'+
    '<div class="stat warn"><b>'+due+'</b><span>Due soon</span></div>'+
    '<div class="stat"><b>'+act+'</b><span>Active</span></div>'+
    '<div class="stat"><b class="num" style="font-family:var(--f-display)">'+money(spend).replace(/\.00$/,"")+'</b><span>Running cost excl. VAT</span></div>';
  var al="";
  var ex=all.filter(function(i){return status(i).k==="bad"}),du=all.filter(function(i){return status(i).k==="warn"});
  function names(a){return a.slice(0,3).map(function(i){return esc(i.name)}).join(", ")+(a.length>3?" +"+(a.length-3)+" more":"")}
  if(ex.length)al+='<div class="alert bad"><span>Expired: '+names(ex)+'</span><button type="button" data-f="expired">Show</button></div>';
  if(du.length)al+='<div class="alert"><span>Renewal due: '+names(du)+'</span><button type="button" data-f="due">Show</button></div>';
  $("#alerts").innerHTML=al+msAlertHtml("sw")+crossAlert("sw");
  var chips=[["all","All"],["expired","Expired"],["due","Due soon"],["active","Active"],["trash","🗑 Trash"+(S.trash.sw.length?" ("+S.trash.sw.length+")":"")]];
  $("#chips").innerHTML=chips.map(function(c){return '<button type="button" class="chip" data-f="'+c[0]+'" aria-pressed="'+(S.filter===c[0])+'">'+c[1]+'</button>'}).join("")+'<button type="button" class="chip" data-act="cols">⚙ Columns</button>'+(window.RL_CFG?'':'<button type="button" class="chip" data-act="arts">Budget articles</button>');
  var rows=filtered(),h="";
  if(!all.length){
    h='<div class="empty"><h2>No software added yet</h2><p>Add your first subscription one field at a time, or import many at once from an Excel file.</p><div class="actions"><button class="btn primary" type="button" id="emAdd">+ Add software</button><button class="btn" type="button" id="emImp">Import Excel</button><button class="btn" type="button" id="emSample">Load 3 sample rows</button></div></div>';
  }else if(!rows.length){
    h='<div class="empty"><h2>No matches</h2><p>Try another search or filter.</p></div>';
  }else{
    h=listHtml("sw",rows);
  }
  $("#list").innerHTML=h;
}

/* ---------- panel helpers ---------- */
function openPanel(html,kind,wide){
  var o=$("#overlay");o.dataset.kind=kind;
  o.innerHTML='<div class="panel'+(wide?' wide':'')+'" role="dialog" aria-modal="true">'+html+'</div>';
  o.hidden=false;
  var f=o.querySelector("input:not([type=hidden]),select,textarea");if(f&&kind!=="detail")f.focus();
}
function closePanel(){var o=$("#overlay");o.hidden=true;o.innerHTML="";S.open=null;S.openCat=null;S.wiz=null;S.cw=null;S.co=null;S.imp=null;S.dirty=false}
/* Forms (Online Renewals, Συμβάσεις, Διαγωνισμοί, renew, milestone) never close by a click outside them or by Backspace; Escape / Cancel ask first when something was typed. */
var FORMKINDS={wiz:1,renew:1,ms:1};
function formOpen(){var o=$("#overlay");return !!o&&!o.hidden&&!!FORMKINDS[o.dataset.kind]}
function askClose(){
  if(S.co){coCancel();return}
  if(formOpen()&&S.dirty&&!window.confirm("Να κλείσει η φόρμα; Ό,τι έχεις συμπληρώσει και δεν έχει αποθηκευτεί θα χαθεί."))return;
  closePanel();
}
document.addEventListener("keydown",function(ev){if(ev.key==="Escape"&&!$("#overlay").hidden)askClose()});
window.addEventListener("beforeunload",function(e){if(formOpen()&&S.dirty){e.preventDefault();e.returnValue=""}});

/* ---------- detail panel ---------- */
function showDetail(id){
  var it=byId(id);if(!it)return;S.open=id;S.openCat="sw";
  var s=status(it);
  var files=(it.attachments||[]).map(function(a,i){
    return '<li><a href="#" data-blob="'+esc(a.id)+'">'+esc(a.name)+'</a><button type="button" class="btn small danger" data-delfile="'+i+'">Remove</button></li>';
  }).join("");
  var hist=(it.history||[]).slice().reverse().map(function(h){
    return '<tr><td>'+fmtDate(h.from)+' – '+fmtDate(h.to)+'</td><td class="num">'+money(h.cost)+'</td></tr>';
  }).join("");
  var opts=REMIND.map(function(n){return '<option value="'+n+'"'+(+it.remindDays===n?" selected":"")+'>'+n+' days before</option>'}).join("");
  if(REMIND.indexOf(+it.remindDays)<0)opts+='<option value="'+(+it.remindDays)+'" selected>'+(+it.remindDays)+' days before</option>';
  var web=it.website?(/^https?:\/\//i.test(it.website)?'<a href="'+esc(it.website)+'" target="_blank" rel="noopener">'+esc(it.website)+'</a>':esc(it.website)):"—";
  openPanel(
   '<div class="ph"><div><h2>'+esc(it.name)+'</h2><span class="pill '+s.k+'">'+s.t+'</span> <span class="hint">'+dayText(s.d)+'</span></div><button class="btn small" type="button" data-act="close">Close</button></div>'+
   '<dl class="kv">'+
   '<dt>Description</dt><dd>'+esc(it.description||"—")+'</dd>'+
   '<dt>Vendor</dt><dd>'+esc(it.vendor||"—")+'</dd>'+
   '<dt>Website</dt><dd>'+web+'</dd>'+
   '<dt>Username</dt><dd>'+(it.username?'<span class="mono">'+esc(it.username)+'</span> <button class="btn small" type="button" data-copy="username">Copy</button>':"—")+'</dd>'+
   '<dt>Notification emails</dt><dd>'+esc(it.emails||"—")+'</dd>'+
   '<dt>Date From</dt><dd class="mono">'+fmtDate(it.dateFrom)+'</dd>'+
   '<dt>Date To</dt><dd class="mono">'+fmtDate(it.dateTo)+'</dd>'+
   '<dt>Cost excl. VAT</dt><dd class="num">'+money(it.cost)+'</dd></dl>'+
   '<div class="sec"><h3>Reminder</h3><label class="f">Alert me before expiry<select id="remSel">'+opts+'</select></label><span class="hint">The alert appears at the top of the ledger from this point until the date passes.</span></div>'+
   '<div class="sec"><h3>Attachments</h3>'+(files?'<ul class="files">'+files+'</ul>':'<span class="hint">No invoices or receipts attached yet.</span>')+
   '<div><button class="btn" type="button" data-act="attach"'+(S.assets?'':' disabled')+'>+ Attach files</button> <span class="hint">'+(S.assets?'Invoices, receipts, PDFs, images, Word, Excel, HTML (up to '+attMB()+' MB each).':'Uploads are not available in this view.')+'</span></div></div>'+
   bpDetail(it,0)+msSection("sw",it)+
   '<div class="sec"><h3>Renewal</h3><div><button class="btn primary" type="button" data-act="renew">Renew…</button></div>'+
   (hist?'<div class="tbl"><table><thead><tr><th>Previous period</th><th>Cost excl. VAT</th></tr></thead><tbody>'+hist+'</tbody></table></div>':'')+'</div>'+
   cfDetail(it,"software")+'<div class="sec"><div class="actions"><button class="btn" type="button" data-act="edit">Edit details</button><button class="btn danger" type="button" data-act="del">Delete</button></div><div id="delbox"></div></div>'
  ,"detail");
}

/* ---------- add / edit (guided prompt or full form) ---------- */
function inputHtml(f,val,pre){
  var id=pre+f.k,v=val==null?"":val;
  if(f.cf)return cfInput(f,v,id);
  if(f.ta)return '<textarea id="'+id+'" placeholder="'+esc(f.ph||"")+'">'+esc(v)+'</textarea>';
  var t=f.date?"date":f.num?"number":f.k==="website"?"url":"text";
  return '<input id="'+id+'" type="'+t+'"'+(f.num?' step="0.01" min="0" inputmode="decimal"':'')+' value="'+esc(v)+'" placeholder="'+esc(f.ph||"")+'" autocomplete="off">';
}
function remindSel(v,id){return '<select id="'+id+'">'+REMIND.map(function(n){return '<option value="'+n+'"'+(+v===n?" selected":"")+'>'+n+' days before expiry</option>'}).join("")+'</select>'}
function startWizard(id){
  var it=id?byId(id):null;
  S.wiz={id:id||null,mode:it?"full":"step",i:0,err:"",data:it?Object.assign({},it):{dateFrom:todayIso(),remindDays:30}};
  drawWizard();
}
function collect(){
  var w=S.wiz;
  swF().forEach(function(f){var el=$("#w_"+f.k);if(el)w.data[f.k]=el.value});
  var r=$("#w_remind");if(r)w.data.remindDays=+r.value;
  bpCollect(w.data);
  if(bpHas(w.data))w.data.cost=bpSum(w.data.budget);
}
function validate(keys){
  var d=S.wiz.data;
  for(var i=0;i<keys.length;i++){
    var f=swF().filter(function(x){return x.k===keys[i]})[0];if(!f)continue;
    var v=d[f.k];
    if(f.cf){var ce=cfErr(f,v);if(ce)return ce}
    if(f.req&&(v==null||String(v).trim()===""))return f.l+" is required.";
    if(f.date&&v&&!parseIso(v))return f.l+" is not a valid date.";
    if(f.email&&v&&emailsErr(v))return emailsErr(v);
    if(f.num&&v!==""&&v!=null&&(!isFinite(Number(v))||Number(v)<0))return "Enter the cost as a number, for example 120.50.";
  }
  if(keys.indexOf("dateTo")>=0&&d.dateFrom&&d.dateTo&&d.dateTo<d.dateFrom)return "Date To must be on or after Date From.";
  if(keys.indexOf("cost")>=0||keys.length>3){var be=bpErr(d,0);if(be)return be}
  return "";
}
function bpSec(d){return '<div class="sec"><h3>Cost breakdown (optional)</h3><p class="hint">Split the cost into partial amounts per year, each with its budget article. When you add partial amounts, the cost is their sum.</p>'+bpBlock(d,null,0,msYears("sw",d))+'</div>'}
function drawWizard(){
  var w=S.wiz,d=w.data,h;cfLoad(d,"software");
  var head='<div class="ph"><h2>'+(w.id?"Edit software":"Add software")+'</h2><button class="btn small" type="button" data-act="close">Cancel</button></div>';
  if(w.mode==="full"){
    h=head+'<div style="display:grid;gap:12px">'+swF().map(function(f){
      var ih=inputHtml(f,d[f.k],"w_");if(f.k==="cost"&&bpHas(d))ih=ih.replace("<input","<input readonly");
      return '<label class="f">'+f.l+(f.req?' *':'')+(f.hint?'<small>'+esc(f.hint)+'</small>':'')+ih+'</label>'+(f.k==="cost"?'</div>'+bpSec(d)+'<div style="display:grid;gap:12px">':'');
    }).join("")+'<label class="f">Reminder<small>Alert me before expiry</small>'+remindSel(d.remindDays||30,"w_remind")+'</label></div>'+
    '<div class="err" id="werr">'+esc(w.err)+'</div>'+
    '<div class="actions"><button class="btn primary" type="button" data-act="wsave">Save</button>'+(w.id?'':'<button class="btn" type="button" data-act="wstep">Guided mode</button>')+'</div>';
  }else{
    var total=swF().length+1,i=w.i,last=i===total-1;
    var body;
    if(i<swF().length){var f=swF()[i];body='<label class="f"><span class="big-q">'+f.q+(f.req?'':' <small>(optional)</small>')+'</span>'+inputHtml(f,d[f.k],"w_")+'</label>'}
    else body='<label class="f"><span class="big-q">When should we alert you before it expires?</span>'+remindSel(d.remindDays||30,"w_remind")+'</label>'+bpSec(d);
    h=head+'<div class="steps" aria-hidden="true"><i style="width:'+Math.round((i+1)/total*100)+'%"></i></div><div class="hint">Step '+(i+1)+' of '+total+'</div>'+body+
    '<div class="err" id="werr">'+esc(w.err)+'</div>'+
    '<div class="actions">'+(i>0?'<button class="btn" type="button" data-act="wback">Back</button>':'')+
    '<button class="btn primary" type="button" data-act="'+(last?'wsave':'wnext')+'">'+(last?'Save':'Next')+'</button></div>'+
    '<div><button class="btn small" type="button" data-act="wfull">Switch to full form</button></div>';
  }
  openPanel(h,"wiz");
}
async function wizSave(){
  collect();var w=S.wiz;
  var e=validate(swF().map(function(f){return f.k}));
  if(e){w.err=e;var x=$("#werr");if(x)x.textContent=e;return}
  var base=w.id?byId(w.id):{};
  var rec=norm(Object.assign({},base,w.data));cfApply(rec,w.data,"software");
  rec.budget=bpClean(w.data);if(rec.budget.length)rec.cost=bpSum(rec.budget);
  var id=w.id||uid();
  if(await save(id,rec)){closePanel();toast(w.id?"Saved":"Added "+rec.name);if(!w.id)showDetail(id)}
}
function wizNext(){
  collect();var w=S.wiz,f=swF()[w.i];
  var e=validate([f.k]);
  if(e){w.err=e;var x=$("#werr");if(x)x.textContent=e;return}
  if(f.k==="dateFrom"&&!w.data.dateTo)w.data.dateTo=addYear(w.data.dateFrom);
  if(f.k==="dateTo"){e=validate(["dateTo"]);if(e){w.err=e;drawWizard();return}}
  w.err="";w.i++;drawWizard();
}

/* ---------- renew ---------- */
function showRenew(id){
  var it=byId(id);if(!it)return;
  var nf=it.dateTo?addDays(it.dateTo,1):todayIso();
  openPanel('<div class="ph"><h2>Renew '+esc(it.name)+'</h2><button class="btn small" type="button" data-act="back" data-id="'+esc(id)+'">Cancel</button></div>'+
   '<p class="hint">Current period: '+fmtDate(it.dateFrom)+' – '+fmtDate(it.dateTo)+' at '+money(it.cost)+'. It is kept in the renewal history.</p>'+
   '<div class="grid2"><label class="f">New Date From<input id="r_from" type="date" value="'+nf+'"></label><label class="f">New Date To<input id="r_to" type="date" value="'+addYear(nf)+'"></label></div>'+
   '<label class="f">New cost excl. VAT (€)<input id="r_cost" type="number" step="0.01" min="0" value="'+esc(it.cost)+'" inputmode="decimal"></label>'+
   '<div class="err" id="rerr"></div><div class="actions"><button class="btn primary" type="button" data-act="rsave" data-id="'+esc(id)+'">Confirm renewal</button></div>',"renew");
  $("#r_from").addEventListener("change",function(){var v=$("#r_from").value;if(parseIso(v))$("#r_to").value=addYear(v)});
}
async function doRenew(id){
  var it=byId(id),f=$("#r_from").value,t=$("#r_to").value,c=$("#r_cost").value,err="";
  if(!parseIso(f)||!parseIso(t))err="Enter both dates.";
  else if(t<f)err="New Date To must be on or after New Date From.";
  else if(c===""||!isFinite(Number(c))||Number(c)<0)err="Enter the new cost as a number.";
  if(err){$("#rerr").textContent=err;return}
  var rec=norm(it);
  rec.history=(it.history||[]).concat([{from:it.dateFrom,to:it.dateTo,cost:Number(it.cost)||0,renewedOn:todayIso()}]);
  rec.dateFrom=f;rec.dateTo=t;rec.cost=Number(c);rec.budget=[];rec.sample=it.sample;
  if(await save(id,rec)){toast("Renewed until "+fmtDate(t));showDetail(id)}
}

/* ---------- attachments ---------- */
/* Largest attachment: 20 MB, or less when the WordPress server (PHP upload_max_filesize / post_max_size) allows less. */
function attMax(){var m=window.RL_CFG&&Number(window.RL_CFG.maxUpload);return m>0?Math.min(m,20971520):20971520}
function attMB(){var v=attMax()/1048576;return v>=10?String(Math.round(v)):String(Math.round(v*10)/10).replace(".",",")}
function attTooBig(f,el){
  if(f.size<=attMax())return "";
  var sz=(f.size/1048576).toFixed(1).replace(".",",");
  return el?"το αρχείο είναι "+sz+" MB και το όριο είναι "+attMB()+" MB"+(window.RL_CFG&&attMax()<20971520?" (όριο του server: ζήτα από τον διαχειριστή του hosting να αυξήσει τα upload_max_filesize και post_max_size σε τουλάχιστον 20M)":""):"file is "+sz+" MB, the limit is "+attMB()+" MB";
}
var MIME={html:"text/html",htm:"text/html",pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",csv:"text/csv",txt:"text/plain",md:"text/markdown",json:"application/json",xml:"application/xml",eml:"message/rfc822",msg:"application/vnd.ms-outlook",lic:"application/octet-stream",rtf:"application/rtf",log:"text/plain",ics:"text/calendar",vcf:"text/vcard",zip:"application/zip","7z":"application/x-7z-compressed",rar:"application/vnd.rar",gz:"application/gzip",tar:"application/x-tar",p7m:"application/pkcs7-mime",p7s:"application/pkcs7-signature",cer:"application/pkix-cert",crt:"application/x-x509-ca-cert",tif:"image/tiff",tiff:"image/tiff",bmp:"image/bmp",dwg:"application/octet-stream",dxf:"application/octet-stream",mp4:"video/mp4",webm:"video/webm"};
function reopen(cat,id){cat==="co"?showCoDetail(id):cat==="tn"?showTnDetail(id):cat==="ct"?showCtDetail(id):showDetail(id)}
async function attachFiles(files){
  var cat=S.openCat||"sw",id=S.open,it=getItem(cat,id);if(!it||!S.assets)return;
  var list=(it.attachments||[]).slice(),n=0,el=cat!=="sw";
  for(var i=0;i<files.length;i++){
    var f=files[i],ext=(f.name.split(".").pop()||"").toLowerCase(),type=f.type&&MIME[ext]===f.type?f.type:MIME[ext]||f.type;
    var big=attTooBig(f,el);if(big){toast(f.name+": "+big);continue}
    try{var r=await S.assets.upload(f,type?{type:type}:undefined);list.push({id:r.id,name:f.name,size:r.sizeBytes});n++}
    catch(e){toast(f.name+": "+(e&&e.code==="unsupported_type"?(el?"μη υποστηριζόμενος τύπος (PDF, εικόνα, CSV, κείμενο, Word, Excel, PowerPoint, HTML, XML, email (eml/msg), άδεια (lic), zip/7z/rar κ.ά.)":"file type not supported (use PDF, image, CSV, text, Word, Excel, PowerPoint, HTML, XML, email (eml/msg), license (lic), zip/7z/rar and similar)"):e&&e.code==="too_large"?(el?"μεγαλύτερο από το όριο ("+attMB()+" MB)":"larger than the limit ("+attMB()+" MB)"):(el?"αποτυχία μεταφόρτωσης":"upload failed")))}
  }
  if(n){var rec=strip(it);rec.attachments=list;if(await save(id,rec,cat)){toast(el?n+" αρχείο/α προστέθηκαν":n+" file"+(n>1?"s":"")+" attached");reopen(cat,id)}}
}
async function removeFile(i){
  var cat=S.openCat||"sw",it=getItem(cat,S.open);if(!it)return;var a=(it.attachments||[])[i];if(!a)return;
  var rec=strip(it);rec.attachments=it.attachments.filter(function(_,j){return j!==i});
  var before=(it.attachments||[]).slice(),id=it.id,el=cat!=="sw";
  if(await save(id,rec,cat)){
    reopen(cat,id);
    /* the file itself is only deleted when the 8 s to undo are over */
    toastUndo(el?"Το αρχείο αφαιρέθηκε":"File removed",async function(){
      var cur=getItem(cat,id);if(!cur)return;var r2=strip(cur);r2.attachments=before;
      if(await save(id,r2,cat)&&S.open===id)reopen(cat,id);
    },function(){if(fileInUse(a.id))return;try{S.assets.delete(a.id)}catch(e){}},el);
  }
}

/* =============== MILESTONES (both categories) =============== */
var REMIND_MS=[30,60];
function msIsEl(cat){return cat==="ct"}
function msList(it){return (it&&it.milestones)||[]}
/* Number of "years" of a record: contracts use their year table; software counts whole years from Date From to Date To. */
function msYears(cat,it){
  if(cat==="ct")return Math.max(1,(it.years||[]).length);
  var a=parseIso(it.dateFrom),b=parseIso(it.dateTo);if(!a||!b||b<a)return 1;
  var n=1;while(n<60&&addDays(addMonths(it.dateFrom,12*n),-1)<it.dateTo)n++;
  return n;
}
function msYearRange(cat,it,y){
  if(cat==="ct"){var r=(it.years||[])[y-1];return r?fmtDate(r.from)+" – "+fmtDate(r.to):""}
  var f=addMonths(it.dateFrom,12*(y-1));if(!parseIso(f))return "";
  var t=addDays(addMonths(it.dateFrom,12*y),-1);if(it.dateTo&&t>it.dateTo)t=it.dateTo;
  return fmtDate(f)+" – "+fmtDate(t);
}
function msInfo(m){
  var el=!!m._el,d=daysLeft(m.due);
  if(m.done)return {k:"ok",t:el?"Ολοκληρώθηκε":"Done",d:d};
  if(d==null)return {k:"ok",t:el?"Χωρίς ημερομηνία":"No date",d:null};
  if(d<0)return {k:"bad",t:el?"Εκπρόθεσμο":"Overdue",d:d};
  if(d<=(+m.remind||30))return {k:"warn",t:el?"Πλησιάζει":"Due soon",d:d};
  return {k:"ok",t:el?"Προγραμματισμένο":"Scheduled",d:d};
}
function msAll(cat){
  var out=[];
  listOf(cat).forEach(function(it){if(cat==="ct"&&ctInfo(it).archived)return;msList(it).forEach(function(m){
    var s=msInfo(Object.assign({_el:cat==="ct"},m));
    if(s.k!=="ok")out.push({cat:cat,it:it,m:m,s:s});
  })});
  out.sort(function(a,b){return a.s.d-b.s.d});
  return out;
}
function msAttn(cat){return msAll(cat).length}
function msTitle(cat,it){return cat==="ct"?it.title:it.name}
function msAlertHtml(cat){
  var l=msAll(cat);if(!l.length)return "";
  var el=cat==="ct";
  var h=l.slice(0,4).map(function(x){
    return '<div class="alert'+(x.s.k==="bad"?' bad':'')+'"><span>'+(el?"Milestone: ":"Milestone: ")+'<b>'+esc(x.m.description)+'</b> · '+esc(msTitle(cat,x.it))+' · '+fmtDate(x.m.due)+' ('+(el?dayTextEl(x.s.d):dayText(x.s.d))+')</span>'+
      '<button type="button" data-act="openid" data-cat="'+cat+'" data-id="'+esc(x.it.id)+'">'+(el?"Άνοιγμα":"Open")+'</button></div>';
  }).join("");
  if(l.length>4)h+='<div class="alert"><span>+'+(l.length-4)+' milestones</span></div>';
  return h;
}
function msFilesHtml(m){
  var f=(m.attachments||[]).map(function(a){return '<a href="#" data-blob="'+esc(a.id)+'">'+esc(a.name)+'</a>'}).join(" · ");
  return f?'<div class="msf">'+f+'</div>':"";
}
function msSection(cat,it){
  var el=cat==="ct",L=msList(it),max=msYears(cat,it);
  L.forEach(function(m){if(m.year>max)max=m.year});
  var h='<div class="sec"><h3>Milestones</h3><span class="hint">'+(el?"Πρόσθεσε milestones ανά έτος. Η ειδοποίηση εμφανίζεται και στέλνεται με email 30 ή 60 ημέρες πριν την ημερομηνία παράδοσης.":"Add milestones per year. The alert shows on screen and is e-mailed 30 or 60 days before the delivery date.")+'</span>';
  for(var y=1;y<=max;y++){
    var rows=L.filter(function(m){return m.year===y}).sort(function(a,b){return (a.due||"9999").localeCompare(b.due||"9999")});
    h+='<div class="msyear"><div class="msyh"><div><b>'+(el?"Έτος ":"Year ")+y+'</b> <span class="hint">'+msYearRange(cat,it,y)+'</span></div>'+
      '<button class="btn small" type="button" data-act="msadd" data-year="'+y+'">'+(el?"+ Προσθήκη milestone":"+ Add milestone")+'</button></div>';
    if(rows.length)h+='<ul class="files ms">'+rows.map(function(m){
      var s=msInfo(Object.assign({_el:el},m));
      return '<li class="'+(m.done?"done":"")+'"><div class="msb"><div><b>'+esc(m.description)+'</b> <span class="pill '+s.k+'">'+s.t+'</span></div>'+
        '<div class="hint">'+fmtDate(m.due)+(s.d!=null&&!m.done?' · '+(el?dayTextEl(s.d):dayText(s.d)):'')+' · '+(el?"ειδοποίηση ":"alert ")+(+m.remind||30)+(el?" ημ. πριν":" days before")+'</div>'+
        (m.comments?'<div class="msc">'+esc(m.comments)+'</div>':'')+msFilesHtml(m)+'</div>'+
        '<div class="actions"><button class="btn small" type="button" data-act="msdone" data-mid="'+esc(m.id)+'">'+(m.done?(el?"Επανάνοιγμα":"Reopen"):(el?"Ολοκληρώθηκε":"Mark done"))+'</button>'+
        '<button class="btn small" type="button" data-act="msedit" data-mid="'+esc(m.id)+'">'+(el?"Επεξεργασία":"Edit")+'</button>'+
        '<button class="btn small danger" type="button" data-act="msdel" data-mid="'+esc(m.id)+'">'+(el?"Διαγραφή":"Delete")+'</button></div></li>';
    }).join("")+'</ul>';
    else h+='<span class="hint">'+(el?"Κανένα milestone για αυτό το έτος.":"No milestones for this year.")+'</span>';
    h+='</div>';
  }
  return h+'</div>';
}
function showMsForm(cat,id,mid,year){
  var it=getItem(cat,id);if(!it)return;
  var m=mid?msList(it).find(function(x){return x.id===mid}):null;
  S.ms={cat:cat,id:id,mid:mid||null,year:m?m.year:year,added:[],removed:[],err:"",
    d:m?JSON.parse(JSON.stringify(m)):{description:"",due:"",remind:30,comments:"",done:false,attachments:[]}};
  msDraw();
}
function msCollect(){
  var w=S.ms,d=w.d,a=$("#ms_desc");if(!a)return;
  d.description=a.value;d.due=$("#ms_due").value;d.remind=+$("#ms_rem").value||30;d.comments=$("#ms_com").value;
}
function msDraw(){
  var w=S.ms,d=w.d,el=w.cat==="ct",it=getItem(w.cat,w.id);
  var files=(d.attachments||[]).map(function(a,i){return '<li><a href="#" data-blob="'+esc(a.id)+'">'+esc(a.name)+'</a><button type="button" class="btn small danger" data-act="msrmfile" data-i="'+i+'">'+(el?"Αφαίρεση":"Remove")+'</button></li>'}).join("");
  openPanel('<div class="ph"><div><h2>'+(w.mid?(el?"Επεξεργασία milestone":"Edit milestone"):(el?"Νέο milestone":"New milestone"))+'</h2><span class="hint">'+esc(msTitle(w.cat,it))+' · '+(el?"Έτος ":"Year ")+w.year+'</span></div><button class="btn small" type="button" data-act="mscancel">'+(el?"Άκυρο":"Cancel")+'</button></div>'+
   '<label class="f">'+(el?"Περιγραφή":"Description")+'<textarea id="ms_desc" maxlength="1000">'+esc(d.description)+'</textarea></label>'+
   '<div class="grid2"><label class="f">'+(el?"Ημερομηνία παράδοσης":"Delivery date")+'<input id="ms_due" type="date" value="'+esc(d.due)+'"></label>'+
   '<label class="f">'+(el?"Ειδοποίηση":"Alert")+'<select id="ms_rem">'+remOpts(d.remind,REMIND_MS,el?" ημέρες πριν":" days before")+'</select></label></div>'+
   '<label class="f">'+(el?"Σχόλια":"Comments")+'<textarea id="ms_com" maxlength="4000">'+esc(d.comments)+'</textarea></label>'+
   '<div class="sec"><h3>'+(el?"Συνημμένα":"Attachments")+'</h3>'+(files?'<ul class="files">'+files+'</ul>':'<span class="hint">'+(el?"Δεν υπάρχουν συνημμένα.":"No attachments yet.")+'</span>')+
   '<div><button class="btn" type="button" data-act="msattach"'+(S.assets?'':' disabled')+'>'+(el?"+ Προσθήκη αρχείων":"+ Attach files")+'</button> <span class="hint">'+(el?"Μέγιστο μέγεθος αρχείου "+attMB()+" MB.":"Max file size "+attMB()+" MB.")+'</span></div></div>'+
   '<div class="err" id="mserr">'+esc(w.err)+'</div><div class="actions"><button class="btn primary" type="button" data-act="mssave">'+(el?"Αποθήκευση":"Save")+'</button></div>',"ms");
}
function msPick(){
  var inp=document.createElement("input");inp.type="file";inp.multiple=true;
  inp.addEventListener("change",function(){var fl=Array.prototype.slice.call(inp.files);if(fl.length)msUpload(fl)});
  inp.click();
}
async function msUpload(files){
  var w=S.ms;if(!w||!S.assets)return;msCollect();var el=w.cat==="ct";
  for(var i=0;i<files.length;i++){
    var f=files[i],ext=(f.name.split(".").pop()||"").toLowerCase(),type=f.type&&MIME[ext]===f.type?f.type:MIME[ext]||f.type;
    var big=attTooBig(f,el);if(big){toast(f.name+": "+big);continue}
    try{var r=await S.assets.upload(f,type?{type:type}:undefined);w.d.attachments.push({id:r.id,name:f.name,size:r.sizeBytes});w.added.push(r.id)}
    catch(e){toast(f.name+": "+(e&&e.code==="unsupported_type"?(el?"μη υποστηριζόμενος τύπος":"file type not supported"):e&&e.code==="too_large"?(el?"μεγαλύτερο από το όριο ("+attMB()+" MB)":"larger than the limit ("+attMB()+" MB)"):(el?"αποτυχία μεταφόρτωσης":"upload failed")))}
  }
  msDraw();
}
async function msSave(){
  var w=S.ms;msCollect();var d=w.d,el=w.cat==="ct",it=getItem(w.cat,w.id);if(!it)return;
  var e="";
  if(!String(d.description).trim())e=el?"Συμπλήρωσε την περιγραφή.":"Enter a description.";
  else if(!parseIso(d.due))e=el?"Επίλεξε ημερομηνία παράδοσης.":"Choose a delivery date.";
  if(e){w.err=e;var x=$("#mserr");if(x)x.textContent=e;return}
  var obj={id:w.mid||uid(),year:w.year,description:String(d.description).trim(),due:d.due,remind:d.remind===60?60:30,comments:String(d.comments||"").trim(),done:!!d.done,attachments:d.attachments||[]};
  var list=msList(it).slice(),i=list.findIndex(function(x){return x.id===obj.id});
  if(i>=0)list[i]=obj;else list.push(obj);
  var rec=strip(it);rec.milestones=list;
  if(await save(w.id,rec,w.cat)){
    var gone=(w.removed||[]).slice();
    for(var k=0;k<gone.length;k++){try{await S.assets.delete(gone[k])}catch(_){}}
    S.ms=null;toast(el?"Το milestone αποθηκεύτηκε":"Milestone saved");reopen(w.cat,w.id);
  }
}
async function msCancel(){
  var w=S.ms;if(!w)return;
  var add=(w.added||[]).slice();S.ms=null;
  for(var k=0;k<add.length;k++){try{await S.assets.delete(add[k])}catch(_){}}
  reopen(w.cat,w.id);
}
async function msToggleDone(mid){
  var cat=S.openCat||"sw",it=getItem(cat,S.open);if(!it)return;
  var list=msList(it).map(function(m){return m.id===mid?Object.assign({},m,{done:!m.done}):m});
  var rec=strip(it);rec.milestones=list;
  if(await save(it.id,rec,cat))reopen(cat,it.id);
}
async function msDelete(mid){
  var cat=S.openCat||"sw",it=getItem(cat,S.open);if(!it)return;
  var m=msList(it).find(function(x){return x.id===mid});if(!m)return;
  var before=msList(it).slice(),id=it.id,el=cat==="ct",rec=strip(it);rec.milestones=before.filter(function(x){return x.id!==mid});
  if(await save(id,rec,cat)){
    reopen(cat,id);
    /* the milestone's files are only deleted when the 8 s to undo are over */
    toastUndo(el?"Το milestone διαγράφηκε":"Milestone deleted",async function(){
      var cur=getItem(cat,id);if(!cur)return;var r2=strip(cur);r2.milestones=before;
      if(await save(id,r2,cat)&&S.open===id)reopen(cat,id);
    },async function(){var f=(m.attachments||[]);for(var k=0;k<f.length;k++){try{await S.assets.delete(f[k].id)}catch(_){}}},el);
  }
}

/* Passwords are no longer kept: records saved by older versions lose theirs the first time they are loaded. */
async function purgePasswords(){
  var old=S.items.filter(function(i){return Object.prototype.hasOwnProperty.call(i,"password")});
  for(var k=0;k<old.length;k++){var rec=strip(old[k]);delete rec.password;try{await col("software").doc(old[k].id).set(rec)}catch(e){}}
}

/* ---------- list columns: choose which to show, sort every column ---------- */
function emailsErr(v,el){
  var l=String(v||"").split(/[,;\s]+/).filter(Boolean);
  if(l.length>20)return el?"Έως 20 διευθύνσεις email.":"At most 20 e-mail addresses.";
  for(var i=0;i<l.length;i++){if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(l[i]))return (el?"Μη έγκυρο email: ":"Invalid e-mail address: ")+l[i]}
  return "";
}
function msOpen(it){return msList(it).filter(function(m){return !m.done}).length}
function msText(it){
  return msList(it).map(function(m){return "Έτος "+m.year+": "+m.description+" - "+fmtDate(m.due)+" ("+(+m.remind||30)+"d)"+(m.done?" [done]":"")}).join("; ");
}
function cTxt(f){return {v:function(it){return esc(it[f]||"—")},s:function(it){return it[f]||""}}}
function cNum(f){return {v:function(it){return '<span class="num">'+(it[f]===""||it[f]==null?"—":money(it[f]))+'</span>'},s:function(it){return it[f]===""||it[f]==null?"":Number(it[f])}}}
function cDate(f){return {v:function(it){return '<span class="mono">'+fmtDate(it[f])+'</span>'},s:function(it){return it[f]||""}}}
function cFiles(){return {v:function(it){var n=(it.attachments||[]).length;return '<span class="sub">'+(n?n+" file"+(n>1?"s":""):"—")+'</span>'},s:function(it){return (it.attachments||[]).length}}}
function cMs(){return {v:function(it){var a=msList(it).length,o=msOpen(it);return '<span class="num">'+(a?o+" / "+a:"—")+'</span>'},s:function(it){return msOpen(it)}}}
function cEm(){return {v:function(it){return '<span class="sub">'+esc(it.emails||"—")+'</span>'},s:function(it){return it.emails||""}}}
function cdef(k,l,d,w,o){return Object.assign({k:k,l:l,d:d,w:w},o)}
var COLS={
 sw:[
  cdef("name","Software",1,"2fr",{v:function(it){return '<span class="n">'+esc(it.name)+(it.sample?' <span class="hint">(sample)</span>':'')+'</span>'},s:function(it){return it.name||""}}),
  cdef("vendor","Vendor",1,"1.2fr",cTxt("vendor")),
  cdef("description","Description",0,"2fr",cTxt("description")),
  cdef("website","Website",0,"1.4fr",cTxt("website")),
  cdef("username","Username",0,"1.2fr",cTxt("username")),
  cdef("dateFrom","Date From",1,"1fr",cDate("dateFrom")),
  cdef("dateTo","Expires",1,"1fr",cDate("dateTo")),
  cdef("status","Status",1,"1.2fr",{v:function(it){var s=status(it);return '<span class="pill '+s.k+'">'+s.t+'</span> <span class="sub">'+dayText(s.d)+'</span>'},s:function(it){var d=status(it).d;return d==null?"":d}}),
  cdef("cost","Cost excl. VAT",1,"1fr",cNum("cost")),
  cdef("remindDays","Reminder",0,"1fr",{v:function(it){return '<span class="num">'+(+it.remindDays||30)+' d</span>'},s:function(it){return +it.remindDays||30}}),
  cdef("milestones","Milestones",0,"1fr",cMs()),
  cdef("emails","Notification emails",0,"1.6fr",cEm()),
  cdef("files","Files",1,"90px",cFiles())
 ],
 ct:[
  cdef("title","Σύμβαση",1,"2fr",{v:function(c){return '<span class="n">'+esc(c.title)+(c.sample?' <span class="hint">(δείγμα)</span>':'')+'</span>'},s:function(c){return c.title||""}}),
  cdef("tender","Αρ. διαγωνισμού",1,"1fr",cTxt("tender")),
  cdef("description","Περιγραφή",0,"2fr",cTxt("description")),
  cdef("contractor","Ανάδοχος",1,"1.3fr",{v:function(c){return esc(ctrOf(c).name||"—")},s:function(c){return ctrOf(c).name}}),
  cdef("coordinator","Συντονιστής",0,"1.2fr",cTxt("coordinator")),
  cdef("months","Διάρκεια (μήνες)",0,"1fr",{v:function(c){return '<span class="num">'+esc(c.months||"—")+'</span>'},s:function(c){return Number(c.months)||""}}),
  cdef("dateFrom","Έναρξη",0,"1fr",cDate("dateFrom")),
  cdef("dateTo","Λήξη",1,"1fr",cDate("dateTo")),
  cdef("status","Κατάσταση",1,"1.3fr",{v:function(c){var s=ctInfo(c);return '<span class="pill '+s.k+'">'+s.t+'</span> <span class="sub">'+esc(s.sub)+'</span>'},s:function(c){var d=ctInfo(c).d;return d==null?"":d}}),
  cdef("cost","Κόστος",1,"1fr",{v:function(c){return '<span class="num">'+money(ctTotal(c))+'</span>'},s:function(c){return ctTotal(c)}}),
  cdef("milestones","Milestones",0,"1fr",cMs()),
  cdef("emails","Email ειδοποιήσεων",0,"1.6fr",cEm()),
  cdef("files","Αρχεία",1,"90px",cFiles())
 ],
 co:[
  cdef("name","Ανάδοχος",1,"2fr",{v:function(c){return '<span class="n">'+esc(c.name)+(c.sample?' <span class="hint">(δείγμα)</span>':'')+'</span>'},s:function(c){return c.name||""}}),
  cdef("address","Διεύθυνση",0,"2fr",{v:function(c){return esc(coAddr(c)||"—")},s:function(c){return coAddr(c)}}),
  cdef("city","Πόλη",0,"1fr",cTxt("city")),
  cdef("contact","Άτομο επικοινωνίας",1,"1.3fr",cTxt("contact")),
  cdef("email","Email",1,"1.5fr",cTxt("email")),
  cdef("phone","Τηλέφωνο",1,"1.2fr",cTxt("phone")),
  cdef("active","Ενεργές συμβάσεις",1,"1fr",{v:function(c){return '<span class="num">'+coStats(c.id).n+'</span>'},s:function(c){return coStats(c.id).n}}),
  cdef("tenders","Αρ. διαγωνισμού ενεργών συμβάσεων",1,"2fr",{v:function(c){var t=coStats(c.id).tenders;return t.length?'<span class="sub">'+t.map(esc).join(", ")+'</span>':"—"},s:function(c){return coStats(c.id).tenders.join(", ")}})
 ],
 tn:[
  cdef("title","Διαγωνισμός",1,"2fr",{v:function(c){return '<span class="n">'+esc(c.title)+(c.sample?' <span class="hint">(δείγμα)</span>':'')+'</span>'},s:function(c){return c.title||""}}),
  cdef("tender","Αρ. διαγωνισμού",1,"1fr",cTxt("tender")),
  cdef("description","Περιγραφή",0,"2fr",cTxt("description")),
  cdef("months","Διάρκεια (μήνες)",1,"1fr",{v:function(c){return '<span class="num">'+esc(c.months||"—")+'</span>'},s:function(c){return Number(c.months)||""}}),
  cdef("dateFrom","Εκτιμ. έναρξη",1,"1fr",cDate("dateFrom")),
  cdef("dateTo","Εκτιμ. λήξη",1,"1fr",cDate("dateTo")),
  cdef("status","Κατάσταση",1,"1.4fr",{v:function(c){var s=tnInfo(c);return '<span class="pill '+s.k+'">'+s.t+'</span> <span class="sub">'+esc(s.sub)+'</span>'},s:function(c){return tnInfo(c).t}}),
  cdef("cost","Εκτιμώμενο κόστος",1,"1fr",cNum("cost")),
  cdef("files","Αρχεία",1,"90px",cFiles())
 ]
};
function loadPrefs(){
  var d={cols:{sw:[],ct:[],tn:[],co:[]},sort:{sw:{k:"dateTo",dir:1},ct:{k:"dateTo",dir:1},tn:{k:"dateFrom",dir:1},co:{k:"name",dir:1}}},p=null;
  try{p=JSON.parse(localStorage.getItem("rl.listprefs")||"null")}catch(e){}
  ["sw","ct","tn","co"].forEach(function(c){
    var keys=colsAll(c).map(function(x){return x.k}),sel=p&&p.cols&&Array.isArray(p.cols[c])?p.cols[c].filter(function(k){return keys.indexOf(k)>=0}):null;
    d.cols[c]=sel&&sel.length?sel:colsAll(c).filter(function(x){return x.d}).map(function(x){return x.k});
    var so=p&&p.sort&&p.sort[c];if(so&&keys.indexOf(so.k)>=0)d.sort[c]={k:so.k,dir:so.dir===-1?-1:1};
  });
  return d;
}
function savePrefs(){try{localStorage.setItem("rl.listprefs",JSON.stringify({cols:S.cols,sort:S.sort}))}catch(e){}}
function colsOf(cat){var sel=S.cols[cat];return colsAll(cat).filter(function(c){return sel.indexOf(c.k)>=0})}
function sortList(cat,list){
  var so=S.sort[cat],c=colsAll(cat).filter(function(x){return x.k===so.k})[0]||colsAll(cat).filter(function(x){return x.k==="dateTo"})[0];
  return list.slice().sort(function(a,b){
    var x=c.s(a),y=c.s(b),xe=x===""||x==null,ye=y===""||y==null;
    if(xe||ye)return xe&&ye?0:xe?1:-1; /* empty values always last */
    var r=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"el",{numeric:true,sensitivity:"base"});
    return r*so.dir||String(a.id).localeCompare(String(b.id));
  });
}
function listHtml(cat,rows){
  var cs=colsOf(cat),so=S.sort[cat],el=cat!=="sw";
  var MIN={name:210,title:230,description:250,website:180,emails:210,status:200,files:80,months:110,remindDays:90,milestones:100,cost:110,tender:130,vat:120,city:120,active:120,tenders:150,phone:140};
  var mins=cs.map(function(c){return MIN[c.k]||125}),total=mins.reduce(function(x,y){return x+y},0);
  var tpl=cs.map(function(c,i){return c.k==="files"?mins[i]+"px":"minmax("+mins[i]+"px,"+c.w+")"}).join(" ");
  var st='grid-template-columns:'+tpl+';min-width:'+total+'px';
  var h='<div class="lw"><div class="head"'+(el?' lang="el"':'')+' style="'+st+'">'+cs.map(function(c){
    var on=so.k===c.k;
    return '<button type="button" class="hc" data-sort="'+c.k+'" aria-sort="'+(on?(so.dir===1?"ascending":"descending"):"none")+'" title="'+(el?"Ταξινόμηση":"Sort")+'">'+esc(c.l)+'<span class="ar">'+(on?(so.dir===1?" ▲":" ▼"):"")+'</span></button>';
  }).join("")+'</div>';
  h+=rows.map(function(it){
    return '<button type="button" class="row" data-id="'+esc(it.id)+'" style="'+st+'">'+cs.map(function(c,i){
      var sv=c.s(it),tt=sv===""||sv==null||c.k==="status"?"":' title="'+esc(String(sv))+'"';
      return '<span class="cell" data-l="'+esc(c.l)+'"'+(i?'':' data-first="1"')+tt+'>'+c.v(it)+'</span>';
    }).join("")+'</button>';
  }).join("")+'</div>';
  return h;
}
function setSort(k){
  var cat=S.cat,so=S.sort[cat];
  S.sort[cat]=so.k===k?{k:k,dir:-so.dir}:{k:k,dir:1};
  savePrefs();render();
}
function showCols(){
  var cat=S.cat,el=cat!=="sw",sel=S.cols[cat];
  var h='<div class="ph"><h2>'+(el?"Στήλες λίστας":"List columns")+'</h2><button class="btn small" type="button" data-act="close">'+(el?"Κλείσιμο":"Close")+'</button></div>'+
   '<p class="hint">'+(el?"Επίλεξε ποιες στήλες θα εμφανίζονται στην αρχική σελίδα. Μπορείς να ταξινομήσεις οποιαδήποτε στήλη πατώντας στην επικεφαλίδα της.":"Choose which columns are shown on the main page. Click any column heading to sort it ascending or descending.")+'</p>'+
   '<div class="colpick">'+colsAll(cat).map(function(c){return '<label><input type="checkbox" data-col="'+c.k+'"'+(sel.indexOf(c.k)>=0?' checked':'')+'> '+esc(c.l)+'</label>'}).join("")+'</div>'+
   '<div class="actions"><button class="btn" type="button" data-act="colsreset">'+(el?"Προεπιλογή":"Reset to default")+'</button></div>';
  openPanel(h,"cols");
}
function toggleCol(k,on){
  var cat=S.cat,sel=S.cols[cat].slice(),i=sel.indexOf(k);
  if(on&&i<0)sel.push(k);if(!on&&i>=0)sel.splice(i,1);
  if(!sel.length){showCols();return}
  S.cols[cat]=sel;savePrefs();render();
}
function resetCols(){S.cols[S.cat]=colsAll(S.cat).filter(function(x){return x.d}).map(function(x){return x.k});S.sort[S.cat]={k:S.cat==="tn"?"dateFrom":S.cat==="co"?"name":"dateTo",dir:1};savePrefs();render();showCols()}
var PREFS=loadPrefs();S.cols=PREFS.cols;S.sort=PREFS.sort;

/* ---------- budget breakdown: partial amounts per year, each with a budget article ---------- */
var DEFAULT_ARTICLES=[{"code":"03460","desc":"Τηλεπικοινωνιακός, Μηχανογραφικός και Άλλος Εξοπλισμός","cat":"03300","catDesc":"ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ","split":true},{"code":"03461","desc":"Συντήρηση Μηχανογραφικού Εξοπλισμού","cat":"03300","catDesc":"ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ","split":true},{"code":"03462","desc":"Συντήρηση Τηλεπικοινωνιακού Εξοπλισμού","cat":"03300","catDesc":"ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ","split":true},{"code":"03466","desc":"Συντήρηση Εξοπλισμού Γραφείου","cat":"03300","catDesc":"ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ","split":true},{"code":"03468","desc":"Συντήρηση Άλλου Εξοπλισμού","cat":"03300","catDesc":"ΣΥΝΤΗΡΗΣΕΙΣ ΚΑΙ ΕΠΙΔΙΟΡΘΩΣΕΙΣ","split":true},{"code":"03583","desc":"Αγορά Υπηρεσιών","cat":"03580","catDesc":"ΣΥΜΒΑΣΗ ΥΠΗΡΕΣΙΩΝ","split":true},{"code":"07651","desc":"Αγορά Μηχανολογικού και Ηλεκτρονικού Εξοπλισμού","cat":"07650","catDesc":"ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ","split":false},{"code":"07654","desc":"Αγορά Εξοπλισμού Γραφείων","cat":"07650","catDesc":"ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ","split":false},{"code":"07655","desc":"Αγορά Τηλεπικοινωνιακού Εξοπλισμού","cat":"07650","catDesc":"ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ","split":false},{"code":"07661","desc":"Αγορά Ηλεκτρονικών Συστημάτων Ασφάλειας","cat":"07650","catDesc":"ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ","split":false},{"code":"07663","desc":"Αγορά Συστημάτων Πυρασφάλειας","cat":"07650","catDesc":"ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ","split":false},{"code":"07681","desc":"Αγορά Μηχανογραφικού Εξοπλισμού, Προγραμμάτων και Υπηρεσιών","cat":"07650","catDesc":"ΑΓΟΡΑ ΕΞΟΠΛΙΣΜΟΥ","split":false},{"code":"07755","desc":"Εφαρμογή του Προτύπου ISO 27002","cat":"07750","catDesc":"ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ","split":false},{"code":"07758","desc":"Δορυφορικές Εικόνες","cat":"07750","catDesc":"ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ","split":false},{"code":"07759","desc":"Ανάπτυξη Συστήματος Διαχείρισης Μέτρων του Προγράμματος Αγροτικής Ανάπτυξης","cat":"07750","catDesc":"ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ","split":false},{"code":"07760","desc":"Επανασχεδιασμός Ολοκληρωμένου Συστήματος Διαχείρισης και Ελέγχου (ΟΣΔΕ)","cat":"07750","catDesc":"ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ","split":false},{"code":"07761","desc":"Ανάπτυξη Μηχανογραφικών Συστημάτων για την Νέα Κοινή Αγροτική Πολιτική (ΚΑΠ)","cat":"07750","catDesc":"ΑΓΟΡΑ ΑΛΛΩΝ ΣΤΟΙΧΕΙΩΝ ΕΝΕΡΓΗΤΙΚΟΥ","split":false}];
function r2(x){return Math.round((Number(x)||0)*100)/100}
/* article = {code, desc, cat, catDesc, split}; split = "ΠΟΣΟ ΑΝΑΛΥΣΗΣ ΑΝΑ ΕΤΟΣ" is ΝΑΙ */
function normArt(x){
  if(typeof x==="string")return parseArtLines(x)[0]||null;
  if(!x||!x.code)return null;
  return {code:String(x.code),desc:String(x.desc||""),cat:String(x.cat||""),catDesc:String(x.catDesc||""),split:!!x.split};
}
function parseArtLines(text){
  var out=[],seen={};
  String(text||"").split(/\r?\n/).forEach(function(line){
    var p=line.split(/\t|\|/).map(function(x){return x.trim()}),code=(p[0]||"").slice(0,40);
    if(!code||seen[code])return;seen[code]=1;
    out.push({code:code,desc:(p[1]||"").slice(0,200),cat:(p[2]||"").slice(0,40),catDesc:(p[3]||"").slice(0,200),split:/^(Ν|N|YES|Y)/i.test((p[4]||"").trim())});
  });
  return out.slice(0,500);
}
function artLines(list){return list.map(function(a){return [a.code,a.desc,a.cat,a.catDesc,a.split?"ΝΑΙ":"ΌΧΙ"].join(" | ")}).join("\n")}
function articles(){
  var a=null;
  if(window.RL_CFG&&Array.isArray(window.RL_CFG.articles))a=window.RL_CFG.articles;
  else{try{a=JSON.parse(localStorage.getItem("rl.articles")||"null")}catch(e){}}
  if(!Array.isArray(a))a=DEFAULT_ARTICLES;
  return a.map(normArt).filter(Boolean);
}
/* find an article by its code (also accepts "code description" text) */
function artFind(v,list){
  v=String(v||"").trim();if(!v)return null;list=list||articles();
  for(var i=0;i<list.length;i++)if(list[i].code===v)return list[i];
  var t=v.split(/\s/)[0];
  for(var j=0;j<list.length;j++)if(list[j].code===t)return list[j];
  return null;
}
function artLabel(v){var a=artFind(v);return a?(a.code+" — "+a.desc):String(v||"")}
function artOpts(v,el){
  var l=articles(),cur=artFind(v,l),val=cur?cur.code:String(v||""),groups=[],map={};
  l.forEach(function(a){var k=a.cat+"|"+a.catDesc;if(!map[k]){map[k]={t:(a.cat+(a.catDesc?" · "+a.catDesc:"")).trim(),l:[]};groups.push(map[k])}map[k].l.push(a)});
  var opt=function(a){return '<option value="'+esc(a.code)+'"'+(a.code===val?' selected':'')+'>'+esc(a.code+" — "+a.desc)+'</option>'};
  var h='<option value="">'+(el?"— Άρθρο προϋπολογισμού —":"— Budget article —")+'</option>'+groups.map(function(g){return '<optgroup label="'+esc(g.t)+'">'+g.l.map(opt).join("")+'</optgroup>'}).join("");
  if(val&&!cur)h+='<option value="'+esc(val)+'" selected>'+esc(val)+'</option>';
  return h;
}
function bpHas(d,year){return (d.budget||[]).some(function(p){return year==null||+p.year===year})}
function bpSum(list,year){return r2((list||[]).filter(function(p){return year==null||+p.year===year}).reduce(function(a,p){return a+(Number(p.amount)||0)},0))}
function bpCollect(d){(d.budget||[]).forEach(function(p,i){var a=$("#bp_amt_"+i),r=$("#bp_art_"+i),y=$("#bp_yr_"+i);if(a)p.amount=a.value;if(r)p.article=r.value;if(y)p.year=+y.value||1})}
function bpClean(d){return (d.budget||[]).filter(function(p){return p.amount!==""&&p.amount!=null&&isFinite(Number(p.amount))}).map(function(p){return {year:Math.max(1,+p.year||1),amount:r2(p.amount),article:String(p.article||"")}})}
function bpErr(d,el){
  for(var i=0;i<(d.budget||[]).length;i++){var p=d.budget[i];
    if(p.amount===""||p.amount==null){if(p.article)return el?"Συμπλήρωσε το ποσό σε κάθε επιμέρους γραμμή.":"Enter an amount on every partial amount line.";continue}
    if(!isFinite(Number(p.amount))||Number(p.amount)<0)return el?"Τα επιμέρους ποσά πρέπει να είναι αριθμοί, π.χ. 500.50.":"Partial amounts must be numbers, for example 500.50."}
  return "";
}
/* rows for one year (contracts) or all rows with a year selector (software) */
function bpBlock(d,year,el,nYears){
  var rows=(d.budget||[]).map(function(p,i){return {p:p,i:i}}).filter(function(x){return year==null||+x.p.year===year});
  var h='<div class="bpb">'+rows.map(function(x){
    var ysel=year==null?'<select id="bp_yr_'+x.i+'" title="'+(el?"Έτος":"Year")+'">'+Array.apply(null,Array(Math.max(nYears,+x.p.year||1))).map(function(_,k){return '<option value="'+(k+1)+'"'+((+x.p.year||1)===k+1?' selected':'')+'>'+(el?"Έτος ":"Year ")+(k+1)+'</option>'}).join("")+'</select>':'';
    return '<div class="bp">'+ysel+'<input id="bp_amt_'+x.i+'" type="number" step="0.01" min="0" inputmode="decimal" placeholder="'+(el?"Ποσό (€)":"Amount (€)")+'" value="'+esc(x.p.amount)+'"><select id="bp_art_'+x.i+'">'+artOpts(x.p.article,el)+'</select>'+
      '<button type="button" class="btn small danger" data-act="bpdel" data-i="'+x.i+'" title="'+(el?"Αφαίρεση":"Remove")+'">✕</button></div>'}).join("")+
    '<div><button type="button" class="btn small" data-act="bpadd"'+(year!=null?' data-year="'+year+'"':'')+'>'+(el?"+ Επιμέρους ποσό":"+ Add partial amount")+'</button></div></div>';
  return h;
}
function bpDetail(it,el){
  var l=it.budget||[];if(!l.length)return "";
  var years=[];l.forEach(function(p){if(years.indexOf(+p.year)<0)years.push(+p.year)});years.sort(function(a,b){return a-b});
  return '<div class="sec"><h3>'+(el?"Επιμέρους ποσά ανά έτος":"Cost breakdown")+'</h3>'+years.map(function(y){
    var rows=l.filter(function(p){return +p.year===y});
    return '<div class="msyear"><div class="msyh"><b>'+(el?"Έτος ":"Year ")+y+'</b><span class="num">'+(el?"Σύνολο ":"Total ")+(el?mc(bpSum(l,y)):money(bpSum(l,y)))+'</span></div><ul class="files">'+rows.map(function(p){
      return '<li><span>'+esc(p.article?artLabel(p.article):(el?"(χωρίς άρθρο)":"(no article)"))+'</span><span class="num">'+(el?mc(p.amount):money(p.amount))+'</span></li>'}).join("")+'</ul></div>'}).join("")+'</div>';
}
function bpText(it){
  return (it.budget||[]).map(function(p){return "Έτος "+p.year+": "+Number(p.amount).toFixed(2)+(p.article?" ["+artLabel(p.article)+"]":"")}).join("; ");
}
/* how many records (live and trashed) use an article code */
function artUsage(code){
  var n=0,fn=function(it){if((it.budget||[]).concat(it.extras||[]).some(function(p){return String(p.article||"")===code}))n++};
  S.items.forEach(fn);S.contracts.forEach(fn);S.tenders.forEach(fn);S.trash.sw.forEach(fn);S.trash.ct.forEach(fn);S.trash.tn.forEach(fn);
  return n;
}
/* what the user may do with the articles: add (create), change (edit), remove (delete). Browser builds: everything. */
function artCan(k){return !window.RL_CFG||!!(window.RL_CFG.artPerms&&window.RL_CFG.artPerms[k])}
function artRow(a){
  var isNew=!a,ro=!isNew&&!artCan("edit")?' disabled':'',noDel=!artCan("delete")?' disabled':'';
  a=a||{code:"",desc:"",cat:"",catDesc:"",split:false};
  return '<tr><td><input data-k="code" value="'+esc(a.code)+'" size="7" aria-label="Κωδικός"'+ro+'></td><td><input data-k="desc" value="'+esc(a.desc)+'" aria-label="Περιγραφή άρθρου"'+ro+'></td><td><input data-k="cat" value="'+esc(a.cat)+'" size="7" aria-label="Κατηγορία"'+ro+'></td><td><input data-k="catDesc" value="'+esc(a.catDesc)+'" aria-label="Περιγραφή κατηγορίας"'+ro+'></td>'+
   '<td><select data-k="split" aria-label="Ποσό ανάλυσης ανά έτος"'+ro+'><option value="1"'+(a.split?' selected':'')+'>ΝΑΙ</option><option value="0"'+(a.split?'':' selected')+'>ΌΧΙ</option></select></td>'+
   '<td class="artuse">'+(a.code&&artUsage(a.code)?artUsage(a.code):"—")+'</td><td><button class="btn small" type="button" data-act="artdel" title="'+(noDel?'Δεν έχεις δικαίωμα διαγραφής άρθρων':'Διαγραφή άρθρου')+'"'+noDel+'>✕</button></td></tr>';
}
function showArticles(){
  var el=S.cat!=="sw";
  openPanel('<div class="ph"><h2>'+(el?"Άρθρα προϋπολογισμού":"Budget articles")+'</h2><button class="btn small" type="button" data-act="close">'+(el?"Κλείσιμο":"Close")+'</button></div>'+
   '<p class="hint">'+(el?"Κάθε γραμμή είναι ένα άρθρο. «Ποσό ανάλυσης ανά έτος»: ΝΑΙ = το ποσό κατανέμεται ανά μήνα στα έτη της περιόδου, ΌΧΙ = στο έτος έναρξης. Άρθρο που χρησιμοποιείται σε εγγραφές δεν μπορεί να διαγραφεί ή να αλλάξει κωδικό.":"Each row is one article. Split per year: ΝΑΙ = spread by month over the years of the period, ΌΧΙ = start year. An article used by records cannot be deleted or have its code changed.")+'</p>'+
   '<div class="tbl"><table class="art"><thead><tr><th>Κωδικός</th><th>Περιγραφή άρθρου</th><th>Κατηγορία</th><th>Περιγραφή κατηγορίας</th><th>Ανάλυση ανά έτος</th><th>Σε χρήση</th><th></th></tr></thead><tbody id="artRows">'+articles().map(artRow).join("")+'</tbody></table></div>'+
   '<div class="actions"><button class="btn" type="button" data-act="artadd"'+(artCan("create")?'':' disabled title="Δεν έχεις δικαίωμα προσθήκης άρθρων"')+'>'+(el?"+ Προσθήκη νέου άρθρου":"+ Add article")+'</button><button class="btn primary" type="button" data-act="artsave">'+(el?"Αποθήκευση":"Save")+'</button></div>',"arts");
}
function saveArticles(){
  var list=[],seen={};
  [].forEach.call(document.querySelectorAll("#artRows tr"),function(tr){
    var o={};[].forEach.call(tr.querySelectorAll("[data-k]"),function(n){o[n.dataset.k]=n.value.replace(/[|\t\r\n]/g," ").trim()});
    if(!o.code||seen[o.code])return;seen[o.code]=1;
    list.push({code:o.code.slice(0,40),desc:(o.desc||"").slice(0,200),cat:(o.cat||"").slice(0,40),catDesc:(o.catDesc||"").slice(0,200),split:o.split==="1"});
  });
  var kept=[];
  articles().forEach(function(a){if(!seen[a.code]&&artUsage(a.code)){list.push(a);kept.push(a.code)}});
  list=list.slice(0,500);
  function done(){
    closePanel();toast(kept.length?(S.cat!=="sw"?"Αποθηκεύτηκαν. Διατηρήθηκαν επειδή χρησιμοποιούνται: ":"Saved. Kept because they are in use: ")+kept.join(", "):S.cat!=="sw"?"Τα άρθρα αποθηκεύτηκαν":"Articles saved");
    if(S.cat==="bd"||S.cat==="ar")render();else{var ca=$("#cntAr");if(ca)ca.textContent=articles().length||""}
  }
  if(window.RL_SAVE_ARTICLES){
    /* WordPress: the server stores the list (and keeps articles that records still use) */
    window.RL_SAVE_ARTICLES(list).then(function(res){
      window.RL_CFG.articles=res.articles;kept=res.kept||[];done();
    },function(e){toast(e&&e.status===403?"Δεν έχεις δικαίωμα επεξεργασίας άρθρων":"Αποτυχία αποθήκευσης άρθρων: "+((e&&e.message)||""))});
    return;
  }
  try{localStorage.setItem("rl.articles",JSON.stringify(list))}catch(e){}
  done();
}
function bpRedraw(){
  if(ctLike(S.cat)){ctCollect();ctRefresh(true)}else{collect();drawWizard()}
}
function bpLive(){
  if(ctLike(S.cat)){ctCollect();(S.cw.d.years||[]).forEach(function(y,i){var c=$("#cy_cost_"+i);if(c&&bpHas(S.cw.d,i+1))c.value=y.cost});var sp=$("#cSum");if(sp)sp.textContent=mc(ctSum(S.cw.d.years));exTotals()}
  else{collect();var c=$("#w_cost");if(c&&bpHas(S.wiz.data))c.value=bpSum(S.wiz.data.budget)}
}

/* =============== TRASH VIEW =============== */
function fmtDay(ms){if(!ms)return "—";var d=new Date(ms);return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear()}
function renderTrash(cat){
  var el=cat!=="sw",L=(S.trash[cat]||[]).slice().sort(function(a,b){return (b._at||0)-(a._at||0)}),days=trashDays(),now=Date.now();
  var canPurge=window.RL_TRASH?window.RL_TRASH.canPurge(collName(cat)):true;
  $("#stats").innerHTML='<div class="stat"><b>'+L.length+'</b><span>'+(el?"Στον κάδο":"In the trash")+'</span></div>';
  $("#alerts").innerHTML='<div class="alert"><span>'+(el?"Οι εγγραφές στον κάδο δεν εμφανίζονται στη λίστα, δεν στέλνουν υπενθυμίσεις και δεν μπαίνουν στον Προϋπολογισμό. ":"Records in the trash are hidden from the list, send no reminders and are left out of the budget. ")+
    (days?(el?"Διαγράφονται οριστικά "+days+" ημέρες μετά τη διαγραφή.":"They are deleted for good "+days+" days after deletion."):(el?"Δεν διαγράφονται αυτόματα.":"They are not removed automatically."))+'</span></div>';
  $("#chips").innerHTML='<button type="button" class="chip" data-f="all">← '+(el?"Πίσω στη λίστα":"Back to the list")+'</button>';
  var h;
  if(!L.length)h='<div class="empty"><h2>'+(el?"Ο κάδος είναι άδειος":"The trash is empty")+'</h2><p>'+(el?"Οι εγγραφές που διαγράφεις θα εμφανίζονται εδώ και θα μπορείς να τις επαναφέρεις.":"Records you delete show up here and can be restored.")+'</p></div>';
  else h='<div class="tbl"><table class="art"><thead><tr><th>'+(cat==="co"?"Ανάδοχος":cat==="tn"?"Διαγωνισμός":el?"Σύμβαση":"Software")+'</th><th>'+(el?"Διαγράφηκε":"Deleted")+'</th><th>'+(el?"Οριστική διαγραφή σε":"Deleted for good in")+'</th><th></th></tr></thead><tbody>'+L.map(function(it){
    var left=days&&it._at?Math.max(0,Math.ceil((it._at+days*864e5-now)/864e5)):null;
    return '<tr><td>'+esc(recName(cat,it)||"—")+'</td><td>'+fmtDay(it._at)+(it._by?" · "+esc(it._by):"")+'</td><td>'+(left===null?"—":left+(el?" ημ.":" d"))+'</td><td class="trbtn"><button class="btn small" type="button" data-act="trrestore" data-id="'+esc(it.id)+'">'+(el?"Επαναφορά":"Restore")+'</button> '+
      '<button class="btn small danger" type="button" data-act="trpurge" data-id="'+esc(it.id)+'">'+(el?"Οριστική διαγραφή":"Delete for good")+'</button></td></tr>';
  }).join("")+'</tbody></table></div>';
  $("#list").innerHTML=h;
  if(!canPurge)[].forEach.call(document.querySelectorAll('[data-act=trpurge]'),function(n){n.hidden=true});
}

/* =============== BUDGET SHEET (Προϋπολογισμός) =============== */
/*BD-CALC-START*/
function bdParts(s){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");return m?{y:+m[1],m:+m[2],d:+m[3]}:null}
function bdGr(s){var p=bdParts(s);return p?(p.d<10?"0":"")+p.d+"/"+(p.m<10?"0":"")+p.m+"/"+p.y:"—"}
function bdEur(n){var v=r2(n),s=Math.abs(v).toFixed(2).split(".");return (v<0?"-":"")+s[0].replace(/\B(?=(\d{3})+(?!\d))/g,".")+","+s[1]+" €"}
function bdNum(n){return bdEur(n).replace(" €","")}
function bdMo(x){return String(Math.round(x*100)/100).replace(".",",")}
/* months of the period that fall in each calendar year; a part-month counts by the share of its days */
function bdMonths(f,t){
  var a=bdParts(f),b=bdParts(t);if(!a||!b||t<f)return null;
  var by={},tot=0,y=a.y,m=a.m;
  while(y<b.y||(y===b.y&&m<=b.m)){
    var dim=new Date(Date.UTC(y,m,0)).getUTCDate(),s=(y===a.y&&m===a.m)?a.d:1,e=(y===b.y&&m===b.m)?b.d:dim,fr=(e-s+1)/dim;
    by[y]=(by[y]||0)+fr;tot+=fr;m++;if(m>12){m=1;y++}
  }
  return {by:by,total:tot};
}
/* split=true (ΝΑΙ): spread by month over the calendar years of the period; otherwise the whole amount goes to the start year */
function bdAlloc(amount,from,to,split){
  var f=bdParts(from);if(!f)return null;
  var by={},txt,note="";
  if(split){
    var mo=bdMonths(from,to);
    if(mo){
      var ys=Object.keys(mo.by).map(Number).sort(function(a,b){return a-b});
      if(ys.length===1){by[ys[0]]=r2(amount);txt="όλο το διάστημα εντός του "+ys[0]}
      else{
        var acc=0,parts=[];
        ys.forEach(function(y,i){
          var v=i===ys.length-1?r2(amount-acc):r2(amount*mo.by[y]/mo.total);acc=r2(acc+v);by[y]=v;
          parts.push(y+": "+bdMo(mo.by[y])+"/"+bdMo(mo.total)+" μήνες = "+bdEur(v));
        });
        txt="κατανομή ανά μήνα ("+parts.join(", ")+")";
      }
      return {by:by,text:txt};
    }
    note=" (χωρίς έγκυρη ημερομηνία λήξης)";
  }
  by[f.y]=r2(amount);
  return {by:by,text:"ολόκληρο το ποσό στο έτος έναρξης "+f.y+note};
}
/* rows: one per record and article; amounts per calendar year */
var BD_VAT=0.19; /* amounts in the records are net of VAT; the budget sheet shows them including 19% VAT */
function bdBuild(arts,items,contracts,tenders,vat){
  vat=vat==null?bdVat():vat;
  var rows={},order=[],warn=[];
  function rowFor(code,kind,id,desc,head){var k=code+"|"+kind+"|"+id;if(!rows[k]){rows[k]={code:code,kind:kind,id:id,desc:desc,how:head.slice(),by:{}};order.push(k)}return rows[k]}
  function seg(kind,id,desc,head,label,from,to,parts,cost,force){
    var list=(parts||[]).filter(function(p){var n=Number(p.amount);return p.amount!==""&&p.amount!=null&&isFinite(n)&&n!==0});
    if(!list.length&&Number(cost)>0)list=[{amount:Number(cost),article:""}];
    var groups={},gorder=[];
    list.forEach(function(p){
      var a=artFind(p.article,arts),code=a?a.code:"",g=groups[code];
      if(!g){g=groups[code]={a:a,sum:0,amts:[],raw:""};gorder.push(code)}
      g.sum=r2(g.sum+Number(p.amount));g.amts.push(Number(p.amount));
      if(!a&&p.article)g.raw=String(p.article);
    });
    gorder.forEach(function(code){
      var g=groups[code],gross=r2(g.sum*(1+vat)),al=bdAlloc(gross,from,to,!!(force||(g.a&&g.a.split)));
      if(!al){warn.push(desc+" ("+label+"): δεν έχει έγκυρη ημερομηνία έναρξης, το ποσό "+bdEur(g.sum)+" δεν περιλαμβάνεται.");return}
      var r=rowFor(code,kind,id,desc,head);
      Object.keys(al.by).forEach(function(y){r.by[y]=r2((r.by[y]||0)+al.by[y])});
      r.how.push(label+" ("+bdGr(from)+" – "+bdGr(to)+"): "+bdEur(g.sum)+(g.amts.length>1?" = "+g.amts.map(bdNum).join(" + "):"")+(vat?" + ΦΠΑ "+(Math.round(vat*10000)/100)+"% ("+bdEur(r2(gross-g.sum))+") = "+bdEur(gross):"")+" — "+al.text+(g.raw?" · το άρθρο «"+g.raw+"» δεν υπάρχει στη λίστα άρθρων":(code===""?" · χωρίς άρθρο":"")));
    });
  }
  (items||[]).forEach(function(it){
    seg("sw",it.id,it.name||"",["Ανανέωση: "+bdGr(it.dateFrom)+" – "+bdGr(it.dateTo)],"Ποσό",it.dateFrom,it.dateTo,it.budget,it.cost);
  });
  (contracts||[]).forEach(function(c){
    var head=["Διαγωνισμός: "+(c.tender||"—")+" · Διάρκεια: "+(c.months!==""&&c.months!=null?c.months:"—")+" μήνες","Σύμβαση: "+bdGr(c.dateFrom)+" – "+bdGr(c.dateTo)];
    (c.years||[]).forEach(function(y,i){
      seg("ct",c.id,c.title||"",head,"Έτος "+(i+1),y.from,y.to,(c.budget||[]).filter(function(p){return +p.year===i+1}),y.cost);
    });
  });
  /* additional / optional services: the yearly amount of every contract year, spread by month over that year (always monthly) */
  (contracts||[]).forEach(function(c){
    var head=["Διαγωνισμός: "+(c.tender||"—")+" · Διάρκεια: "+(c.months!==""&&c.months!=null?c.months:"—")+" μήνες","Σύμβαση: "+bdGr(c.dateFrom)+" – "+bdGr(c.dateTo)];
    (c.extras||[]).forEach(function(e){
      if(!exOk(e))return;
      (c.years||[]).forEach(function(y,i){
        seg("ct",c.id,c.title||"",head,"Έτος "+(i+1)+" · υπηρεσία «"+(e.desc||"")+"»",y.from,y.to,[{amount:Number(e.amount),article:e.article}],0,true);
      });
    });
  });
  (tenders||[]).forEach(function(c){
    var head=["Εκτιμώμενος διαγωνισμός: "+(c.tender||"—")+" · Διάρκεια: "+(c.months!==""&&c.months!=null?c.months:"—")+" μήνες","Εκτιμώμενη περίοδος: "+bdGr(c.dateFrom)+" – "+bdGr(c.dateTo)];
    (c.years||[]).forEach(function(y,i){
      seg("tn",c.id,c.title||"",head,"Έτος "+(i+1),y.from,y.to,(c.budget||[]).filter(function(p){return +p.year===i+1}),y.cost);
    });
  });
  var byArt={},min=null,max=null;
  order.forEach(function(k){
    var r=rows[k];(byArt[r.code]=byArt[r.code]||[]).push(r);
    Object.keys(r.by).forEach(function(y){y=+y;if(min===null||y<min)min=y;if(max===null||y>max)max=y});
  });
  Object.keys(byArt).forEach(function(c){byArt[c].sort(function(a,b){return a.desc.localeCompare(b.desc,"el")})});
  var years=[];if(min!==null)for(var y=min;y<=max;y++)years.push(y);
  return {byArt:byArt,years:years,warn:warn};
}
function bdTotals(rows,years){return years.map(function(y){return r2(rows.reduce(function(a,r){return a+(r.by[y]||0)},0))})}
/*BD-CALC-END*/
function bdSel(){
  var v=S.bdArt;if(v==null){try{v=localStorage.getItem("rl.bdart")}catch(e){}}
  return v||"all";
}
function bdTable(title,sub,rows,years){
  var tot=bdTotals(rows,years);
  return '<section class="bds"><h3>'+esc(title)+'</h3>'+(sub?'<p class="hint">'+esc(sub)+'</p>':'')+
   '<div class="tbl"><table class="bdt"><thead><tr><th>Α/Α</th><th>Λεπτομέρειες Δαπάνης (Περιγραφή)</th><th>Τρόπος Υπολογισμού</th>'+
   years.map(function(y){return '<th class="num">Προϋπολ.<br>ΕΤΟΣ <b class="yr">'+y+'</b><br>€ με ΦΠΑ</th>'}).join("")+'</tr></thead><tbody>'+
   (rows.length?rows.map(function(r,i){
     return '<tr class="src-'+esc(r.kind)+'"><td>'+(i+1)+'</td><td>'+esc(r.desc)+'</td><td class="how">'+r.how.map(esc).join("<br>")+'</td>'+years.map(function(y){return '<td class="num">'+(r.by[y]?bdNum(r.by[y]):"")+'</td>'}).join("")+'</tr>';
   }).join(""):'<tr><td colspan="'+(3+years.length)+'" class="hint">Δεν υπάρχουν γραμμές για αυτό το άρθρο.</td></tr>')+
   '<tr class="tot"><td colspan="3">Σύνολα</td>'+tot.map(function(v){return '<td class="num">'+bdNum(v)+'</td>'}).join("")+'</tr></tbody></table></div></section>';
}
function renderBd(){
  var arts=articles(),B=bdBuild(arts,S.items,S.contracts,S.tenders.filter(tnActive)),sel=bdSel(),years=B.years.length?B.years:[new Date().getFullYear()];
  var all=[];Object.keys(B.byArt).forEach(function(c){all=all.concat(B.byArt[c])});
  var tot=bdTotals(all,years);
  $("#stats").innerHTML=years.map(function(y,i){return '<div class="stat"><b class="num" style="font-family:var(--f-display)">'+bdNum(tot[i])+'</b><span>Σύνολο προϋπολογισμού <b class="yr">'+y+'</b> (€, με ΦΠΑ '+(BD_VAT*100)+'%)</span></div>'}).join("");
  $("#alerts").innerHTML=B.warn.map(function(w){return '<div class="alert bad"><span>'+esc(w)+'</span></div>'}).join("");
  var opts='<option value="all">Όλα τα άρθρα</option>'+arts.map(function(a){var n=(B.byArt[a.code]||[]).length;return '<option value="'+esc(a.code)+'"'+(sel===a.code?' selected':'')+'>'+esc(a.code+" — "+a.desc)+(n?" ("+n+")":"")+'</option>'}).join("")+
    (B.byArt[""]?'<option value="none"'+(sel==="none"?' selected':'')+'>Χωρίς άρθρο ('+B.byArt[""].length+')</option>':'');
  if(sel==="all")opts=opts.replace('<option value="all">','<option value="all" selected>');
  $("#chips").innerHTML='<label class="bdsel">Άρθρο <select id="bdArt">'+opts+'</select></label>'+(!window.RL_CFG||window.RL_CFG.canArticles?' <button type="button" class="chip" data-act="arts">Άρθρα προϋπολογισμού</button>':'');
  var h='<p class="bdleg"><span class="lg sw">Online Renewals</span><span class="lg ct">Συμβάσεις</span><span class="lg tn">Διαγωνισμοί (εκτιμώμενοι)</span></p>';
  function secFor(a){return bdTable(a.code+" — "+a.desc,"Κατηγορία "+a.cat+(a.catDesc?" · "+a.catDesc:"")+" · Ποσό ανάλυσης ανά έτος: "+(a.split?"ΝΑΙ (κατανομή ανά μήνα στα έτη)":"ΌΧΙ (στο έτος έναρξης)"),B.byArt[a.code]||[],years)}
  if(sel==="all"){
    arts.forEach(function(a){if((B.byArt[a.code]||[]).length)h+=secFor(a)});
    if(B.byArt[""])h+=bdTable("Χωρίς άρθρο","Ποσά που δεν έχουν συνδεθεί με άρθρο προϋπολογισμού (ολόκληρο το ποσό στο έτος έναρξης).",B.byArt[""],years);
    if(!h)h='<div class="empty"><h2>Δεν υπάρχουν ποσά ακόμα</h2><p>Ο πίνακας συμπληρώνεται αυτόματα από τα επιμέρους ποσά (με άρθρο) που καταχωρείς ανά έτος στις Συμβάσεις, στους ενεργούς Διαγωνισμούς και στα Online Renewals.</p></div>';
  }else if(sel==="none")h=bdTable("Χωρίς άρθρο","Ποσά που δεν έχουν συνδεθεί με άρθρο προϋπολογισμού.",B.byArt[""]||[],years);
  else{var a=artFind(sel,arts);h=a?secFor(a):""}
  $("#list").innerHTML=h;
}
function bdExport(){
  if(needX())return;
  var arts=articles(),B=bdBuild(arts,S.items,S.contracts,S.tenders.filter(tnActive)),years=B.years.length?B.years:[new Date().getFullYear()];
  var wb=XLSX.utils.book_new(),used={},fmt="#,##0.00";
  function name(s){s=String(s).replace(/[\\\/\?\*\[\]:]/g,"").trim().slice(0,31)||"Φύλλο";var n=s,k=2;while(used[n.toLowerCase()]){n=s.slice(0,28)+" "+k++}used[n.toLowerCase()]=1;return n}
  function num(v,f,c){var o={t:"n",v:v,z:fmt};if(f)o.f=f;return o}
  function colL(i){return XLSX.utils.encode_col(i)}
  var yh=years.map(function(y){return "Προϋπολ.\nΕΤΟΣ "+y+"\n€ με ΦΠΑ"});
  var sum=[["Άρθρο","Περιγραφή άρθρου","Κατηγορία","Ποσό ανάλυσης ανά έτος"].concat(yh)],codes=[];
  arts.forEach(function(a){if((B.byArt[a.code]||[]).length)codes.push(a.code)});
  codes.forEach(function(c){
    var a=artFind(c,arts),t=bdTotals(B.byArt[c],years);
    sum.push([a.code,a.desc,(a.cat+" "+a.catDesc).trim(),a.split?"ΝΑΙ":"ΌΧΙ"].concat(t.map(function(v){return num(v)})));
  });
  if(B.byArt[""]){sum.push(["—","Χωρίς άρθρο","","ΌΧΙ"].concat(bdTotals(B.byArt[""],years).map(function(v){return num(v)})))}
  var n=sum.length-1,trow=["Σύνολα","","",""];
  years.forEach(function(y,i){var L=colL(4+i),t=0;for(var r=1;r<=n;r++)t+=sum[r][4+i].v;trow.push(num(r2(t),"SUM("+L+"2:"+L+(n+1)+")"))});
  sum.push(trow);
  var ws0=XLSX.utils.aoa_to_sheet(sum);ws0["!cols"]=[{wch:10},{wch:48},{wch:36},{wch:14}].concat(years.map(function(){return {wch:16}}));
  XLSX.utils.book_append_sheet(wb,ws0,name("Σύνοψη"));
  function sheet(title,rows){
    var aoa=[["Α/Α","Λεπτομέρειες Δαπάνης (Περιγραφή)","Τρόπος Υπολογισμού","","",""].concat(yh)],mer=[{s:{r:0,c:2},e:{r:0,c:5}}];
    rows.forEach(function(r,i){aoa.push([i+1,r.desc,r.how.join(" | "),"","",""].concat(years.map(function(y){return num(r.by[y]||0)})));mer.push({s:{r:i+1,c:2},e:{r:i+1,c:5}})});
    var k=rows.length,tr=["Σύνολα","","","","",""];
    years.forEach(function(y,i){var L=colL(6+i);tr.push(num(bdTotals(rows,[y])[0],k?"SUM("+L+"2:"+L+(k+1)+")":null))});
    aoa.push(tr);mer.push({s:{r:k+1,c:0},e:{r:k+1,c:5}});
    var ws=XLSX.utils.aoa_to_sheet(aoa);ws["!merges"]=mer;
    ws["!cols"]=[{wch:8},{wch:44},{wch:30},{wch:14},{wch:14},{wch:14}].concat(years.map(function(){return {wch:16}}));
    XLSX.utils.book_append_sheet(wb,ws,name(title));
  }
  codes.forEach(function(c){var a=artFind(c,arts);sheet(a.code+" "+a.desc,B.byArt[c])});
  if(B.byArt[""])sheet("Χωρίς άρθρο",B.byArt[""]);
  if(!codes.length&&!B.byArt[""]){toast("Δεν υπάρχουν ποσά προϋπολογισμού για εξαγωγή");return}
  offer("budget-"+todayIso()+".xlsx",XLSX.write(wb,{bookType:"xlsx",type:"array"}));
}

/* =============== CONTRACTS (Συμβάσεις) =============== */
var REMIND_CT=[14,30,60,90,120,180];
var CT_BASE=[
 {k:"title",l:"ΣΥΜΒΑΣΗ",q:"Ποια είναι η σύμβαση;",req:1,ph:"π.χ. Συντήρηση πληροφοριακών συστημάτων"},
 {k:"tender",l:"ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ",q:"Ποιος είναι ο αριθμός διαγωνισμού;",ph:"π.χ. 12/2026"},
 {k:"description",l:"ΠΕΡΙΓΡΑΦΗ",q:"Γράψε μια σύντομη περιγραφή της σύμβασης.",ta:1},
 {k:"contractorId",l:"ΑΝΑΔΟΧΟΣ",q:"Ποιος είναι ο ανάδοχος; Επίλεξέ τον από τη λίστα αναδόχων.",sel:1},
 {k:"repName",l:"ΟΝΟΜΑΤΕΠΩΝΥΜΟ ΑΝΤΙΠΡΟΣΩΠΟΥ ΑΝΑΔΟΧΟΥ (ΓΙΑ ΤΗ ΣΥΜΒΑΣΗ)",q:"Ποιος είναι ο αντιπρόσωπος του αναδόχου για αυτή τη σύμβαση; (προαιρετικό)"},
 {k:"repPhone",l:"ΤΗΛΕΦΩΝΟ ΑΝΤΙΠΡΟΣΩΠΟΥ",q:"Ποιο είναι το τηλέφωνο του αντιπροσώπου; (προαιρετικό)",phone:1,ph:"π.χ. 22 123456, 99 123456"},
 {k:"repEmail",l:"EMAIL ΑΝΤΙΠΡΟΣΩΠΟΥ",q:"Ποιο είναι το email του αντιπροσώπου; Για περισσότερα χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;) (προαιρετικό).",email:1,hint:"Για περισσότερα email χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;)",ph:"name@example.com"},
 {k:"coordinator",l:"ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ",q:"Ποιος είναι ο συντονιστής της σύμβασης;"},
 {k:"months",l:"ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ)",q:"Ποια είναι η διάρκεια της σύμβασης σε μήνες;",num:1,req:1,ph:"π.χ. 62"},
 {k:"dateFrom",l:"ΗΜΕΡ. ΕΝΑΡΞΗΣ",q:"Πότε ξεκινά η σύμβαση;",date:1,req:1},
 {k:"dateTo",l:"ΗΜΕΡ. ΛΗΞΗΣ",q:"Πότε λήγει; Υπολογίζεται από τη διάρκεια, μπορείς να την αλλάξεις.",date:1,req:1},
 {k:"cost",l:"ΚΟΣΤΟΣ (€)",q:"Ποιο είναι το συνολικό κόστος (€);",num:1},
 {k:"emails",l:"EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ",q:"Σε ποια email να στέλνονται οι ειδοποιήσεις; Για περισσότερα από ένα χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;) (προαιρετικό).",ta:1,email:1,hint:"Για περισσότερα email χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;)",ph:"name@example.com, other@example.com"}
];
var TN_BASE=[
 {k:"title",l:"ΟΝΟΜΑ ΔΙΑΓΩΝΙΣΜΟΥ",q:"Ποιο είναι το όνομα του διαγωνισμού;",req:1,ph:"π.χ. Προμήθεια εξοπλισμού δικτύου"},
 {k:"tender",l:"ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ",q:"Ποιος είναι ο αριθμός του διαγωνισμού;",ph:"π.χ. 12/2027"},
 {k:"description",l:"ΠΕΡΙΓΡΑΦΗ",q:"Γράψε μια σύντομη περιγραφή του διαγωνισμού.",ta:1},
 {k:"months",l:"ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)",q:"Ποια είναι η διάρκεια σε μήνες;",num:1,req:1,ph:"π.χ. 36"},
 {k:"dateFrom",l:"ΕΚΤΙΜΩΜΕΝΗ ΗΜΕΡ. ΕΝΑΡΞΗΣ",q:"Ποια είναι η εκτιμώμενη ημερομηνία έναρξης;",date:1,req:1},
 {k:"dateTo",l:"ΕΚΤΙΜΩΜΕΝΗ ΗΜΕΡ. ΛΗΞΗΣ",q:"Ποια είναι η εκτιμώμενη ημερομηνία λήξης; Υπολογίζεται από τη διάρκεια, μπορείς να την αλλάξεις.",date:1,req:1},
 {k:"cost",l:"ΕΚΤΙΜΩΜΕΝΟ ΚΟΣΤΟΣ (€)",q:"Ποιο είναι το εκτιμώμενο συνολικό κόστος (€);",num:1}
];
/* contract form: the contractor is chosen from the registered contractors and shown read-only */
function ctrSelOpts(d){
  var cur=d.contractorId||"",list=(S.contractors||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name),"el",{sensitivity:"base"})});
  var h='<option value="">— Επιλογή αναδόχου —</option>'+list.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===cur?' selected':'')+'>'+esc(c.name)+'</option>'}).join("");
  if(cur&&!coById(cur))h+='<option value="'+esc(cur)+'" selected>'+esc(d.contractor||cur)+'</option>';
  return h;
}
function ctrInfoHtml(d){
  var o=ctrOf(d);
  if(d.contractorId)return ctrKv(o)+'<span class="hint">Τα στοιχεία του αναδόχου είναι μόνο για ανάγνωση εδώ. Αλλάζουν μόνο από την καρτέλα «Ανάδοχοι».</span>';
  if(o.name||o.vat||o.addr||o.contact||o.phone||o.email)return '<span class="hint">Η σύμβαση έχει ανάδοχο ως ελεύθερο κείμενο (παλιά καταχώρηση). Επίλεξε ανάδοχο από τη λίστα για να τον αντικαταστήσεις ή δημιούργησέ τον από αυτά τα στοιχεία.</span>'+ctrKv(o)+'<button class="btn small" type="button" data-act="coaddlegacy">Δημιουργία αναδόχου από αυτά τα στοιχεία</button>';
  return '<span class="hint">'+((S.contractors||[]).length?'Δεν έχει επιλεγεί ανάδοχος. Αν δεν υπάρχει στη λίστα, πάτησε «+ Νέος ανάδοχος».':'Δεν υπάρχουν ακόμα ανάδοχοι. Πάτησε «+ Νέος ανάδοχος» για να προσθέσεις.')+'</span>';
}
function ctField(f,d,step){
  if(f.sel)return '<label class="f">'+(step?'<span class="big-q">'+f.q+' <small>(προαιρετικό)</small></span>':f.l)+'<span class="ctrsel"><select id="c_contractorId">'+ctrSelOpts(d)+'</select><button type="button" class="btn small" data-act="coaddfromct">+ Νέος ανάδοχος</button></span><span id="cCtrInfo">'+ctrInfoHtml(d)+'</span></label>';
  if(step)return '<label class="f"><span class="big-q">'+f.q+(f.req?'':' <small>(προαιρετικό)</small>')+'</span>'+ctInput(f,d[f.k],"c_"+f.k)+'</label>';
  return '<label class="f">'+f.l+(f.req?' *':'')+(f.hint?'<small>'+esc(f.hint)+'</small>':'')+ctInput(f,d[f.k],"c_"+f.k)+'</label>';
}
function cwBase(){var tn=S.cw&&S.cw.kind==="tn";return (tn?TN_BASE:CT_BASE).concat(cfDescs(tn?"tenders":"contracts"))}
function mc(v){return v===""||v==null?"—":money(v)}
function dayTextEl(d){if(d==null)return "";if(d<0){var n=-d;return "πριν από "+n+(n==1?" ημέρα":" ημέρες")}if(d==0)return "σήμερα";return "σε "+d+(d==1?" ημέρα":" ημέρες")}
function addMonths(s,k){var d=parseIso(s);if(!d)return "";var day=d.getDate();d=new Date(d.getFullYear(),d.getMonth()+k,1);var dim=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,dim));return iso(d)}
function ctEnd(from,months){return addDays(addMonths(from,Math.round(Number(months))),-1)}
/* Years = whole years in the duration (minimum 1). Extra months go to year 1. 62 months -> 5 years: 14+12+12+12+12 */
function buildYears(from,months,old){
  var m=Math.round(Number(months));
  if(!parseIso(from)||!(m>0))return [];
  var n=Math.max(1,Math.floor(m/12)),first=m<12?m:12+(m%12),out=[],s=from;
  for(var i=0;i<n;i++){
    var len=i===0?first:12,e=addDays(addMonths(s,len),-1),o=old&&old[i];
    out.push({from:s,to:e,cost:o&&o.cost!=null?o.cost:"",remind:o&&o.remind?+o.remind:defRemind()});
    s=addDays(e,1);
  }
  var fin=ctEnd(from,m);if(fin>=out[out.length-1].from)out[out.length-1].to=fin;
  return out;
}
/* Additional / optional services of a contract: each has a yearly amount (€, excl. VAT); only the total contract cost includes it (not the cost of each year) */
function exOk(e){var n=Number(e&&e.amount);return e&&e.amount!==""&&e.amount!=null&&isFinite(n)&&n>0}
function exClean(d){return (d.extras||[]).filter(exOk).map(function(e){return {id:e.id||uid(),desc:String(e.desc||"").trim(),amount:r2(Number(e.amount)),article:String(e.article||"")}})}
function exSum(c){return r2((c.extras||[]).reduce(function(a,e){return a+(exOk(e)?Number(e.amount):0)},0))}
function ctYearCost(c,i){var y=(c.years||[])[i]||{};return y.cost===""||y.cost==null?"":r2(Number(y.cost)||0)}
function ctTotal(c){return r2((Number(c.cost)||0)+exSum(c)*(c.years||[]).length)}
function exText(c){return (c.extras||[]).filter(exOk).map(function(e){return (e.desc||"—")+" ("+Number(e.amount).toFixed(2)+" €/έτος"+(e.article?" ["+artLabel(e.article)+"]":"")+")"}).join("; ")}
function ctSum(ys){return (ys||[]).reduce(function(a,y){var v=Number(y.cost);return a+(y.cost===""||y.cost==null||!isFinite(v)?0:v)},0)}
function ctInfo(c){
  var t=todayIso(),ys=c.years||[],from=c.dateFrom||(ys[0]&&ys[0].from)||"",to=c.dateTo||(ys.length?ys[ys.length-1].to:"");
  var de=daysLeft(to),i;
  if(de==null)return {k:"ok",t:"Χωρίς ημερομηνία",sub:"",d:null,yr:null};
  if(c.archived&&de<0)return {k:"mute",t:"Αρχειοθετήθηκε",sub:"Αρχειοθετήθηκε"+(c.archivedAt?" "+fmtDate(c.archivedAt):""),d:de,yr:null,archived:true};
  if(de<0)return {k:"bad",t:"Έληξε",sub:"Η σύμβαση έληξε "+dayTextEl(de),d:de,yr:null};
  if(from&&t<from){var ds=daysLeft(from);return {k:"ok",t:"Δεν ξεκίνησε",sub:"Ξεκινά "+dayTextEl(ds),d:ds,yr:null}}
  for(i=0;i<ys.length;i++){
    var d=daysLeft(ys[i].to);
    if(d!=null&&d>=0&&d<=(+ys[i].remind||30)){var last=i===ys.length-1;return {k:"warn",t:"Λήγει σύντομα",sub:(last?"Λήξη σύμβασης ":"Λήξη έτους "+(i+1)+" ")+dayTextEl(d),d:d,yr:i+1,last:last}}
  }
  var ci=-1;for(i=0;i<ys.length;i++){if(t>=ys[i].from&&t<=ys[i].to){ci=i;break}}
  return {k:"ok",t:"Σε ισχύ",sub:ci>=0?"Έτος "+(ci+1)+" από "+ys.length:"",d:de,yr:ci>=0?ci+1:null};
}
/* archived (expired) contracts are kept for reference only: no alerts, digest items or milestone notifications */
function ctExpired(c){var ys=c.years||[],to=c.dateTo||(ys.length?ys[ys.length-1].to:""),de=daysLeft(to);return de!=null&&de<0}
function attn(cat){return listOf(cat).filter(function(i){var s=cat==="ct"?ctInfo(i):status(i);return s.k!=="ok"&&!s.archived}).length}
function crossAlert(cat){
  var o=cat==="sw"?"ct":"sw",n=attn(o)+msAttn(o);if(!n)return "";
  return '<div class="alert"><span>'+(o==="ct"?'Συμβάσεις: '+n+' χρειάζονται προσοχή':'Online Renewals: '+n+' need attention')+'</span><button type="button" data-act="gocat" data-cat="'+o+'">'+(o==="ct"?'Προβολή':'View')+'</button></div>';
}
function remOpts(v,list,suffix){
  var h=list.map(function(n){return '<option value="'+n+'"'+(+v===n?" selected":"")+'>'+n+suffix+'</option>'}).join("");
  if(list.indexOf(+v)<0&&+v)h+='<option value="'+(+v)+'" selected>'+(+v)+suffix+'</option>';
  return h;
}

/* ---------- list ---------- */
function ctFiltered(){
  var q=S.q.toLowerCase();
  return sortList("ct",S.contracts.filter(function(c){
    var k=ctInfo(c).k;
    if(S.filter==="expired"&&k!=="bad")return false;
    if(S.filter==="due"&&k!=="warn")return false;
    if(S.filter==="active"&&k!=="ok")return false;
    if(S.filter==="archived"&&!ctInfo(c).archived)return false;
    if(!q)return true;
    return [c.title,c.tender,c.description,ctrOf(c).name,ctrOf(c).vat,ctrOf(c).contact,ctrOf(c).phone,ctrOf(c).email,c.repName,c.repPhone,c.repEmail,c.coordinator].join(" ").toLowerCase().indexOf(q)>=0;
  }));
}
function renderCt(){
  var all=S.contracts,exp=0,due=0,act=0,spend=0,arch=0;
  all.forEach(function(c){var si=ctInfo(c),k=si.k;if(si.archived){arch++;return}if(k==="bad")exp++;else{if(k==="warn")due++;else act++;spend+=ctTotal(c)}});
  $("#stats").innerHTML=
    '<div class="stat"><b>'+all.length+'</b><span>Συμβάσεις</span></div>'+
    '<div class="stat bad"><b>'+exp+'</b><span>Έληξαν</span></div>'+
    '<div class="stat warn"><b>'+due+'</b><span>Λήγουν σύντομα</span></div>'+
    '<div class="stat"><b>'+act+'</b><span>Σε ισχύ</span></div>'+(arch?'<div class="stat"><b>'+arch+'</b><span>Αρχείο</span></div>':'')+
    '<div class="stat"><b class="num" style="font-family:var(--f-display)">'+money(spend).replace(/\.00$/,"")+'</b><span>Κόστος ενεργών</span></div>';
  var lines=[];
  all.forEach(function(c){var s=ctInfo(c);if(s.k!=="ok"&&!s.archived)lines.push({c:c,s:s})});
  lines.sort(function(a,b){return a.s.d-b.s.d});
  var al=lines.slice(0,4).map(function(x){
    return '<div class="alert'+(x.s.k==="bad"?' bad':'')+'"><span><b>'+esc(x.c.title)+'</b> · '+esc(x.s.sub)+'</span><button type="button" data-act="openid" data-cat="ct" data-id="'+esc(x.c.id)+'">Άνοιγμα</button></div>';
  }).join("");
  if(lines.length>4)al+='<div class="alert"><span>+'+(lines.length-4)+' ακόμη</span><button type="button" data-f="due">Προβολή</button></div>';
  $("#alerts").innerHTML=al+msAlertHtml("ct")+crossAlert("ct");
  var chips=[["all","Όλες"],["expired","Έληξαν"],["due","Λήγουν σύντομα"],["active","Σε ισχύ"],["archived","Αρχείο"],["trash","🗑 Κάδος"+(S.trash.ct.length?" ("+S.trash.ct.length+")":"")]];
  $("#chips").innerHTML=chips.map(function(c){return '<button type="button" class="chip" data-f="'+c[0]+'" aria-pressed="'+(S.filter===c[0])+'">'+c[1]+'</button>'}).join("")+'<button type="button" class="chip" data-act="cols">⚙ Στήλες</button>'+(window.RL_CFG?'':'<button type="button" class="chip" data-act="arts">Άρθρα προϋπολογισμού</button>');
  var rows=ctFiltered(),h="";
  if(!all.length){
    h='<div class="empty"><h2>Δεν υπάρχουν συμβάσεις ακόμα</h2><p>Πρόσθεσε την πρώτη σύμβαση πεδίο-πεδίο ή εισήγαγε πολλές μαζί από αρχείο Excel. Τα έτη και οι υπενθυμίσεις δημιουργούνται αυτόματα από τη διάρκεια.</p><div class="actions"><button class="btn primary" type="button" id="emAdd">+ Νέα σύμβαση</button><button class="btn" type="button" id="emImp">Εισαγωγή Excel</button><button class="btn" type="button" id="emSample">Φόρτωση 2 δειγμάτων</button></div></div>';
  }else if(!rows.length){
    h='<div class="empty"><h2>Κανένα αποτέλεσμα</h2><p>Δοκίμασε άλλη αναζήτηση ή φίλτρο.</p></div>';
  }else{
    h=listHtml("ct",rows);
  }
  $("#list").innerHTML=h;
}

/* Archive of expired contracts: the contract stays in the list for reference but sends no notifications */
function ctArchBtn(c){
  if(s_arch(c))return '<button class="btn" type="button" data-act="ctunarch" title="Η σύμβαση ξαναμπαίνει στις ειδοποιήσεις (αν έχει λήξει θα εμφανίζεται ως Έληξε)">Επαναφορά από το Αρχείο</button>';
  return '<button class="btn" type="button" data-act="ctarch"'+(ctExpired(c)?'':' disabled title="Η αρχειοθέτηση ενεργοποιείται μόνο όταν η σύμβαση έχει λήξει"')+'>Αρχειοθέτηση</button>';
}
function s_arch(c){return !!ctInfo(c).archived}
async function ctSetArchive(id,on){
  var c=getItem("ct",id);if(!c)return;
  if(on&&!ctExpired(c)){toast("Η αρχειοθέτηση επιτρέπεται μόνο όταν η σύμβαση έχει λήξει");return}
  var rec=strip(c);rec.archived=!!on;rec.archivedAt=on?todayIso():"";
  if(await save(id,rec,"ct")){toast(on?"Η σύμβαση αρχειοθετήθηκε. Δεν θα στέλνει πλέον ειδοποιήσεις.":"Η σύμβαση επανήλθε από το Αρχείο");showCtDetail(id)}
}
/* ---------- detail ---------- */
function showCtDetail(id){
  var c=getItem("ct",id);if(!c)return;S.open=id;S.openCat="ct";
  var s=ctInfo(c),ys=c.years||[],t=todayIso(),o=ctrOf(c);
  var files=(c.attachments||[]).map(function(a,i){
    return '<li><a href="#" data-blob="'+esc(a.id)+'">'+esc(a.name)+'</a><button type="button" class="btn small danger" data-delfile="'+i+'">Αφαίρεση</button></li>';
  }).join("");
  var yr=ys.map(function(y,i){
    var cur=t>=y.from&&t<=y.to,past=t>y.to;
    return '<tr class="'+(cur?"cur":"")+'"><td>Έτος '+(i+1)+'</td><td class="mono">'+fmtDate(y.from)+'</td><td class="mono">'+fmtDate(y.to)+'</td><td class="num">'+mc(ctYearCost(c,i))+'</td>'+
      '<td><select class="yrRem" data-i="'+i+'" aria-label="Υπενθύμιση έτους '+(i+1)+'">'+remOpts(y.remind,REMIND_CT," ημέρες πριν")+'</select></td>'+
      '<td>'+(cur?'<span class="pill ok">Τρέχον</span>':past?'<span class="hint">Ολοκληρώθηκε</span>':'')+'</td></tr>';
  }).join("");
  openPanel(
   '<div class="ph"><div><h2>'+esc(c.title)+'</h2><span class="pill '+s.k+'">'+s.t+'</span> <span class="hint">'+esc(s.sub)+'</span></div><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+
   '<dl class="kv wl">'+
   '<dt>ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ</dt><dd>'+esc(c.tender||"—")+'</dd>'+
   '<dt>ΠΕΡΙΓΡΑΦΗ</dt><dd>'+esc(c.description||"—")+'</dd>'+
   '<dt>ΑΝΑΔΟΧΟΣ</dt><dd>'+esc(o.name||"—")+(o.linked?' <button class="btn small" type="button" data-act="gocontractor" data-id="'+esc(o.id)+'">Καρτέλα αναδόχου</button>':'')+'</dd>'+
   (o.vat?'<dt>ΑΦΜ ΑΝΑΔΟΧΟΥ</dt><dd>'+esc(o.vat)+'</dd>':'')+
   '<dt>ΔΙΕΥΘΥΝΣΗ ΑΝΑΔΟΧΟΥ</dt><dd>'+esc(o.addr||"—")+'</dd>'+
   '<dt>ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ</dt><dd>'+esc(o.contact||"—")+'</dd>'+
   '<dt>ΤΗΛΕΦΩΝΟ ΑΝΑΔΟΧΟΥ</dt><dd>'+(o.phone?'<a href="tel:'+esc(String(o.phone).split(/[,;]/)[0].replace(/[^0-9+]/g,""))+'">'+esc(o.phone)+'</a>':"—")+'</dd>'+
   '<dt>EMAIL ΑΝΑΔΟΧΟΥ</dt><dd>'+esc(o.email||"—")+'</dd>'+
   '<dt>ΑΝΤΙΠΡΟΣΩΠΟΣ ΑΝΑΔΟΧΟΥ (ΣΥΜΒΑΣΗΣ)</dt><dd>'+esc(c.repName||"—")+'</dd>'+
   '<dt>ΤΗΛΕΦΩΝΟ ΑΝΤΙΠΡΟΣΩΠΟΥ</dt><dd>'+(c.repPhone?'<a href="tel:'+esc(String(c.repPhone).split(/[,;]/)[0].replace(/[^0-9+]/g,""))+'">'+esc(c.repPhone)+'</a>':"—")+'</dd>'+
   '<dt>EMAIL ΑΝΤΙΠΡΟΣΩΠΟΥ</dt><dd>'+esc(c.repEmail||"—")+'</dd>'+
   '<dt>ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ</dt><dd>'+esc(c.coordinator||"—")+'</dd>'+
   '<dt>ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)</dt><dd class="num">'+esc(c.months||"—")+'</dd>'+
   '<dt>ΗΜΕΡ. ΕΝΑΡΞΗΣ</dt><dd class="mono">'+fmtDate(c.dateFrom)+'</dd>'+
   '<dt>ΗΜΕΡ. ΛΗΞΗΣ</dt><dd class="mono">'+fmtDate(c.dateTo)+'</dd>'+
   '<dt>ΚΟΣΤΟΣ</dt><dd class="num">'+mc(ctTotal(c))+'</dd>'+
   '<dt>EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ</dt><dd>'+esc(c.emails||"—")+'</dd></dl>'+
   '<div class="sec"><h3>Έτη και υπενθυμίσεις</h3><div class="tbl"><table><thead><tr><th>Έτος</th><th>ΗΜΕΡ. ΕΝΑΡΞΗΣ</th><th>ΗΜΕΡ. ΛΗΞΗΣ</th><th>ΚΟΣΤΟΣ</th><th>Υπενθύμιση</th><th></th></tr></thead><tbody>'+yr+'</tbody></table></div>'+
   '<span class="hint">Η υπενθύμιση κάθε έτους εμφανίζεται στην κορυφή και στο παράθυρο ειδοποιήσεων από την επιλεγμένη ημερομηνία μέχρι τη λήξη του έτους.</span></div>'+
   '<div class="sec"><h3>Συνημμένα</h3>'+(files?'<ul class="files">'+files+'</ul>':'<span class="hint">Δεν υπάρχουν συνημμένα (συμβάσεις, τιμολόγια, αποδείξεις).</span>')+
   '<div><button class="btn" type="button" data-act="attach"'+(S.assets?'':' disabled')+'>+ Προσθήκη αρχείων</button> <span class="hint">'+(S.assets?'PDF, εικόνες, CSV, κείμενο, Word, Excel, PowerPoint, HTML, XML, email (eml/msg), άδειες (lic), συμπιεσμένα (zip/7z/rar) κ.ά. · μέγιστο μέγεθος αρχείου '+attMB()+' MB. Τα αρχεία HTML κατεβαίνουν, δεν ανοίγουν μέσα στην εφαρμογή.':'Η μεταφόρτωση δεν είναι διαθέσιμη εδώ.')+'</span></div></div>'+
   bpDetail(c,1)+exDetail(c)+cfDetail(c,"contracts")+msSection("ct",c)+
   '<div class="sec"><div class="actions"><button class="btn" type="button" data-act="edit">Επεξεργασία</button>'+ctArchBtn(c)+'<button class="btn danger" type="button" data-act="ctdel">Διαγραφή</button></div><div id="delbox"></div></div>'
  ,"detail",true);
}

/* ---------- add / edit ---------- */
function ctInput(f,v,id){
  v=v==null?"":v;
  if(f.cf)return cfInput(f,v,id);
  if(f.ta)return '<textarea id="'+id+'" placeholder="'+esc(f.ph||"")+'">'+esc(v)+'</textarea>';
  var t=f.date?"date":f.num?"number":"text";
  var ex=f.k==="months"?' step="1" min="1" inputmode="numeric"':f.num?' step="0.01" min="0" inputmode="decimal"':'';
  return '<input id="'+id+'" type="'+t+'"'+ex+' value="'+esc(v)+'" placeholder="'+esc(f.ph||"")+'" autocomplete="off">';
}
function ctStart(id){
  var c=id?getItem("ct",id):null;
  S.cw={id:id||null,mode:c?"full":"step",i:0,err:"",d:c?JSON.parse(JSON.stringify(c)):{months:"",dateFrom:todayIso(),years:[]}};
  ctDraw();
}
/* contract form: the additional / optional services block */
function exBlock(d){
  var rows=(d.extras||[]).map(function(e,i){
    return '<div class="bp ex">'+
      '<input class="exd" id="ex_desc_'+i+'" type="text" placeholder="Περιγραφή υπηρεσίας" value="'+esc(e.desc)+'" autocomplete="off">'+
      '<input id="ex_amt_'+i+'" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Ετήσιο ποσό (€)" value="'+esc(e.amount)+'">'+
      '<select id="ex_art_'+i+'" aria-label="Άρθρο προϋπολογισμού">'+artOpts(e.article,1)+'</select>'+
      '<button type="button" class="btn small danger" data-act="exdel" data-i="'+i+'" title="Αφαίρεση">✕</button></div>';
  }).join("");
  return '<div class="sec"><h3>Επιπρόσθετες / Προαιρετικές Υπηρεσίες</h3><p class="hint">Για κάθε Επιπρόσθετη / Προαιρετική Υπηρεσία γράψε περιγραφή, το ποσό που αφορά ανά έτος της σύμβασης (χωρίς ΦΠΑ) και το σχετικό άρθρο του προϋπολογισμού που αφορά. Το ποσό προστίθεται μόνο στο συνολικό κόστος της σύμβασης και περνά στον Προϋπολογισμό στο άρθρο της, κατανεμημένο ανά μήνα σε όλα τα έτη της σύμβασης.</p><div class="bpb">'+rows+'<div><button type="button" class="btn small" data-act="exadd">+ Υπηρεσία</button></div></div>'+
    '<p class="hint">Ετήσιο σύνολο υπηρεσιών: <b id="cExSum">'+mc(exSum(d))+'</b> · Συνολικό κόστος σύμβασης με Επιπρόσθετες / Προαιρετικές Υπηρεσίες: <b id="cTotal">'+mc(ctTotal(d))+'</b></p></div>';
}
function exCollect(d){(d.extras||[]).forEach(function(e,i){var t=$("#ex_desc_"+i),a=$("#ex_amt_"+i),r=$("#ex_art_"+i);if(t)e.desc=t.value;if(a)e.amount=a.value;if(r)e.article=r.value})}
function exTotals(){
  var w=S.cw;if(!w||w.kind==="tn")return;var d=w.d;exCollect(d);
  var yc=(d.years||[]).some(function(y){return y.cost!==""&&y.cost!=null}),base=(yc||d.cost==null||String(d.cost).trim()==="")?ctSum(d.years):Number(d.cost);/* saving fills the cost from the sum of the years */
  var a=$("#cExSum"),t=$("#cTotal");if(a)a.textContent=mc(exSum(d));if(t)t.textContent=mc(r2((Number(base)||0)+exSum(d)*(d.years||[]).length));
}
function exErr(d){
  var l=d.extras||[];
  for(var i=0;i<l.length;i++){
    var e=l[i],blankA=e.amount===""||e.amount==null,blankD=!String(e.desc||"").trim();
    if(blankA&&blankD)continue;
    if(blankD)return "Υπηρεσία "+(i+1)+": συμπλήρωσε περιγραφή.";
    if(blankA||!isFinite(Number(e.amount))||Number(e.amount)<=0)return "Υπηρεσία "+(i+1)+": το ετήσιο ποσό πρέπει να είναι αριθμός μεγαλύτερος από 0.";
  }
  return "";
}
function exDetail(c){
  var l=(c.extras||[]).filter(exOk);if(!l.length)return "";
  var n=(c.years||[]).length;
  return '<div class="sec"><h3>Επιπρόσθετες / Προαιρετικές Υπηρεσίες</h3><ul class="files">'+l.map(function(e){
    return '<li><span>'+esc(e.desc||"—")+' <span class="hint">'+esc(e.article?artLabel(e.article):"(χωρίς άρθρο)")+'</span></span><span class="num">'+mc(e.amount)+' / έτος</span></li>';
  }).join("")+'</ul><span class="hint">Ετήσιο σύνολο υπηρεσιών '+mc(exSum(c))+' × '+n+' '+(n===1?'έτος':'έτη')+' = '+mc(r2(exSum(c)*n))+'. Το συνολικό ΚΟΣΤΟΣ της σύμβασης περιλαμβάνει τις υπηρεσίες· το κόστος κάθε έτους δεν τις περιλαμβάνει.</span></div>';
}
function ctCollect(){
  var d=S.cw.d;
  cwBase().forEach(function(f){var el=$("#c_"+f.k);if(el)d[f.k]=el.value});
  (d.years||[]).forEach(function(y,i){
    var a=$("#cy_from_"+i),b=$("#cy_to_"+i),c=$("#cy_cost_"+i),r=$("#cy_rem_"+i);
    if(a)y.from=a.value;if(b)y.to=b.value;if(c)y.cost=c.value;if(r)y.remind=+r.value;
  });
  bpCollect(d);
  (d.years||[]).forEach(function(y,i){if(bpHas(d,i+1))y.cost=bpSum(d.budget,i+1)});
  exCollect(d);
}
function ctRegen(){var d=S.cw.d,g=buildYears(d.dateFrom,d.months,d.years);if(!g.length)return;d.years=g;d.dateTo=g[g.length-1].to}
function ctApplyEnd(){var d=S.cw.d,ys=d.years;if(ys&&ys.length&&parseIso(d.dateTo)&&d.dateTo>=ys[ys.length-1].from)ys[ys.length-1].to=d.dateTo}
function ctRefresh(skipTo){
  var el=$("#cYears");if(el)el.innerHTML=ctYearsTable();
  exTotals();
  var dt=$("#c_dateTo");if(dt&&!skipTo)dt.value=S.cw.d.dateTo||"";
}
function ctYearsTable(){
  var tn=S.cw.kind==="tn",ys=S.cw.d.years||[];
  if(!ys.length)return '<p class="hint">Συμπλήρωσε τη διάρκεια (μήνες) και την ημερομηνία έναρξης για να δημιουργηθούν τα έτη.</p>';
  return '<div class="tbl"><table><thead><tr><th>Έτος</th><th>ΗΜΕΡ. ΕΝΑΡΞΗΣ</th><th>ΗΜΕΡ. ΛΗΞΗΣ</th><th>ΚΟΣΤΟΣ (€)</th>'+(tn?'':'<th>Υπενθύμιση</th>')+'</tr></thead><tbody>'+
   ys.map(function(y,i){
     var hp=bpHas(S.cw.d,i+1);
     return '<tr><td>Έτος '+(i+1)+'</td><td><input id="cy_from_'+i+'" type="date" value="'+esc(y.from)+'"></td><td><input id="cy_to_'+i+'" type="date" value="'+esc(y.to)+'"></td>'+
       '<td><input id="cy_cost_'+i+'" type="number" step="0.01" min="0" inputmode="decimal" value="'+esc(hp?bpSum(S.cw.d.budget,i+1):y.cost)+'"'+(hp?' readonly title="Άθροισμα επιμέρους ποσών"':'')+'></td>'+
       (tn?'':'<td><select id="cy_rem_'+i+'">'+remOpts(y.remind,REMIND_CT," ημέρες πριν")+'</select></td>')+'</tr>'+
       '<tr class="bpr"><td></td><td colspan="'+(tn?3:4)+'"><span class="hint">Επιμέρους ποσά έτους '+(i+1)+(hp?'':' (προαιρετικό)')+'</span>'+bpBlock(S.cw.d,i+1,1,ys.length)+'</td></tr>';
   }).join("")+'</tbody></table></div><p class="hint">Άθροισμα κόστους ετών: <b id="cSum">'+mc(ctSum(ys))+'</b></p>';
}
function ctDraw(){
  var w=S.cw,d=w.d,tn=w.kind==="tn",B=cwBase(),h;cfLoad(d,tn?"tenders":"contracts");
  var ttl=w.promoteFrom?"Promote στις Συμβάσεις":tn?(w.id?"Επεξεργασία διαγωνισμού":"Νέος διαγωνισμός"):(w.id?"Επεξεργασία σύμβασης":"Νέα σύμβαση");
  var head='<div class="ph"><h2>'+ttl+'</h2><button class="btn small" type="button" data-act="close">Άκυρο</button></div>'+
    (w.promoteFrom?'<p class="hint">Τα πεδία μεταφέρθηκαν από τον διαγωνισμό «'+esc(w.promoteTitle||"")+'». Έλεγξε και διόρθωσέ τα (π.χ. συμπλήρωσε ανάδοχο και συντονιστή, υπενθυμίσεις, email) πριν την αποθήκευση. Τα συνημμένα του διαγωνισμού αντιγράφονται στη σύμβαση. Η συμπερίληψη του διαγωνισμού στον Προϋπολογισμό θα αφαιρεθεί, γιατί θα γίνεται πλέον μέσω της νέας σύμβασης.</p>':'');
  var saveL=w.promoteFrom?"Αποθήκευση σύμβασης και προώθηση":"Αποθήκευση";
  if(w.mode==="full"){
    h=head+'<div style="display:grid;gap:12px">'+B.map(function(f){return ctField(f,d,false)}).join("")+'</div>'+
      '<div class="sec"><h3>'+(tn?"Έτη διαγωνισμού":"Έτη σύμβασης")+'</h3><p class="hint">Δημιουργούνται αυτόματα από τη διάρκεια. Οι επιπλέον μήνες πέρα από τα πλήρη έτη προστίθενται στο 1ο έτος.'+(tn?' Συμπλήρωσε για κάθε έτος τα επιμέρους ποσά με το σχετικό άρθρο προϋπολογισμού· περνούν στον Προϋπολογισμό όσο ο διαγωνισμός είναι ενεργός.':'')+'</p><div id="cYears">'+ctYearsTable()+'</div>'+
      '<div><button class="btn small" type="button" data-act="ctsum">Συμπλήρωση ΚΟΣΤΟΥΣ από το άθροισμα ετών</button></div></div>'+(tn?'':'<div id="cExtras">'+exBlock(d)+'</div>')+
      '<div class="err" id="werr">'+esc(w.err)+'</div><div class="actions"><button class="btn primary" type="button" data-act="ctsave">'+saveL+'</button>'+(w.id||w.promoteFrom?'':'<button class="btn" type="button" data-act="ctstep">Βήμα-βήμα</button>')+'</div>';
    openPanel(h,"wiz",true);return;
  }
  var total=B.length+1,i=w.i,last=i===total-1,body;
  if(i<B.length){var f=B[i];body=ctField(f,d,true)}
  else body='<div><span class="big-q">'+(tn?"Έτη και κόστη":"Έτη, κόστη και υπενθυμίσεις")+'</span><p class="hint">'+(tn?"Συμπλήρωσε το κόστος κάθε έτους ή τα επιμέρους ποσά του με το σχετικό άρθρο.":"Συμπλήρωσε το κόστος κάθε έτους και διάλεξε πότε θέλεις υπενθύμιση πριν τη λήξη του.")+'</p></div><div id="cYears">'+ctYearsTable()+'</div>'+(tn?'':'<div id="cExtras">'+exBlock(d)+'</div>');
  h=head+'<div class="steps" aria-hidden="true"><i style="width:'+Math.round((i+1)/total*100)+'%"></i></div><div class="hint">Βήμα '+(i+1)+' από '+total+'</div>'+body+
    '<div class="err" id="werr">'+esc(w.err)+'</div>'+
    '<div class="actions">'+(i>0?'<button class="btn" type="button" data-act="ctback">Πίσω</button>':'')+'<button class="btn primary" type="button" data-act="'+(last?'ctsave':'ctnext')+'">'+(last?saveL:'Επόμενο')+'</button></div>'+
    '<div><button class="btn small" type="button" data-act="ctfull">Πλήρης φόρμα</button></div>';
  openPanel(h,"wiz",last);
}
function ctValidateBase(keys){
  var d=S.cw.d;
  for(var i=0;i<keys.length;i++){
    var f=cwBase().filter(function(x){return x.k===keys[i]})[0];if(!f)continue;
    var v=d[f.k],blank=v==null||String(v).trim()==="";
    if(f.cf){var ce=cfErr(f,v);if(ce)return ce}
    if(f.req&&blank)return f.l+": υποχρεωτικό πεδίο.";
    if(f.k==="months"&&!blank){var m=Number(v);if(!isFinite(m)||m<1||Math.floor(m)!==m)return "Η διάρκεια πρέπει να είναι ακέραιος αριθμός μηνών, π.χ. 62."}
    if(f.date&&!blank&&!parseIso(v))return f.l+": μη έγκυρη ημερομηνία.";
    if(f.email&&!blank&&emailsErr(v,1))return f.l+": "+emailsErr(v,1);
    if(f.phone&&!blank&&!/^\+?[0-9][0-9 ()\-./,;]{4,}$/.test(String(v).trim()))return f.l+": μη έγκυρο τηλέφωνο (ψηφία, κενά, + ( ) - . ; ,).";
    if(S.cw.kind==="tn"&&f.k==="tender"&&!blank){var dp=tnDup(v,S.cw.id);if(dp)return "Ο αριθμός διαγωνισμού «"+String(v).trim()+"» υπάρχει ήδη στον διαγωνισμό «"+dp.title+"». Κάθε διαγωνισμός πρέπει να έχει διαφορετικό αριθμό."}
    if(f.k==="cost"&&!blank&&(!isFinite(Number(v))||Number(v)<0))return "Το κόστος πρέπει να είναι αριθμός, π.χ. 12000.50.";
  }
  if(keys.indexOf("dateTo")>=0&&d.dateFrom&&d.dateTo&&d.dateTo<d.dateFrom)return "Η ημερομηνία λήξης πρέπει να είναι μετά την ημερομηνία έναρξης.";
  return "";
}
function ctNext(){
  ctCollect();var w=S.cw,f=cwBase()[w.i];
  var e=ctValidateBase([f.k]);
  if(e){w.err=e;var x=$("#werr");if(x)x.textContent=e;return}
  if(f.k==="months"||f.k==="dateFrom")ctRegen();
  if(f.k==="dateTo")ctApplyEnd();
  w.err="";w.i++;ctDraw();
}
function ctRecord(d,kind){
  var tn=kind==="tn";
  var ys=(d.years||[]).map(function(y){var o={from:y.from,to:y.to,cost:(y.cost===""||y.cost==null)?"":Number(y.cost)};if(!tn)o.remind=+y.remind||30;return o});
  var blank=d.cost==null||String(d.cost).trim()==="";
  var base={title:String(d.title||"").trim(),tender:String(d.tender||"").trim(),description:String(d.description||"").trim(),months:Number(d.months),dateFrom:d.dateFrom,dateTo:d.dateTo,cost:blank?ctSum(ys):Number(d.cost),years:ys,budget:bpClean(d),attachments:d.attachments||[],createdAt:d.createdAt||Date.now(),sample:!!d.sample};
  if(tn){base.status=d.status||"active";base.statusAt=d.statusAt||"";base.promotedTo=d.promotedTo||"";cfApply(base,d,"tenders");return base}
  base.extras=exClean(d);base.archived=!!d.archived;base.archivedAt=d.archived?(d.archivedAt||""):"";
  var cr=coById(d.contractorId);base.contractorId=String(d.contractorId||"");base.contractor=cr?cr.name:String(d.contractor||"").trim();["contractorVat","contractorAddress","contractorContact","contractorPhone","contractorEmail"].forEach(function(k){base[k]=base.contractorId?"":String(d[k]||"").trim()});["repName","repPhone","repEmail"].forEach(function(k){base[k]=String(d[k]||"").trim()});base.coordinator=String(d.coordinator||"").trim();base.emails=String(d.emails||"").trim();base.milestones=d.milestones||[];
  cfApply(base,d,"contracts");return base;
}
async function ctSave(){
  ctCollect();var w=S.cw,d=w.d;
  var e=ctValidateBase(cwBase().map(function(f){return f.k}));
  if(!e)e=bpErr(d,1);
  if(!e&&w.kind!=="tn")e=exErr(d);
  if(!e){
    if(!(d.years||[]).length)d.years=buildYears(d.dateFrom,d.months);
    for(var i=0;i<d.years.length&&!e;i++){
      var y=d.years[i],n="Έτος "+(i+1)+": ";
      if(!parseIso(y.from)||!parseIso(y.to))e=n+"συμπλήρωσε έγκυρες ημερομηνίες.";
      else if(y.to<y.from)e=n+"η λήξη είναι πριν την έναρξη.";
      else if(y.cost!==""&&y.cost!=null&&(!isFinite(Number(y.cost))||Number(y.cost)<0))e=n+"το κόστος πρέπει να είναι αριθμός.";
    }
  }
  if(e){w.err=e;var x=$("#werr");if(x)x.textContent=e;return}
  /* on every save the contract cost is filled from the sum of the years (same as the "Συμπλήρωση ΚΟΣΤΟΥΣ από το άθροισμα ετών" button) when at least one year has a cost */
  if((d.years||[]).some(function(y){return y.cost!==""&&y.cost!=null}))d.cost=r2(ctSum(d.years));
  var tn=w.kind==="tn",rec=ctRecord(d,w.kind),id=w.id||uid();
  if(w.promoteFrom){
    if(await tnPromoteDo(w.promoteFrom,id,rec)){closePanel();toast("Ο διαγωνισμός προωθήθηκε στις Συμβάσεις");S.cat="ct";S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat","ct")}catch(e){}render();showCtDetail(id)}
    return;
  }
  if(await save(id,rec,tn?"tn":"ct")){closePanel();toast(w.id?"Αποθηκεύτηκε":"Προστέθηκε: "+rec.title);if(!w.id)(tn?showTnDetail:showCtDetail)(id)}
}
/* ---------- tenders (Διαγωνισμοί): same form as the contracts, without reminders ---------- */
function tnActive(t){return (t.status||"active")==="active"}
/* A tender number is compared without case and spaces ("12 / 2024" = "12/2024"); returns the other live tender that already uses it. */
function tnKey(s){return String(s==null?"":s).replace(/\s+/g,"").toUpperCase()}
function tnDup(num,exceptId){var k=tnKey(num);if(!k)return null;return (S.tenders||[]).filter(function(t){return t.id!==exceptId&&tnKey(t.tender)===k})[0]||null}
function tnInfo(t){
  var s=t.status||"active";
  if(s==="cancelled")return {k:"bad",t:"Ακυρώθηκε",sub:t.statusAt?fmtDate(t.statusAt):""};
  if(s==="promoted")return {k:"mute",t:"Προωθήθηκε σε Σύμβαση",sub:t.statusAt?fmtDate(t.statusAt):""};
  return {k:"ok",t:"Ενεργός",sub:""};
}
function tnStart(id){
  var t=id?getItem("tn",id):null;
  S.cw={id:id||null,kind:"tn",mode:t?"full":"step",i:0,err:"",d:t?JSON.parse(JSON.stringify(t)):{months:"",dateFrom:todayIso(),years:[],status:"active"}};
  ctDraw();
}
/* Promote: open the contract form pre-filled from the tender; nothing changes until the contract is saved. */
function tnPromoteStart(id){
  var t=getItem("tn",id);if(!t||!tnActive(t))return;
  var d=JSON.parse(JSON.stringify(t));
  d.years=(d.years||[]).map(function(y){return Object.assign({},y,{remind:30})});
  ["status","statusAt","promotedTo"].forEach(function(k){delete d[k]});
  d.contractorId="";d.repName="";d.repPhone="";d.repEmail="";d.contractor="";d.contractorVat="";d.contractorAddress="";d.contractorContact="";d.contractorPhone="";d.contractorEmail="";d.coordinator="";d.emails="";d.milestones=[];d.createdAt=Date.now();d.sample=false;
  S.cw={id:null,kind:"ct",promoteFrom:id,promoteTitle:t.title,mode:"full",i:0,err:"",d:d};
  ctDraw();
}
async function tnPromoteDo(tid,cid,rec){
  var t=getItem("tn",tid);if(!t)return false;
  if(window.RL_PROMOTE){try{await window.RL_PROMOTE(tid,cid,rec)}catch(e){toast(e&&e.status===409?"Ο διαγωνισμός δεν είναι πλέον ενεργός ή η σύμβαση υπάρχει ήδη":"Η προώθηση απέτυχε");return false}return true}
  if(!(await save(cid,rec,"ct")))return false;
  var tr=strip(t);tr.status="promoted";tr.promotedTo=cid;tr.statusAt=todayIso();
  if(!(await save(tid,tr,"tn"))){
    if(S.db&&S.uid){try{await col("contracts").doc(cid).delete()}catch(e){}}else{S.contracts=S.contracts.filter(function(x){return x.id!==cid});render()}
    return false;
  }
  return true;
}
async function tnSetStatus(id,st){
  var t=getItem("tn",id);if(!t)return;
  var rec=strip(t);rec.status=st;rec.statusAt=st==="cancelled"?todayIso():"";rec.promotedTo="";
  if(await save(id,rec,"tn")){toast(st==="cancelled"?"Ο διαγωνισμός ακυρώθηκε και αποθηκεύτηκε για αναφορά. Αφαιρέθηκε από τον Προϋπολογισμό.":"Ο διαγωνισμός είναι πάλι ενεργός");showTnDetail(id)}
}
function tnFiltered(){
  var q=S.q.toLowerCase();
  return sortList("tn",S.tenders.filter(function(c){
    var s=c.status||"active";
    if(S.filter==="active"&&s!=="active")return false;
    if(S.filter==="cancelled"&&s!=="cancelled")return false;
    if(S.filter==="promoted"&&s!=="promoted")return false;
    if(!q)return true;
    return [c.title,c.tender,c.description].join(" ").toLowerCase().indexOf(q)>=0;
  }));
}
function arRows(){
  var q=S.q.toLowerCase();
  return articles().filter(function(a){return !q||[a.code,a.desc,a.cat,a.catDesc].join(" ").toLowerCase().indexOf(q)>=0});
}
function renderAr(){
  var all=articles(),cats={},used=0,split=0;
  all.forEach(function(a){cats[a.cat]=1;if(artUsage(a.code))used++;if(a.split)split++});
  $("#stats").innerHTML='<div class="stat"><b>'+all.length+'</b><span>Άρθρα</span></div><div class="stat"><b>'+Object.keys(cats).length+'</b><span>Κατηγορίες</span></div><div class="stat"><b>'+used+'</b><span>Σε χρήση σε εγγραφές</span></div><div class="stat"><b>'+split+'</b><span>Με ανάλυση ανά έτος (ΝΑΙ)</span></div>';
  $("#alerts").innerHTML="";
  var edit="";
  if(!window.RL_CFG||window.RL_CFG.canArticles)edit='<button type="button" class="btn primary" data-act="arts">Επεξεργασία άρθρων</button>';
  $("#chips").innerHTML=edit;
  var rows=arRows(),h;
  if(!all.length)h='<div class="empty"><h2>Δεν υπάρχουν άρθρα</h2><p>Τα άρθρα προϋπολογισμού ορίζονται από τον διαχειριστή.</p></div>';
  else if(!rows.length)h='<div class="empty"><h2>Κανένα αποτέλεσμα</h2><p>Δοκίμασε άλλη αναζήτηση.</p></div>';
  else h='<div class="tbl"><table class="art arview"><thead><tr><th>Κωδικός</th><th>Περιγραφή άρθρου</th><th>Κατηγορία</th><th>Περιγραφή κατηγορίας</th><th>Ανάλυση ανά έτος</th><th class="num">Εγγραφές</th></tr></thead><tbody>'+
    rows.map(function(a){return '<tr><td class="mono"><b>'+esc(a.code)+'</b></td><td>'+esc(a.desc)+'</td><td>'+esc(a.cat)+'</td><td>'+esc(a.catDesc||"")+'</td><td>'+(a.split?'ΝΑΙ':'ΌΧΙ')+'</td><td class="num">'+artUsage(a.code)+'</td></tr>'}).join("")+'</tbody></table></div>';
  $("#list").innerHTML=h;
}
function renderTn(){
  var all=S.tenders,n={active:0,cancelled:0,promoted:0},est=0;
  all.forEach(function(t){var s=t.status||"active";n[s]=(n[s]||0)+1;if(s==="active")est+=Number(t.cost)||0});
  $("#stats").innerHTML=
    '<div class="stat"><b>'+all.length+'</b><span>Διαγωνισμοί</span></div>'+
    '<div class="stat"><b>'+n.active+'</b><span>Ενεργοί</span></div>'+
    '<div class="stat"><b>'+n.promoted+'</b><span>Προωθήθηκαν σε Σύμβαση</span></div>'+
    '<div class="stat bad"><b>'+n.cancelled+'</b><span>Ακυρώθηκαν</span></div>'+
    '<div class="stat"><b class="num" style="font-family:var(--f-display)">'+money(est).replace(/\.00$/,"")+'</b><span>Εκτιμώμενο κόστος ενεργών</span></div>';
  $("#alerts").innerHTML="";
  var chips=[["all","Όλοι"],["active","Ενεργοί"],["promoted","Προωθήθηκαν"],["cancelled","Ακυρώθηκαν"],["trash","🗑 Κάδος"+(S.trash.tn.length?" ("+S.trash.tn.length+")":"")]];
  $("#chips").innerHTML=chips.map(function(c){return '<button type="button" class="chip" data-f="'+c[0]+'" aria-pressed="'+(S.filter===c[0])+'">'+c[1]+'</button>'}).join("")+'<button type="button" class="chip" data-act="cols">⚙ Στήλες</button>'+(window.RL_CFG?'':'<button type="button" class="chip" data-act="arts">Άρθρα προϋπολογισμού</button>');
  var rows=tnFiltered(),h="";
  if(!all.length)h='<div class="empty"><h2>Δεν υπάρχουν διαγωνισμοί ακόμα</h2><p>Κατέγραψε τους νέους διαγωνισμούς που σκοπεύει να διενεργήσει ο Οργανισμός, με εκτιμώμενες ημερομηνίες, κόστος και επιμέρους ποσά ανά άρθρο προϋπολογισμού. Όταν ο διαγωνισμός προχωρήσει, προωθείται σε Σύμβαση.</p><div class="actions"><button class="btn primary" type="button" id="emAdd">+ Νέος διαγωνισμός</button></div></div>';
  else if(!rows.length)h='<div class="empty"><h2>Κανένα αποτέλεσμα</h2><p>Δοκίμασε άλλη αναζήτηση ή φίλτρο.</p></div>';
  else h=listHtml("tn",rows);
  $("#list").innerHTML=h;
}
function showTnDetail(id){
  var c=getItem("tn",id);if(!c)return;S.open=id;S.openCat="tn";
  var s=tnInfo(c),st=c.status||"active",ys=c.years||[],t=todayIso();
  var files=(c.attachments||[]).map(function(a,i){
    return '<li><a href="#" data-blob="'+esc(a.id)+'">'+esc(a.name)+'</a><button type="button" class="btn small danger" data-delfile="'+i+'">Αφαίρεση</button></li>';
  }).join("");
  var yr=ys.map(function(y,i){return '<tr><td>Έτος '+(i+1)+'</td><td class="mono">'+fmtDate(y.from)+'</td><td class="mono">'+fmtDate(y.to)+'</td><td class="num">'+mc(y.cost)+'</td></tr>'}).join("");
  var note="";
  if(st==="active")note='<p class="hint">Ο διαγωνισμός είναι ενεργός: τα ποσά του περιλαμβάνονται στον Προϋπολογισμό.</p>';
  else if(st==="cancelled")note='<p class="hint">Ακυρώθηκε'+(c.statusAt?" στις "+fmtDate(c.statusAt):"")+' και διατηρείται για αναφορά. Δεν περιλαμβάνεται στον Προϋπολογισμό.</p>';
  else{var pc=c.promotedTo?getItem("ct",c.promotedTo):null;note='<p class="hint">Προωθήθηκε σε Σύμβαση'+(c.statusAt?" στις "+fmtDate(c.statusAt):"")+' και διατηρείται για αναφορά. Η συμπερίληψη στον Προϋπολογισμό γίνεται πλέον μέσω της σύμβασης. '+(pc?'<button class="btn small" type="button" data-act="gocontract" data-id="'+esc(pc.id)+'">Άνοιγμα σύμβασης «'+esc(pc.title)+'»</button>':'(Η σύμβαση δεν βρέθηκε· ίσως έχει διαγραφεί.)')+'</p>'}
  var act='';
  if(st==="active")act='<button class="btn primary" type="button" data-act="tnpromote">Promote στις Συμβάσεις και αποθήκευση για αναφορά</button><button class="btn" type="button" data-act="tncancel">Ακύρωση και αποθήκευση για αναφορά</button>';
  else if(st==="cancelled")act='<button class="btn" type="button" data-act="tnreopen">Επανενεργοποίηση</button>';
  openPanel(
   '<div class="ph"><div><h2>'+esc(c.title)+'</h2><span class="pill '+s.k+'">'+s.t+'</span> <span class="hint">'+esc(s.sub)+'</span></div><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+note+
   '<dl class="kv wl">'+
   '<dt>ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ</dt><dd>'+esc(c.tender||"—")+'</dd>'+
   '<dt>ΠΕΡΙΓΡΑΦΗ</dt><dd>'+esc(c.description||"—")+'</dd>'+
   '<dt>ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)</dt><dd class="num">'+esc(c.months||"—")+'</dd>'+
   '<dt>ΕΚΤΙΜΩΜΕΝΗ ΗΜΕΡ. ΕΝΑΡΞΗΣ</dt><dd class="mono">'+fmtDate(c.dateFrom)+'</dd>'+
   '<dt>ΕΚΤΙΜΩΜΕΝΗ ΗΜΕΡ. ΛΗΞΗΣ</dt><dd class="mono">'+fmtDate(c.dateTo)+'</dd>'+
   '<dt>ΕΚΤΙΜΩΜΕΝΟ ΚΟΣΤΟΣ</dt><dd class="num">'+mc(c.cost)+'</dd></dl>'+
   '<div class="sec"><h3>Έτη</h3><div class="tbl"><table><thead><tr><th>Έτος</th><th>ΗΜΕΡ. ΕΝΑΡΞΗΣ</th><th>ΗΜΕΡ. ΛΗΞΗΣ</th><th>ΚΟΣΤΟΣ</th></tr></thead><tbody>'+yr+'</tbody></table></div></div>'+
   '<div class="sec"><h3>Συνημμένα</h3>'+(files?'<ul class="files">'+files+'</ul>':'<span class="hint">Δεν υπάρχουν συνημμένα (προδιαγραφές, μελέτες, προσφορές).</span>')+
   '<div><button class="btn" type="button" data-act="attach"'+(S.assets?'':' disabled')+'>+ Προσθήκη αρχείων</button> <span class="hint">'+(S.assets?'PDF, εικόνες, CSV, κείμενο, Word, Excel, PowerPoint, HTML, XML, email (eml/msg), άδειες (lic), συμπιεσμένα (zip/7z/rar) κ.ά. · μέγιστο μέγεθος αρχείου '+attMB()+' MB. Τα αρχεία HTML κατεβαίνουν, δεν ανοίγουν μέσα στην εφαρμογή.':'Η μεταφόρτωση δεν είναι διαθέσιμη εδώ.')+'</span></div></div>'+
   bpDetail(c,1)+cfDetail(c,"tenders")+
   '<div class="sec"><div class="actions">'+act+'<button class="btn" type="button" data-act="edit">Επεξεργασία</button><button class="btn danger" type="button" data-act="tndel">Διαγραφή</button></div><div id="delbox"></div></div>'
  ,"detail",true);
}

/* =============== CONTRACTORS (Ανάδοχοι) =============== */
var CO_BASE=[
 {k:"name",l:"ΟΝΟΜΑ",req:1,ph:"π.χ. Παράδειγμα Α.Ε."},
 {k:"address",l:"ΔΙΕΥΘΥΝΣΗ (ΟΔΟΣ, ΑΡΙΘΜΟΣ)"},
 {k:"address2",l:"ΔΙΕΥΘΥΝΣΗ (ΣΥΝΕΧΕΙΑ)"},
 {k:"postal",l:"Τ.Κ."},
 {k:"city",l:"ΠΟΛΗ"},
 {k:"country",l:"ΧΩΡΑ"},
 {k:"contact",l:"ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ"},
 {k:"phone",l:"ΤΗΛΕΦΩΝΟ",phone:1,ph:"π.χ. 22 123456, 99 123456"},
 {k:"email",l:"EMAIL",email:1,hint:"Για περισσότερα email χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;)",ph:"name@example.com"}
];
function coAddr(c){return [c.address,c.address2,[c.postal,c.city].filter(Boolean).join(" "),c.country].filter(function(x){return x&&String(x).trim()}).join(", ")}
function coKey(s){return String(s==null?"":s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toUpperCase()}
function coById(id){return id?((S.contractors||[]).filter(function(x){return x.id===id})[0]||null):null}
/* The contractor of a contract: the registered contractor when linked, otherwise the older free-text fields of the contract. */
function ctrOf(c){
  var r=coById(c.contractorId);
  if(r)return {linked:true,id:r.id,name:r.name||"",vat:"",addr:coAddr(r),contact:r.contact||"",phone:r.phone||"",email:r.email||""};
  return {linked:false,id:c.contractorId||"",name:c.contractor||"",vat:c.contractorVat||"",addr:c.contractorAddress||"",contact:c.contractorContact||"",phone:c.contractorPhone||"",email:c.contractorEmail||""};
}
/* a contractor with the same name or VAT number (compared without case and extra spaces) */
function coDup(name,vat,exceptId){
  var nk=coKey(name);
  return (S.contractors||[]).filter(function(x){return x.id!==exceptId&&nk&&coKey(x.name)===nk})[0]||null;
}
/* active contract = in force, expiring soon or not started yet (not expired) */
function coActive(c){var t=ctInfo(c).t;return t==="Σε ισχύ"||t==="Λήγει σύντομα"||t==="Δεν ξεκίνησε"}
function coContracts(id){return S.contracts.filter(function(c){return c.contractorId===id})}
function coStats(id){
  var n=0,seen={},list=[];
  coContracts(id).forEach(function(c){if(!coActive(c))return;n++;var k=tnKey(c.tender);if(k&&!seen[k]){seen[k]=1;list.push(String(c.tender).trim())}});
  return {n:n,tenders:list};
}
function coFiltered(){
  var q=S.q.toLowerCase();
  return sortList("co",(S.contractors||[]).filter(function(c){
    var n=coStats(c.id).n;
    if(S.filter==="withact"&&!n)return false;
    if(S.filter==="noact"&&n)return false;
    if(!q)return true;
    return [c.name,coAddr(c),c.contact,c.phone,c.email].join(" ").toLowerCase().indexOf(q)>=0;
  }));
}
function coLegacy(){return S.contracts.filter(function(c){return !c.contractorId&&String(c.contractor||"").trim()})}
function renderCo(){
  var all=S.contractors||[],withAct=0,acts=0,tset={};
  all.forEach(function(c){var s=coStats(c.id);if(s.n)withAct++;acts+=s.n;s.tenders.forEach(function(t){tset[tnKey(t)]=1})});
  $("#stats").innerHTML=
    '<div class="stat"><b>'+all.length+'</b><span>Ανάδοχοι</span></div>'+
    '<div class="stat"><b>'+withAct+'</b><span>Με ενεργές συμβάσεις</span></div>'+
    '<div class="stat"><b>'+acts+'</b><span>Ενεργές συμβάσεις</span></div>'+
    '<div class="stat"><b>'+Object.keys(tset).length+'</b><span>Διαγωνισμοί ενεργών συμβάσεων</span></div>';
  var lg=coLegacy();
  $("#alerts").innerHTML=lg.length?'<div class="alert"><span><b>'+lg.length+'</b> '+(lg.length===1?'σύμβαση έχει':'συμβάσεις έχουν')+' ανάδοχο ως ελεύθερο κείμενο, χωρίς σύνδεση με τη λίστα αναδόχων.</span><button type="button" data-act="comigrate">Δημιουργία αναδόχων από τις συμβάσεις</button></div>':"";
  var chips=[["all","Όλοι"],["withact","Με ενεργές συμβάσεις"],["noact","Χωρίς ενεργές συμβάσεις"],["trash","🗑 Κάδος"+(S.trash.co.length?" ("+S.trash.co.length+")":"")]];
  $("#chips").innerHTML=chips.map(function(c){return '<button type="button" class="chip" data-f="'+c[0]+'" aria-pressed="'+(S.filter===c[0])+'">'+c[1]+'</button>'}).join("")+'<button type="button" class="chip" data-act="cols">⚙ Στήλες</button>';
  var rows=coFiltered(),h="";
  if(!all.length)h='<div class="empty"><h2>Δεν υπάρχουν ανάδοχοι ακόμα</h2><p>Κατέγραψε εδώ τους αναδόχους (όνομα, διεύθυνση, άτομο επικοινωνίας, email, τηλέφωνο). Στις Συμβάσεις ο ανάδοχος επιλέγεται από αυτή τη λίστα και τα στοιχεία του αλλάζουν μόνο από εδώ.</p><div class="actions"><button class="btn primary" type="button" id="emAdd">+ Νέος ανάδοχος</button></div></div>';
  else if(!rows.length)h='<div class="empty"><h2>Κανένα αποτέλεσμα</h2><p>Δοκίμασε άλλη αναζήτηση ή φίλτρο.</p></div>';
  else h=listHtml("co",rows);
  $("#list").innerHTML=h;
}
function ctrKv(o){
  var tel=o.phone?'<a href="tel:'+esc(String(o.phone).split(/[,;]/)[0].replace(/[^0-9+]/g,""))+'">'+esc(o.phone)+'</a>':"—";
  return '<dl class="kv wl ctrinfo"><dt>ΟΝΟΜΑ</dt><dd>'+esc(o.name||"—")+'</dd>'+(o.vat?'<dt>ΑΦΜ</dt><dd>'+esc(o.vat)+'</dd>':'')+'<dt>ΔΙΕΥΘΥΝΣΗ</dt><dd>'+esc(o.addr||"—")+'</dd><dt>ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ</dt><dd>'+esc(o.contact||"—")+'</dd><dt>ΤΗΛΕΦΩΝΟ</dt><dd>'+tel+'</dd><dt>EMAIL</dt><dd>'+esc(o.email||"—")+'</dd></dl>';
}
function showCoDetail(id){
  var c=coById(id);if(!c)return;S.open=id;S.openCat="co";
  var st=coStats(id),cts=coContracts(id);
  var rows=cts.map(function(x){var s=ctInfo(x);return '<tr><td>'+esc(x.title)+'</td><td>'+esc(x.tender||"—")+'</td><td><span class="pill '+s.k+'">'+s.t+'</span></td><td class="mono">'+fmtDate(x.dateTo)+'</td><td><button class="btn small" type="button" data-act="gocontract" data-id="'+esc(x.id)+'">Άνοιγμα</button></td></tr>'}).join("");
  openPanel(
   '<div class="ph"><div><h2>'+esc(c.name)+'</h2><span class="hint">Ανάδοχος</span></div><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+
   '<dl class="kv wl">'+
   '<dt>ΔΙΕΥΘΥΝΣΗ</dt><dd>'+esc([c.address,c.address2].filter(Boolean).join(", ")||"—")+'</dd>'+
   '<dt>Τ.Κ. / ΠΟΛΗ</dt><dd>'+esc([c.postal,c.city].filter(Boolean).join(" ")||"—")+'</dd>'+
   '<dt>ΧΩΡΑ</dt><dd>'+esc(c.country||"—")+'</dd>'+
   '<dt>ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ</dt><dd>'+esc(c.contact||"—")+'</dd>'+
   '<dt>ΤΗΛΕΦΩΝΟ</dt><dd>'+(c.phone?'<a href="tel:'+esc(String(c.phone).split(/[,;]/)[0].replace(/[^0-9+]/g,""))+'">'+esc(c.phone)+'</a>':"—")+'</dd>'+
   '<dt>EMAIL</dt><dd>'+esc(c.email||"—")+'</dd>'+
   '<dt>ΕΝΕΡΓΕΣ ΣΥΜΒΑΣΕΙΣ</dt><dd class="num">'+st.n+'</dd>'+
   '<dt>ΑΡ. ΔΙΑΓΩΝΙΣΜΟΥ ΕΝΕΡΓΩΝ ΣΥΜΒΑΣΕΩΝ</dt><dd>'+(st.tenders.length?esc(st.tenders.join(", ")):"—")+'</dd></dl>'+
   cfDetail(c,"contractors")+'<div class="sec"><h3>Συμβάσεις του αναδόχου</h3>'+(rows?'<div class="tbl"><table><thead><tr><th>ΣΥΜΒΑΣΗ</th><th>ΑΡ. ΔΙΑΓΩΝΙΣΜΟΥ</th><th>ΚΑΤΑΣΤΑΣΗ</th><th>ΛΗΞΗ</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div><span class="hint">Ενεργές είναι οι συμβάσεις που δεν έχουν λήξει.</span>':'<span class="hint">Καμία σύμβαση δεν χρησιμοποιεί ακόμα αυτόν τον ανάδοχο.</span>')+'</div>'+
   '<div class="sec"><div class="actions"><button class="btn" type="button" data-act="edit">Επεξεργασία</button><button class="btn danger" type="button" data-act="codel">Διαγραφή</button></div><div id="delbox"></div></div>'
  ,"detail",true);
}
function coStart(id,opt){
  var c=id?coById(id):null;opt=opt||{};
  S.co={id:id||null,err:"",fromContract:!!opt.fromContract,prevDirty:!!opt.prevDirty,d:c?JSON.parse(JSON.stringify(c)):Object.assign({},opt.prefill||{})};
  coDraw();S.dirty=false;
}
function coCollect(){var d=S.co.d;coF().forEach(function(f){var el=$("#co_"+f.k);if(el)d[f.k]=el.value})}
function coDraw(){
  var w=S.co,d=w.d;cfLoad(d,"contractors");
  openPanel('<div class="ph"><h2>'+(w.id?"Επεξεργασία αναδόχου":"Νέος ανάδοχος")+'</h2><button class="btn small" type="button" data-act="cocancel">Άκυρο</button></div>'+
   (w.fromContract?'<p class="hint">Μετά την αποθήκευση επιστρέφεις στη σύμβαση και ο ανάδοχος επιλέγεται αυτόματα. Τα στοιχεία της σύμβασης που έχεις ήδη συμπληρώσει διατηρούνται.</p>':'')+
   '<div style="display:grid;gap:12px">'+coF().map(function(f){return '<label class="f">'+f.l+(f.req?' *':'')+(f.hint?'<small>'+esc(f.hint)+'</small>':'')+ctInput(f,d[f.k],"co_"+f.k)+'</label>'}).join("")+'</div>'+
   '<div class="err" id="werr">'+esc(w.err)+'</div><div class="actions"><button class="btn primary" type="button" data-act="cosave">Αποθήκευση</button></div>',"wiz",true);
}
function coCancel(){
  var w=S.co;if(!w)return;
  if(S.dirty&&!window.confirm("Να κλείσει η φόρμα; Ό,τι έχεις συμπληρώσει και δεν έχει αποθηκευτεί θα χαθεί."))return;
  S.co=null;
  if(w.fromContract&&S.cw){S.dirty=w.prevDirty;ctDraw();return}
  closePanel();
}
async function coSave(){
  coCollect();var w=S.co,d=w.d,e="",name=String(d.name||"").trim();
  if(!name)e="ΟΝΟΜΑ: υποχρεωτικό πεδίο.";
  coF().forEach(function(f){var v=d[f.k];if(e||v==null||String(v).trim()==="")return;
    if(f.cf){var ce=cfErr(f,v);if(ce){e=ce;return}}
    if(f.email&&emailsErr(v,1))e=f.l+": "+emailsErr(v,1);
    if(f.phone&&!/^\+?[0-9][0-9 ()\-./,;]{4,}$/.test(String(v).trim()))e=f.l+": μη έγκυρο τηλέφωνο (ψηφία, κενά, + ( ) - . ; ,).";
  });
  if(!e){var dp=coDup(name,"",w.id);if(dp)e="Υπάρχει ήδη ανάδοχος με το όνομα «"+dp.name+"». Επίλεξέ τον από τη λίστα αντί να τον προσθέσεις ξανά."}
  if(e){w.err=e;var x=$("#werr");if(x)x.textContent=e;return}
  var rec={};CO_BASE.forEach(function(f){rec[f.k]=String(d[f.k]==null?"":d[f.k]).trim()});rec.createdAt=d.createdAt||Date.now();rec.sample=!!d.sample;cfApply(rec,d,"contractors");
  var id=w.id||uid();
  if(await save(id,rec,"co")){
    var back=w.fromContract&&S.cw;S.co=null;
    if(back){S.cw.d.contractorId=id;S.cw.d.contractor=rec.name;S.dirty=true;toast("Προστέθηκε ανάδοχος: "+rec.name);ctDraw();return}
    closePanel();toast(w.id?"Αποθηκεύτηκε":"Προστέθηκε: "+rec.name);showCoDetail(id);
  }
}
/* contracts whose contractor is still free text: register the contractors (same name = one contractor) and link the contracts */
async function coMigrate(){
  var legacy=coLegacy();if(!legacy.length){toast("Δεν υπάρχουν συμβάσεις με ανάδοχο ως ελεύθερο κείμενο");return}
  var groups={},order=[];
  legacy.forEach(function(c){var k=coKey(c.contractor);if(!groups[k]){groups[k]=[];order.push(k)}groups[k].push(c)});
  if(!window.confirm("Θα δημιουργηθούν ή θα συνδεθούν "+order.length+" ανάδοχοι για "+legacy.length+" συμβάσεις (ίδιο όνομα = ένας ανάδοχος). Τα στοιχεία (διεύθυνση, επικοινωνία) περνούν από τη σύμβαση στον ανάδοχο. Συνέχεια;"))return;
  var made=0,linked=0;
  for(var i=0;i<order.length;i++){
    var cs=groups[order[i]],ex=(S.contractors||[]).filter(function(x){return coKey(x.name)===order[i]})[0],id,name;
    if(ex){id=ex.id;name=ex.name}
    else{
      var src=cs.filter(function(c){return c.contractorVat||c.contractorAddress||c.contractorContact||c.contractorPhone||c.contractorEmail})[0]||cs[0];
      name=String(cs[0].contractor).trim();
      var rec={name:name,address:String(src.contractorAddress||"").trim(),address2:"",postal:"",city:"",region:"",country:"",contact:String(src.contractorContact||"").trim(),phone:String(src.contractorPhone||"").trim(),email:String(src.contractorEmail||"").trim(),createdAt:Date.now(),sample:false};
      id=uid();
      if(!(await save(id,rec,"co")))continue;
      made++;
      if(!coById(id)){S.contractors.push(Object.assign({id:id},rec))}
    }
    for(var j=0;j<cs.length;j++){
      var r=strip(cs[j]);r.contractorId=id;r.contractor=name;["contractorVat","contractorAddress","contractorContact","contractorPhone","contractorEmail"].forEach(function(k){r[k]=""});
      if(await save(cs[j].id,r,"ct"))linked++;
    }
  }
  toast("Δημιουργήθηκαν "+made+" ανάδοχοι και συνδέθηκαν "+linked+" συμβάσεις");render();
}
function coHead0(){return ["ΟΝΟΜΑ","ΔΙΕΥΘΥΝΣΗ","ΔΙΕΥΘΥΝΣΗ (ΣΥΝΕΧΕΙΑ)","Τ.Κ.","ΠΟΛΗ","ΧΩΡΑ","ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ","EMAIL","ΤΗΛΕΦΩΝΟ","ΕΝΕΡΓΕΣ ΣΥΜΒΑΣΕΙΣ","ΑΡ. ΔΙΑΓΩΝΙΣΜΟΥ ΕΝΕΡΓΩΝ ΣΥΜΒΑΣΕΩΝ"]}
function coRowsOut0(){
  return (S.contractors||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name),"el",{sensitivity:"base"})}).map(function(c){
    var s=coStats(c.id);return [c.name,c.address||"",c.address2||"",c.postal||"",c.city||"",c.country||"",c.contact||"",c.email||"",c.phone||"",s.n,s.tenders.join(", ")];
  });
}
function coExportXlsx(){if(needX())return;if(!(S.contractors||[]).length){toast("Δεν υπάρχουν ανάδοχοι για εξαγωγή");return}offer("contractors-"+todayIso()+".xlsx",ctWb(coHead(),coRowsOut(),"Ανάδοχοι"))}
function coExportCsv(){
  if(!(S.contractors||[]).length){toast("Δεν υπάρχουν ανάδοχοι για εξαγωγή");return}
  var q=function(v){v=String(v==null?"":v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  offer("contractors-"+todayIso()+".csv","﻿"+[coHead()].concat(coRowsOut()).map(function(r){return r.map(q).join(",")}).join("\r\n"));
}
function coShowExport(){
  openPanel('<div class="ph"><h2>Εξαγωγή αναδόχων</h2><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+
   '<div class="sec"><h3>Εξαγωγή όλων των αναδόχων</h3><p class="hint">Περιλαμβάνει όλα τα στοιχεία κάθε αναδόχου, τον αριθμό των ενεργών συμβάσεών του και τους αριθμούς διαγωνισμού (π.χ. ΟΑΠ/ΠΜΕ/01/21/01) των ενεργών συμβάσεών του.</p><div class="actions"><button class="btn primary" type="button" data-act="xlsx">Excel (.xlsx)</button><button class="btn" type="button" data-act="csv">CSV</button></div></div>',"export");
}

/* ---------- Excel import ---------- */
function nh(s){return String(s==null?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[\s.\-–()_:,;]/g,"")}
var CT_ALIAS={repName:["ΑΝΤΙΠΡΟΣΩΠΟΣΑΝΑΔΟΧΟΥΣΥΜΒΑΣΗΣ","ΑΝΤΙΠΡΟΣΩΠΟΣΑΝΑΔΟΧΟΥ","ΑΝΤΙΠΡΟΣΩΠΟΣ"],repPhone:["ΤΗΛΕΦΩΝΟΑΝΤΙΠΡΟΣΩΠΟΥ"],repEmail:["EMAILΑΝΤΙΠΡΟΣΩΠΟΥ"],title:["ΣΥΜΒΑΣΗ","CONTRACT"],tender:["ΑΡΙΘΜΟΣΔΙΑΓΩΝΙΣΜΟΥ","ΑΡΔΙΑΓΩΝΙΣΜΟΥ","TENDER"],description:["ΠΕΡΙΓΡΑΦΗ","DESCRIPTION"],contractor:["ΑΝΑΔΟΧΟΣ","CONTRACTOR"],contractorVat:["ΑΦΜΑΝΑΔΟΧΟΥ","ΑΦΜ"],contractorAddress:["ΔΙΕΥΘΥΝΣΗΑΝΑΔΟΧΟΥ"],contractorContact:["ΑΤΟΜΟΕΠΙΚΟΙΝΩΝΙΑΣΑΝΑΔΟΧΟΥ","ΑΤΟΜΟΕΠΙΚΟΙΝΩΝΙΑΣ"],contractorPhone:["ΤΗΛΕΦΩΝΟΑΝΑΔΟΧΟΥ","ΤΗΛΕΦΩΝΟ"],contractorEmail:["EMAILΑΝΑΔΟΧΟΥ"],
 coordinator:["ΣΥΝΤΟΝΙΣΤΗΣΣΥΜΒΑΣΗΣ","ΣΥΝΤΟΝΙΣΤΗΣ"],months:["ΔΙΑΡΚΕΙΑΣΥΜΒΑΣΗΣΜΗΝΕΣ","ΔΙΑΡΚΕΙΑΜΗΝΕΣ","ΔΙΑΡΚΕΙΑ","ΜΗΝΕΣ"],dateFrom:["ΗΜΕΡΕΝΑΡΞΗΣ","ΕΝΑΡΞΗ"],dateTo:["ΗΜΕΡΛΗΞΗΣ","ΛΗΞΗ"],cost:["ΚΟΣΤΟΣ","ΣΥΝΟΛΙΚΟΚΟΣΤΟΣ"],emails:["EMAILΕΙΔΟΠΟΙΗΣΕΩΝ","EMAILΕΙΔΟΠΟΙΗΣΗΣ","EMAILS","EMAIL","NOTIFICATIONEMAILS"]};
function numOf(v){
  if(v===""||v==null)return "";
  if(typeof v==="number")return v;
  var s=String(v).replace(/[€\s]/g,"");
  if(s.indexOf(",")>=0&&s.indexOf(".")>=0)s=s.replace(/\./g,"").replace(",",".");
  else if(s.indexOf(",")>=0)s=s.replace(",",".");
  return Number(s);
}
function parseCtSheet(buf){
  var wb=XLSX.read(buf,{type:"array",cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]];
  var rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});
  return rows.map(function(r,idx){
    var base={},yrs={};
    Object.keys(r).forEach(function(k){
      var h=nh(k),v=r[k],m=/^ΕΤΟΣ(\d+)(ΗΜΕΡΕΝΑΡΞΗΣ|ΗΜΕΡΛΗΞΗΣ|ΚΟΣΤΟΣ|ΥΠΕΝΘΥΜΙΣΗ.*)$/.exec(h);
      if(m){var n=+m[1],p=m[2];yrs[n]=yrs[n]||{};
        if(p==="ΗΜΕΡΕΝΑΡΞΗΣ")yrs[n].from=toIsoDate(v);else if(p==="ΗΜΕΡΛΗΞΗΣ")yrs[n].to=toIsoDate(v);else if(p==="ΚΟΣΤΟΣ")yrs[n].cost=v;else yrs[n].remind=v;
        return}
      Object.keys(CT_ALIAS).forEach(function(key){if(CT_ALIAS[key].indexOf(h)>=0&&v!==""&&base[key]===undefined)base[key]=v});
    });
    var from=toIsoDate(base.dateFrom),to=toIsoDate(base.dateTo),months=numOf(base.months);
    if((months===""||!(months>0))&&from&&to){var a=parseIso(from),b=parseIso(to);if(a&&b)months=Math.round(((b-a)/864e5+1)/30.4375)}
    if(!to&&from&&months>0)to=ctEnd(from,months);
    var g=buildYears(from,months);
    if(g.length&&to&&to>=g[g.length-1].from)g[g.length-1].to=to;
    Object.keys(yrs).map(Number).sort(function(x,y){return x-y}).forEach(function(n){
      var y=yrs[n],i=n-1;
      if(i>=g.length){if(!y.from||!y.to)return;g.push({from:y.from,to:y.to,cost:"",remind:defRemind()});i=g.length-1}
      if(y.from)g[i].from=y.from;if(y.to)g[i].to=y.to;
      if(y.cost!==undefined&&y.cost!=="")g[i].cost=numOf(y.cost);
      var rm=Number(y.remind);if(rm>0)g[i].remind=rm;
    });
    var cost=numOf(base.cost);
    var rec={title:String(base.title||"").trim(),tender:String(base.tender==null?"":base.tender).trim(),description:String(base.description||"").trim(),contractor:String(base.contractor||"").trim(),contractorVat:String(base.contractorVat||"").trim(),contractorAddress:String(base.contractorAddress||"").trim(),contractorContact:String(base.contractorContact||"").trim(),contractorPhone:String(base.contractorPhone||"").trim(),contractorEmail:String(base.contractorEmail||"").trim(),coordinator:String(base.coordinator||"").trim(),repName:String(base.repName||"").trim(),repPhone:String(base.repPhone||"").trim(),repEmail:String(base.repEmail||"").trim(),contractorId:"",
      months:months===""?0:months,dateFrom:from,dateTo:to,cost:cost===""?ctSum(g):cost,years:g,emails:String(base.emails||"").trim(),attachments:[],createdAt:Date.now(),sample:false};
    var cm=rec.contractor?(S.contractors||[]).filter(function(x){return coKey(x.name)===coKey(rec.contractor)})[0]:null;
    if(cm){rec.contractorId=cm.id;rec.contractor=cm.name;["contractorVat","contractorAddress","contractorContact","contractorPhone","contractorEmail"].forEach(function(k){rec[k]=""})}
    var errs=[];
    if(!rec.title)errs.push("λείπει η σύμβαση");
    if(emailsErr(rec.emails,1))errs.push(emailsErr(rec.emails,1));
    if(rec.contractorEmail&&emailsErr(rec.contractorEmail,1))errs.push("EMAIL ΑΝΑΔΟΧΟΥ: "+emailsErr(rec.contractorEmail,1));
    if(rec.repEmail&&emailsErr(rec.repEmail,1))errs.push("EMAIL ΑΝΤΙΠΡΟΣΩΠΟΥ: "+emailsErr(rec.repEmail,1));
    if(!from)errs.push("ΗΜΕΡ. ΕΝΑΡΞΗΣ λείπει/άκυρη");
    if(!(rec.months>0))errs.push("άκυρη διάρκεια");
    if(from&&to&&to<from)errs.push("λήξη πριν την έναρξη");
    if(!isFinite(rec.cost))errs.push("άκυρο κόστος");
    g.forEach(function(y,i){if(!isFinite(Number(y.cost)))errs.push("άκυρο κόστος έτους "+(i+1))});
    return {n:idx+2,rec:rec,errs:errs};
  });
}
function showCtImport(rows){
  S.imp=rows;S.impCat="ct";
  var good=rows.filter(function(r){return !r.errs.length}).length;
  var tr=rows.slice(0,200).map(function(r){
    var x=r.rec;
    return '<tr class="'+(r.errs.length?"badrow":"")+'"><td>'+r.n+'</td><td>'+esc(x.title)+'</td><td>'+esc(x.tender)+'</td><td>'+esc(x.contractor)+'</td><td>'+esc(x.months)+'</td><td>'+fmtDate(x.dateFrom)+'</td><td>'+fmtDate(x.dateTo)+'</td><td class="num">'+(isFinite(x.cost)?money(x.cost):"—")+'</td><td>'+x.years.length+'</td><td>'+(r.errs.length?esc(r.errs.join(", ")):"OK")+'</td></tr>';
  }).join("");
  openPanel('<div class="ph"><h2>Προεπισκόπηση εισαγωγής</h2><button class="btn small" type="button" data-act="close">Άκυρο</button></div>'+
   '<p class="hint">Βρέθηκαν '+rows.length+' γραμμές, '+good+' έτοιμες για εισαγωγή. Οι γραμμές με πρόβλημα παραλείπονται. Οι νέες συμβάσεις προστίθενται στις υπάρχουσες.</p>'+
   '<div class="tbl"><table><thead><tr><th>Γραμμή</th><th>ΣΥΜΒΑΣΗ</th><th>ΑΡ. ΔΙΑΓΩΝΙΣΜΟΥ</th><th>ΑΝΑΔΟΧΟΣ</th><th>ΜΗΝΕΣ</th><th>ΕΝΑΡΞΗ</th><th>ΛΗΞΗ</th><th>ΚΟΣΤΟΣ</th><th>ΕΤΗ</th><th>Έλεγχος</th></tr></thead><tbody>'+tr+'</tbody></table></div>'+
   '<div class="actions"><button class="btn primary" type="button" data-act="doimport"'+(good?'':' disabled')+'>Εισαγωγή '+good+' γραμμών</button></div>',"imp",true);
}

/* ---------- export ---------- */
function ctHead0(n){
  var h=["ΣΥΜΒΑΣΗ","ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ","ΠΕΡΙΓΡΑΦΗ","ΑΝΑΔΟΧΟΣ","ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ","ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ)","ΗΜΕΡ. ΕΝΑΡΞΗΣ","ΗΜΕΡ. ΛΗΞΗΣ","ΚΟΣΤΟΣ"];
  for(var i=1;i<=n;i++)h.push("ΕΤΟΣ "+i+" - ΗΜΕΡ.ΕΝΑΡΞΗΣ","ΕΤΟΣ "+i+" - ΗΜΕΡ.ΛΗΞΗΣ","ΕΤΟΣ "+i+" - ΚΟΣΤΟΣ","ΕΤΟΣ "+i+" - ΥΠΕΝΘΥΜΙΣΗ (ΗΜΕΡΕΣ ΠΡΙΝ)");
  h.push("ΣΥΝΗΜΜΕΝΑ","EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ","ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ","MILESTONES","ΚΑΤΑΣΤΑΣΗ","ΑΦΜ ΑΝΑΔΟΧΟΥ","ΔΙΕΥΘΥΝΣΗ ΑΝΑΔΟΧΟΥ","ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ ΑΝΑΔΟΧΟΥ","ΤΗΛΕΦΩΝΟ ΑΝΑΔΟΧΟΥ","EMAIL ΑΝΑΔΟΧΟΥ","ΑΝΤΙΠΡΟΣΩΠΟΣ ΑΝΑΔΟΧΟΥ (ΣΥΜΒΑΣΗΣ)","ΤΗΛΕΦΩΝΟ ΑΝΤΙΠΡΟΣΩΠΟΥ","EMAIL ΑΝΤΙΠΡΟΣΩΠΟΥ","ΕΠΙΠΡΟΣΘΕΤΕΣ/ΠΡΟΑΙΡΕΤΙΚΕΣ ΥΠΗΡΕΣΙΕΣ","ΕΤΗΣΙΟ ΠΟΣΟ ΥΠΗΡΕΣΙΩΝ");return h;
}
function ctMaxYears(){return S.contracts.reduce(function(a,c){return Math.max(a,(c.years||[]).length)},1)}
function ctRowsOut0(n){
  return S.contracts.slice().sort(function(a,b){return (a.dateTo||"").localeCompare(b.dateTo||"")}).map(function(c){
    var o=ctrOf(c),r=[c.title,c.tender,c.description,o.name,c.coordinator,c.months,c.dateFrom,c.dateTo,ctTotal(c)],ys=c.years||[];
    for(var i=0;i<n;i++){var y=ys[i]||{};r.push(y.from||"",y.to||"",i<ys.length?ctYearCost(c,i):"",y.remind||"")}
    r.push((c.attachments||[]).map(function(a){return a.name}).join("; "),c.emails||"",bpText(c),msText(c),ctInfo(c).t,o.vat,o.addr,o.contact,o.phone,o.email,c.repName||"",c.repPhone||"",c.repEmail||"",exText(c),exSum(c)||"");
    return r;
  });
}
function ctWb(head,rows,sheet){
  var ws=XLSX.utils.aoa_to_sheet([head].concat(rows));
  ws["!cols"]=head.map(function(h){return {wch:Math.max(14,Math.min(36,h.length+2))}});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheet||"Συμβάσεις");
  return XLSX.write(wb,{bookType:"xlsx",type:"array"});
}
function ctExportXlsx(){if(needX())return;if(!S.contracts.length){toast("Δεν υπάρχουν συμβάσεις για εξαγωγή");return}var n=ctMaxYears();offer("contracts-"+todayIso()+".xlsx",ctWb(ctHead(n),ctRowsOut(n)))}
function ctExportCsv(){
  if(!S.contracts.length){toast("Δεν υπάρχουν συμβάσεις για εξαγωγή");return}
  var n=ctMaxYears(),q=function(v){v=String(v==null?"":v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  offer("contracts-"+todayIso()+".csv","﻿"+[ctHead(n)].concat(ctRowsOut(n)).map(function(r){return r.map(q).join(",")}).join("\r\n"));
}
function tnMaxYears(){return S.tenders.reduce(function(a,c){return Math.max(a,(c.years||[]).length)},1)}
function tnHead0(n){
  var h=["ΟΝΟΜΑ ΔΙΑΓΩΝΙΣΜΟΥ","ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ","ΠΕΡΙΓΡΑΦΗ","ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)","ΕΚΤΙΜ. ΗΜΕΡ. ΕΝΑΡΞΗΣ","ΕΚΤΙΜ. ΗΜΕΡ. ΛΗΞΗΣ","ΕΚΤΙΜΩΜΕΝΟ ΚΟΣΤΟΣ"];
  for(var i=1;i<=n;i++)h.push("ΕΤΟΣ "+i+" - ΗΜΕΡ.ΕΝΑΡΞΗΣ","ΕΤΟΣ "+i+" - ΗΜΕΡ.ΛΗΞΗΣ","ΕΤΟΣ "+i+" - ΚΟΣΤΟΣ");
  h.push("ΣΥΝΗΜΜΕΝΑ","ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ","ΚΑΤΑΣΤΑΣΗ");return h;
}
function tnRowsOut0(n){
  return S.tenders.slice().sort(function(a,b){return (a.dateFrom||"").localeCompare(b.dateFrom||"")}).map(function(c){
    var r=[c.title,c.tender,c.description,c.months,c.dateFrom,c.dateTo,c.cost],ys=c.years||[];
    for(var i=0;i<n;i++){var y=ys[i]||{};r.push(y.from||"",y.to||"",y.cost===undefined?"":y.cost)}
    r.push((c.attachments||[]).map(function(a){return a.name}).join("; "),bpText(c),tnInfo(c).t);
    return r;
  });
}
function tnExportXlsx(){if(needX())return;if(!S.tenders.length){toast("Δεν υπάρχουν διαγωνισμοί για εξαγωγή");return}var n=tnMaxYears();offer("tenders-"+todayIso()+".xlsx",ctWb(tnHead(n),tnRowsOut(n),"Διαγωνισμοί"))}
function tnExportCsv(){
  if(!S.tenders.length){toast("Δεν υπάρχουν διαγωνισμοί για εξαγωγή");return}
  var n=tnMaxYears(),q=function(v){v=String(v==null?"":v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  offer("tenders-"+todayIso()+".csv","\ufeff"+[tnHead(n)].concat(tnRowsOut(n)).map(function(r){return r.map(q).join(",")}).join("\r\n"));
}
function tnShowExport(){
  openPanel('<div class="ph"><h2>Εξαγωγή διαγωνισμών</h2><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+
   '<div class="sec"><h3>Εξαγωγή όλων των διαγωνισμών</h3><p class="hint">Περιλαμβάνει όλα τα πεδία, τα στοιχεία κάθε έτους, τα επιμέρους ποσά, τα ονόματα των συνημμένων και την κατάσταση (ενεργός, ακυρώθηκε, προωθήθηκε).</p><div class="actions"><button class="btn primary" type="button" data-act="xlsx">Excel (.xlsx)</button><button class="btn" type="button" data-act="csv">CSV</button></div></div>',"export");
}
function ctTemplate(){if(needX())return;
  var ex=["Παράδειγμα σύμβασης","12/2026","Περιγραφή","Εταιρεία Α","Όνομα Επώνυμο",24,"2026-01-01","2027-12-31",24000,"2026-01-01","2026-12-31",12000,30,"2027-01-01","2027-12-31",12000,30,"","a@example.com, b@example.com","","",""];
  offer("contracts-template.xlsx",ctWb(ctHead(2),[ex]));
}
function ctShowExport(){
  openPanel('<div class="ph"><h2>Εξαγωγή και εισαγωγή</h2><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+
   '<div class="sec"><h3>Εξαγωγή όλων των συμβάσεων</h3><p class="hint">Περιλαμβάνει όλα τα πεδία, τα στοιχεία κάθε έτους, την υπενθύμιση ανά έτος, τα ονόματα των συνημμένων και την κατάσταση. Οι στήλες ΕΤΟΣ προσαρμόζονται στη μεγαλύτερη σύμβαση.</p><div class="actions"><button class="btn primary" type="button" data-act="xlsx">Excel (.xlsx)</button><button class="btn" type="button" data-act="csv">CSV</button></div></div>'+
   '<div class="sec"><h3>Εισαγωγή από Excel</h3><p class="hint">Στήλες: ΣΥΜΒΑΣΗ, ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ, ΠΕΡΙΓΡΑΦΗ, ΑΝΑΔΟΧΟΣ, ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ, ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ), ΗΜΕΡ. ΕΝΑΡΞΗΣ, ΗΜΕΡ. ΛΗΞΗΣ, ΚΟΣΤΟΣ και προαιρετικά ΑΦΜ ΑΝΑΔΟΧΟΥ, ΔΙΕΥΘΥΝΣΗ ΑΝΑΔΟΧΟΥ, ΑΤΟΜΟ ΕΠΙΚΟΙΝΩΝΙΑΣ ΑΝΑΔΟΧΟΥ, ΤΗΛΕΦΩΝΟ ΑΝΑΔΟΧΟΥ, EMAIL ΑΝΑΔΟΧΟΥ, ΕΤΟΣ 1 - ΗΜΕΡ.ΕΝΑΡΞΗΣ, ΗΜΕΡ.ΛΗΞΗΣ, ΚΟΣΤΟΣ κ.ο.κ. Αν λείπουν οι στήλες των ετών, δημιουργούνται αυτόματα από τη διάρκεια. Ημερομηνίες: ηη/μμ/εεεε ή εεεε-μμ-ηη.</p><div class="actions"><button class="btn" type="button" data-act="tpl">Λήψη προτύπου</button><button class="btn" type="button" data-act="pick">Επιλογή αρχείου Excel…</button></div></div>',"export");
}

/* ---------- samples ---------- */
async function ctSample(){
  var t=todayIso();
  var a=addMonths(t,-20),b=addMonths(addDays(t,21),-24);
  var ya=buildYears(a,62),yb=buildYears(b,24);
  ya.forEach(function(y,i){y.cost=[18000,15000,15000,15000,15000][i]||0});
  yb.forEach(function(y){y.cost=9000});
  var mk=function(o,ys){var c=Object.assign({tender:"",description:"",coordinator:"",attachments:[],createdAt:Date.now(),sample:true,years:ys,dateTo:ys[ys.length-1].to,cost:ctSum(ys)},o);return c};
  await save(uid(),mk({title:"Συντήρηση πληροφοριακών συστημάτων",tender:"12/2024",description:"Υποστήριξη και συντήρηση εξοπλισμού",contractor:"Παράδειγμα Α.Ε.",coordinator:"Όνομα Επώνυμο",months:62,dateFrom:a},ya),"ct");
  await save(uid(),mk({title:"Υπηρεσίες φιλοξενίας δεδομένων",tender:"05/2025",description:"Φιλοξενία και αντίγραφα ασφαλείας",contractor:"Παράδειγμα Ε.Π.Ε.",coordinator:"Όνομα Επώνυμο",months:24,dateFrom:b},yb),"ct");
}

/* ---------- on-open reminder popup (both categories) ---------- */
/*GUIDE-START*/var GUIDE_HTML="<p class=\"hint\">Οδηγός χρήσης του PROCURE360 · ισχύει για την έκδοση 3.12.0. Πάτησε σε ένα θέμα για να πας κατευθείαν σε αυτό.<\/p>\n<div class=\"gtoc\">\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"intro\">Επισκόπηση<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"start\">Πρώτα βήματα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"sw\">Online Renewals<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"ct\">Συμβάσεις<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"tn\">Διαγωνισμοί<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"bd\">Προϋπολογισμός<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"ar\">Άρθρα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"co\">Ανάδοχοι<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"ms\">Milestones<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"att\">Συνημμένα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"trash\">Κάδος και αναίρεση<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"rem\">Υπενθυμίσεις<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"xl\">Excel<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"cfg\">Ρυθμίσεις εφαρμογής<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"set\">Ρυθμίσεις και δικαιώματα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"data\">Δεδομένα και αντίγραφα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"faq\">Συχνές ερωτήσεις<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"new\">Τι νέο υπάρχει<\/button>\n<\/div>\n\n<h3 id=\"g-intro\">Επισκόπηση<\/h3>\n<p>Το PROCURE360 συνδέει σε ένα σημείο τις αγορές λογισμικού, τις συμβάσεις, τους μελλοντικούς διαγωνισμούς και τον προγραμματισμό του προϋπολογισμού. Έχει πέντε καρτέλες:<\/p>\n<ul>\n<li><b>Online Renewals:<\/b> συνδρομές λογισμικού με ημερομηνία λήξης και ανανέωση.<\/li>\n<li><b>Συμβάσεις:<\/b> συμβάσεις πολλών ετών, με κόστος και υπενθύμιση ανά έτος και milestones.<\/li>\n<li><b>Ανάδοχοι:<\/b> η λίστα των αναδόχων, από την οποία επιλέγονται στις Συμβάσεις.<\/li>\n<li><b>Διαγωνισμοί:<\/b> νέοι διαγωνισμοί που προτίθεται να διενεργήσει ο Οργανισμός, με εκτιμώμενα ποσά.<\/li>\n<li><b>Προϋπολογισμός:<\/b> πίνακες ανά άρθρο, που συμπληρώνονται αυτόματα από τα ποσά των τριών προηγούμενων καρτελών.<\/li>\n<li><b>Άρθρα:<\/b> η λίστα των άρθρων προϋπολογισμού του Οργανισμού.<\/li>\n<\/ul>\n<p>Οι εγγραφές των τριών πρώτων καρτελών κρατούν ποσά <b>χωρίς ΦΠΑ<\/b>. Ο Προϋπολογισμός προσθέτει ΦΠΑ (προεπιλογή 19%, αλλάζει από τις Ρυθμίσεις).<\/p>\n\n<h3 id=\"g-start\">Πρώτα βήματα<\/h3>\n<ul>\n<li>Διάλεξε καρτέλα και πάτησε το πράσινο κουμπί πάνω δεξιά («+ Add software», «+ Νέα σύμβαση», «+ Νέος διαγωνισμός»).<\/li>\n<li>Η φόρμα ανοίγει <b>βήμα-βήμα<\/b> (μία ερώτηση κάθε φορά). Με το «Πλήρης φόρμα» βλέπεις όλα τα πεδία μαζί.<\/li>\n<li>Οι φόρμες (Online Renewals, Συμβάσεις, Διαγωνισμοί) ανοίγουν σε <b>πλήρη οθόνη<\/b> και <b>δεν κλείνουν κατά λάθος<\/b>: ούτε με κλικ έξω από τη φόρμα ούτε με το Backspace. Το Esc και το «Άκυρο» ρωτούν πρώτα αν θέλεις να χάσεις ό,τι έχεις γράψει. Αν δοκιμάσεις να φύγεις από τη σελίδα με μισοσυμπληρωμένη φόρμα, ο browser ζητά επιβεβαίωση.<\/li>\n<li>Η αναζήτηση πάνω από τη λίστα φιλτράρει με ό,τι πληκτρολογείς. Τα κουμπιά φίλτρου (chips) περιορίζουν ανά κατάσταση.<\/li>\n<li>Με το «⚙ Στήλες» διαλέγεις ποιες στήλες φαίνονται, με ποια σειρά και ποια ταξινομεί τη λίστα.<\/li>\n<li>Στο WordPress βλέπεις μόνο τις καρτέλες και τις ενέργειες που σου επιτρέπει ο ρόλος σου. Αν λείπει κάποιο κουμπί, ζήτα το δικαίωμα από τον διαχειριστή.<\/li>\n<\/ul>\n\n<h3 id=\"g-sw\">Online Renewals<\/h3>\n<p><b>Πεδία:<\/b> Software Name, Description, Vendor, Website, Username, Date From, Date To, Cost excl. VAT (€), Notification emails (για περισσότερα από ένα χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;)) και η υπενθύμιση (7, 14, 30, 60 ή 90 ημέρες πριν τη λήξη). Δεν αποθηκεύονται κωδικοί πρόσβασης.<\/p>\n<p><b>Κατάσταση:<\/b> «Active», «Due soon» (μέσα στις ημέρες υπενθύμισης) ή «Expired».<\/p>\n<p><b>Ανανέωση:<\/b> άνοιξε την εγγραφή και πάτησε «Renew…». Δίνεις νέες ημερομηνίες και κόστος, και η προηγούμενη περίοδος κρατιέται στο ιστορικό ανανεώσεων.<\/p>\n<p><b>Επιμέρους ποσά και άρθρα:<\/b> στην ενότητα «Cost breakdown» της εγγραφής πατάς «+ Add partial amount» και χωρίζεις το κόστος σε μέρη, διαλέγοντας για κάθε μέρος το άρθρο προϋπολογισμού. Έτσι περνά στον Προϋπολογισμό. Αν δεν δώσεις επιμέρους ποσά, μπαίνει ολόκληρο το κόστος χωρίς άρθρο.<\/p>\n\n<h3 id=\"g-ct\">Συμβάσεις<\/h3>\n<p><b>Πεδία:<\/b> Σύμβαση, Αριθμός διαγωνισμού, Περιγραφή, Ανάδοχος, Συντονιστής, Διάρκεια (μήνες), Ημερομηνία έναρξης και λήξης, Κόστος, Emails ειδοποιήσεων (για περισσότερα από ένα χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;)).<\/p>\n<p><b>Ανάδοχος:<\/b> επιλέγεται από λίστα (drop-down) με τους αναδόχους της καρτέλας «Ανάδοχοι». Αν ο ανάδοχος δεν υπάρχει, πατάς «+ Νέος ανάδοχος»: ανοίγει η φόρμα αναδόχου και μετά την αποθήκευση επιστρέφεις στη σύμβαση με τον ανάδοχο επιλεγμένο, χωρίς να χαθεί ό,τι είχες συμπληρώσει. Τα στοιχεία του αναδόχου (διεύθυνση, άτομο επικοινωνίας, τηλέφωνο, email) εμφανίζονται στη σύμβαση <b>μόνο για ανάγνωση<\/b>· αλλάζουν αποκλειστικά από την καρτέλα «Ανάδοχοι».<\/p>\n<p><b>Αντιπρόσωπος αναδόχου για τη σύμβαση:<\/b> επειδή το άτομο επικοινωνίας μπορεί να διαφέρει ανά σύμβαση, κάθε σύμβαση έχει δικά της πεδία Ονοματεπώνυμο, Τηλέφωνο και Email αντιπροσώπου (προαιρετικά· τηλέφωνο και email μπορεί να είναι περισσότερα, χωρισμένα με κόμμα ή ερωτηματικό). Περιλαμβάνονται στην αναζήτηση και στο Excel (εξαγωγή και εισαγωγή). Το email είναι πληροφοριακό: οι ειδοποιήσεις στέλνονται μόνο στα «Email ειδοποιήσεων».<\/p>\n<p><b>Παλιές συμβάσεις:<\/b> συμβάσεις που είχαν ανάδοχο ως ελεύθερο κείμενο διατηρούν τα παλιά τους στοιχεία μέχρι να επιλέξεις ανάδοχο. Στην καρτέλα «Ανάδοχοι» το κουμπί «Δημιουργία αναδόχων από τις συμβάσεις» τους δημιουργεί αυτόματα (ίδιο όνομα = ένας ανάδοχος) και συνδέει τις συμβάσεις.<\/p>\n<p><b>Έτη σύμβασης:<\/b> δημιουργούνται αυτόματα από τη διάρκεια και την ημερομηνία έναρξης. Οι επιπλέον μήνες πέρα από τα πλήρη έτη προστίθενται στο 1ο έτος. Για κάθε έτος βάζεις κόστος και υπενθύμιση (14, 30, 60, 90, 120 ή 180 ημέρες πριν τη λήξη του έτους).<\/p>\n<p><b>Επιμέρους ποσά:<\/b> κάτω από κάθε έτος πατάς «+ Επιμέρους ποσό», επιλέγεις άρθρο προϋπολογισμού και γράφεις το ποσό. Το κόστος του έτους γίνεται το άθροισμα των ποσών. Δες την ενότητα «Προϋπολογισμός» για το πώς περνούν.<\/p>\n<p><b>Αρχειοθέτηση (Archive):<\/b> όταν μια σύμβαση έχει λήξει, στο κάτω μέρος των λεπτομερειών της εμφανίζεται το κουμπί «Αρχειοθέτηση» (είναι ανενεργό όσο η σύμβαση δεν έχει λήξει). Η αρχειοθετημένη σύμβαση <b>δεν στέλνει πλέον καμία ειδοποίηση<\/b> (ούτε email λήξης, ούτε υπενθυμίσεις ετών/milestones, ούτε εμφανίζεται στο «Needs your attention» και στις ειδοποιήσεις της κορυφής) και δεν μετράει στους μετρητές «Έληξαν». Παραμένει στις Συμβάσεις για αναφορά: τη βρίσκεις στο φίλτρο «Αρχείο» και στο «Όλες», με κατάσταση «Αρχειοθετήθηκε». Με το κουμπί «Επαναφορά από το Αρχείο» γυρίζει στην κανονική της κατάσταση. Αν παρατείνεις τη λήξη μιας αρχειοθετημένης σύμβασης, γίνεται αυτόματα ξανά ενεργή.<\/p>\n<p><b>Κόστος σύμβασης:<\/b> σε κάθε αποθήκευση το ΚΟΣΤΟΣ της σύμβασης συμπληρώνεται αυτόματα από το άθροισμα των ετών (όπως το κουμπί «Συμπλήρωση ΚΟΣΤΟΥΣ από το άθροισμα ετών», που μπορείς να πατήσεις και χειροκίνητα). Αν κανένα έτος δεν έχει κόστος, το ΚΟΣΤΟΣ μένει όπως το έγραψες.<\/p>\n<p><b>Επιπρόσθετες / Προαιρετικές Υπηρεσίες:<\/b> στη φόρμα της σύμβασης, κάτω από τα έτη, πατάς «+ Υπηρεσία» για κάθε επιπρόσθετη ή προαιρετική υπηρεσία που περιλαμβάνεται στη σύμβαση (όσες χρειάζονται). Για κάθε μία γράφεις περιγραφή, το <b>ποσό που αφορά ένα έτος της σύμβασης<\/b> (χωρίς ΦΠΑ) και το άρθρο προϋπολογισμού. Το ποσό <b>προστίθεται μόνο στο συνολικό κόστος<\/b> της σύμβασης (π.χ. 2 έτη × 1.500 € υπηρεσίες = +3.000 €), όχι στο κόστος κάθε έτους· η φόρμα δείχνει ζωντανά το ετήσιο σύνολο των υπηρεσιών και το συνολικό κόστος με τις υπηρεσίες. Τα ποσά των ετών δεν αλλάζουν.<\/p>\n<p><b>Στον Προϋπολογισμό:<\/b> κάθε υπηρεσία περνά στο άρθρο που όρισες, για κάθε έτος της σύμβασης, <b>κατανεμημένη ανά μήνα<\/b> στα ημερολογιακά έτη που καλύπτει (π.χ. 1.200 € για 01/07–30/06: 6 μήνες στο πρώτο ημερολογιακό έτος και 6 στο επόμενο), πάντα με ΦΠΑ όπως τα υπόλοιπα ποσά, ανεξάρτητα από την επιλογή «Ανάλυση ανά έτος» του άρθρου. Στη στήλη «Πώς προκύπτει» φαίνεται η περιγραφή της υπηρεσίας και το έτος της σύμβασης. Ένα άρθρο που χρησιμοποιείται σε υπηρεσίες μετράει στη χρήση του και δεν διαγράφεται εύκολα. Οι υπηρεσίες εμφανίζονται και στο Excel των συμβάσεων (δύο νέες στήλες· το ΚΟΣΤΟΣ περιλαμβάνει τις υπηρεσίες) και δεν περιλαμβάνονται στην εισαγωγή από Excel.<\/p>\n<p><b>Κατάσταση:<\/b> «Δεν ξεκίνησε», «Ενεργή», «Λήγει σύντομα» (λήξη έτους ή σύμβασης μέσα στις ημέρες υπενθύμισης) ή «Έληξε».<\/p>\n\n<h3 id=\"g-tn\">Διαγωνισμοί<\/h3>\n<p>Εδώ καταγράφονται οι νέοι διαγωνισμοί που σκοπεύει να διενεργήσει ο Οργανισμός.<\/p>\n<p><b>Πεδία:<\/b> Όνομα διαγωνισμού, Αριθμός διαγωνισμού (<b>μοναδικός<\/b>: δεν μπορούν δύο διαγωνισμοί να έχουν τον ίδιο αριθμό, ανεξάρτητα από κεφαλαία/πεζά και κενά, π.χ. «12 / 2027» = «12/2027»· αριθμός διαγωνισμού που βρίσκεται μόνο στον Κάδο μπορεί να ξαναχρησιμοποιηθεί, αλλά τότε η επαναφορά του από τον Κάδο απορρίπτεται όσο ο αριθμός χρησιμοποιείται), Περιγραφή, Διάρκεια (μήνες), Εκτιμώμενη ημερομηνία έναρξης και λήξης, Εκτιμώμενο κόστος. Τα <b>Έτη<\/b> δημιουργούνται αυτόματα από τη διάρκεια, όπως στις Συμβάσεις, αλλά χωρίς υπενθύμιση. Σε κάθε έτος βάζεις επιμέρους ποσά με το σχετικό άρθρο. Τα συνημμένα προστίθενται στο παράθυρο της εγγραφής.<\/p>\n<p><b>Προϋπολογισμός:<\/b> όσο ο διαγωνισμός είναι <b>ενεργός<\/b>, τα ποσά του περιλαμβάνονται στον Προϋπολογισμό με σημείωση «Εκτιμώμενος διαγωνισμός».<\/p>\n<p><b>Δύο επιλογές μέσα στον διαγωνισμό:<\/b><\/p>\n<ul>\n<li><b>Ακύρωση και αποθήκευση για αναφορά:<\/b> ο διαγωνισμός μένει στη λίστα ως «Ακυρώθηκε» και αφαιρείται από τον Προϋπολογισμό. Μπορείς να τον επανενεργοποιήσεις με το «Επανενεργοποίηση».<\/li>\n<li><b>Promote στις Συμβάσεις και αποθήκευση για αναφορά:<\/b> ανοίγει η φόρμα Σύμβασης προσυμπληρωμένη από τον διαγωνισμό. Συμπληρώνεις τα υπόλοιπα (π.χ. ανάδοχος, συντονιστής, υπενθυμίσεις) και διορθώνεις ό,τι χρειάζεται, και η σύμβαση δημιουργείται μόνο όταν πατήσεις την αποθήκευση. Ο διαγωνισμός μένει ως «Προωθήθηκε σε Σύμβαση», με σύνδεσμο προς τη σύμβαση, και αφαιρείται από τον Προϋπολογισμό. Από εδώ και πέρα τα ποσά μπαίνουν στον Προϋπολογισμό μέσω της σύμβασης. Τα συνημμένα του διαγωνισμού αντιγράφονται στη σύμβαση.<\/li>\n<\/ul>\n<p>Ένας ακυρωμένος ή προωθημένος διαγωνισμός δεν προωθείται ξανά. Στο WordPress το Promote απαιτεί δικαίωμα επεξεργασίας διαγωνισμών και δημιουργίας συμβάσεων.<\/p>\n\n<h3 id=\"g-bd\">Προϋπολογισμός<\/h3>\n<p>Η καρτέλα δεν έχει δικά της δεδομένα. Συμπληρώνεται αυτόματα από τα επιμέρους ποσά των Online Renewals, των Συμβάσεων και των <b>ενεργών<\/b> Διαγωνισμών.<\/p>\n<ul>\n<li>Πάνω φαίνεται το σύνολο κάθε έτους, με το έτος τονισμένο.<\/li>\n<li><b>Χρώματα γραμμών:<\/b> κάθε γραμμή χρωματίζεται με ανοιχτή απόχρωση του χρώματος της καρτέλας από την οποία προέρχεται: τιρκουάζ για Online Renewals, μπλε για Συμβάσεις, μωβ για Διαγωνισμούς. Το υπόμνημα είναι πάνω από τους πίνακες.<\/li>\n<li>Επιπλέον: Με το «Άρθρο» διαλέγεις ένα άρθρο ή όλα. Κάθε άρθρο έχει δικό του πίνακα με στήλες Α/Α, Λεπτομέρειες Δαπάνης (το όνομα της σύμβασης, του διαγωνισμού ή του λογισμικού), Τρόπος Υπολογισμού και ένα ποσό ανά έτος.<\/li>\n<li><b>ΦΠΑ:<\/b> στις εγγραφές τα ποσά είναι χωρίς ΦΠΑ. Ο Προϋπολογισμός προσθέτει ΦΠΑ, προεπιλογή 19% (στήλες «€ με ΦΠΑ»). Ο Τρόπος Υπολογισμού δείχνει καθαρό ποσό + ΦΠΑ = σύνολο.<\/li>\n<li><b>Ανάλυση ανά έτος = ΝΑΙ:<\/b> το ποσό μοιράζεται ανά μήνα στα ημερολογιακά έτη της περιόδου (ένας μερικός μήνας μετράει ανάλογα με τις ημέρες). Παράδειγμα: 1.200 € καθαρά με περίοδο από 1/4 για 12 μήνες γίνονται 1.428 € με ΦΠΑ, δηλαδή 1.071 € στο πρώτο έτος και 357 € στο επόμενο.<\/li>\n<li><b>Ανάλυση ανά έτος = ΌΧΙ:<\/b> ολόκληρο το ποσό μπαίνει στο έτος έναρξης.<\/li>\n<li>Ποσά χωρίς άρθρο εμφανίζονται στον πίνακα «Χωρίς άρθρο». Αν μια εγγραφή δεν έχει ημερομηνία έναρξης, εμφανίζεται προειδοποίηση ότι δεν περιλαμβάνεται.<\/li>\n<li><b>Εξαγωγή Excel:<\/b> δημιουργεί φύλλο σύνοψης και ένα φύλλο ανά άρθρο, με τύπους αθροίσματος.<\/li>\n<li>Εγγραφές στον Κάδο, ακυρωμένοι και προωθημένοι διαγωνισμοί δεν υπολογίζονται.<\/li>\n<\/ul>\n<p><b>Άρθρα προϋπολογισμού:<\/b> δες και την καρτέλα «Άρθρα». Η λίστα (Κωδικός, Περιγραφή, Κατηγορία, Περιγραφή κατηγορίας, Ανάλυση ανά έτος ΝΑΙ/ΌΧΙ) είναι πίνακας με «+ Προσθήκη νέου άρθρου» και «Διαγραφή». Η επεξεργασία γίνεται μέσα στην ίδια την εφαρμογή, από το κουμπί «Επεξεργασία άρθρων» της καρτέλας «Άρθρα» (ή «Άρθρα προϋπολογισμού» στον Προϋπολογισμό), σε όλες τις εκδόσεις. Άρθρο που χρησιμοποιείται σε εγγραφές δεν διαγράφεται και δεν αλλάζει κωδικό.<\/p>\n\n<h3 id=\"g-ar\">Άρθρα<\/h3>\n<p>Η καρτέλα «Άρθρα» εμφανίζει τα άρθρα προϋπολογισμού του Οργανισμού: Κωδικός, Περιγραφή άρθρου, Κατηγορία, Περιγραφή κατηγορίας, Ανάλυση ανά έτος (ΝΑΙ/ΌΧΙ) και πόσες εγγραφές χρησιμοποιούν κάθε άρθρο. Η αναζήτηση φιλτράρει τη λίστα.<\/p>\n<ul>\n<li>Τη βλέπει όποιος μπορεί να δει τουλάχιστον μία από τις ενότητες (Online Renewals, Συμβάσεις, Διαγωνισμοί). Δεν έχει δικά της δικαιώματα.<\/li>\n<li><b>Αλλαγή άρθρων:<\/b> από το κουμπί «Επεξεργασία άρθρων» της ίδιας καρτέλας, μέσα στην εφαρμογή. Στο WordPress τα δικαιώματα ορίζονται στο PROCURE360 → Application Management, στην ενότητα «Budget Articles (Άρθρα)»: <b>create<\/b> = προσθήκη νέων άρθρων, <b>edit<\/b> = αλλαγή υπαρχόντων, <b>delete<\/b> = διαγραφή. Δίνονται ανά ρόλο ή ανά χρήστη· από προεπιλογή μόνο ο Administrator τα έχει. Όποιος δεν έχει κανένα βλέπει μόνο τη λίστα, και όποιος έχει μερικά βλέπει τα υπόλοιπα κουμπιά απενεργοποιημένα. Η αποθήκευση γίνεται στον server και ισχύει για όλους.\n<\/ul>\n\n<h3 id=\"g-co\">Ανάδοχοι<\/h3>\n<p><b>Τι είναι:<\/b> η κεντρική λίστα των αναδόχων. Κάθε ανάδοχος καταχωρείται μία φορά και επιλέγεται από τις Συμβάσεις.<\/p>\n<p><b>Πεδία:<\/b> Όνομα (υποχρεωτικό), Διεύθυνση (οδός/αριθμός και συνέχεια), Τ.Κ., Πόλη, Χώρα, Άτομο επικοινωνίας, Τηλέφωνο, Email (για περισσότερα από ένα τηλέφωνο ή email χρησιμοποίησε κόμμα (,) ή ερωτηματικό (;)).<\/p>\n<p><b>Στήλες της λίστας:<\/b> εκτός από τα στοιχεία, η λίστα δείχνει <b>πόσες ενεργές συμβάσεις<\/b> έχει ο ανάδοχος και <b>ποιοι αριθμοί διαγωνισμού<\/b> (π.χ. ΟΑΠ/ΠΜΕ/01/21/01) αφορούν τις ενεργές συμβάσεις του (ο ίδιος αριθμός σε δύο συμβάσεις εμφανίζεται μία φορά). Ενεργή είναι κάθε σύμβαση που δεν έχει λήξει (σε ισχύ, λήγει σύντομα ή δεν έχει ξεκινήσει). Στο παράθυρο του αναδόχου φαίνονται όλες οι συμβάσεις του, με σύνδεσμο για άνοιγμα.<\/p>\n<p><b>Κανόνες:<\/b> δεν επιτρέπονται δύο ανάδοχοι με το ίδιο όνομα (χωρίς διάκριση πεζών/κεφαλαίων και τόνων). Ανάδοχος που χρησιμοποιείται σε σύμβαση δεν διαγράφεται· πρώτα αλλάζεις τον ανάδοχο στις συμβάσεις. Αν μετονομάσεις έναν ανάδοχο, η αλλαγή φαίνεται αυτόματα σε όλες τις συμβάσεις του.<\/p>\n<p><b>Κάδος, Excel:<\/b> η διαγραφή πηγαίνει στον Κάδο (με επαναφορά). Η εξαγωγή Excel/CSV περιλαμβάνει τις ενεργές συμβάσεις και τους αριθμούς διαγωνισμού. Δεν υπάρχει εισαγωγή αναδόχων από Excel· κατά την εισαγωγή συμβάσεων ο ανάδοχος συνδέεται αυτόματα αν το όνομά του υπάρχει στη λίστα.<\/p>\n<p><b>Δικαιώματα (WordPress):<\/b> η ενότητα «Contractors (Ανάδοχοι)» στο Application Management έχει δικά της δικαιώματα προβολής, δημιουργίας, επεξεργασίας, διαγραφής και εξαγωγής.<\/p>\n\n<h3 id=\"g-ms\">Milestones<\/h3>\n<p>Σε μια εγγραφή (Online Renewal ή Σύμβαση) πρόσθεσε milestones ανά έτος με «+ Προσθήκη milestone»: περιγραφή, ημερομηνία παράδοσης, ειδοποίηση (30 ή 60 ημέρες πριν), σχόλια και συνημμένα. Η ειδοποίηση εμφανίζεται στην οθόνη και στέλνεται με email.<\/p>\n\n<h3 id=\"g-att\">Συνημμένα<\/h3>\n<p>Στο παράθυρο μιας εγγραφής πάτα «+ Προσθήκη αρχείων» (PDF, εικόνες, CSV, κείμενο, Word, Excel, PowerPoint, HTML, XML, email (eml/msg), άδειες (lic), συμπιεσμένα (zip/7z/rar), JSON, RTF, ics/vcf, πιστοποιητικά (cer/crt/p7m/p7s), dwg/dxf κ.ά., <b>έως 20 MB το καθένα<\/b>· δεν υπάρχει όριο στον αριθμό των αρχείων). Για άνοιγμα πάτα στο όνομα του αρχείου. Τα αρχεία <b>HTML<\/b> δεν ανοίγουν μέσα στην εφαρμογή (για λόγους ασφαλείας, γιατί θα μπορούσαν να εκτελέσουν κώδικα): κατεβαίνουν στον υπολογιστή σου και τα ανοίγεις από εκεί. Στο WordPress ο server μπορεί να έχει μικρότερο όριο (ρυθμίσεις PHP <code>upload_max_filesize<\/code> και <code>post_max_size<\/code>)· τότε η εφαρμογή δείχνει το πραγματικό όριο δίπλα στο κουμπί και, για μεγαλύτερο αρχείο, ζητά από τον διαχειριστή του hosting να τα αυξήσει σε τουλάχιστον 20M. Το «Αφαίρεση» σβήνει το αρχείο (με αναίρεση για λίγα δευτερόλεπτα). Τα συνημμένα εμφανίζονται ως στήλη «Αρχεία» στη λίστα και ως όνομα στην εξαγωγή.<\/p>\n\n<h3 id=\"g-trash\">Κάδος και αναίρεση<\/h3>\n<ul>\n<li><b>Αναίρεση:<\/b> μετά από διαγραφή εγγραφής, milestone ή συνημμένου εμφανίζεται για 8 δευτερόλεπτα κουμπί «Αναίρεση».<\/li>\n<li><b>Κάδος:<\/b> η διαγραφή μεταφέρει την εγγραφή στον Κάδο (κουμπί «🗑 Κάδος» δίπλα στα φίλτρα). Εκεί γίνεται <b>Επαναφορά<\/b>. Οι εγγραφές του κάδου δεν υπολογίζονται, δεν στέλνουν υπενθυμίσεις και δεν μπαίνουν στις εξαγωγές.<\/li>\n<li><b>Οριστική διαγραφή:<\/b> γίνεται μόνο από τον Κάδο (στο WordPress με ξεχωριστό δικαίωμα) και αυτόματα μετά από 30 ημέρες (ρυθμίζεται στο WordPress: Ρυθμίσεις → PROCURE360 → Παραμονή στον Κάδο· 0 = ποτέ).<\/li>\n<\/ul>\n\n<h3 id=\"g-rem\">Υπενθυμίσεις<\/h3>\n<ul>\n<li>Στο άνοιγμα της εφαρμογής εμφανίζεται παράθυρο «Needs your attention» με ό,τι έληξε ή λήγει σύντομα. Σε κάθε καρτέλα φαίνονται και ειδοποιήσεις για την άλλη καρτέλα.<\/li>\n<li><b>WordPress:<\/b> στέλνονται και email, αυτόματα μία φορά την ημέρα. Παραλήπτες είναι τα email της εγγραφής και οι γενικοί παραλήπτες των Ρυθμίσεων· το email επαναλαμβάνεται κάθε Ν ημέρες όσο η εγγραφή χρειάζεται ενέργεια. Οι Διαγωνισμοί δεν έχουν υπενθυμίσεις.<\/li>\n<li>Στις εκδόσεις HTML και Windows δεν στέλνονται email, μόνο το παράθυρο στο άνοιγμα. Η έκδοση Windows μπορεί να ανοίγει με την εκκίνηση των Windows.<\/li>\n<\/ul>\n\n<h3 id=\"g-xl\">Excel: εισαγωγή και εξαγωγή<\/h3>\n<ul>\n<li><b>Εισαγωγή:<\/b> κουμπί «Import Excel» (Online Renewals και Συμβάσεις). Οι στήλες αναγνωρίζονται από τους τίτλους τους, ελληνικούς ή αγγλικούς. Υπάρχει και πρότυπο αρχείου για λήψη. Οι Διαγωνισμοί δεν έχουν εισαγωγή από Excel.<\/li>\n<li><b>Εξαγωγή:<\/b> κουμπί «Export» / «Εξαγωγή» σε Excel ή CSV, με όλα τα πεδία και τα επιμέρους ποσά. Στους Διαγωνισμούς περιλαμβάνεται και η κατάσταση.<\/li>\n<li>Στο WordPress η εξαγωγή χρειάζεται δικαίωμα «export».<\/li>\n<\/ul>\n\n<h3 id=\"g-cfg\">Ρυθμίσεις εφαρμογής (καρτέλα ⚙ Ρυθμίσεις)<\/h3>\n<ul>\n<li><b>Πού είναι:<\/b> η καρτέλα «⚙ Ρυθμίσεις» δίπλα στα Άρθρα. Στο WordPress φαίνεται και αλλάζει μόνο από διαχειριστή (δικαίωμα διαχείρισης)· στις εκδόσεις HTML και Windows είναι ανοιχτή σε όποιον χρησιμοποιεί τον υπολογιστή.<\/li>\n<li><b>Γενικά:<\/b> το ποσοστό ΦΠΑ του Προϋπολογισμού (προεπιλογή 19%, 0–100) και οι προεπιλεγμένες ημέρες υπενθύμισης για τα νέα έτη συμβάσεων (προεπιλογή 30, 1–365). Η αλλαγή του ΦΠΑ επηρεάζει μόνο την εμφάνιση του Προϋπολογισμού, οι εγγραφές κρατούν ποσά χωρίς ΦΠΑ. Οι προεπιλεγμένες ημέρες ισχύουν για νέα έτη συμβάσεων, όχι για τα υπάρχοντα ούτε για τα Online Renewals.<\/li>\n<li><b>Custom fields (δικά σου πεδία):<\/b> μπορείς να προσθέσεις δικά σου πεδία σε Συμβάσεις, Διαγωνισμούς, Αναδόχους και Online Renewals (έως 30 ανά καρτέλα). Τύποι: Κείμενο, Αριθμός / Ποσό €, Ημερομηνία, Λίστα επιλογών. Τα πεδία εμφανίζονται στις φόρμες, στις λεπτομέρειες, στις στήλες της λίστας (⚙ Στήλες) και στις εξαγωγές Excel/CSV. Ο τύπος ενός αποθηκευμένου πεδίου δεν αλλάζει. Αν διαγράψεις ένα πεδίο, οι τιμές του κρύβονται και χάνονται όταν ξαναγίνει αποθήκευση της εγγραφής.<\/li>\n<li><b>Αντίγραφο ασφαλείας (Backup):<\/b> το κουμπί «Λήψη αντιγράφου» κατεβάζει ένα αρχείο ZIP με όλα τα δεδομένα (Online Renewals, Συμβάσεις, Διαγωνισμοί, Ανάδοχοι), τα Άρθρα, τις Ρυθμίσεις και τα συνημμένα. Ο κάδος δεν περιλαμβάνεται. Το αρχείο περιέχει πραγματικά δεδομένα και ονόματα χρηστών· φύλαξέ το με ασφάλεια.<\/li>\n<li><b>Επαναφορά (Restore):<\/b> διάλεξε το ZIP, δες την προεπισκόπηση (πόσες εγγραφές θα προστεθούν ή θα ενημερωθούν) και επιβεβαίωσε. Η επαναφορά ενημερώνει ή προσθέτει εγγραφές με βάση το αναγνωριστικό τους και <b>δεν διαγράφει<\/b> τίποτα. Μπορείς να επιλέξεις αν θα επαναφερθούν και οι Ρυθμίσεις και τα Άρθρα. Τα συνημμένα που υπάρχουν ήδη (ίδιο όνομα και μέγεθος) δεν ανεβαίνουν ξανά.<\/li>\n<\/ul>\n\n<h3 id=\"g-set\">Ρυθμίσεις και δικαιώματα (WordPress)<\/h3>\n<ul>\n<li><b>Μενού PROCURE360 (στο WordPress admin):<\/b> όλα βρίσκονται κάτω από ένα μενού. «Ρυθμίσεις»: γενικοί παραλήπτες υπενθυμίσεων, κάθε πόσες ημέρες επαναλαμβάνεται το email, παραμονή στον Κάδο και κουμπί αποστολής υπενθυμίσεων τώρα. Τα άρθρα δεν είναι πια εκεί· επεξεργάζονται μέσα στην εφαρμογή.<\/li>\n<li><b>PROCURE360 → Application Management:<\/b> εκεί ορίζεται ποιος έχει πρόσβαση και με ποιον ρόλο. Κάθε ενότητα (Software, Contracts, Tenders, Contractors, Budget Articles) έχει δικαιώματα προβολής, δημιουργίας, επεξεργασίας, διαγραφής και εξαγωγής. Επιπλέον υπάρχει το «purge» για οριστική διαγραφή από τον Κάδο. Το δικαίωμα προσαρμόζεται και ανά χρήστη.<\/li>\n<li>Ό,τι γίνεται καταγράφεται στο αρχείο δραστηριότητας του Application Management.<\/li>\n<\/ul>\n\n<h3 id=\"g-data\">Δεδομένα και αντίγραφα ασφαλείας<\/h3>\n<ul>\n<li><b>WordPress:<\/b> τα δεδομένα είναι στη βάση του WordPress και είναι κοινά για όλους τους χρήστες. Τα αντίγραφα γίνονται με το αντίγραφο της βάσης και του φακέλου uploads του site σου. Πριν από αναβάθμιση plugin κάνε αντίγραφο.<\/li>\n<li><b>HTML και Windows:<\/b> τα δεδομένα αποθηκεύονται στον browser του συγκεκριμένου υπολογιστή και δεν μοιράζονται με άλλους. Στα Windows το Backup.bat φτιάχνει zip στα Έγγραφα. Μην καθαρίσεις τα δεδομένα του browser. Εξαγωγή Excel όποτε θες επιπλέον αντίγραφο.<\/li>\n<\/ul>\n\n<h3 id=\"g-faq\">Συχνές ερωτήσεις<\/h3>\n<ul>\n<li><b>Γιατί ο Προϋπολογισμός δείχνει μεγαλύτερο ποσό από αυτό που έγραψα;<\/b> Γιατί προσθέτει ΦΠΑ 19%. Οι εγγραφές κρατούν ποσά χωρίς ΦΠΑ.<\/li>\n<li><b>Ο διαγωνισμός δεν φαίνεται στον Προϋπολογισμό.<\/b> Ελέγχεται η κατάστασή του (πρέπει να είναι «Ενεργός») και αν έχει επιμέρους ποσά ή κόστος και ημερομηνία έναρξης.<\/li>\n<li><b>Έσβησα κάτι κατά λάθος.<\/b> Πάτα «Αναίρεση» αμέσως, αλλιώς πήγαινε στον Κάδο και πάτα Επαναφορά.<\/li>\n<li><b>Δεν μπορώ να διαγράψω ένα άρθρο.<\/b> Χρησιμοποιείται σε εγγραφές (live ή στον Κάδο). Άλλαξε πρώτα το άρθρο σε αυτές τις εγγραφές.<\/li>\n<li><b>Δεν βλέπω μια καρτέλα ή ένα κουμπί (WordPress).<\/b> Ο ρόλος σου δεν έχει το σχετικό δικαίωμα· ζήτα το από τον διαχειριστή.<\/li>\n<li><b>Η σελίδα φαίνεται ίδια μετά από αναβάθμιση.<\/b> Κάνε ανανέωση με Ctrl+F5.<\/li>\n<\/ul>\n\n<h3 id=\"g-new\">Τι νέο υπάρχει<\/h3>\n<ul>\n<li><b>3.12.0:<\/b> Νέα καρτέλα «⚙ Ρυθμίσεις»: ΦΠΑ και προεπιλεγμένες ημέρες υπενθύμισης, δικά σου πεδία (custom fields: κείμενο, αριθμός, ημερομηνία, λίστα επιλογών) σε Συμβάσεις, Διαγωνισμούς, Αναδόχους και Online Renewals, και Backup / Restore όλων των δεδομένων, των συνημμένων και των ρυθμίσεων σε ένα αρχείο ZIP.<\/li>\n<li><b>3.11.1:<\/b> Συνημμένα: δέχονται πλέον και άλλους τύπους αρχείων, όπως XML, EML, MSG, LIC, JSON, RTF, 7z/RAR/GZ/TAR, ICS/VCF, πιστοποιητικά (CER/CRT/P7M/P7S), TIFF/BMP, DWG/DXF. Τα αρχεία HTML και XML κατεβαίνουν, δεν ανοίγουν μέσα στην εφαρμογή (ασφάλεια).<\/li>\n<li><b>3.11.0:<\/b> Συμβάσεις: κουμπί «Αρχειοθέτηση» για συμβάσεις που έχουν λήξει (ενεργό μόνο όταν η σύμβαση έχει λήξει)· οι αρχειοθετημένες δεν στέλνουν ειδοποιήσεις/υπενθυμίσεις, μένουν στη λίστα για αναφορά (φίλτρο «Αρχείο») και μπορούν να επανέλθουν.<\/li>\n<li><b>3.10.3:<\/b> Στις λεπτομέρειες της σύμβασης αφαιρέθηκε η ένδειξη «(με υπηρεσίες)» δίπλα στο ΚΟΣΤΟΣ.<\/li>\n<li><b>3.10.2:<\/b> Με κάθε αποθήκευση σύμβασης (και διαγωνισμού) το ΚΟΣΤΟΣ συμπληρώνεται από το άθροισμα ετών· η ετικέτα έγινε «Συνολικό κόστος σύμβασης με Επιπρόσθετες / Προαιρετικές Υπηρεσίες».<\/li>\n<li><b>3.10.1:<\/b> Επιπρόσθετες / Προαιρετικές Υπηρεσίες: αφαιρέθηκε το πεδίο «είδος»· το ποσό των υπηρεσιών προστίθεται <b>μόνο στο συνολικό κόστος<\/b> της σύμβασης και όχι στο κόστος κάθε έτους (στη λίστα, στις υπενθυμίσεις και στο Excel). Ο Προϋπολογισμός δεν αλλάζει.<\/li>\n<li><b>3.10.0:<\/b> Συμβάσεις: νέα ενότητα «Επιπρόσθετες / Προαιρετικές Υπηρεσίες» (είδος, περιγραφή, ετήσιο ποσό, άρθρο)· το ποσό προστίθεται στο κόστος κάθε έτους και στο συνολικό κόστος και περνά στον Προϋπολογισμό στο άρθρο του, κατανεμημένο ανά μήνα σε όλα τα έτη της σύμβασης· αντίστοιχες στήλες στο Excel συμβάσεων.<\/li>\n<li><b>3.9.0:<\/b> νέα καρτέλα «Ανάδοχοι» με λίστα αναδόχων (όνομα, διεύθυνση, άτομο επικοινωνίας, τηλέφωνο, email), πλήθος ενεργών συμβάσεων και αριθμοί διαγωνισμού των ενεργών συμβάσεων ανά ανάδοχο· στις Συμβάσεις ο ανάδοχος επιλέγεται από λίστα (με κουμπί «+ Νέος ανάδοχος») και τα στοιχεία του φαίνονται μόνο για ανάγνωση· νέα πεδία αντιπροσώπου αναδόχου ανά σύμβαση· δημιουργία αναδόχων από παλιές συμβάσεις· νέα ενότητα δικαιωμάτων «Contractors».<\/li>\n<li><b>3.8.0:<\/b> οι φόρμες ανοίγουν σε πλήρη οθόνη και δεν κλείνουν κατά λάθος· στοιχεία αναδόχου (ΑΦΜ, διεύθυνση, άτομο επικοινωνίας, τηλέφωνο, email)· υπόδειξη «κόμμα (,) ή ερωτηματικό (;)» στα πεδία email· μοναδικός αριθμός διαγωνισμού (έλεγχος διπλότυπων)· συνημμένα HTML, εμφανές όριο μεγέθους (20 MB ή το όριο του server) και σαφή μηνύματα όταν ένα αρχείο το ξεπερνά.<\/li>\n<li><b>3.7.0:<\/b> νέα ενότητα «Budget Articles (Άρθρα)» στο Application Management με ξεχωριστά δικαιώματα create / edit / delete για την προσθήκη, αλλαγή και διαγραφή άρθρων (ανά ρόλο ή ανά χρήστη).<\/li>\n<li><b>3.6.0:<\/b> τα άρθρα επεξεργάζονται μέσα στην ίδια την εφαρμογή (όχι από τις Ρυθμίσεις του WordPress)· οι Ρυθμίσεις και το Application Management μπήκαν κάτω από ένα ενιαίο μενού «PROCURE360» στο WordPress admin.<\/li>\n<li><b>3.5.0:<\/b> νέα καρτέλα «Άρθρα», το έτος στα σύνολα του Προϋπολογισμού τονίζεται και οι γραμμές των πινάκων χρωματίζονται ανάλογα με την προέλευση (Online Renewals, Συμβάσεις, Διαγωνισμοί).<\/li>\n<li><b>3.4.1:<\/b> νέα εμφάνιση των τεσσάρων καρτελών: ανάγλυφα κουμπιά με δικό τους χρώμα η καθεμία (Online Renewals τιρκουάζ, Συμβάσεις μπλε, Διαγωνισμοί μωβ, Προϋπολογισμός πράσινο).<\/li>\n<li><b>3.4.0:<\/b> λογότυπο PROCURE360 στην κεφαλίδα της εφαρμογής και εικονίδιο στον Windows installer και στην καρτέλα του browser.<\/li>\n<li><b>3.3.0:<\/b> ενσωματωμένος οδηγός χρήσης (κουμπί «? Οδηγός»).<\/li>\n<li><b>3.2.0:<\/b> νέο όνομα PROCURE360.<\/li>\n<li><b>3.1.1:<\/b> ο Προϋπολογισμός περιλαμβάνει ΦΠΑ 19%.<\/li>\n<li><b>3.1.0:<\/b> καρτέλα Διαγωνισμοί, με ακύρωση και Promote σε Σύμβαση.<\/li>\n<li><b>3.0.0:<\/b> Κάδος, οριστική διαγραφή με ξεχωριστό δικαίωμα, αναίρεση, προστασία χρησιμοποιούμενων άρθρων.<\/li>\n<li><b>2.5.0:<\/b> άρθρα προϋπολογισμού σε πίνακα, με προσθήκη και διαγραφή.<\/li>\n<li><b>2.4.0:<\/b> καρτέλα Προϋπολογισμός και εξαγωγή Excel.<\/li>\n<li><b>2.3.0:<\/b> επιμέρους ποσά ανά έτος με άρθρο προϋπολογισμού.<\/li>\n<li><b>2.2.0:<\/b> αφαίρεση κωδικού πρόσβασης, πολλά emails, επιλογή και ταξινόμηση στηλών.<\/li>\n<\/ul>";/*GUIDE-END*/
function showGuide(sec){
  openPanel('<div class="ph"><h2>Οδηγός χρήσης</h2><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div><div class="guide">'+GUIDE_HTML+'</div>',"guide",true);
  var e=sec&&document.getElementById("g-"+sec);if(e&&e.scrollIntoView)e.scrollIntoView();
}
function showDigest(){
  if(!$("#overlay").hidden)return;
  var list=[];
  S.items.forEach(function(i){var s=status(i);if(s.k!=="ok")list.push({cat:"sw",id:i.id,k:s.k,t:s.t,d:s.d,name:i.name,sub:fmtDate(i.dateTo)+" · "+dayText(s.d)+" · "+money(i.cost)})});
  S.contracts.forEach(function(c){var s=ctInfo(c);if(s.k!=="ok"&&!s.archived)list.push({cat:"ct",id:c.id,k:s.k,t:s.t,d:s.d,name:c.title,sub:s.sub+" · "+mc(ctTotal(c))})});
  ["sw","ct"].forEach(function(cc){msAll(cc).forEach(function(x){list.push({cat:cc,id:x.it.id,k:x.s.k,t:"Milestone",d:x.s.d,name:x.m.description+" · "+msTitle(cc,x.it),sub:fmtDate(x.m.due)+" · "+(cc==="ct"?dayTextEl(x.s.d):dayText(x.s.d))})})});
  if(!list.length)return;
  list.sort(function(a,b){return a.d-b.d});
  var rows=list.map(function(x){
    return '<li><div style="min-width:0"><b>'+esc(x.name)+'</b> <span class="hint">'+(x.cat==="ct"?"Σύμβαση":"Software")+'</span><br><span class="sub hint">'+esc(x.sub)+'</span></div>'+
      '<div class="actions"><span class="pill '+x.k+'">'+x.t+'</span>'+(x.cat==="sw"?'<button class="btn small primary" type="button" data-act="renewid" data-id="'+esc(x.id)+'">Renew</button>':'')+
      '<button class="btn small" type="button" data-act="openid" data-cat="'+x.cat+'" data-id="'+esc(x.id)+'">'+(x.cat==="ct"?"Άνοιγμα":"Open")+'</button></div></li>';
  }).join("");
  openPanel('<div class="ph"><div><h2>Needs your attention</h2><p class="hint" style="margin:4px 0 0">'+list.length+' item'+(list.length>1?'s are':' is')+' expired or close to expiry · Χρειάζονται προσοχή.</p></div><button class="btn small" type="button" data-act="close">Dismiss</button></div><ul class="files digest">'+rows+'</ul>',"digest");
}
function maybeDigest(){
  if(S.digestShown||!S.loaded.sw||!S.loaded.ct)return;
  S.digestShown=true;
  if(attn("sw")+attn("ct")+msAttn("sw")+msAttn("ct")>0)setTimeout(showDigest,500);
}

/* ---------- shared render ---------- */
function render(){
  var _ts=$("#tabSt");if(_ts)_ts.setAttribute("aria-selected",String(S.cat==="st"));
  if(S.cat==="st"&&window.RL_CFG&&window.RL_CFG.canManage===false)S.cat="sw";
  if(S.cat==="st"){if(!(S.stDirty&&$("#stRoot")))renderStPage();return}
  var bd=S.cat==="bd",tn=S.cat==="tn",ct=S.cat==="ct",ar=S.cat==="ar",co=S.cat==="co";
  $("#tabSw").setAttribute("aria-selected",String(!ct&&!bd&&!tn&&!ar&&!co));var ta=$("#tabAr");if(ta)ta.setAttribute("aria-selected",String(ar));$("#tabCt").setAttribute("aria-selected",String(ct));
  var tt=$("#tabTn");if(tt)tt.setAttribute("aria-selected",String(tn));
  var tco=$("#tabCo");if(tco)tco.setAttribute("aria-selected",String(co));
  var tb=$("#tabBd");if(tb)tb.setAttribute("aria-selected",String(bd));
  var el=ct||tn||co;
  $("#btnAdd").style.display=bd||ar?"none":"";$("#btnImport").style.display=bd||tn||ar||co?"none":"";$("#btnExport").style.display=ar?"none":"";
  $("#q").style.display=bd?"none":"";
  $("#cntSw").textContent=S.items.length||"";$("#cntCt").textContent=S.contracts.length||"";
  var cn=$("#cntTn");if(cn)cn.textContent=S.tenders.length||"";var ca=$("#cntAr");if(ca)ca.textContent=articles().length||"";var cco=$("#cntCo");if(cco)cco.textContent=(S.contractors||[]).length||"";
  $("#btnAdd").textContent=co?"+ Νέος ανάδοχος":tn?"+ Νέος διαγωνισμός":ct?"+ Νέα σύμβαση":"+ Add software";
  $("#btnImport").textContent=ct?"Εισαγωγή Excel":"Import Excel";
  $("#btnExport").textContent=bd?"Εξαγωγή Excel":el?"Εξαγωγή":"Export";
  $("#q").placeholder=ar?"Αναζήτηση άρθρου, κωδικού, κατηγορίας…":tn?"Αναζήτηση διαγωνισμού, αρ. διαγωνισμού…":ct?"Αναζήτηση σύμβασης, ανάδοχου, αρ. διαγωνισμού…":"Search name, vendor, website…";
  if(co)$("#q").placeholder="Αναζήτηση αναδόχου, email…";
  $("#stats").setAttribute("lang",el||bd||ar?"el":"en");
  if(ar)renderAr();else if(bd)renderBd();else if(S.filter==="trash")renderTrash(co?"co":tn?"tn":ct?"ct":"sw");else if(co)renderCo();else if(tn)renderTn();else if(ct)renderCt();else renderSw();
  $("#note").textContent=ar?"Τα άρθρα προϋπολογισμού του Οργανισμού. Κάθε ποσό σε Online Renewal, Σύμβαση ή Διαγωνισμό συνδέεται με ένα άρθρο και περνά έτσι στον Προϋπολογισμό. Η στήλη «Εγγραφές» δείχνει πόσες εγγραφές (και του Κάδου) χρησιμοποιούν το άρθρο.":bd?"Ο πίνακας υπολογίζεται αυτόματα από τα επιμέρους ποσά (χωρίς ΦΠΑ στις εγγραφές· εδώ προστίθεται ΦΠΑ 19%) κάθε έτους των Συμβάσεων, των ενεργών Διαγωνισμών και των Online Renewals. Άρθρα με ανάλυση ανά έτος (ΝΑΙ): το ποσό κατανέμεται ανά μήνα στα ημερολογιακά έτη της περιόδου. Τα υπόλοιπα (ΌΧΙ): ολόκληρο στο έτος έναρξης.":tn?"Τα ποσά των ενεργών διαγωνισμών περιλαμβάνονται στον Προϋπολογισμό. Με ακύρωση ή προώθηση σε Σύμβαση αφαιρούνται από εκεί· η συμπερίληψη γίνεται πλέον μέσω της σύμβασης.":S.db?(ct?"Κοινές εγγραφές, αποθηκευμένες στον server. Οι υπενθυμίσεις στέλνονται και με email.":"Shared records, saved on the server. Reminders are also sent by email."):"Storage is not available in this view, so changes last only until you close the page. · Η αποθήκευση δεν είναι διαθέσιμη εδώ.";
  if(co)$("#note").textContent="Η λίστα των αναδόχων. Στις Συμβάσεις ο ανάδοχος επιλέγεται από εδώ και τα στοιχεία του εμφανίζονται μόνο για ανάγνωση· κάθε αλλαγή γίνεται μόνο σε αυτή την καρτέλα. «Ενεργές συμβάσεις»: συμβάσεις που δεν έχουν λήξει. «Αρ. διαγωνισμού»: οι αριθμοί διαγωνισμού των ενεργών συμβάσεων.";
  var ov=$("#overlay");
  if(S.open&&!ov.hidden&&ov.dataset.kind==="detail"&&!getItem(S.openCat||"sw",S.open))closePanel();
}

/* ---------- Excel import ---------- */
var ALIAS={name:["software name","name","software","ονομασία λογισμικού"],description:["description","περιγραφή"],vendor:["vendor","supplier","προμηθευτής"],
 website:["website","web site","url","site","ιστοσελίδα"],username:["username","user name","user","login"],emails:["notification emails","notification email","emails","email","e-mail","email ειδοποιήσεων"],
 dateFrom:["date from","from","start","start date"],dateTo:["date to","to","end","end date","expiry","expiry date","expires"],
 cost:["cost excl. vat (€)","cost excl. vat","cost without vat","cost","price","amount"],remindDays:["reminder","reminder days","remind days","alert days"]};
function hk(s){return String(s||"").trim().toLowerCase().replace(/\s+/g," ")}
function toIsoDate(v){
  if(v==null||v==="")return "";
  if(v instanceof Date&&!isNaN(v))return iso(new Date(v.getTime()+12*36e5));
  if(typeof v==="number"){var d=new Date(Math.round((v-25569)*864e5));return iso(new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()))}
  var s=String(v).trim(),m;
  if((m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)))return m[1]+"-"+pad(+m[2])+"-"+pad(+m[3]);
  if((m=/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s))){var y=+m[3];if(y<100)y+=2000;return y+"-"+pad(+m[2])+"-"+pad(+m[1])}
  return "";
}
function parseSheet(buf){
  var wb=XLSX.read(buf,{type:"array",cellDates:true});
  var ws=wb.Sheets[wb.SheetNames[0]];
  var rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});
  return rows.map(function(r,idx){
    var map={};Object.keys(r).forEach(function(k){map[hk(k)]=r[k]});
    var o={};
    Object.keys(ALIAS).forEach(function(key){for(var i=0;i<ALIAS[key].length;i++){var a=ALIAS[key][i];if(map[a]!==undefined&&map[a]!==""){o[key]=map[a];break}}});
    var rec=norm({name:o.name,description:o.description,vendor:o.vendor,website:o.website,username:o.username,emails:o.emails==null?"":String(o.emails),
      dateFrom:toIsoDate(o.dateFrom),dateTo:toIsoDate(o.dateTo),cost:o.cost==null?"":Number(String(o.cost).replace(/[€\s,]/g,function(c){return c===","?".":""})),remindDays:o.remindDays});
    var errs=[];
    if(!rec.name)errs.push("name missing");
    if(!rec.dateTo)errs.push("Date To missing/invalid");
    if(rec.dateFrom&&rec.dateTo&&rec.dateTo<rec.dateFrom)errs.push("Date To before Date From");
    if(!isFinite(rec.cost))errs.push("cost invalid");
    if(emailsErr(rec.emails))errs.push(emailsErr(rec.emails));
    return {n:idx+2,rec:rec,errs:errs};
  });
}
function showImport(rows){
  S.imp=rows;S.impCat="sw";
  var good=rows.filter(function(r){return !r.errs.length}).length;
  var tr=rows.slice(0,200).map(function(r){
    var x=r.rec;
    return '<tr class="'+(r.errs.length?"badrow":"")+'"><td>'+r.n+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.vendor)+'</td><td>'+fmtDate(x.dateFrom)+'</td><td>'+fmtDate(x.dateTo)+'</td><td class="num">'+(isFinite(x.cost)?money(x.cost):"—")+'</td><td>'+(r.errs.length?esc(r.errs.join(", ")):"OK")+'</td></tr>';
  }).join("");
  openPanel('<div class="ph"><h2>Import preview</h2><button class="btn small" type="button" data-act="close">Cancel</button></div>'+
   '<p class="hint">'+rows.length+' row'+(rows.length==1?"":"s")+' found, '+good+' ready to import. Rows with problems are skipped. Imported rows are added to your existing list.</p>'+
   '<div class="tbl"><table><thead><tr><th>Row</th><th>Software Name</th><th>Vendor</th><th>Date From</th><th>Date To</th><th>Cost</th><th>Check</th></tr></thead><tbody>'+tr+'</tbody></table></div>'+
   '<div class="actions"><button class="btn primary" type="button" data-act="doimport"'+(good?'':' disabled')+'>Import '+good+' row'+(good==1?"":"s")+'</button></div>',"imp",true);
}
async function doImport(){
  var good=(S.imp||[]).filter(function(r){return !r.errs.length}),n=0;
  for(var i=0;i<good.length;i++){if(await save(uid(),good[i].rec,S.impCat||"sw"))n++}
  closePanel();toast("Imported "+n+" row"+(n==1?"":"s"));
}

function needX(){
  if(typeof XLSX!=="undefined")return false;
  toast("Η βιβλιοθήκη Excel δεν φορτώθηκε. Χρειάζεται σύνδεση στο internet. / Excel library not loaded: internet connection needed.");
  return true;
}
/* ---------- export ---------- */
var HEAD=["Software Name","Description","Vendor","Website","Username","Date From","Date To","Cost excl. VAT (€)","Reminder (days before)","Notification emails","Cost breakdown","Attachments","Milestones","Status"];
function rowsOut(){
  return S.items.slice().sort(function(a,b){return (a.dateTo||"").localeCompare(b.dateTo||"")}).map(function(i){
    return [i.name,i.description,i.vendor,i.website,i.username,i.dateFrom,i.dateTo,Number(i.cost)||0,i.remindDays,i.emails||"",bpText(i),(i.attachments||[]).map(function(a){return a.name}).join("; "),msText(i),status(i).t];
  });
}
async function offer(name,data){
  if(!S.dl){toast("Downloads are not available in this view");return}
  try{await S.dl.save({filename:name,data:data});toast("Saved "+name)}
  catch(e){if(!e||e.code!=="declined")toast("Could not save the file")}
}
function wbBuffer(rows,cols,head){
  head=head||HEAD;
  var ws=XLSX.utils.aoa_to_sheet([head].concat(rows));
  ws["!cols"]=cols||head.map(function(h){return {wch:Math.max(14,h.length+2)}});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Software");
  return XLSX.write(wb,{bookType:"xlsx",type:"array"});
}
function exportXlsx(){if(needX())return;if(S.cat==="co")return coExportXlsx();if(S.cat==="tn")return tnExportXlsx();if(S.cat==="ct")return ctExportXlsx();if(!S.items.length){toast("Nothing to export yet");return}offer("renewal-ledger-"+todayIso()+".xlsx",wbBuffer(swRowsOut(),null,swHead()))}
function exportCsv(){if(S.cat==="co")return coExportCsv();if(S.cat==="tn")return tnExportCsv();if(S.cat==="ct")return ctExportCsv();
  if(!S.items.length){toast("Nothing to export yet");return}
  var q=function(v){v=String(v==null?"":v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  offer("renewal-ledger-"+todayIso()+".csv","﻿"+[swHead()].concat(swRowsOut()).map(function(r){return r.map(q).join(",")}).join("\r\n"));
}
function templateXlsx(){if(needX())return;if(S.cat==="ct")return ctTemplate();
  offer("renewal-ledger-template.xlsx",wbBuffer([["Example App","Team chat","Example Ltd","https://example.com","admin@example.com","2026-01-01","2026-12-31",120,30,"a@example.com, b@example.com","","","",""]]));
}
function showExport(){if(S.cat==="bd")return bdExport();if(S.cat==="co")return coShowExport();if(S.cat==="tn")return tnShowExport();if(S.cat==="ct")return ctShowExport();
  openPanel('<div class="ph"><h2>Export &amp; import</h2><button class="btn small" type="button" data-act="close">Close</button></div>'+
   '<div class="sec"><h3>Export all software</h3><p class="hint">Includes every field, the reminder setting, attachment file names and the current status. Keep the file safe.</p><div class="actions"><button class="btn primary" type="button" data-act="xlsx">Excel (.xlsx)</button><button class="btn" type="button" data-act="csv">CSV</button></div></div>'+
   '<div class="sec"><h3>Import template</h3><p class="hint">Use these column headings: '+HEAD.slice(0,8).join(", ")+'. Optional: Reminder (days before), Notification emails (several separated by commas). Dates can be dd/mm/yyyy or yyyy-mm-dd.</p><div class="actions"><button class="btn" type="button" data-act="tpl">Download template</button><button class="btn" type="button" data-act="pick">Choose Excel file to import…</button></div></div>',"export");
}


/* ---------- events ---------- */
ROOT.addEventListener("click",async function(ev){
  var t=ev.target;
  if(t.id==="overlay"){if(!formOpen())closePanel();return}
  var b=t.closest("button,[data-f]");if(!b)return;
  var a=b.dataset.act;
  if(a&&stAction(a,b))return;
  if(b.dataset.f&&!a){S.filter=b.dataset.f;if(S.filter==="trash")loadTrash(S.cat);render();return}
  if(b.dataset.sort)return setSort(b.dataset.sort);
  if(b.id==="btnAdd"||b.id==="emAdd")return S.cat==="co"?coStart():S.cat==="tn"?tnStart():S.cat==="ct"?ctStart():startWizard();
  if(b.id==="btnImport"||b.id==="emImp"){$("#fileXlsx").click();return}
  if(b.id==="btnExport")return showExport();
  if(b.id==="emSample")return S.cat==="ct"?ctSample():loadSample();
  if(b.classList.contains("row"))return reopen(S.cat,b.dataset.id);
  if(b.dataset.copy){var it=byId(S.open);try{await navigator.clipboard.writeText(it[b.dataset.copy]||"");toast("Copied")}catch(e){toast("Copy is blocked here — select the text instead")}return}
  if(b.dataset.delfile!==undefined)return removeFile(+b.dataset.delfile);
  if(b.id==="delYes"){var id=S.open;var dc=S.openCat||"sw";if(dc==="co"&&coContracts(id).length){toast("Ο ανάδοχος χρησιμοποιείται σε συμβάσεις και δεν μπορεί να διαγραφεί.");return}if(await remove(id,dc)){closePanel();toastUndo(dc!=="sw"?"Μεταφέρθηκε στον κάδο":"Moved to the trash",function(){restoreItem(dc,id).then(function(ok){if(ok)toast(dc!=="sw"?"Η εγγραφή επαναφέρθηκε":"Record restored")})},null,dc!=="sw")}return}
  if(b.id==="delNo"){$("#delbox").innerHTML="";return}
  switch(a){
    case "close":askClose();break;
    case "gocat":S.cat=b.dataset.cat;S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat",S.cat)}catch(e){}render();break;
    case "ctnext":ctNext();break;
    case "ctback":ctCollect();S.cw.err="";S.cw.i--;ctDraw();break;
    case "ctfull":ctCollect();S.cw.mode="full";S.cw.err="";ctDraw();break;
    case "ctstep":ctCollect();S.cw.mode="step";S.cw.i=0;S.cw.err="";ctDraw();break;
    case "ctsave":ctSave();break;
    case "coaddfromct":ctCollect();coStart(null,{fromContract:true,prevDirty:S.dirty});break;
    case "coaddlegacy":{ctCollect();var ld=S.cw.d;coStart(null,{fromContract:true,prevDirty:S.dirty,prefill:{name:ld.contractor,vat:ld.contractorVat,address:ld.contractorAddress,contact:ld.contractorContact,phone:ld.contractorPhone,email:ld.contractorEmail}});break}
    case "cosave":coSave();break;
    case "cocancel":coCancel();break;
    case "comigrate":coMigrate();break;
    case "codel":{var cu=coContracts(S.open);$("#delbox").innerHTML=cu.length?'<p class="err">Ο ανάδοχος χρησιμοποιείται σε '+cu.length+' '+(cu.length===1?'σύμβαση':'συμβάσεις')+' και δεν μπορεί να διαγραφεί. Άλλαξε πρώτα τον ανάδοχο στις συμβάσεις αυτές.</p>':'<p class="err">Να διαγραφεί ο ανάδοχος; Θα μεταφερθεί στον Κάδο και μπορείς να τον επαναφέρεις.</p><div class="actions"><button class="btn danger" type="button" id="delYes">Ναι, μεταφορά στον κάδο</button><button class="btn" type="button" id="delNo">Άκυρο</button></div>';break}
    case "gocontractor":{var gco=b.dataset.id;S.cat="co";S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat","co")}catch(e){}render();showCoDetail(gco);break}
    case "ctsum":ctCollect();var cs=$("#c_cost");if(cs)cs.value=ctSum(S.cw.d.years);break;
    case "tndel":$("#delbox").innerHTML='<p class="err">Να διαγραφεί ο διαγωνισμός; Θα μεταφερθεί στον Κάδο και μπορείς να τον επαναφέρεις.</p><div class="actions"><button class="btn danger" type="button" id="delYes">Ναι, μεταφορά στον κάδο</button><button class="btn" type="button" id="delNo">Άκυρο</button></div>';break;
    case "tncancel":$("#delbox").innerHTML='<p class="err">Να ακυρωθεί ο διαγωνισμός; Θα αποθηκευτεί για αναφορά και τα ποσά του θα αφαιρεθούν από τον Προϋπολογισμό.</p><div class="actions"><button class="btn danger" type="button" data-act="tncancelyes">Ναι, ακύρωση και αποθήκευση για αναφορά</button><button class="btn" type="button" id="delNo">Όχι</button></div>';break;
    case "tncancelyes":tnSetStatus(S.open,"cancelled");break;
    case "tnreopen":tnSetStatus(S.open,"active");break;
    case "tnpromote":tnPromoteStart(S.open);break;
    case "gocontract":{var gid=b.dataset.id;S.cat="ct";S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat","ct")}catch(e){}render();showCtDetail(gid);break}
    case "ctarch":ctSetArchive(S.open,true);break;
    case "ctunarch":ctSetArchive(S.open,false);break;
    case "ctdel":$("#delbox").innerHTML='<p class="err">Να διαγραφεί η σύμβαση; Θα μεταφερθεί στον Κάδο και μπορείς να την επαναφέρεις.</p><div class="actions"><button class="btn danger" type="button" id="delYes">Ναι, μεταφορά στον κάδο</button><button class="btn" type="button" id="delNo">Άκυρο</button></div>';break;
    case "back":showDetail(b.dataset.id);break;
    case "renewid":S.open=b.dataset.id;S.openCat="sw";showRenew(b.dataset.id);break;
    case "openid":reopen(b.dataset.cat||"sw",b.dataset.id);break;
    case "cols":showCols();break;
    case "arts":showArticles();break;
    case "undo":doUndo();break;
    case "trrestore":{var tc=S.cat;if(await restoreItem(tc,b.dataset.id))toast(tc!=="sw"?"Η εγγραφή επαναφέρθηκε":"Record restored");break}
    case "trpurge":{var pc=S.cat,pit=(S.trash[pc]||[]).find(function(x){return x.id===b.dataset.id});if(!pit)break;
      if(!window.confirm((pc!=="sw"?"ΟΡΙΣΤΙΚΗ διαγραφή «":"PERMANENTLY delete \"")+recName(pc,pit)+(pc!=="sw"?"» και όλων των συνημμένων της; ΔΕΝ μπορεί να αναιρεθεί.":"\" and all its attachments? This CANNOT be undone.")))break;
      if(await purgeItem(pc,b.dataset.id))toast(pc!=="sw"?"Διαγράφηκε οριστικά":"Deleted for good");break}
    case "artsave":saveArticles();break;
    case "artadd":{if(!artCan("create"))break;var rows=$("#artRows");rows.insertAdjacentHTML("beforeend",artRow());var ins=rows.querySelectorAll("tr");ins[ins.length-1].querySelector("input").focus();break}
    case "artdel":{if(!artCan("delete"))break;var tr=b.closest("tr"),cd=tr&&tr.querySelector("[data-k=code]"),us=cd&&cd.defaultValue?artUsage(cd.defaultValue):0;
      if(us){toast(S.cat!=="sw"?"Το άρθρο χρησιμοποιείται σε "+us+" εγγραφές και δεν μπορεί να διαγραφεί":"This article is used by "+us+" record(s) and cannot be deleted");break}
      if(tr)tr.remove();break}
    case "exadd":ctCollect();S.cw.d.extras=S.cw.d.extras||[];S.cw.d.extras.push({id:uid(),kind:"extra",desc:"",amount:"",article:""});{var cx=$("#cExtras");if(cx)cx.innerHTML=exBlock(S.cw.d)}break;
    case "exdel":ctCollect();S.cw.d.extras.splice(+b.dataset.i,1);{var cx2=$("#cExtras");if(cx2)cx2.innerHTML=exBlock(S.cw.d)}break;
    case "bpadd":{var dd=ctLike(S.cat)?(ctCollect(),S.cw.d):(collect(),S.wiz.data);dd.budget=dd.budget||[];dd.budget.push({year:+b.dataset.year||1,amount:"",article:""});bpRedraw();break}
    case "bpdel":{var dd2=ctLike(S.cat)?(ctCollect(),S.cw.d):(collect(),S.wiz.data);dd2.budget.splice(+b.dataset.i,1);if(ctLike(S.cat))(dd2.years||[]).forEach(function(y,i){if(!bpHas(dd2,i+1)&&false)y.cost=""});bpRedraw();break}
    case "colsreset":resetCols();break;
    case "attach":$("#fileAttach").click();break;
    case "msadd":showMsForm(S.openCat||"sw",S.open,null,+b.dataset.year||1);break;
    case "msedit":showMsForm(S.openCat||"sw",S.open,b.dataset.mid);break;
    case "msdel":msDelete(b.dataset.mid);break;
    case "msdone":msToggleDone(b.dataset.mid);break;
    case "msattach":msPick();break;
    case "mssave":msSave();break;
    case "mscancel":msCancel();break;
    case "msrmfile":msCollect();var rm=S.ms.d.attachments.splice(+b.dataset.i,1)[0];if(rm){var ai=S.ms.added.indexOf(rm.id);if(ai>=0){S.ms.added.splice(ai,1);try{S.assets.delete(rm.id)}catch(_){}}else S.ms.removed.push(rm.id)}msDraw();break;
    case "renew":showRenew(S.open);break;
    case "guide":showGuide(S.cat);break;
    case "gsec":{var ge=document.getElementById("g-"+b.dataset.id);if(ge&&ge.scrollIntoView)ge.scrollIntoView({behavior:"smooth",block:"start"});break}
    case "rsave":doRenew(b.dataset.id);break;
    case "edit":S.openCat==="co"?coStart(S.open):S.openCat==="tn"?tnStart(S.open):S.openCat==="ct"?ctStart(S.open):startWizard(S.open);break;
    case "del":$("#delbox").innerHTML='<p class="err">Delete this software? It moves to the Trash, where you can restore it.</p><div class="actions"><button class="btn danger" type="button" id="delYes">Yes, move to the trash</button><button class="btn" type="button" id="delNo">Keep it</button></div>';break;
    case "wnext":wizNext();break;
    case "wback":collect();S.wiz.err="";S.wiz.i--;drawWizard();break;
    case "wfull":collect();S.wiz.mode="full";S.wiz.err="";drawWizard();break;
    case "wstep":collect();S.wiz.mode="step";S.wiz.i=0;S.wiz.err="";drawWizard();break;
    case "wsave":wizSave();break;
    case "doimport":doImport();break;
    case "xlsx":exportXlsx();break;
    case "csv":exportCsv();break;
    case "tpl":templateXlsx();break;
    case "pick":$("#fileXlsx").click();break;
  }
  if(b.dataset.act&&b.closest("#chips"))return;
});
ROOT.addEventListener("keydown",function(ev){
  if(ev.key==="Enter"&&S.cw&&!S.co&&S.cw.mode==="step"&&ev.target.tagName==="INPUT"){ev.preventDefault();S.cw.i===cwBase().length?ctSave():ctNext()}
  if(ev.key==="Enter"&&S.wiz&&S.wiz.mode==="step"&&ev.target.tagName==="INPUT"){ev.preventDefault();var l=S.wiz.i===swF().length;l?wizSave():wizNext()}
});
ROOT.addEventListener("input",function(ev){var t=ev.target;if(t&&t.closest&&t.closest("#overlay")&&formOpen())S.dirty=true;if(t&&t.id&&t.id.indexOf("bp_amt_")===0)bpLive();else if(t&&t.id&&t.id.indexOf("ex_amt_")===0)exTotals()});
ROOT.addEventListener("change",async function(ev){
  var t=ev.target;if(t&&t.closest&&t.closest("#overlay")&&formOpen())S.dirty=true;
  if(t.id==="bdArt"){S.bdArt=t.value;try{localStorage.setItem("rl.bdart",t.value)}catch(e){}render();return}
  if(t.dataset&&t.dataset.col){toggleCol(t.dataset.col,t.checked);return}
  if(t.id&&t.id.indexOf("bp_amt_")===0){bpLive();return}
  if(t.id==="remSel"){var it=byId(S.open);if(it){var rec=norm(it);rec.remindDays=+t.value;rec.attachments=it.attachments;rec.history=it.history;rec.createdAt=it.createdAt;rec.sample=it.sample;if(await save(it.id,rec))toast("Reminder set to "+t.value+" days before expiry")}}
  if(t.id==="fileXlsx"&&t.files[0]){
    var f=t.files[0];t.value="";
    try{if(needX())return;var buf=await f.arrayBuffer();var ct=S.cat==="ct";var rows=ct?parseCtSheet(buf):parseSheet(buf);if(!rows.length){toast(ct?"Δεν βρέθηκαν γραμμές στο πρώτο φύλλο":"No rows found in the first sheet");return}ct?showCtImport(rows):showImport(rows)}
    catch(e){toast("Could not read that file")}
  }
  if(S.cw&&!S.co&&t.id==="c_contractorId"){ctCollect();var ci=$("#cCtrInfo");if(ci)ci.innerHTML=ctrInfoHtml(S.cw.d)}
  if(S.cw&&(t.id==="c_months"||t.id==="c_dateFrom")){ctCollect();ctRegen();ctRefresh()}
  if(S.cw&&t.id==="c_dateTo"){ctCollect();ctApplyEnd();ctRefresh(true)}
  if(S.cw&&t.id&&t.id.indexOf("cy_cost_")===0){ctCollect();var sp=$("#cSum");if(sp)sp.textContent=mc(ctSum(S.cw.d.years))}
  if(t.classList&&t.classList.contains("yrRem")){var cc=getItem("ct",S.open);if(cc){var rc=strip(cc);rc.years=cc.years.map(function(y,i){return i===+t.dataset.i?Object.assign({},y,{remind:+t.value}):y});if(await save(cc.id,rc,"ct"))toast("Η υπενθύμιση ενημερώθηκε")}}
  if(t.id==="fileAttach"&&t.files.length){var fl=Array.prototype.slice.call(t.files);t.value="";attachFiles(fl)}
});
$("#q").addEventListener("input",function(e){S.q=e.target.value;render()});

async function loadSample(){
  var t=todayIso();
  var d=[["Example CRM Suite","Customer records and pipeline","Example Soft Ltd","https://example.com/crm",addDays(t,-340),addDays(t,25),480],
         ["Example Cloud Backup","Offsite backups","Example Cloud","https://example.com/backup",addDays(t,-200),addDays(t,165),220],
         ["Example Design Pack","Design licences","Example Studio","https://example.com/design",addDays(t,-400),addDays(t,-6),360]];
  for(var i=0;i<d.length;i++){var x=d[i];await save(uid(),norm({name:x[0],description:x[1],vendor:x[2],website:x[3],dateFrom:x[4],dateTo:x[5],cost:x[6],remindDays:30,sample:true}))}
}

/* ---------- start ---------- */
async function start(){
  try{var rc=localStorage.getItem("rl.cat");if(rc==="ct"||rc==="bd"||rc==="tn"||rc==="ar"||rc==="co"||rc==="st")S.cat=rc}catch(e){}
  render();
  var c=window.claude;if(!c||!c.use)return;
  try{S.assets=await c.use("assets")}catch(e){}
  try{S.dl=await c.use("downloads")}catch(e){}
  try{
    var u=await c.use("user"),db=await c.use("db");
    var id=u&&u.id?await u.id():null;
    if(db&&id){
      S.db=db;S.uid=id;
      S.loaded={};
      var sub=function(name,cat,key){return col(name).onSnapshot(function(snap){var all=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())});S[key]=all.filter(function(x){return !x.deletedAt});if(!window.RL_TRASH)S.trash[cat]=all.filter(function(x){return x.deletedAt}).map(function(x){return Object.assign({},x,{_at:x.deletedAt})});S.loaded[cat]=true;if(key==="items")purgePasswords();if(S.loaded.sw&&S.loaded.ct&&S.loaded.tn&&S.loaded.co&&!S.tinit){S.tinit=1;if(window.RL_TRASH){loadTrash("sw");loadTrash("ct");loadTrash("tn");loadTrash("co")}else autoPurge()}render();maybeDigest()},function(){toast("Live sync stopped — reload the page")})};
      S.unsub=[sub("software","sw","items"),sub("contracts","ct","contracts"),sub("tenders","tn","tenders"),sub("contractors","co","contractors")];
    }
  }catch(e){}
  render();
}
start();
})();
