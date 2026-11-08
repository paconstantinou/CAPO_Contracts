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
 {k:"emails",l:"Notification emails",q:"Which e-mail addresses should receive the reminders? Separate several with commas (optional).",ta:1,email:1,ph:"name@example.com, other@example.com"}
];
var REMIND=[7,14,30,60,90];
var S={items:[],contracts:[],tenders:[],trash:{sw:[],ct:[],tn:[]},cat:"sw",loaded:{},uid:null,db:null,assets:null,dl:null,filter:"all",q:"",open:null,openCat:null,cw:null,impCat:null,mem:false,unsub:null};

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
    remindDays:+o.remindDays||30,attachments:o.attachments||[],history:o.history||[],milestones:o.milestones||[],budget:o.budget||[],createdAt:o.createdAt||Date.now(),sample:!!o.sample};
}
function uid(){return "s"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

/* ---------- storage ---------- */
function col(n){return S.db.doc("data/users/"+S.uid+"/app").collection(n||"software")}
var CATS={sw:{c:"software",k:"items"},ct:{c:"contracts",k:"contracts"},tn:{c:"tenders",k:"tenders"}};
function ctLike(c){return c==="ct"||c==="tn"}
function listOf(cat){return S[(CATS[cat]||CATS.sw).k]}
function getItem(cat,id){return listOf(cat).find(function(x){return x.id===id})}
async function save(id,rec,cat){
  cat=cat||"sw";
  if(S.db&&S.uid){try{await col(collName(cat)).doc(id).set(rec)}catch(e){toast("Could not save ("+(e&&e.code||"error")+")");return false}}
  else{var L=listOf(cat),i=L.findIndex(function(x){return x.id===id}),o=Object.assign({id:id},rec);if(i>=0)L[i]=o;else L.push(o);render()}
  return true;
}
/* Deleting never destroys: the record goes to the trash (WordPress: on the server; here: kept with a deletedAt mark) and can be restored. */
var TRASH_DAYS=30;
function trashDays(){return window.RL_TRASH?(window.RL_TRASH.days||0):TRASH_DAYS}
function collName(cat){return (CATS[cat]||CATS.sw).c}
function recName(cat,it){return cat==="sw"?(it.name||""):(it.title||"")}
async function remove(id,cat){
  cat=cat||"sw";var it=getItem(cat,id);if(!it)return false;
  if(window.RL_TRASH){try{await col(collName(cat)).doc(id).delete()}catch(e){toast("Could not delete");return false}loadTrash(cat)}
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
  ["sw","ct","tn"].forEach(function(c){(S.trash[c]||[]).filter(function(x){return x._at&&x._at<lim}).forEach(function(x){purgeItem(c,x.id)})});
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
function closePanel(){var o=$("#overlay");o.hidden=true;o.innerHTML="";S.open=null;S.openCat=null;S.wiz=null;S.cw=null;S.imp=null}

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
   '<div><button class="btn" type="button" data-act="attach"'+(S.assets?'':' disabled')+'>+ Attach files</button> <span class="hint">'+(S.assets?'Invoices, receipts, PDFs, images (up to 20 MB each).':'Uploads are not available in this view.')+'</span></div></div>'+
   bpDetail(it,0)+msSection("sw",it)+
   '<div class="sec"><h3>Renewal</h3><div><button class="btn primary" type="button" data-act="renew">Renew…</button></div>'+
   (hist?'<div class="tbl"><table><thead><tr><th>Previous period</th><th>Cost excl. VAT</th></tr></thead><tbody>'+hist+'</tbody></table></div>':'')+'</div>'+
   '<div class="sec"><div class="actions"><button class="btn" type="button" data-act="edit">Edit details</button><button class="btn danger" type="button" data-act="del">Delete</button></div><div id="delbox"></div></div>'
  ,"detail");
}

