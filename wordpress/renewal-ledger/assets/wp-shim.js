/* Renewal Ledger - storage layer for WordPress.
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
  var cache={},subs=[],loaded={};
  function snapFor(name){
    var m=cache[name]||{},ids=Object.keys(m);
    var docs=ids.map(function(id){var v=m[id];return {id:id,exists:true,data:function(){return v}}});
    return {docs:docs,size:docs.length,empty:!docs.length};
  }
  function notify(name){subs.forEach(function(l){if(l.name===name){try{l.cb(snapFor(name))}catch(e){console.error(e)}}})}
  function refresh(name,first,errcb){
    return api("GET","records/"+name).then(function(res){
      var m={};(res.items||[]).forEach(function(it){m[it.id]=it.data});
      var changed=JSON.stringify(m)!==JSON.stringify(cache[name]||{});
      cache[name]=m;
      if(changed||first)notify(name);
    },function(e){if(first&&errcb)errcb(e)});
  }
  function colRef(name){
    return {
      doc:function(id){return {
        set:function(d){var v=JSON.parse(JSON.stringify(d));return api("PUT","records/"+name+"/"+id,{data:v}).then(function(){(cache[name]=cache[name]||{})[id]=v;notify(name)})},
        delete:function(){return api("DELETE","records/"+name+"/"+id).then(function(){if(cache[name])delete cache[name][id];notify(name)})}
      }},
      onSnapshot:function(cb,errcb){
        var l={name:name,cb:cb};subs.push(l);
        refresh(name,true,errcb);
        return function(){subs=subs.filter(function(x){return x!==l})};
      }
    };
  }
  /* the page asks for db.doc("data/users/<id>/app").collection("software") */
  var db={doc:function(){return {collection:function(n){return colRef(n)}}},collection:colRef};
  /* other users change the same records: refresh every 60 s while the tab is visible */
  setInterval(function(){
    if(document.hidden)return;
    var seen={};subs.forEach(function(l){if(!seen[l.name]){seen[l.name]=1;refresh(l.name,false)}});
  },60000);
  var assets={
    upload:function(blob){
      if(!(blob instanceof Blob)||!blob.size)return Promise.reject({code:"invalid_request",message:"empty file"});
      var fd=new FormData();fd.append("file",blob,blob.name||"file");
      return api("POST","files",fd,true).then(function(r){return {id:r.id,url:"#",sizeBytes:r.size,contentType:r.type}},function(e){
        var m={rl_too_large:"too_large",rl_bad_type:"unsupported_type"};
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
  document.addEventListener("click",function(e){
    var a=e.target.closest&&e.target.closest("a[data-blob]");if(!a)return;
    e.preventDefault();
    var w=window.open("","_blank");
    fetch(cfg.rest+"files/"+a.getAttribute("data-blob"),{credentials:"same-origin",headers:{"X-WP-Nonce":cfg.nonce||""}}).then(function(r){
      if(!r.ok)throw new Error(r.status);return r.blob();
    }).then(function(b){
      var u=URL.createObjectURL(b);
      if(w){w.location.href=u}else{var d=document.createElement("a");d.href=u;d.download=a.textContent||"file";document.body.appendChild(d);d.click();d.remove()}
    }).catch(function(){if(w)w.close();alert("Το αρχείο δεν βρέθηκε ή δεν έχεις δικαίωμα. / File not found or access denied.")});
  });
})();
