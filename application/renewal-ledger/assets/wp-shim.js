/* PROCURE360 - storage layer for WordPress.
   Same small API the page expects (db, user, assets, downloads), backed by the plugin's REST routes (MySQL + protected uploads folder). */
(function(){
  var cfg=window.RL_CFG||{};
  function api(method,path,body,isForm){
    var opts={method:method,credentials:"same-origin",headers:{"X-WP-Nonce":cfg.nonce||"","Accept":"application/json"}};
    if(body!==undefined&&!isForm){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body)}
    if(isForm)opts.body=body;
    return fetch(cfg.rest+path,opts).then(function(r){
      return r.json().catch(function(){return {}}).then(function(j){
        if(!r.ok)throw {code:(j&&j.code)||"unavailable",message:(j&&j.message)||r.statusText,status:r.status};
        return j;
      });
    });
  }
  window.RL_SAVE_ARTICLES=function(list){return api("PUT","articles",{articles:list})};
  window.RL_SAVE_SETTINGS=function(obj){return api("PUT","settings",{settings:obj})};
  window.RL_NOTE_TPL={get:function(){return api("GET","note-template")},save:function(name,data){return api("PUT","note-template",{name:name,data:data})},reset:function(){return api("DELETE","note-template")}};
  window.RL_AUTO_TN={run:function(){return api("POST","auto-tenders/run",{})}};
  window.RL_BACKUP_SCHEDULE={get:function(){return api("GET","backup-schedule")},save:function(o){return api("PUT","backup-schedule",{schedule:o})},run:function(){return api("POST","backup-schedule/run",{})}};
  var perms=cfg.perms||{};
  function curColl(){
    var t=document.getElementById("tabCt"),n=document.getElementById("tabTn"),k=document.getElementById("tabCo"),pv=document.getElementById("tabPv");
    if(pv&&pv.getAttribute("aria-selected")==="true")return "provisions";
    if(k&&k.getAttribute("aria-selected")==="true")return "contractors";
    return n&&n.getAttribute("aria-selected")==="true"?"tenders":t&&t.getAttribute("aria-selected")==="true"?"contracts":"software";
  }
  function onBd(){var t=document.getElementById("tabBd");return !!t&&t.getAttribute("aria-selected")==="true"}
  function onSt(){var t=document.getElementById("tabSt");return !!t&&t.getAttribute("aria-selected")==="true"}
  function onRc(){var t=document.getElementById("tabRc");return !!t&&t.getAttribute("aria-selected")==="true"}
  function onAr(){var t=document.getElementById("tabAr");return !!t&&t.getAttribute("aria-selected")==="true"}
  function P(c,a){return !!(perms[c]&&perms[c][a])}
  /* Record owners (3.21): in these modules a user without "view_all" only gets the records he or she owns. */
  var OWN={software:1,contracts:1,tenders:1,provisions:1};
  function restricted(c){return !!OWN[c]&&P(c,"view")&&!P(c,"view_all")}
  function anyRestricted(){return restricted("software")||restricted("contracts")||restricted("tenders")||restricted("provisions")}
  var cache={},subs=[],loaded={};
  function snapFor(name){
    var m=cache[name]||{},ids=Object.keys(m);
    var docs=ids.map(function(id){var v=m[id];return {id:id,exists:true,data:function(){return v}}});
    return {docs:docs,size:docs.length,empty:!docs.length};
  }
  function notify(name){subs.forEach(function(l){if(l.name===name){try{l.cb(snapFor(name))}catch(e){console.error(e)}}})}
  function refresh(name,first,errcb){
    return api("GET","records/"+name).then(function(res){
      var m={};(res.items||[]).forEach(function(it){m[it.id]=OWN[name]?Object.assign({},it.data,{_owner:it.owner||0,_ownerName:it.ownerName||""}):it.data});
      var changed=JSON.stringify(m)!==JSON.stringify(cache[name]||{});
      cache[name]=m;
      if(changed||first)notify(name);
    },function(e){if(first&&errcb)errcb(e)});
  }
  function colRef(name){
    return {
      doc:function(id){return {
        set:function(d){
          var v=JSON.parse(JSON.stringify(d)),ow=Number(v._owner)||0,body;
          delete v._owner;delete v._ownerName;
          body={data:v};if(OWN[name]&&ow>0)body.ownerId=ow;
          return api("PUT","records/"+name+"/"+id,body).then(function(){
            var old=(cache[name]||{})[id]||{};
            if(OWN[name]){v._owner=ow>0?ow:(old._owner||Number(cfg.userId)||0);v._ownerName=ow>0&&owners.names[ow]||old._ownerName||""}
            (cache[name]=cache[name]||{})[id]=v;notify(name);
            /* the owner may have changed: a user who sees only his or her own records no longer sees a record given to somebody else */
            if(OWN[name])refresh(name,false);
          })
        },
        delete:function(){return api("DELETE","records/"+name+"/"+id).then(function(){if(cache[name])delete cache[name][id];notify(name)})}
      }},
      onSnapshot:function(cb,errcb){
        /* a module the user may not view is simply empty (the server would answer 403) */
        if(!P(name,"view")){cache[name]={};setTimeout(function(){cb(snapFor(name))},0);return function(){}}
        var l={name:name,cb:cb};subs.push(l);
        refresh(name,true,errcb);
        return function(){subs=subs.filter(function(x){return x!==l})};
      }
    };
  }
  /* Owners: who can own records (users with access to the application), and the administrator's screen that assigns records that have no owner. */
  var owners={names:{},list:null};
  window.RL_OWN={
    me:Number(cfg.userId)||0,
    restricted:restricted,
    anyRestricted:anyRestricted,
    canAssign:!!cfg.canManage,
    users:function(){
      if(owners.list)return Promise.resolve(owners.list);
      return api("GET","owners").then(function(r){owners.list=r.items||[];owners.list.forEach(function(u){owners.names[u.id]=u.name});return owners.list},function(){owners.list=[];return owners.list});
    },
    name:function(id){return owners.names[id]||""},
    unassigned:function(){return api("GET","owners/unassigned")},
    assign:function(items){return api("POST","owners/assign",{items:items}).then(function(r){return Promise.all(["software","contracts","tenders","provisions"].map(function(n){return refresh(n,false)})).then(function(){return r})})}
  };
  /* Trash: deleting a record moves it to the trash on the server. These calls list, restore and permanently delete from it. */
  function url(path,params){return path+(cfg.rest.indexOf("?")>=0?"&":"?")+params}
  window.RL_TRASH={
    can:function(c){return P(c,"delete")},
    canPurge:function(c){return P(c,"purge")},
    days:cfg.trashDays||0,
    list:function(c){return api("GET",url("records/"+c,"trash=1")).then(function(r){return (r.items||[]).map(function(it){return {id:it.id,data:it.data,at:Date.parse(String(it.deleted_at).replace(" ","T")+"Z")||0,by:it.deleted_by||""}})})},
    restore:function(c,id){return api("POST","records/"+c+"/"+id+"/restore").then(function(){return refresh(c,false)})},
    purge:function(c,id){return api("DELETE",url("records/"+c+"/"+id,"purge=1"))}
  };
  /* Promote a tender to a contract in one server step (the server copies the attachments and marks the tender as promoted). */
  window.RL_PROMOTE=function(tid,cid,rec){
    var body={contractId:cid,data:JSON.parse(JSON.stringify(rec))},ow=Number(body.data._owner)||0;
    delete body.data._owner;delete body.data._ownerName;if(ow>0)body.ownerId=ow;
    return api("POST","records/tenders/"+tid+"/promote",body).then(function(){return Promise.all([refresh("contracts",false),refresh("tenders",false)])});
  };
  /* the page asks for db.doc("data/users/<id>/app").collection("software") */
  var db={doc:function(){return {collection:function(n){return colRef(n)}}},collection:colRef};
  /* other users change the same records: refresh every 60 s while the tab is visible */
  setInterval(function(){
    if(document.hidden)return;
    var seen={};subs.forEach(function(l){if(!seen[l.name]){seen[l.name]=1;refresh(l.name,false)}});
  },60000);
  var assets={
    read:function(id){return fetch(cfg.rest+"files/"+id,{credentials:"same-origin",headers:{"X-WP-Nonce":cfg.nonce||""}}).then(function(r){if(!r.ok)throw new Error(r.status);return r.blob()})},
    upload:function(blob,opts){
      if(!(blob instanceof Blob)||!blob.size)return Promise.reject({code:"invalid_request",message:"empty file"});
      var fd=new FormData();fd.append("file",blob,blob.name||"file");fd.append("coll",(opts&&opts.coll)||curColl());
      return api("POST","files",fd,true).then(function(r){return {id:r.id,url:"#",sizeBytes:r.size,contentType:r.type}},function(e){
        var m={rl_too_large:"too_large",rl_bad_type:"unsupported_type",rl_bad_content:"bad_content",rl_infected:"infected",rl_av_unavailable:"av_unavailable"};
        /* PHP drops a request bigger than post_max_size before WordPress sees it, so the server then only reports a missing field */
        if((e.code==="rl_bad_coll"||e.code==="rl_no_file")&&cfg.maxUpload&&blob.size>cfg.maxUpload)throw {code:"too_large",message:e.message};
        throw {code:m[e.code]||e.code||"upstream_error",message:e.message};
      });
    },
    delete:function(id){return api("DELETE","files/"+id).then(function(){return {deleted:true}})}
  };
  var downloads={
    save:function(o){
      var type=/\.xlsx$/i.test(o.filename)?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":/\.csv$/i.test(o.filename)?"text/csv;charset=utf-8":"application/octet-stream";
      var blob=o.data instanceof Blob?o.data:new Blob([o.data],{type:type});
      var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=o.filename;document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
      return Promise.resolve({status:"saved"});
    }
  };
  var user={id:function(){return Promise.resolve(String(cfg.userId||"wp"))}};
  window.claude={use:function(n){
    if(n==="db")return Promise.resolve(db);
    if(n==="assets")return Promise.resolve(assets);
    if(n==="downloads")return Promise.resolve(downloads);
    if(n==="user")return Promise.resolve(user);
    return Promise.resolve(null);
  }};
  /* attachments are private: fetch with the login nonce, then open the file */
  function isHtmlFile(name,type){return /\.(html?|xml)$/i.test(name||"")||/^(text\/html|application\/xml|text\/xml)/i.test(type||"")}
  function saveAs(b,name){var d=document.createElement("a");d.href=URL.createObjectURL(new Blob([b],{type:"application/octet-stream"}));d.download=name||"file.html";document.body.appendChild(d);d.click();setTimeout(function(){URL.revokeObjectURL(d.href);d.remove()},1500)}
  document.addEventListener("click",function(e){
    var a=e.target.closest&&e.target.closest("a[data-blob]");if(!a)return;
    e.preventDefault();
    /* every attachment is downloaded under its own file name (never opened in a tab, where it would get a generated name) */
    fetch(cfg.rest+"files/"+a.getAttribute("data-blob"),{credentials:"same-origin",headers:{"X-WP-Nonce":cfg.nonce||""}}).then(function(r){
      if(!r.ok)throw new Error(r.status);return r.blob();
    }).then(function(b){saveAs(b,a.textContent)}).catch(function(){alert("Το αρχείο δεν βρέθηκε ή δεν έχεις δικαίωμα. / File not found or access denied.")});
  });

  /* Convenience only: hide what the user may not do. The server enforces every one of these again on each request. */
  var gating=false;
  /* Only write when the value changes: re-setting `hidden` to true queues a mutation record every time, and the observer below would then call gate() forever. */
  function hide(sel,root,yes){[].forEach.call(root.querySelectorAll(sel),function(n){var d=yes?"none":"";if(n.hidden!==yes)n.hidden=yes;if(n.style.display!==d)n.style.display=d})}
  function gate(){
    if(gating)return;gating=true;
    try{
      var root=document.getElementById("rl-app");if(!root)return;
      var c=curColl();
      var bdt=document.getElementById("tabBd");
      /* The budget and the reconciliation table add up ALL the records: they are not offered to a user who sees only his or her own. */
      var noTotals=anyRestricted();
      var anyView=P("software","view")||P("contracts","view")||P("tenders","view")||P("contractors","view")||P("provisions","view");
      if(bdt)bdt.style.display=anyView&&!noTotals?"":"none";
      var art=document.getElementById("tabAr");if(art)art.style.display=anyView?"":"none";
      var stt=document.getElementById("tabSt");if(stt)stt.style.display=cfg.canManage?"":"none";
      var rct=document.getElementById("tabRc");if(rct)rct.style.display=anyView&&!noTotals?"":"none";
      if(noTotals&&(onBd()||onRc())){setTimeout(function(){var x=document.getElementById("tabSw");x&&x.click()},0);return}
      var pvt=document.getElementById("tabPv");if(pvt)pvt.style.display=P("provisions","view")?"":"none";
      if(onRc()){
        /* the reconciliation table is calculated from tenders and contracts; nothing to add or import */
        hide("#btnAdd,#emAdd,#btnImport,#emImp",root,true);
        hide("#btnExport",root,!(P("contracts","export")||P("tenders","export")));
        if(!anyView)setTimeout(function(){var x=document.getElementById("tabSw");x&&x.click()},0);
        return;
      }
      if(onSt()){hide("#btnAdd,#emAdd,#btnImport,#emImp,#btnExport",root,true);return}
      if(onAr()){
        /* the article list is reference data for everyone who can view something; editing happens in the WordPress settings */
        hide("#btnAdd,#emAdd,#btnImport,#emImp,#btnExport",root,true);
        if(!anyView)setTimeout(function(){var x=document.getElementById("tabSw");x&&x.click()},0);
        return;
      }
      if(onBd()){
        /* budget sheet is calculated from the records the user may view; nothing to add or import here */
        hide("#btnAdd,#emAdd,#btnImport,#emImp",root,true);
        hide("#btnExport",root,!(P("software","export")||P("contracts","export")||P("tenders","export")));
        if(!anyView)setTimeout(function(){var x=document.getElementById("tabSw");x&&x.click()},0);
        return;
      }
      hide("#btnAdd,#emAdd,[data-act=pick],[data-act=tpl],[data-act=ctsample],#emSample",root,!P(c,"create"));
      hide("#btnImport,#emImp",root,!P(c,"create")||c==="tenders"||c==="contractors"||c==="provisions"); /* tenders and contractors have no Excel import */
      hide("[data-act=coaddfromct],[data-act=coaddlegacy]",root,!P("contractors","create"));
      hide("[data-act=comigrate]",root,!(P("contractors","create")&&P("contracts","edit")));
      hide("#btnExport",root,!P(c,"export"));
      hide("[data-act=xlsx],[data-act=csv]",root,!P(c,"export"));
      hide("[data-act=edit],[data-act=renew],[data-act=renewid],[data-act=attach],[data-act=rsave],[data-act=msadd],[data-act=msedit],[data-act=msdel],[data-act=msdone]",root,!P(c,"edit"));
      hide("[data-act=del],[data-act=ctdel],[data-act=tndel],[data-act=codel],[data-act=pvdel]",root,!P(c,"delete"));
      hide("[data-act=tncancel],[data-act=tncancelyes],[data-act=tnreopen]",root,!P("tenders","edit"));
      hide("[data-act=tnpromote]",root,!(P("tenders","edit")&&P("contracts","create")));
      hide("[data-f=trash],[data-act=trrestore]",root,!P(c,"delete"));
      hide("[data-act=trpurge]",root,!P(c,"purge"));
      var sw=document.getElementById("tabSw"),ct=document.getElementById("tabCt"),tn=document.getElementById("tabTn"),co=document.getElementById("tabCo");
      if(co)co.style.display=P("contractors","view")?"":"none";
      if(sw)sw.style.display=P("software","view")?"":"none";
      if(ct)ct.style.display=P("contracts","view")?"":"none";
      if(tn)tn.style.display=P("tenders","view")?"":"none";
      if(!P(c,"view")){var vis=[sw,ct,tn,co,pvt].filter(function(x){return x&&x.style.display!=="none"});if(vis[0])setTimeout(function(){vis[0].click()},0)}
    }finally{gating=false}
  }
  document.addEventListener("DOMContentLoaded",function(){
    var root=document.getElementById("rl-app");if(!root)return;
    /* use the full browser width instead of the theme's narrow content column */
    var sbw=window.innerWidth-document.documentElement.clientWidth;root.style.setProperty("--rl-sbw",Math.max(0,sbw)+"px");root.classList.add("rl-wide");
    window.addEventListener("resize",function(){root.style.setProperty("--rl-sbw",Math.max(0,window.innerWidth-document.documentElement.clientWidth)+"px")});
    new MutationObserver(function(){gate()}).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["aria-selected","hidden"]});
    gate();
  });
  /* Exports come from the server, so the Export permission is really enforced and Excel/CSV content matches it. */
  document.addEventListener("click",function(e){
    var b=e.target.closest&&e.target.closest("[data-act=xlsx],[data-act=csv]");
    if(!b||!cfg.serverExport||curColl()==="provisions")return;
    e.preventDefault();e.stopImmediatePropagation();
    var fmt=b.getAttribute("data-act"),c=curColl();
    fetch(cfg.rest+"export/"+c+"?format="+fmt,{credentials:"same-origin",headers:{"X-WP-Nonce":cfg.nonce||""}}).then(function(r){
      if(!r.ok)throw new Error(r.status);
      var cd=r.headers.get("Content-Disposition")||"",m=/filename="([^"]+)"/.exec(cd);
      return r.blob().then(function(bl){return {bl:bl,name:m?m[1]:"export."+fmt}});
    }).then(function(o){
      var a=document.createElement("a");a.href=URL.createObjectURL(o.bl);a.download=o.name;document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    }).catch(function(){alert("Η εξαγωγή απέτυχε ή δεν έχεις δικαίωμα. / Export failed or not permitted.")});
  },true);
})();