/* ---------- add / edit (guided prompt or full form) ---------- */
function inputHtml(f,val,pre){
  var id=pre+f.k,v=val==null?"":val;
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
  FIELDS.forEach(function(f){var el=$("#w_"+f.k);if(el)w.data[f.k]=el.value});
  var r=$("#w_remind");if(r)w.data.remindDays=+r.value;
  bpCollect(w.data);
  if(bpHas(w.data))w.data.cost=bpSum(w.data.budget);
}
function validate(keys){
  var d=S.wiz.data;
  for(var i=0;i<keys.length;i++){
    var f=FIELDS.filter(function(x){return x.k===keys[i]})[0];if(!f)continue;
    var v=d[f.k];
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
  var w=S.wiz,d=w.data,h;
  var head='<div class="ph"><h2>'+(w.id?"Edit software":"Add software")+'</h2><button class="btn small" type="button" data-act="close">Cancel</button></div>';
  if(w.mode==="full"){
    h=head+'<div style="display:grid;gap:12px">'+FIELDS.map(function(f){
      var ih=inputHtml(f,d[f.k],"w_");if(f.k==="cost"&&bpHas(d))ih=ih.replace("<input","<input readonly");
      return '<label class="f">'+f.l+(f.req?' *':'')+ih+'</label>'+(f.k==="cost"?'</div>'+bpSec(d)+'<div style="display:grid;gap:12px">':'');
    }).join("")+'<label class="f">Reminder<small>Alert me before expiry</small>'+remindSel(d.remindDays||30,"w_remind")+'</label></div>'+
    '<div class="err" id="werr">'+esc(w.err)+'</div>'+
    '<div class="actions"><button class="btn primary" type="button" data-act="wsave">Save</button>'+(w.id?'':'<button class="btn" type="button" data-act="wstep">Guided mode</button>')+'</div>';
  }else{
    var total=FIELDS.length+1,i=w.i,last=i===total-1;
    var body;
    if(i<FIELDS.length){var f=FIELDS[i];body='<label class="f"><span class="big-q">'+f.q+(f.req?'':' <small>(optional)</small>')+'</span>'+inputHtml(f,d[f.k],"w_")+'</label>'}
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
  var e=validate(FIELDS.map(function(f){return f.k}));
  if(e){w.err=e;var x=$("#werr");if(x)x.textContent=e;return}
  var base=w.id?byId(w.id):{};
  var rec=norm(Object.assign({},base,w.data));
  rec.budget=bpClean(w.data);if(rec.budget.length)rec.cost=bpSum(rec.budget);
  var id=w.id||uid();
  if(await save(id,rec)){closePanel();toast(w.id?"Saved":"Added "+rec.name);if(!w.id)showDetail(id)}
}
function wizNext(){
  collect();var w=S.wiz,f=FIELDS[w.i];
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
var MIME={pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",csv:"text/csv",txt:"text/plain",md:"text/markdown",json:"application/json",mp4:"video/mp4",webm:"video/webm"};
function reopen(cat,id){cat==="tn"?showTnDetail(id):cat==="ct"?showCtDetail(id):showDetail(id)}
async function attachFiles(files){
  var cat=S.openCat||"sw",id=S.open,it=getItem(cat,id);if(!it||!S.assets)return;
  var list=(it.attachments||[]).slice(),n=0,el=cat!=="sw";
  for(var i=0;i<files.length;i++){
    var f=files[i],ext=(f.name.split(".").pop()||"").toLowerCase(),type=f.type&&MIME[ext]===f.type?f.type:MIME[ext]||f.type;
    try{var r=await S.assets.upload(f,type?{type:type}:undefined);list.push({id:r.id,name:f.name,size:r.sizeBytes});n++}
    catch(e){toast(f.name+": "+(e&&e.code==="unsupported_type"?(el?"μη υποστηριζόμενος τύπος (PDF, εικόνα, CSV ή κείμενο)":"file type not supported (use PDF, image, CSV or text)"):e&&e.code==="too_large"?(el?"μεγαλύτερο από 20 MB":"larger than 20 MB"):(el?"αποτυχία μεταφόρτωσης":"upload failed")))}
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
  listOf(cat).forEach(function(it){msList(it).forEach(function(m){
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
   '<div><button class="btn" type="button" data-act="msattach"'+(S.assets?'':' disabled')+'>'+(el?"+ Προσθήκη αρχείων":"+ Attach files")+'</button></div></div>'+
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
    try{var r=await S.assets.upload(f,type?{type:type}:undefined);w.d.attachments.push({id:r.id,name:f.name,size:r.sizeBytes});w.added.push(r.id)}
    catch(e){toast(f.name+": "+(e&&e.code==="unsupported_type"?(el?"μη υποστηριζόμενος τύπος":"file type not supported"):e&&e.code==="too_large"?(el?"μεγαλύτερο από 20 MB":"larger than 20 MB"):(el?"αποτυχία μεταφόρτωσης":"upload failed")))}
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
  cdef("contractor","Ανάδοχος",1,"1.3fr",cTxt("contractor")),
  cdef("coordinator","Συντονιστής",0,"1.2fr",cTxt("coordinator")),
  cdef("months","Διάρκεια (μήνες)",0,"1fr",{v:function(c){return '<span class="num">'+esc(c.months||"—")+'</span>'},s:function(c){return Number(c.months)||""}}),
  cdef("dateFrom","Έναρξη",0,"1fr",cDate("dateFrom")),
  cdef("dateTo","Λήξη",1,"1fr",cDate("dateTo")),
  cdef("status","Κατάσταση",1,"1.3fr",{v:function(c){var s=ctInfo(c);return '<span class="pill '+s.k+'">'+s.t+'</span> <span class="sub">'+esc(s.sub)+'</span>'},s:function(c){var d=ctInfo(c).d;return d==null?"":d}}),
  cdef("cost","Κόστος",1,"1fr",cNum("cost")),
  cdef("milestones","Milestones",0,"1fr",cMs()),
  cdef("emails","Email ειδοποιήσεων",0,"1.6fr",cEm()),
  cdef("files","Αρχεία",1,"90px",cFiles())
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
  var d={cols:{sw:[],ct:[],tn:[]},sort:{sw:{k:"dateTo",dir:1},ct:{k:"dateTo",dir:1},tn:{k:"dateFrom",dir:1}}},p=null;
  try{p=JSON.parse(localStorage.getItem("rl.listprefs")||"null")}catch(e){}
  ["sw","ct","tn"].forEach(function(c){
    var keys=COLS[c].map(function(x){return x.k}),sel=p&&p.cols&&Array.isArray(p.cols[c])?p.cols[c].filter(function(k){return keys.indexOf(k)>=0}):null;
    d.cols[c]=sel&&sel.length?sel:COLS[c].filter(function(x){return x.d}).map(function(x){return x.k});
    var so=p&&p.sort&&p.sort[c];if(so&&keys.indexOf(so.k)>=0)d.sort[c]={k:so.k,dir:so.dir===-1?-1:1};
  });
  return d;
}
function savePrefs(){try{localStorage.setItem("rl.listprefs",JSON.stringify({cols:S.cols,sort:S.sort}))}catch(e){}}
function colsOf(cat){var sel=S.cols[cat];return COLS[cat].filter(function(c){return sel.indexOf(c.k)>=0})}
function sortList(cat,list){
  var so=S.sort[cat],c=COLS[cat].filter(function(x){return x.k===so.k})[0]||COLS[cat].filter(function(x){return x.k==="dateTo"})[0];
  return list.slice().sort(function(a,b){
    var x=c.s(a),y=c.s(b),xe=x===""||x==null,ye=y===""||y==null;
    if(xe||ye)return xe&&ye?0:xe?1:-1; /* empty values always last */
    var r=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"el",{numeric:true,sensitivity:"base"});
    return r*so.dir||String(a.id).localeCompare(String(b.id));
  });
}
function listHtml(cat,rows){
  var cs=colsOf(cat),so=S.sort[cat],el=cat!=="sw";
  var MIN={name:210,title:230,description:250,website:180,emails:210,status:200,files:80,months:110,remindDays:90,milestones:100,cost:110,tender:130};
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
   '<div class="colpick">'+COLS[cat].map(function(c){return '<label><input type="checkbox" data-col="'+c.k+'"'+(sel.indexOf(c.k)>=0?' checked':'')+'> '+esc(c.l)+'</label>'}).join("")+'</div>'+
   '<div class="actions"><button class="btn" type="button" data-act="colsreset">'+(el?"Προεπιλογή":"Reset to default")+'</button></div>';
  openPanel(h,"cols");
}
function toggleCol(k,on){
  var cat=S.cat,sel=S.cols[cat].slice(),i=sel.indexOf(k);
  if(on&&i<0)sel.push(k);if(!on&&i>=0)sel.splice(i,1);
  if(!sel.length){showCols();return}
  S.cols[cat]=sel;savePrefs();render();
}
function resetCols(){S.cols[S.cat]=COLS[S.cat].filter(function(x){return x.d}).map(function(x){return x.k});S.sort[S.cat]={k:S.cat==="tn"?"dateFrom":"dateTo",dir:1};savePrefs();render();showCols()}
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
  var n=0,fn=function(it){if((it.budget||[]).some(function(p){return String(p.article||"")===code}))n++};
  S.items.forEach(fn);S.contracts.forEach(fn);S.tenders.forEach(fn);S.trash.sw.forEach(fn);S.trash.ct.forEach(fn);S.trash.tn.forEach(fn);
  return n;
}
function artRow(a){
  a=a||{code:"",desc:"",cat:"",catDesc:"",split:false};
  return '<tr><td><input data-k="code" value="'+esc(a.code)+'" size="7" aria-label="Κωδικός"></td><td><input data-k="desc" value="'+esc(a.desc)+'" aria-label="Περιγραφή άρθρου"></td><td><input data-k="cat" value="'+esc(a.cat)+'" size="7" aria-label="Κατηγορία"></td><td><input data-k="catDesc" value="'+esc(a.catDesc)+'" aria-label="Περιγραφή κατηγορίας"></td>'+
   '<td><select data-k="split" aria-label="Ποσό ανάλυσης ανά έτος"><option value="1"'+(a.split?' selected':'')+'>ΝΑΙ</option><option value="0"'+(a.split?'':' selected')+'>ΌΧΙ</option></select></td>'+
   '<td class="artuse">'+(a.code&&artUsage(a.code)?artUsage(a.code):"—")+'</td><td><button class="btn small" type="button" data-act="artdel" title="Διαγραφή άρθρου">✕</button></td></tr>';
}
function showArticles(){
  var el=S.cat!=="sw";
  openPanel('<div class="ph"><h2>'+(el?"Άρθρα προϋπολογισμού":"Budget articles")+'</h2><button class="btn small" type="button" data-act="close">'+(el?"Κλείσιμο":"Close")+'</button></div>'+
   '<p class="hint">'+(el?"Κάθε γραμμή είναι ένα άρθρο. «Ποσό ανάλυσης ανά έτος»: ΝΑΙ = το ποσό κατανέμεται ανά μήνα στα έτη της περιόδου, ΌΧΙ = στο έτος έναρξης. Άρθρο που χρησιμοποιείται σε εγγραφές δεν μπορεί να διαγραφεί ή να αλλάξει κωδικό.":"Each row is one article. Split per year: ΝΑΙ = spread by month over the years of the period, ΌΧΙ = start year. An article used by records cannot be deleted or have its code changed.")+'</p>'+
   '<div class="tbl"><table class="art"><thead><tr><th>Κωδικός</th><th>Περιγραφή άρθρου</th><th>Κατηγορία</th><th>Περιγραφή κατηγορίας</th><th>Ανάλυση ανά έτος</th><th>Σε χρήση</th><th></th></tr></thead><tbody id="artRows">'+articles().map(artRow).join("")+'</tbody></table></div>'+
   '<div class="actions"><button class="btn" type="button" data-act="artadd">'+(el?"+ Προσθήκη νέου άρθρου":"+ Add article")+'</button><button class="btn primary" type="button" data-act="artsave">'+(el?"Αποθήκευση":"Save")+'</button></div>',"arts");
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
  try{localStorage.setItem("rl.articles",JSON.stringify(list.slice(0,500)))}catch(e){}
  closePanel();toast(kept.length?(S.cat!=="sw"?"Αποθηκεύτηκαν. Διατηρήθηκαν επειδή χρησιμοποιούνται: ":"Saved. Kept because they are in use: ")+kept.join(", "):S.cat!=="sw"?"Τα άρθρα αποθηκεύτηκαν":"Articles saved");
  if(S.cat==="bd")render();
}
function bpRedraw(){
  if(ctLike(S.cat)){ctCollect();ctRefresh(true)}else{collect();drawWizard()}
}
function bpLive(){
  if(ctLike(S.cat)){ctCollect();(S.cw.d.years||[]).forEach(function(y,i){var c=$("#cy_cost_"+i);if(c&&bpHas(S.cw.d,i+1))c.value=y.cost});var sp=$("#cSum");if(sp)sp.textContent=mc(ctSum(S.cw.d.years))}
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
  else h='<div class="tbl"><table class="art"><thead><tr><th>'+(cat==="tn"?"Διαγωνισμός":el?"Σύμβαση":"Software")+'</th><th>'+(el?"Διαγράφηκε":"Deleted")+'</th><th>'+(el?"Οριστική διαγραφή σε":"Deleted for good in")+'</th><th></th></tr></thead><tbody>'+L.map(function(it){
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
  vat=vat==null?BD_VAT:vat;
  var rows={},order=[],warn=[];
  function rowFor(code,kind,id,desc,head){var k=code+"|"+kind+"|"+id;if(!rows[k]){rows[k]={code:code,kind:kind,id:id,desc:desc,how:head.slice(),by:{}};order.push(k)}return rows[k]}
  function seg(kind,id,desc,head,label,from,to,parts,cost){
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
      var g=groups[code],gross=r2(g.sum*(1+vat)),al=bdAlloc(gross,from,to,!!(g.a&&g.a.split));
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
   years.map(function(y){return '<th class="num">Προϋπολ.<br>ΕΤΟΣ '+y+'<br>€ με ΦΠΑ</th>'}).join("")+'</tr></thead><tbody>'+
   (rows.length?rows.map(function(r,i){
     return '<tr><td>'+(i+1)+'</td><td>'+esc(r.desc)+'</td><td class="how">'+r.how.map(esc).join("<br>")+'</td>'+years.map(function(y){return '<td class="num">'+(r.by[y]?bdNum(r.by[y]):"")+'</td>'}).join("")+'</tr>';
   }).join(""):'<tr><td colspan="'+(3+years.length)+'" class="hint">Δεν υπάρχουν γραμμές για αυτό το άρθρο.</td></tr>')+
   '<tr class="tot"><td colspan="3">Σύνολα</td>'+tot.map(function(v){return '<td class="num">'+bdNum(v)+'</td>'}).join("")+'</tr></tbody></table></div></section>';
}
function renderBd(){
  var arts=articles(),B=bdBuild(arts,S.items,S.contracts,S.tenders.filter(tnActive)),sel=bdSel(),years=B.years.length?B.years:[new Date().getFullYear()];
  var all=[];Object.keys(B.byArt).forEach(function(c){all=all.concat(B.byArt[c])});
  var tot=bdTotals(all,years);
  $("#stats").innerHTML=years.map(function(y,i){return '<div class="stat"><b class="num" style="font-family:var(--f-display)">'+bdNum(tot[i])+'</b><span>Σύνολο προϋπολογισμού '+y+' (€, με ΦΠΑ '+(BD_VAT*100)+'%)</span></div>'}).join("");
  $("#alerts").innerHTML=B.warn.map(function(w){return '<div class="alert bad"><span>'+esc(w)+'</span></div>'}).join("");
  var opts='<option value="all">Όλα τα άρθρα</option>'+arts.map(function(a){var n=(B.byArt[a.code]||[]).length;return '<option value="'+esc(a.code)+'"'+(sel===a.code?' selected':'')+'>'+esc(a.code+" — "+a.desc)+(n?" ("+n+")":"")+'</option>'}).join("")+
    (B.byArt[""]?'<option value="none"'+(sel==="none"?' selected':'')+'>Χωρίς άρθρο ('+B.byArt[""].length+')</option>':'');
  if(sel==="all")opts=opts.replace('<option value="all">','<option value="all" selected>');
  $("#chips").innerHTML='<label class="bdsel">Άρθρο <select id="bdArt">'+opts+'</select></label>'+(window.RL_CFG?'':' <button type="button" class="chip" data-act="arts">Άρθρα προϋπολογισμού</button>');
  var h="";
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
 {k:"contractor",l:"ΑΝΑΔΟΧΟΣ",q:"Ποιος είναι ο ανάδοχος;"},
 {k:"coordinator",l:"ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ",q:"Ποιος είναι ο συντονιστής της σύμβασης;"},
 {k:"months",l:"ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ)",q:"Ποια είναι η διάρκεια της σύμβασης σε μήνες;",num:1,req:1,ph:"π.χ. 62"},
 {k:"dateFrom",l:"ΗΜΕΡ. ΕΝΑΡΞΗΣ",q:"Πότε ξεκινά η σύμβαση;",date:1,req:1},
 {k:"dateTo",l:"ΗΜΕΡ. ΛΗΞΗΣ",q:"Πότε λήγει; Υπολογίζεται από τη διάρκεια, μπορείς να την αλλάξεις.",date:1,req:1},
 {k:"cost",l:"ΚΟΣΤΟΣ (€)",q:"Ποιο είναι το συνολικό κόστος (€);",num:1},
 {k:"emails",l:"EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ",q:"Σε ποια email να στέλνονται οι ειδοποιήσεις; Χώρισε πολλά με κόμμα (προαιρετικό).",ta:1,email:1}
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
function cwBase(){return S.cw&&S.cw.kind==="tn"?TN_BASE:CT_BASE}
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
    out.push({from:s,to:e,cost:o&&o.cost!=null?o.cost:"",remind:o&&o.remind?+o.remind:30});
    s=addDays(e,1);
  }
  var fin=ctEnd(from,m);if(fin>=out[out.length-1].from)out[out.length-1].to=fin;
  return out;
}
function ctSum(ys){return (ys||[]).reduce(function(a,y){var v=Number(y.cost);return a+(y.cost===""||y.cost==null||!isFinite(v)?0:v)},0)}
function ctInfo(c){
  var t=todayIso(),ys=c.years||[],from=c.dateFrom||(ys[0]&&ys[0].from)||"",to=c.dateTo||(ys.length?ys[ys.length-1].to:"");
  var de=daysLeft(to),i;
  if(de==null)return {k:"ok",t:"Χωρίς ημερομηνία",sub:"",d:null,yr:null};
  if(de<0)return {k:"bad",t:"Έληξε",sub:"Η σύμβαση έληξε "+dayTextEl(de),d:de,yr:null};
  if(from&&t<from){var ds=daysLeft(from);return {k:"ok",t:"Δεν ξεκίνησε",sub:"Ξεκινά "+dayTextEl(ds),d:ds,yr:null}}
  for(i=0;i<ys.length;i++){
    var d=daysLeft(ys[i].to);
    if(d!=null&&d>=0&&d<=(+ys[i].remind||30)){var last=i===ys.length-1;return {k:"warn",t:"Λήγει σύντομα",sub:(last?"Λήξη σύμβασης ":"Λήξη έτους "+(i+1)+" ")+dayTextEl(d),d:d,yr:i+1,last:last}}
  }
  var ci=-1;for(i=0;i<ys.length;i++){if(t>=ys[i].from&&t<=ys[i].to){ci=i;break}}
  return {k:"ok",t:"Σε ισχύ",sub:ci>=0?"Έτος "+(ci+1)+" από "+ys.length:"",d:de,yr:ci>=0?ci+1:null};
}
function attn(cat){return listOf(cat).filter(function(i){return (cat==="ct"?ctInfo(i):status(i)).k!=="ok"}).length}
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
    if(!q)return true;
    return [c.title,c.tender,c.description,c.contractor,c.coordinator].join(" ").toLowerCase().indexOf(q)>=0;
  }));
}
function renderCt(){
  var all=S.contracts,exp=0,due=0,act=0,spend=0;
  all.forEach(function(c){var k=ctInfo(c).k;if(k==="bad")exp++;else{if(k==="warn")due++;else act++;spend+=Number(c.cost)||0}});
  $("#stats").innerHTML=
    '<div class="stat"><b>'+all.length+'</b><span>Συμβάσεις</span></div>'+
    '<div class="stat bad"><b>'+exp+'</b><span>Έληξαν</span></div>'+
    '<div class="stat warn"><b>'+due+'</b><span>Λήγουν σύντομα</span></div>'+
    '<div class="stat"><b>'+act+'</b><span>Σε ισχύ</span></div>'+
    '<div class="stat"><b class="num" style="font-family:var(--f-display)">'+money(spend).replace(/\.00$/,"")+'</b><span>Κόστος ενεργών</span></div>';
  var lines=[];
  all.forEach(function(c){var s=ctInfo(c);if(s.k!=="ok")lines.push({c:c,s:s})});
  lines.sort(function(a,b){return a.s.d-b.s.d});
  var al=lines.slice(0,4).map(function(x){
    return '<div class="alert'+(x.s.k==="bad"?' bad':'')+'"><span><b>'+esc(x.c.title)+'</b> · '+esc(x.s.sub)+'</span><button type="button" data-act="openid" data-cat="ct" data-id="'+esc(x.c.id)+'">Άνοιγμα</button></div>';
  }).join("");
  if(lines.length>4)al+='<div class="alert"><span>+'+(lines.length-4)+' ακόμη</span><button type="button" data-f="due">Προβολή</button></div>';
  $("#alerts").innerHTML=al+msAlertHtml("ct")+crossAlert("ct");
  var chips=[["all","Όλες"],["expired","Έληξαν"],["due","Λήγουν σύντομα"],["active","Σε ισχύ"],["trash","🗑 Κάδος"+(S.trash.ct.length?" ("+S.trash.ct.length+")":"")]];
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

/* ---------- detail ---------- */
function showCtDetail(id){
  var c=getItem("ct",id);if(!c)return;S.open=id;S.openCat="ct";
  var s=ctInfo(c),ys=c.years||[],t=todayIso();
  var files=(c.attachments||[]).map(function(a,i){
    return '<li><a href="#" data-blob="'+esc(a.id)+'">'+esc(a.name)+'</a><button type="button" class="btn small danger" data-delfile="'+i+'">Αφαίρεση</button></li>';
  }).join("");
  var yr=ys.map(function(y,i){
    var cur=t>=y.from&&t<=y.to,past=t>y.to;
    return '<tr class="'+(cur?"cur":"")+'"><td>Έτος '+(i+1)+'</td><td class="mono">'+fmtDate(y.from)+'</td><td class="mono">'+fmtDate(y.to)+'</td><td class="num">'+mc(y.cost)+'</td>'+
      '<td><select class="yrRem" data-i="'+i+'" aria-label="Υπενθύμιση έτους '+(i+1)+'">'+remOpts(y.remind,REMIND_CT," ημέρες πριν")+'</select></td>'+
      '<td>'+(cur?'<span class="pill ok">Τρέχον</span>':past?'<span class="hint">Ολοκληρώθηκε</span>':'')+'</td></tr>';
  }).join("");
  openPanel(
   '<div class="ph"><div><h2>'+esc(c.title)+'</h2><span class="pill '+s.k+'">'+s.t+'</span> <span class="hint">'+esc(s.sub)+'</span></div><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div>'+
   '<dl class="kv wl">'+
   '<dt>ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ</dt><dd>'+esc(c.tender||"—")+'</dd>'+
   '<dt>ΠΕΡΙΓΡΑΦΗ</dt><dd>'+esc(c.description||"—")+'</dd>'+
   '<dt>ΑΝΑΔΟΧΟΣ</dt><dd>'+esc(c.contractor||"—")+'</dd>'+
   '<dt>ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ</dt><dd>'+esc(c.coordinator||"—")+'</dd>'+
   '<dt>ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)</dt><dd class="num">'+esc(c.months||"—")+'</dd>'+
   '<dt>ΗΜΕΡ. ΕΝΑΡΞΗΣ</dt><dd class="mono">'+fmtDate(c.dateFrom)+'</dd>'+
   '<dt>ΗΜΕΡ. ΛΗΞΗΣ</dt><dd class="mono">'+fmtDate(c.dateTo)+'</dd>'+
   '<dt>ΚΟΣΤΟΣ</dt><dd class="num">'+mc(c.cost)+'</dd>'+
   '<dt>EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ</dt><dd>'+esc(c.emails||"—")+'</dd></dl>'+
   '<div class="sec"><h3>Έτη και υπενθυμίσεις</h3><div class="tbl"><table><thead><tr><th>Έτος</th><th>ΗΜΕΡ. ΕΝΑΡΞΗΣ</th><th>ΗΜΕΡ. ΛΗΞΗΣ</th><th>ΚΟΣΤΟΣ</th><th>Υπενθύμιση</th><th></th></tr></thead><tbody>'+yr+'</tbody></table></div>'+
   '<span class="hint">Η υπενθύμιση κάθε έτους εμφανίζεται στην κορυφή και στο παράθυρο ειδοποιήσεων από την επιλεγμένη ημερομηνία μέχρι τη λήξη του έτους.</span></div>'+
   '<div class="sec"><h3>Συνημμένα</h3>'+(files?'<ul class="files">'+files+'</ul>':'<span class="hint">Δεν υπάρχουν συνημμένα (συμβάσεις, τιμολόγια, αποδείξεις).</span>')+
   '<div><button class="btn" type="button" data-act="attach"'+(S.assets?'':' disabled')+'>+ Προσθήκη αρχείων</button> <span class="hint">'+(S.assets?'PDF, εικόνες, CSV ή κείμενο, έως 20 MB το καθένα.':'Η μεταφόρτωση δεν είναι διαθέσιμη εδώ.')+'</span></div></div>'+
   bpDetail(c,1)+msSection("ct",c)+
   '<div class="sec"><div class="actions"><button class="btn" type="button" data-act="edit">Επεξεργασία</button><button class="btn danger" type="button" data-act="ctdel">Διαγραφή</button></div><div id="delbox"></div></div>'
  ,"detail",true);
}

/* ---------- add / edit ---------- */
function ctInput(f,v,id){
  v=v==null?"":v;
  if(f.ta)return '<textarea id="'+id+'">'+esc(v)+'</textarea>';
  var t=f.date?"date":f.num?"number":"text";
  var ex=f.k==="months"?' step="1" min="1" inputmode="numeric"':f.num?' step="0.01" min="0" inputmode="decimal"':'';
  return '<input id="'+id+'" type="'+t+'"'+ex+' value="'+esc(v)+'" placeholder="'+esc(f.ph||"")+'" autocomplete="off">';
}
function ctStart(id){
  var c=id?getItem("ct",id):null;
  S.cw={id:id||null,mode:c?"full":"step",i:0,err:"",d:c?JSON.parse(JSON.stringify(c)):{months:"",dateFrom:todayIso(),years:[]}};
  ctDraw();
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
}
function ctRegen(){var d=S.cw.d,g=buildYears(d.dateFrom,d.months,d.years);if(!g.length)return;d.years=g;d.dateTo=g[g.length-1].to}
function ctApplyEnd(){var d=S.cw.d,ys=d.years;if(ys&&ys.length&&parseIso(d.dateTo)&&d.dateTo>=ys[ys.length-1].from)ys[ys.length-1].to=d.dateTo}
function ctRefresh(skipTo){
  var el=$("#cYears");if(el)el.innerHTML=ctYearsTable();
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
  var w=S.cw,d=w.d,tn=w.kind==="tn",B=cwBase(),h;
  var ttl=w.promoteFrom?"Promote στις Συμβάσεις":tn?(w.id?"Επεξεργασία διαγωνισμού":"Νέος διαγωνισμός"):(w.id?"Επεξεργασία σύμβασης":"Νέα σύμβαση");
  var head='<div class="ph"><h2>'+ttl+'</h2><button class="btn small" type="button" data-act="close">Άκυρο</button></div>'+
    (w.promoteFrom?'<p class="hint">Τα πεδία μεταφέρθηκαν από τον διαγωνισμό «'+esc(w.promoteTitle||"")+'». Έλεγξε και διόρθωσέ τα (π.χ. συμπλήρωσε ανάδοχο και συντονιστή, υπενθυμίσεις, email) πριν την αποθήκευση. Τα συνημμένα του διαγωνισμού αντιγράφονται στη σύμβαση. Η συμπερίληψη του διαγωνισμού στον Προϋπολογισμό θα αφαιρεθεί, γιατί θα γίνεται πλέον μέσω της νέας σύμβασης.</p>':'');
  var saveL=w.promoteFrom?"Αποθήκευση σύμβασης και προώθηση":"Αποθήκευση";
  if(w.mode==="full"){
    h=head+'<div style="display:grid;gap:12px">'+B.map(function(f){return '<label class="f">'+f.l+(f.req?' *':'')+ctInput(f,d[f.k],"c_"+f.k)+'</label>'}).join("")+'</div>'+
      '<div class="sec"><h3>'+(tn?"Έτη διαγωνισμού":"Έτη σύμβασης")+'</h3><p class="hint">Δημιουργούνται αυτόματα από τη διάρκεια. Οι επιπλέον μήνες πέρα από τα πλήρη έτη προστίθενται στο 1ο έτος.'+(tn?' Συμπλήρωσε για κάθε έτος τα επιμέρους ποσά με το σχετικό άρθρο προϋπολογισμού· περνούν στον Προϋπολογισμό όσο ο διαγωνισμός είναι ενεργός.':'')+'</p><div id="cYears">'+ctYearsTable()+'</div>'+
      '<div><button class="btn small" type="button" data-act="ctsum">Συμπλήρωση ΚΟΣΤΟΥΣ από το άθροισμα ετών</button></div></div>'+
      '<div class="err" id="werr">'+esc(w.err)+'</div><div class="actions"><button class="btn primary" type="button" data-act="ctsave">'+saveL+'</button>'+(w.id||w.promoteFrom?'':'<button class="btn" type="button" data-act="ctstep">Βήμα-βήμα</button>')+'</div>';
    openPanel(h,"wiz",true);return;
  }
  var total=B.length+1,i=w.i,last=i===total-1,body;
  if(i<B.length){var f=B[i];body='<label class="f"><span class="big-q">'+f.q+(f.req?'':' <small>(προαιρετικό)</small>')+'</span>'+ctInput(f,d[f.k],"c_"+f.k)+'</label>'}
  else body='<div><span class="big-q">'+(tn?"Έτη και κόστη":"Έτη, κόστη και υπενθυμίσεις")+'</span><p class="hint">'+(tn?"Συμπλήρωσε το κόστος κάθε έτους ή τα επιμέρους ποσά του με το σχετικό άρθρο.":"Συμπλήρωσε το κόστος κάθε έτους και διάλεξε πότε θέλεις υπενθύμιση πριν τη λήξη του.")+'</p></div><div id="cYears">'+ctYearsTable()+'</div>';
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
    if(f.req&&blank)return f.l+": υποχρεωτικό πεδίο.";
    if(f.k==="months"&&!blank){var m=Number(v);if(!isFinite(m)||m<1||Math.floor(m)!==m)return "Η διάρκεια πρέπει να είναι ακέραιος αριθμός μηνών, π.χ. 62."}
    if(f.date&&!blank&&!parseIso(v))return f.l+": μη έγκυρη ημερομηνία.";
    if(f.email&&!blank&&emailsErr(v,1))return emailsErr(v,1);
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
  if(tn){base.status=d.status||"active";base.statusAt=d.statusAt||"";base.promotedTo=d.promotedTo||"";return base}
  base.contractor=String(d.contractor||"").trim();base.coordinator=String(d.coordinator||"").trim();base.emails=String(d.emails||"").trim();base.milestones=d.milestones||[];
  return base;
}
async function ctSave(){
  ctCollect();var w=S.cw,d=w.d;
  var e=ctValidateBase(cwBase().map(function(f){return f.k}));
  if(!e)e=bpErr(d,1);
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
  var tn=w.kind==="tn",rec=ctRecord(d,w.kind),id=w.id||uid();
  if(w.promoteFrom){
    if(await tnPromoteDo(w.promoteFrom,id,rec)){closePanel();toast("Ο διαγωνισμός προωθήθηκε στις Συμβάσεις");S.cat="ct";S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat","ct")}catch(e){}render();showCtDetail(id)}
    return;
  }
  if(await save(id,rec,tn?"tn":"ct")){closePanel();toast(w.id?"Αποθηκεύτηκε":"Προστέθηκε: "+rec.title);if(!w.id)(tn?showTnDetail:showCtDetail)(id)}
}
/* ---------- tenders (Διαγωνισμοί): same form as the contracts, without reminders ---------- */
function tnActive(t){return (t.status||"active")==="active"}
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
  d.contractor="";d.coordinator="";d.emails="";d.milestones=[];d.createdAt=Date.now();d.sample=false;
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
   '<div><button class="btn" type="button" data-act="attach"'+(S.assets?'':' disabled')+'>+ Προσθήκη αρχείων</button> <span class="hint">'+(S.assets?'PDF, εικόνες, CSV ή κείμενο, έως 20 MB το καθένα.':'Η μεταφόρτωση δεν είναι διαθέσιμη εδώ.')+'</span></div></div>'+
   bpDetail(c,1)+
   '<div class="sec"><div class="actions">'+act+'<button class="btn" type="button" data-act="edit">Επεξεργασία</button><button class="btn danger" type="button" data-act="tndel">Διαγραφή</button></div><div id="delbox"></div></div>'
  ,"detail",true);
}

/* ---------- Excel import ---------- */
function nh(s){return String(s==null?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[\s.\-–()_:,;]/g,"")}
var CT_ALIAS={title:["ΣΥΜΒΑΣΗ","CONTRACT"],tender:["ΑΡΙΘΜΟΣΔΙΑΓΩΝΙΣΜΟΥ","ΑΡΔΙΑΓΩΝΙΣΜΟΥ","TENDER"],description:["ΠΕΡΙΓΡΑΦΗ","DESCRIPTION"],contractor:["ΑΝΑΔΟΧΟΣ","CONTRACTOR"],
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
      if(i>=g.length){if(!y.from||!y.to)return;g.push({from:y.from,to:y.to,cost:"",remind:30});i=g.length-1}
      if(y.from)g[i].from=y.from;if(y.to)g[i].to=y.to;
      if(y.cost!==undefined&&y.cost!=="")g[i].cost=numOf(y.cost);
      var rm=Number(y.remind);if(rm>0)g[i].remind=rm;
    });
    var cost=numOf(base.cost);
    var rec={title:String(base.title||"").trim(),tender:String(base.tender==null?"":base.tender).trim(),description:String(base.description||"").trim(),contractor:String(base.contractor||"").trim(),coordinator:String(base.coordinator||"").trim(),
      months:months===""?0:months,dateFrom:from,dateTo:to,cost:cost===""?ctSum(g):cost,years:g,emails:String(base.emails||"").trim(),attachments:[],createdAt:Date.now(),sample:false};
    var errs=[];
    if(!rec.title)errs.push("λείπει η σύμβαση");
    if(emailsErr(rec.emails,1))errs.push(emailsErr(rec.emails,1));
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
function ctHead(n){
  var h=["ΣΥΜΒΑΣΗ","ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ","ΠΕΡΙΓΡΑΦΗ","ΑΝΑΔΟΧΟΣ","ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ","ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ)","ΗΜΕΡ. ΕΝΑΡΞΗΣ","ΗΜΕΡ. ΛΗΞΗΣ","ΚΟΣΤΟΣ"];
  for(var i=1;i<=n;i++)h.push("ΕΤΟΣ "+i+" - ΗΜΕΡ.ΕΝΑΡΞΗΣ","ΕΤΟΣ "+i+" - ΗΜΕΡ.ΛΗΞΗΣ","ΕΤΟΣ "+i+" - ΚΟΣΤΟΣ","ΕΤΟΣ "+i+" - ΥΠΕΝΘΥΜΙΣΗ (ΗΜΕΡΕΣ ΠΡΙΝ)");
  h.push("ΣΥΝΗΜΜΕΝΑ","EMAIL ΕΙΔΟΠΟΙΗΣΕΩΝ","ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ","MILESTONES","ΚΑΤΑΣΤΑΣΗ");return h;
}
function ctMaxYears(){return S.contracts.reduce(function(a,c){return Math.max(a,(c.years||[]).length)},1)}
function ctRowsOut(n){
  return S.contracts.slice().sort(function(a,b){return (a.dateTo||"").localeCompare(b.dateTo||"")}).map(function(c){
    var r=[c.title,c.tender,c.description,c.contractor,c.coordinator,c.months,c.dateFrom,c.dateTo,c.cost],ys=c.years||[];
    for(var i=0;i<n;i++){var y=ys[i]||{};r.push(y.from||"",y.to||"",y.cost===undefined?"":y.cost,y.remind||"")}
    r.push((c.attachments||[]).map(function(a){return a.name}).join("; "),c.emails||"",bpText(c),msText(c),ctInfo(c).t);
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
function tnHead(n){
  var h=["ΟΝΟΜΑ ΔΙΑΓΩΝΙΣΜΟΥ","ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ","ΠΕΡΙΓΡΑΦΗ","ΔΙΑΡΚΕΙΑ (ΜΗΝΕΣ)","ΕΚΤΙΜ. ΗΜΕΡ. ΕΝΑΡΞΗΣ","ΕΚΤΙΜ. ΗΜΕΡ. ΛΗΞΗΣ","ΕΚΤΙΜΩΜΕΝΟ ΚΟΣΤΟΣ"];
  for(var i=1;i<=n;i++)h.push("ΕΤΟΣ "+i+" - ΗΜΕΡ.ΕΝΑΡΞΗΣ","ΕΤΟΣ "+i+" - ΗΜΕΡ.ΛΗΞΗΣ","ΕΤΟΣ "+i+" - ΚΟΣΤΟΣ");
  h.push("ΣΥΝΗΜΜΕΝΑ","ΕΠΙΜΕΡΟΥΣ ΠΟΣΑ","ΚΑΤΑΣΤΑΣΗ");return h;
}
function tnRowsOut(n){
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
   '<div class="sec"><h3>Εισαγωγή από Excel</h3><p class="hint">Στήλες: ΣΥΜΒΑΣΗ, ΑΡΙΘΜΟΣ ΔΙΑΓΩΝΙΣΜΟΥ, ΠΕΡΙΓΡΑΦΗ, ΑΝΑΔΟΧΟΣ, ΣΥΝΤΟΝΙΣΤΗΣ ΣΥΜΒΑΣΗΣ, ΔΙΑΡΚΕΙΑ ΣΥΜΒΑΣΗΣ (ΜΗΝΕΣ), ΗΜΕΡ. ΕΝΑΡΞΗΣ, ΗΜΕΡ. ΛΗΞΗΣ, ΚΟΣΤΟΣ και προαιρετικά ΕΤΟΣ 1 - ΗΜΕΡ.ΕΝΑΡΞΗΣ, ΗΜΕΡ.ΛΗΞΗΣ, ΚΟΣΤΟΣ κ.ο.κ. Αν λείπουν οι στήλες των ετών, δημιουργούνται αυτόματα από τη διάρκεια. Ημερομηνίες: ηη/μμ/εεεε ή εεεε-μμ-ηη.</p><div class="actions"><button class="btn" type="button" data-act="tpl">Λήψη προτύπου</button><button class="btn" type="button" data-act="pick">Επιλογή αρχείου Excel…</button></div></div>',"export");
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
/*GUIDE-START*/var GUIDE_HTML="<p class=\"hint\">Οδηγός χρήσης του PROCURE360 · ισχύει για την έκδοση 3.4.1. Πάτησε σε ένα θέμα για να πας κατευθείαν σε αυτό.<\/p>\n<div class=\"gtoc\">\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"intro\">Επισκόπηση<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"start\">Πρώτα βήματα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"sw\">Online Renewals<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"ct\">Συμβάσεις<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"tn\">Διαγωνισμοί<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"bd\">Προϋπολογισμός<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"ms\">Milestones<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"att\">Συνημμένα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"trash\">Κάδος και αναίρεση<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"rem\">Υπενθυμίσεις<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"xl\">Excel<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"set\">Ρυθμίσεις και δικαιώματα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"data\">Δεδομένα και αντίγραφα<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"faq\">Συχνές ερωτήσεις<\/button>\n<button type=\"button\" class=\"chip\" data-act=\"gsec\" data-id=\"new\">Τι νέο υπάρχει<\/button>\n<\/div>\n\n<h3 id=\"g-intro\">Επισκόπηση<\/h3>\n<p>Το PROCURE360 συνδέει σε ένα σημείο τις αγορές λογισμικού, τις συμβάσεις, τους μελλοντικούς διαγωνισμούς και τον προγραμματισμό του προϋπολογισμού. Έχει τέσσερις καρτέλες:<\/p>\n<ul>\n<li><b>Online Renewals:<\/b> συνδρομές λογισμικού με ημερομηνία λήξης και ανανέωση.<\/li>\n<li><b>Συμβάσεις:<\/b> συμβάσεις πολλών ετών, με κόστος και υπενθύμιση ανά έτος και milestones.<\/li>\n<li><b>Διαγωνισμοί:<\/b> νέοι διαγωνισμοί που προτίθεται να διενεργήσει ο Οργανισμός, με εκτιμώμενα ποσά.<\/li>\n<li><b>Προϋπολογισμός:<\/b> πίνακες ανά άρθρο, που συμπληρώνονται αυτόματα από τα ποσά των τριών προηγούμενων καρτελών.<\/li>\n<\/ul>\n<p>Οι εγγραφές των τριών πρώτων καρτελών κρατούν ποσά <b>χωρίς ΦΠΑ<\/b>. Ο Προϋπολογισμός προσθέτει ΦΠΑ 19%.<\/p>\n\n<h3 id=\"g-start\">Πρώτα βήματα<\/h3>\n<ul>\n<li>Διάλεξε καρτέλα και πάτησε το πράσινο κουμπί πάνω δεξιά («+ Add software», «+ Νέα σύμβαση», «+ Νέος διαγωνισμός»).<\/li>\n<li>Η φόρμα ανοίγει <b>βήμα-βήμα<\/b> (μία ερώτηση κάθε φορά). Με το «Πλήρης φόρμα» βλέπεις όλα τα πεδία μαζί.<\/li>\n<li>Η αναζήτηση πάνω από τη λίστα φιλτράρει με ό,τι πληκτρολογείς. Τα κουμπιά φίλτρου (chips) περιορίζουν ανά κατάσταση.<\/li>\n<li>Με το «⚙ Στήλες» διαλέγεις ποιες στήλες φαίνονται, με ποια σειρά και ποια ταξινομεί τη λίστα.<\/li>\n<li>Στο WordPress βλέπεις μόνο τις καρτέλες και τις ενέργειες που σου επιτρέπει ο ρόλος σου. Αν λείπει κάποιο κουμπί, ζήτα το δικαίωμα από τον διαχειριστή.<\/li>\n<\/ul>\n\n<h3 id=\"g-sw\">Online Renewals<\/h3>\n<p><b>Πεδία:<\/b> Software Name, Description, Vendor, Website, Username, Date From, Date To, Cost excl. VAT (€), Notification emails (πολλά, χωρισμένα με κόμμα) και η υπενθύμιση (7, 14, 30, 60 ή 90 ημέρες πριν τη λήξη). Δεν αποθηκεύονται κωδικοί πρόσβασης.<\/p>\n<p><b>Κατάσταση:<\/b> «Active», «Due soon» (μέσα στις ημέρες υπενθύμισης) ή «Expired».<\/p>\n<p><b>Ανανέωση:<\/b> άνοιξε την εγγραφή και πάτησε «Renew…». Δίνεις νέες ημερομηνίες και κόστος, και η προηγούμενη περίοδος κρατιέται στο ιστορικό ανανεώσεων.<\/p>\n<p><b>Επιμέρους ποσά και άρθρα:<\/b> στην ενότητα «Cost breakdown» της εγγραφής πατάς «+ Add partial amount» και χωρίζεις το κόστος σε μέρη, διαλέγοντας για κάθε μέρος το άρθρο προϋπολογισμού. Έτσι περνά στον Προϋπολογισμό. Αν δεν δώσεις επιμέρους ποσά, μπαίνει ολόκληρο το κόστος χωρίς άρθρο.<\/p>\n\n<h3 id=\"g-ct\">Συμβάσεις<\/h3>\n<p><b>Πεδία:<\/b> Σύμβαση, Αριθμός διαγωνισμού, Περιγραφή, Ανάδοχος, Συντονιστής, Διάρκεια (μήνες), Ημερομηνία έναρξης και λήξης, Κόστος, Emails ειδοποιήσεων.<\/p>\n<p><b>Έτη σύμβασης:<\/b> δημιουργούνται αυτόματα από τη διάρκεια και την ημερομηνία έναρξης. Οι επιπλέον μήνες πέρα από τα πλήρη έτη προστίθενται στο 1ο έτος. Για κάθε έτος βάζεις κόστος και υπενθύμιση (14, 30, 60, 90, 120 ή 180 ημέρες πριν τη λήξη του έτους).<\/p>\n<p><b>Επιμέρους ποσά:<\/b> κάτω από κάθε έτος πατάς «+ Επιμέρους ποσό», επιλέγεις άρθρο προϋπολογισμού και γράφεις το ποσό. Το κόστος του έτους γίνεται το άθροισμα των ποσών. Δες την ενότητα «Προϋπολογισμός» για το πώς περνούν.<\/p>\n<p><b>Κατάσταση:<\/b> «Δεν ξεκίνησε», «Ενεργή», «Λήγει σύντομα» (λήξη έτους ή σύμβασης μέσα στις ημέρες υπενθύμισης) ή «Έληξε».<\/p>\n\n<h3 id=\"g-tn\">Διαγωνισμοί<\/h3>\n<p>Εδώ καταγράφονται οι νέοι διαγωνισμοί που σκοπεύει να διενεργήσει ο Οργανισμός.<\/p>\n<p><b>Πεδία:<\/b> Όνομα διαγωνισμού, Αριθμός διαγωνισμού, Περιγραφή, Διάρκεια (μήνες), Εκτιμώμενη ημερομηνία έναρξης και λήξης, Εκτιμώμενο κόστος. Τα <b>Έτη<\/b> δημιουργούνται αυτόματα από τη διάρκεια, όπως στις Συμβάσεις, αλλά χωρίς υπενθύμιση. Σε κάθε έτος βάζεις επιμέρους ποσά με το σχετικό άρθρο. Τα συνημμένα προστίθενται στο παράθυρο της εγγραφής.<\/p>\n<p><b>Προϋπολογισμός:<\/b> όσο ο διαγωνισμός είναι <b>ενεργός<\/b>, τα ποσά του περιλαμβάνονται στον Προϋπολογισμό με σημείωση «Εκτιμώμενος διαγωνισμός».<\/p>\n<p><b>Δύο επιλογές μέσα στον διαγωνισμό:<\/b><\/p>\n<ul>\n<li><b>Ακύρωση και αποθήκευση για αναφορά:<\/b> ο διαγωνισμός μένει στη λίστα ως «Ακυρώθηκε» και αφαιρείται από τον Προϋπολογισμό. Μπορείς να τον επανενεργοποιήσεις με το «Επανενεργοποίηση».<\/li>\n<li><b>Promote στις Συμβάσεις και αποθήκευση για αναφορά:<\/b> ανοίγει η φόρμα Σύμβασης προσυμπληρωμένη από τον διαγωνισμό. Συμπληρώνεις τα υπόλοιπα (π.χ. ανάδοχος, συντονιστής, υπενθυμίσεις) και διορθώνεις ό,τι χρειάζεται, και η σύμβαση δημιουργείται μόνο όταν πατήσεις την αποθήκευση. Ο διαγωνισμός μένει ως «Προωθήθηκε σε Σύμβαση», με σύνδεσμο προς τη σύμβαση, και αφαιρείται από τον Προϋπολογισμό. Από εδώ και πέρα τα ποσά μπαίνουν στον Προϋπολογισμό μέσω της σύμβασης. Τα συνημμένα του διαγωνισμού αντιγράφονται στη σύμβαση.<\/li>\n<\/ul>\n<p>Ένας ακυρωμένος ή προωθημένος διαγωνισμός δεν προωθείται ξανά. Στο WordPress το Promote απαιτεί δικαίωμα επεξεργασίας διαγωνισμών και δημιουργίας συμβάσεων.<\/p>\n\n<h3 id=\"g-bd\">Προϋπολογισμός<\/h3>\n<p>Η καρτέλα δεν έχει δικά της δεδομένα. Συμπληρώνεται αυτόματα από τα επιμέρους ποσά των Online Renewals, των Συμβάσεων και των <b>ενεργών<\/b> Διαγωνισμών.<\/p>\n<ul>\n<li>Πάνω φαίνεται το σύνολο κάθε έτους. Με το «Άρθρο» διαλέγεις ένα άρθρο ή όλα. Κάθε άρθρο έχει δικό του πίνακα με στήλες Α/Α, Λεπτομέρειες Δαπάνης (το όνομα της σύμβασης, του διαγωνισμού ή του λογισμικού), Τρόπος Υπολογισμού και ένα ποσό ανά έτος.<\/li>\n<li><b>ΦΠΑ:<\/b> στις εγγραφές τα ποσά είναι χωρίς ΦΠΑ. Ο Προϋπολογισμός προσθέτει ΦΠΑ 19% (στήλες «€ με ΦΠΑ»). Ο Τρόπος Υπολογισμού δείχνει καθαρό ποσό + ΦΠΑ = σύνολο.<\/li>\n<li><b>Ανάλυση ανά έτος = ΝΑΙ:<\/b> το ποσό μοιράζεται ανά μήνα στα ημερολογιακά έτη της περιόδου (ένας μερικός μήνας μετράει ανάλογα με τις ημέρες). Παράδειγμα: 1.200 € καθαρά με περίοδο από 1/4 για 12 μήνες γίνονται 1.428 € με ΦΠΑ, δηλαδή 1.071 € στο πρώτο έτος και 357 € στο επόμενο.<\/li>\n<li><b>Ανάλυση ανά έτος = ΌΧΙ:<\/b> ολόκληρο το ποσό μπαίνει στο έτος έναρξης.<\/li>\n<li>Ποσά χωρίς άρθρο εμφανίζονται στον πίνακα «Χωρίς άρθρο». Αν μια εγγραφή δεν έχει ημερομηνία έναρξης, εμφανίζεται προειδοποίηση ότι δεν περιλαμβάνεται.<\/li>\n<li><b>Εξαγωγή Excel:<\/b> δημιουργεί φύλλο σύνοψης και ένα φύλλο ανά άρθρο, με τύπους αθροίσματος.<\/li>\n<li>Εγγραφές στον Κάδο, ακυρωμένοι και προωθημένοι διαγωνισμοί δεν υπολογίζονται.<\/li>\n<\/ul>\n<p><b>Άρθρα προϋπολογισμού:<\/b> η λίστα (Κωδικός, Περιγραφή, Κατηγορία, Περιγραφή κατηγορίας, Ανάλυση ανά έτος ΝΑΙ/ΌΧΙ) είναι πίνακας με «+ Προσθήκη νέου άρθρου» και «Διαγραφή». Στο WordPress: Ρυθμίσεις → PROCURE360. Στις εκδόσεις HTML και Windows: κουμπί «Άρθρα προϋπολογισμού». Άρθρο που χρησιμοποιείται σε εγγραφές δεν διαγράφεται και δεν αλλάζει κωδικό.<\/p>\n\n<h3 id=\"g-ms\">Milestones<\/h3>\n<p>Σε μια εγγραφή (Online Renewal ή Σύμβαση) πρόσθεσε milestones ανά έτος με «+ Προσθήκη milestone»: περιγραφή, ημερομηνία παράδοσης, ειδοποίηση (30 ή 60 ημέρες πριν), σχόλια και συνημμένα. Η ειδοποίηση εμφανίζεται στην οθόνη και στέλνεται με email.<\/p>\n\n<h3 id=\"g-att\">Συνημμένα<\/h3>\n<p>Στο παράθυρο μιας εγγραφής πάτα «+ Προσθήκη αρχείων» (PDF, εικόνες, CSV ή κείμενο, έως 20 MB το καθένα). Για άνοιγμα πάτα στο όνομα του αρχείου. Το «Αφαίρεση» σβήνει το αρχείο (με αναίρεση για λίγα δευτερόλεπτα). Τα συνημμένα εμφανίζονται ως στήλη «Αρχεία» στη λίστα και ως όνομα στην εξαγωγή.<\/p>\n\n<h3 id=\"g-trash\">Κάδος και αναίρεση<\/h3>\n<ul>\n<li><b>Αναίρεση:<\/b> μετά από διαγραφή εγγραφής, milestone ή συνημμένου εμφανίζεται για 8 δευτερόλεπτα κουμπί «Αναίρεση».<\/li>\n<li><b>Κάδος:<\/b> η διαγραφή μεταφέρει την εγγραφή στον Κάδο (κουμπί «🗑 Κάδος» δίπλα στα φίλτρα). Εκεί γίνεται <b>Επαναφορά<\/b>. Οι εγγραφές του κάδου δεν υπολογίζονται, δεν στέλνουν υπενθυμίσεις και δεν μπαίνουν στις εξαγωγές.<\/li>\n<li><b>Οριστική διαγραφή:<\/b> γίνεται μόνο από τον Κάδο (στο WordPress με ξεχωριστό δικαίωμα) και αυτόματα μετά από 30 ημέρες (ρυθμίζεται στο WordPress: Ρυθμίσεις → PROCURE360 → Παραμονή στον Κάδο· 0 = ποτέ).<\/li>\n<\/ul>\n\n<h3 id=\"g-rem\">Υπενθυμίσεις<\/h3>\n<ul>\n<li>Στο άνοιγμα της εφαρμογής εμφανίζεται παράθυρο «Needs your attention» με ό,τι έληξε ή λήγει σύντομα. Σε κάθε καρτέλα φαίνονται και ειδοποιήσεις για την άλλη καρτέλα.<\/li>\n<li><b>WordPress:<\/b> στέλνονται και email, αυτόματα μία φορά την ημέρα. Παραλήπτες είναι τα email της εγγραφής και οι γενικοί παραλήπτες των Ρυθμίσεων· το email επαναλαμβάνεται κάθε Ν ημέρες όσο η εγγραφή χρειάζεται ενέργεια. Οι Διαγωνισμοί δεν έχουν υπενθυμίσεις.<\/li>\n<li>Στις εκδόσεις HTML και Windows δεν στέλνονται email, μόνο το παράθυρο στο άνοιγμα. Η έκδοση Windows μπορεί να ανοίγει με την εκκίνηση των Windows.<\/li>\n<\/ul>\n\n<h3 id=\"g-xl\">Excel: εισαγωγή και εξαγωγή<\/h3>\n<ul>\n<li><b>Εισαγωγή:<\/b> κουμπί «Import Excel» (Online Renewals και Συμβάσεις). Οι στήλες αναγνωρίζονται από τους τίτλους τους, ελληνικούς ή αγγλικούς. Υπάρχει και πρότυπο αρχείου για λήψη. Οι Διαγωνισμοί δεν έχουν εισαγωγή από Excel.<\/li>\n<li><b>Εξαγωγή:<\/b> κουμπί «Export» / «Εξαγωγή» σε Excel ή CSV, με όλα τα πεδία και τα επιμέρους ποσά. Στους Διαγωνισμούς περιλαμβάνεται και η κατάσταση.<\/li>\n<li>Στο WordPress η εξαγωγή χρειάζεται δικαίωμα «export».<\/li>\n<\/ul>\n\n<h3 id=\"g-set\">Ρυθμίσεις και δικαιώματα (WordPress)<\/h3>\n<ul>\n<li><b>Ρυθμίσεις → PROCURE360:<\/b> γενικοί παραλήπτες υπενθυμίσεων, κάθε πόσες ημέρες επαναλαμβάνεται το email, παραμονή στον Κάδο, πίνακας άρθρων προϋπολογισμού και κουμπί αποστολής υπενθυμίσεων τώρα.<\/li>\n<li><b>Application Management:<\/b> εκεί ορίζεται ποιος έχει πρόσβαση και με ποιον ρόλο. Κάθε ενότητα (Software, Contracts, Tenders) έχει δικαιώματα προβολής, δημιουργίας, επεξεργασίας, διαγραφής και εξαγωγής. Επιπλέον υπάρχει το «purge» για οριστική διαγραφή από τον Κάδο. Το δικαίωμα προσαρμόζεται και ανά χρήστη.<\/li>\n<li>Ό,τι γίνεται καταγράφεται στο αρχείο δραστηριότητας του Application Management.<\/li>\n<\/ul>\n\n<h3 id=\"g-data\">Δεδομένα και αντίγραφα ασφαλείας<\/h3>\n<ul>\n<li><b>WordPress:<\/b> τα δεδομένα είναι στη βάση του WordPress και είναι κοινά για όλους τους χρήστες. Τα αντίγραφα γίνονται με το αντίγραφο της βάσης και του φακέλου uploads του site σου. Πριν από αναβάθμιση plugin κάνε αντίγραφο.<\/li>\n<li><b>HTML και Windows:<\/b> τα δεδομένα αποθηκεύονται στον browser του συγκεκριμένου υπολογιστή και δεν μοιράζονται με άλλους. Στα Windows το Backup.bat φτιάχνει zip στα Έγγραφα. Μην καθαρίσεις τα δεδομένα του browser. Εξαγωγή Excel όποτε θες επιπλέον αντίγραφο.<\/li>\n<\/ul>\n\n<h3 id=\"g-faq\">Συχνές ερωτήσεις<\/h3>\n<ul>\n<li><b>Γιατί ο Προϋπολογισμός δείχνει μεγαλύτερο ποσό από αυτό που έγραψα;<\/b> Γιατί προσθέτει ΦΠΑ 19%. Οι εγγραφές κρατούν ποσά χωρίς ΦΠΑ.<\/li>\n<li><b>Ο διαγωνισμός δεν φαίνεται στον Προϋπολογισμό.<\/b> Ελέγχεται η κατάστασή του (πρέπει να είναι «Ενεργός») και αν έχει επιμέρους ποσά ή κόστος και ημερομηνία έναρξης.<\/li>\n<li><b>Έσβησα κάτι κατά λάθος.<\/b> Πάτα «Αναίρεση» αμέσως, αλλιώς πήγαινε στον Κάδο και πάτα Επαναφορά.<\/li>\n<li><b>Δεν μπορώ να διαγράψω ένα άρθρο.<\/b> Χρησιμοποιείται σε εγγραφές (live ή στον Κάδο). Άλλαξε πρώτα το άρθρο σε αυτές τις εγγραφές.<\/li>\n<li><b>Δεν βλέπω μια καρτέλα ή ένα κουμπί (WordPress).<\/b> Ο ρόλος σου δεν έχει το σχετικό δικαίωμα· ζήτα το από τον διαχειριστή.<\/li>\n<li><b>Η σελίδα φαίνεται ίδια μετά από αναβάθμιση.<\/b> Κάνε ανανέωση με Ctrl+F5.<\/li>\n<\/ul>\n\n<h3 id=\"g-new\">Τι νέο υπάρχει<\/h3>\n<ul>\n<li><b>3.4.1:<\/b> νέα εμφάνιση των τεσσάρων καρτελών: ανάγλυφα κουμπιά με δικό τους χρώμα η καθεμία (Online Renewals τιρκουάζ, Συμβάσεις μπλε, Διαγωνισμοί μωβ, Προϋπολογισμός πράσινο).<\/li>\n<li><b>3.4.0:<\/b> λογότυπο PROCURE360 στην κεφαλίδα της εφαρμογής και εικονίδιο στον Windows installer και στην καρτέλα του browser.<\/li>\n<li><b>3.3.0:<\/b> ενσωματωμένος οδηγός χρήσης (κουμπί «? Οδηγός»).<\/li>\n<li><b>3.2.0:<\/b> νέο όνομα PROCURE360.<\/li>\n<li><b>3.1.1:<\/b> ο Προϋπολογισμός περιλαμβάνει ΦΠΑ 19%.<\/li>\n<li><b>3.1.0:<\/b> καρτέλα Διαγωνισμοί, με ακύρωση και Promote σε Σύμβαση.<\/li>\n<li><b>3.0.0:<\/b> Κάδος, οριστική διαγραφή με ξεχωριστό δικαίωμα, αναίρεση, προστασία χρησιμοποιούμενων άρθρων.<\/li>\n<li><b>2.5.0:<\/b> άρθρα προϋπολογισμού σε πίνακα, με προσθήκη και διαγραφή.<\/li>\n<li><b>2.4.0:<\/b> καρτέλα Προϋπολογισμός και εξαγωγή Excel.<\/li>\n<li><b>2.3.0:<\/b> επιμέρους ποσά ανά έτος με άρθρο προϋπολογισμού.<\/li>\n<li><b>2.2.0:<\/b> αφαίρεση κωδικού πρόσβασης, πολλά emails, επιλογή και ταξινόμηση στηλών.<\/li>\n<\/ul>";/*GUIDE-END*/
function showGuide(sec){
  openPanel('<div class="ph"><h2>Οδηγός χρήσης</h2><button class="btn small" type="button" data-act="close">Κλείσιμο</button></div><div class="guide">'+GUIDE_HTML+'</div>',"guide",true);
  var e=sec&&document.getElementById("g-"+sec);if(e&&e.scrollIntoView)e.scrollIntoView();
}
function showDigest(){
  if(!$("#overlay").hidden)return;
  var list=[];
  S.items.forEach(function(i){var s=status(i);if(s.k!=="ok")list.push({cat:"sw",id:i.id,k:s.k,t:s.t,d:s.d,name:i.name,sub:fmtDate(i.dateTo)+" · "+dayText(s.d)+" · "+money(i.cost)})});
  S.contracts.forEach(function(c){var s=ctInfo(c);if(s.k!=="ok")list.push({cat:"ct",id:c.id,k:s.k,t:s.t,d:s.d,name:c.title,sub:s.sub+" · "+mc(c.cost)})});
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
  var bd=S.cat==="bd",tn=S.cat==="tn",ct=S.cat==="ct";
  $("#tabSw").setAttribute("aria-selected",String(!ct&&!bd&&!tn));$("#tabCt").setAttribute("aria-selected",String(ct));
  var tt=$("#tabTn");if(tt)tt.setAttribute("aria-selected",String(tn));
  var tb=$("#tabBd");if(tb)tb.setAttribute("aria-selected",String(bd));
  var el=ct||tn;
  $("#btnAdd").style.display=bd?"none":"";$("#btnImport").style.display=bd||tn?"none":"";
  $("#q").style.display=bd?"none":"";
  $("#cntSw").textContent=S.items.length||"";$("#cntCt").textContent=S.contracts.length||"";
  var cn=$("#cntTn");if(cn)cn.textContent=S.tenders.length||"";
  $("#btnAdd").textContent=tn?"+ Νέος διαγωνισμός":ct?"+ Νέα σύμβαση":"+ Add software";
  $("#btnImport").textContent=ct?"Εισαγωγή Excel":"Import Excel";
  $("#btnExport").textContent=bd?"Εξαγωγή Excel":el?"Εξαγωγή":"Export";
  $("#q").placeholder=tn?"Αναζήτηση διαγωνισμού, αρ. διαγωνισμού…":ct?"Αναζήτηση σύμβασης, ανάδοχου, αρ. διαγωνισμού…":"Search name, vendor, website…";
  $("#stats").setAttribute("lang",el||bd?"el":"en");
  if(bd)renderBd();else if(S.filter==="trash")renderTrash(tn?"tn":ct?"ct":"sw");else if(tn)renderTn();else if(ct)renderCt();else renderSw();
  $("#note").textContent=bd?"Ο πίνακας υπολογίζεται αυτόματα από τα επιμέρους ποσά (χωρίς ΦΠΑ στις εγγραφές· εδώ προστίθεται ΦΠΑ 19%) κάθε έτους των Συμβάσεων, των ενεργών Διαγωνισμών και των Online Renewals. Άρθρα με ανάλυση ανά έτος (ΝΑΙ): το ποσό κατανέμεται ανά μήνα στα ημερολογιακά έτη της περιόδου. Τα υπόλοιπα (ΌΧΙ): ολόκληρο στο έτος έναρξης.":tn?"Τα ποσά των ενεργών διαγωνισμών περιλαμβάνονται στον Προϋπολογισμό. Με ακύρωση ή προώθηση σε Σύμβαση αφαιρούνται από εκεί· η συμπερίληψη γίνεται πλέον μέσω της σύμβασης.":S.db?(ct?"Κοινές εγγραφές, αποθηκευμένες στον server. Οι υπενθυμίσεις στέλνονται και με email.":"Shared records, saved on the server. Reminders are also sent by email."):"Storage is not available in this view, so changes last only until you close the page. · Η αποθήκευση δεν είναι διαθέσιμη εδώ.";
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
function wbBuffer(rows,cols){
  var ws=XLSX.utils.aoa_to_sheet([HEAD].concat(rows));
  ws["!cols"]=cols||HEAD.map(function(h){return {wch:Math.max(14,h.length+2)}});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Software");
  return XLSX.write(wb,{bookType:"xlsx",type:"array"});
}
function exportXlsx(){if(needX())return;if(S.cat==="tn")return tnExportXlsx();if(S.cat==="ct")return ctExportXlsx();if(!S.items.length){toast("Nothing to export yet");return}offer("renewal-ledger-"+todayIso()+".xlsx",wbBuffer(rowsOut()))}
function exportCsv(){if(S.cat==="tn")return tnExportCsv();if(S.cat==="ct")return ctExportCsv();
  if(!S.items.length){toast("Nothing to export yet");return}
  var q=function(v){v=String(v==null?"":v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  offer("renewal-ledger-"+todayIso()+".csv","﻿"+[HEAD].concat(rowsOut()).map(function(r){return r.map(q).join(",")}).join("\r\n"));
}
function templateXlsx(){if(needX())return;if(S.cat==="ct")return ctTemplate();
  offer("renewal-ledger-template.xlsx",wbBuffer([["Example App","Team chat","Example Ltd","https://example.com","admin@example.com","2026-01-01","2026-12-31",120,30,"a@example.com, b@example.com","","","",""]]));
}
function showExport(){if(S.cat==="bd")return bdExport();if(S.cat==="tn")return tnShowExport();if(S.cat==="ct")return ctShowExport();
  openPanel('<div class="ph"><h2>Export &amp; import</h2><button class="btn small" type="button" data-act="close">Close</button></div>'+
   '<div class="sec"><h3>Export all software</h3><p class="hint">Includes every field, the reminder setting, attachment file names and the current status. Keep the file safe.</p><div class="actions"><button class="btn primary" type="button" data-act="xlsx">Excel (.xlsx)</button><button class="btn" type="button" data-act="csv">CSV</button></div></div>'+
   '<div class="sec"><h3>Import template</h3><p class="hint">Use these column headings: '+HEAD.slice(0,8).join(", ")+'. Optional: Reminder (days before), Notification emails (several separated by commas). Dates can be dd/mm/yyyy or yyyy-mm-dd.</p><div class="actions"><button class="btn" type="button" data-act="tpl">Download template</button><button class="btn" type="button" data-act="pick">Choose Excel file to import…</button></div></div>',"export");
}


/* ---------- events ---------- */
ROOT.addEventListener("click",async function(ev){
  var t=ev.target;
  if(t.id==="overlay"){closePanel();return}
  var b=t.closest("button,[data-f]");if(!b)return;
  var a=b.dataset.act;
  if(b.dataset.f&&!a){S.filter=b.dataset.f;if(S.filter==="trash")loadTrash(S.cat);render();return}
  if(b.dataset.sort)return setSort(b.dataset.sort);
  if(b.id==="btnAdd"||b.id==="emAdd")return S.cat==="tn"?tnStart():S.cat==="ct"?ctStart():startWizard();
  if(b.id==="btnImport"||b.id==="emImp"){$("#fileXlsx").click();return}
  if(b.id==="btnExport")return showExport();
  if(b.id==="emSample")return S.cat==="ct"?ctSample():loadSample();
  if(b.classList.contains("row"))return reopen(S.cat,b.dataset.id);
  if(b.dataset.copy){var it=byId(S.open);try{await navigator.clipboard.writeText(it[b.dataset.copy]||"");toast("Copied")}catch(e){toast("Copy is blocked here — select the text instead")}return}
  if(b.dataset.delfile!==undefined)return removeFile(+b.dataset.delfile);
  if(b.id==="delYes"){var id=S.open;var dc=S.openCat||"sw";if(await remove(id,dc)){closePanel();toastUndo(dc!=="sw"?"Μεταφέρθηκε στον κάδο":"Moved to the trash",function(){restoreItem(dc,id).then(function(ok){if(ok)toast(dc!=="sw"?"Η εγγραφή επαναφέρθηκε":"Record restored")})},null,dc!=="sw")}return}
  if(b.id==="delNo"){$("#delbox").innerHTML="";return}
  switch(a){
    case "close":closePanel();break;
    case "gocat":S.cat=b.dataset.cat;S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat",S.cat)}catch(e){}render();break;
    case "ctnext":ctNext();break;
    case "ctback":ctCollect();S.cw.err="";S.cw.i--;ctDraw();break;
    case "ctfull":ctCollect();S.cw.mode="full";S.cw.err="";ctDraw();break;
    case "ctstep":ctCollect();S.cw.mode="step";S.cw.i=0;S.cw.err="";ctDraw();break;
    case "ctsave":ctSave();break;
    case "ctsum":ctCollect();var cs=$("#c_cost");if(cs)cs.value=ctSum(S.cw.d.years);break;
    case "tndel":$("#delbox").innerHTML='<p class="err">Να διαγραφεί ο διαγωνισμός; Θα μεταφερθεί στον Κάδο και μπορείς να τον επαναφέρεις.</p><div class="actions"><button class="btn danger" type="button" id="delYes">Ναι, μεταφορά στον κάδο</button><button class="btn" type="button" id="delNo">Άκυρο</button></div>';break;
    case "tncancel":$("#delbox").innerHTML='<p class="err">Να ακυρωθεί ο διαγωνισμός; Θα αποθηκευτεί για αναφορά και τα ποσά του θα αφαιρεθούν από τον Προϋπολογισμό.</p><div class="actions"><button class="btn danger" type="button" data-act="tncancelyes">Ναι, ακύρωση και αποθήκευση για αναφορά</button><button class="btn" type="button" id="delNo">Όχι</button></div>';break;
    case "tncancelyes":tnSetStatus(S.open,"cancelled");break;
    case "tnreopen":tnSetStatus(S.open,"active");break;
    case "tnpromote":tnPromoteStart(S.open);break;
    case "gocontract":{var gid=b.dataset.id;S.cat="ct";S.filter="all";S.q="";$("#q").value="";try{localStorage.setItem("rl.cat","ct")}catch(e){}render();showCtDetail(gid);break}
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
    case "artadd":{var rows=$("#artRows");rows.insertAdjacentHTML("beforeend",artRow());var ins=rows.querySelectorAll("tr");ins[ins.length-1].querySelector("input").focus();break}
    case "artdel":{var tr=b.closest("tr"),cd=tr&&tr.querySelector("[data-k=code]"),us=cd&&cd.defaultValue?artUsage(cd.defaultValue):0;
      if(us){toast(S.cat!=="sw"?"Το άρθρο χρησιμοποιείται σε "+us+" εγγραφές και δεν μπορεί να διαγραφεί":"This article is used by "+us+" record(s) and cannot be deleted");break}
      if(tr)tr.remove();break}
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
    case "edit":S.openCat==="tn"?tnStart(S.open):S.openCat==="ct"?ctStart(S.open):startWizard(S.open);break;
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
  if(ev.key==="Escape"&&!$("#overlay").hidden)closePanel();
  if(ev.key==="Enter"&&S.cw&&S.cw.mode==="step"&&ev.target.tagName==="INPUT"){ev.preventDefault();S.cw.i===cwBase().length?ctSave():ctNext()}
  if(ev.key==="Enter"&&S.wiz&&S.wiz.mode==="step"&&ev.target.tagName==="INPUT"){ev.preventDefault();var l=S.wiz.i===FIELDS.length;l?wizSave():wizNext()}
});
ROOT.addEventListener("input",function(ev){var t=ev.target;if(t&&t.id&&t.id.indexOf("bp_amt_")===0)bpLive()});
ROOT.addEventListener("change",async function(ev){
  var t=ev.target;
  if(t.id==="bdArt"){S.bdArt=t.value;try{localStorage.setItem("rl.bdart",t.value)}catch(e){}render();return}
  if(t.dataset&&t.dataset.col){toggleCol(t.dataset.col,t.checked);return}
  if(t.id&&t.id.indexOf("bp_amt_")===0){bpLive();return}
  if(t.id==="remSel"){var it=byId(S.open);if(it){var rec=norm(it);rec.remindDays=+t.value;rec.attachments=it.attachments;rec.history=it.history;rec.createdAt=it.createdAt;rec.sample=it.sample;if(await save(it.id,rec))toast("Reminder set to "+t.value+" days before expiry")}}
  if(t.id==="fileXlsx"&&t.files[0]){
    var f=t.files[0];t.value="";
    try{if(needX())return;var buf=await f.arrayBuffer();var ct=S.cat==="ct";var rows=ct?parseCtSheet(buf):parseSheet(buf);if(!rows.length){toast(ct?"Δεν βρέθηκαν γραμμές στο πρώτο φύλλο":"No rows found in the first sheet");return}ct?showCtImport(rows):showImport(rows)}
    catch(e){toast("Could not read that file")}
  }
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
  try{var rc=localStorage.getItem("rl.cat");if(rc==="ct"||rc==="bd"||rc==="tn")S.cat=rc}catch(e){}
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
      var sub=function(name,cat,key){return col(name).onSnapshot(function(snap){var all=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())});S[key]=all.filter(function(x){return !x.deletedAt});if(!window.RL_TRASH)S.trash[cat]=all.filter(function(x){return x.deletedAt}).map(function(x){return Object.assign({},x,{_at:x.deletedAt})});S.loaded[cat]=true;if(key==="items")purgePasswords();if(S.loaded.sw&&S.loaded.ct&&S.loaded.tn&&!S.tinit){S.tinit=1;if(window.RL_TRASH){loadTrash("sw");loadTrash("ct");loadTrash("tn")}else autoPurge()}render();maybeDigest()},function(){toast("Live sync stopped — reload the page")})};
      S.unsub=[sub("software","sw","items"),sub("contracts","ct","contracts"),sub("tenders","tn","tenders")];
    }
  }catch(e){}
  render();
}
start();
})();
