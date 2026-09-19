(function(){
'use strict';

var RT = {
  admin:false, mobile:false, initialized:false, es:null, snapshot:null, events:[],
  wizardStep:0, setup:null, tested:{radarr:null,sonarr:null,tmdb:null}
};

function q(id){ return document.getElementById(id); }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function fmtTime(ts){ if(!ts) return '—'; try{return new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch(_){return '';} }
function ago(ts){ if(!ts) return 'never'; var s=Math.max(0,Math.round((Date.now()-ts)/1000)); if(s<5)return 'now'; if(s<60)return s+'s ago'; if(s<3600)return Math.floor(s/60)+'m ago'; return Math.floor(s/3600)+'h ago'; }
function api(url,opts){ return fetch(url,opts||{}).then(async function(r){ var t=''; try{t=await r.text();}catch(_){} var d={}; try{d=t?JSON.parse(t):{};}catch(_){} if(!r.ok) throw new Error(d.message||('HTTP '+r.status)); return d; }); }
function post(url,body){ return api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}); }

function addStyles(){
  if(q('rt140Style')) return;
  var s=document.createElement('style'); s.id='rt140Style';
  s.textContent=[
    '.rt140-overlay{position:fixed;inset:0;z-index:12000;background:rgba(3,7,14,.76);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:18px}',
    '.rt140-overlay.show{display:flex}.rt140-panel{width:min(1120px,96vw);max-height:92vh;overflow:auto;background:var(--panel,#111826);color:var(--txt,#eef3ff);border:1px solid var(--line,#2a3447);border-radius:18px;box-shadow:0 30px 100px rgba(0,0,0,.55)}',
    '.rt140-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line,#2a3447);position:sticky;top:0;background:var(--panel,#111826);z-index:2}',
    '.rt140-title{font-size:20px;font-weight:900}.rt140-sub{font-size:12px;color:var(--muted,#8f9bb3);margin-top:3px}.rt140-actions{display:flex;gap:8px;flex-wrap:wrap}',
    '.rt140-btn{border:1px solid var(--line,#2a3447);background:var(--panel2,#192234);color:var(--txt,#eef3ff);border-radius:9px;padding:8px 12px;font-weight:800;cursor:pointer}.rt140-btn.primary{background:var(--gold,#d9a441);color:#17120a;border-color:var(--gold,#d9a441)}.rt140-btn:hover{filter:brightness(1.08)}',
    '.rt140-body{padding:18px 20px 24px}.rt140-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.rt140-card{border:1px solid var(--line,#2a3447);background:var(--panel2,#192234);border-radius:13px;padding:14px;min-width:0}.rt140-k{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted,#8f9bb3);font-weight:900}.rt140-v{font-size:24px;font-weight:900;margin-top:4px;overflow:hidden;text-overflow:ellipsis}.rt140-note{font-size:11px;color:var(--muted,#8f9bb3);margin-top:4px}',
    '.rt140-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:#78849a}.rt140-dot.up{background:#35d07f}.rt140-dot.down{background:#ff5f68}',
    '.rt140-section{margin-top:18px}.rt140-section h3{font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;color:var(--muted,#8f9bb3)}',
    '.rt140-events{border:1px solid var(--line,#2a3447);border-radius:13px;overflow:hidden}.rt140-event{display:grid;grid-template-columns:90px 130px 1fr;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line,#2a3447);font-size:12px}.rt140-event:last-child{border-bottom:0}.rt140-event-kind{font-weight:900;color:var(--gold,#d9a441)}',
    '.rt140-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;word-break:break-all;padding:10px;border:1px solid var(--line,#2a3447);background:var(--bg,#0c111b);border-radius:9px;margin:6px 0}.rt140-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}',
    '.rt140-wizard{width:min(780px,96vw)}.rt140-steps{display:flex;gap:5px;padding:14px 20px;border-bottom:1px solid var(--line,#2a3447)}.rt140-stepdot{height:5px;flex:1;background:var(--line,#2a3447);border-radius:10px}.rt140-stepdot.on{background:var(--gold,#d9a441)}',
    '.rt140-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.rt140-field{display:flex;flex-direction:column;gap:5px}.rt140-field.full{grid-column:1/-1}.rt140-field label{font-size:11px;font-weight:800;color:var(--muted,#8f9bb3)}.rt140-field input,.rt140-field select{background:var(--bg,#0c111b);color:var(--txt,#eef3ff);border:1px solid var(--line,#2a3447);border-radius:9px;padding:10px}.rt140-test{font-size:12px;margin-top:7px}.rt140-ok{color:#35d07f}.rt140-bad{color:#ff6b73}',
    '.rt140-welcome{padding:12px 0 6px}.rt140-welcome h2{font-size:28px;margin:0 0 8px}.rt140-welcome p{color:var(--muted,#8f9bb3);line-height:1.55}.rt140-foot{display:flex;justify-content:space-between;gap:10px;margin-top:20px;padding-top:15px;border-top:1px solid var(--line,#2a3447)}',
    '.rt140-live{font-size:11px;font-weight:900;color:#35d07f}.rt140-live.off{color:#ff6b73}',
    '@media(max-width:760px){.rt140-overlay{padding:0}.rt140-panel{width:100vw;max-height:100vh;height:100vh;border-radius:0}.rt140-grid{grid-template-columns:1fr 1fr}.rt140-form{grid-template-columns:1fr}.rt140-field.full{grid-column:auto}.rt140-event{grid-template-columns:64px 100px 1fr}.rt140-head{padding:14px}.rt140-body{padding:14px}}'
  ].join('');
  document.head.appendChild(s);
}

function ensureDashboard(){
  if(q('rtDashboard')) return;
  var o=document.createElement('div'); o.id='rtDashboard'; o.className='rt140-overlay';
  o.innerHTML=
    '<div class="rt140-panel">'+
      '<div class="rt140-head"><div><div class="rt140-title">Live Dashboard</div><div class="rt140-sub">SSE-powered MEDIARR activity · Radarr/Sonarr webhooks · no browser polling</div></div>'+
      '<div class="rt140-actions"><span id="rtConn" class="rt140-live off">● disconnected</span><button class="rt140-btn" id="rtSetupBtn">Setup wizard</button><button class="rt140-btn" id="rtClose">Close</button></div></div>'+
      '<div class="rt140-body">'+
        '<div class="rt140-grid">'+
          '<div class="rt140-card"><div class="rt140-k">Radarr</div><div class="rt140-v" id="rtRadarr">—</div><div class="rt140-note" id="rtRadarrNote"></div></div>'+
          '<div class="rt140-card"><div class="rt140-k">Sonarr</div><div class="rt140-v" id="rtSonarr">—</div><div class="rt140-note" id="rtSonarrNote"></div></div>'+
          '<div class="rt140-card"><div class="rt140-k">Plex</div><div class="rt140-v" id="rtPlex">—</div><div class="rt140-note" id="rtPlexNote"></div></div>'+
          '<div class="rt140-card"><div class="rt140-k">Live clients</div><div class="rt140-v" id="rtClients">0</div><div class="rt140-note">SSE dashboard connections</div></div>'+
          '<div class="rt140-card"><div class="rt140-k">Movies</div><div class="rt140-v" id="rtMovies">0</div><div class="rt140-note" id="rtMoviesNote"></div></div>'+
          '<div class="rt140-card"><div class="rt140-k">TV shows</div><div class="rt140-v" id="rtShows">0</div><div class="rt140-note" id="rtShowsNote"></div></div>'+
          '<div class="rt140-card"><div class="rt140-k">MEDIARR transcodes</div><div class="rt140-v" id="rtTranscodes">0</div><div class="rt140-note">active/remux/HLS sessions</div></div>'+
          '<div class="rt140-card"><div class="rt140-k">Last event</div><div class="rt140-v" style="font-size:15px" id="rtLastEvent">—</div><div class="rt140-note" id="rtLastEventTime"></div></div>'+
        '</div>'+
        '<div class="rt140-section"><h3>Radarr / Sonarr webhook endpoints</h3><div id="rtWebhookBox"></div></div>'+
        '<div class="rt140-section"><h3>Live event feed</h3><div id="rtEvents" class="rt140-events"></div></div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(o);
  q('rtClose').onclick=closeDashboard;
  q('rtSetupBtn').onclick=function(){ openWizard(false); };
  o.addEventListener('click',function(e){if(e.target===o)closeDashboard();});
}

function servicePaint(name,id,noteId){
  var st=RT.snapshot && RT.snapshot.services && RT.snapshot.services[name];
  var el=q(id), note=q(noteId); if(!el)return;
  if(!st){el.innerHTML='<span class="rt140-dot"></span>Not configured'; if(note)note.textContent=''; return;}
  el.innerHTML='<span class="rt140-dot '+(st.up?'up':'down')+'"></span>'+(st.up?'Online':'Offline');
  if(note)note.textContent=(st.version?('v'+st.version+' · '):'')+(st.responseMs!=null?st.responseMs+' ms · ':'')+ago(st.lastChecked);
}
function renderDashboard(){
  var s=RT.snapshot||{};
  servicePaint('radarr','rtRadarr','rtRadarrNote');
  servicePaint('sonarr','rtSonarr','rtSonarrNote');
  servicePaint('plex','rtPlex','rtPlexNote');
  if(q('rtClients'))q('rtClients').textContent=s.clients==null?'0':String(s.clients);
  var r=s.libraries&&s.libraries.radarr||{}, so=s.libraries&&s.libraries.sonarr||{};
  if(q('rtMovies'))q('rtMovies').textContent=String(r.count||0);
  if(q('rtShows'))q('rtShows').textContent=String(so.count||0);
  if(q('rtMoviesNote'))q('rtMoviesNote').textContent=r.ts?'updated '+ago(r.ts):'no cache yet';
  if(q('rtShowsNote'))q('rtShowsNote').textContent=so.ts?'updated '+ago(so.ts):'no cache yet';
  if(q('rtTranscodes'))q('rtTranscodes').textContent=String((s.transcodes||[]).length);
  var ev=RT.events[0]||(s.recent&&s.recent[0]);
  if(q('rtLastEvent'))q('rtLastEvent').textContent=ev?ev.kind:'—';
  if(q('rtLastEventTime'))q('rtLastEventTime').textContent=ev?ago(ev.ts):'';
  var list=RT.events.length?RT.events:(s.recent||[]);
  if(q('rtEvents')){
    q('rtEvents').innerHTML=list.slice(0,40).map(function(e){
      var d=e.data||{}, desc=d.title||d.eventType||d.service||d.user||'';
      if(d.service&&d.eventType)desc=d.service+' · '+d.eventType+(d.title?' · '+d.title:'');
      return '<div class="rt140-event"><div>'+fmtTime(e.ts)+'</div><div class="rt140-event-kind">'+esc(e.kind)+'</div><div>'+esc(desc)+'</div></div>';
    }).join('') || '<div class="rt140-event"><div>—</div><div class="rt140-event-kind">waiting</div><div>Webhook and MEDIARR events will appear here live.</div></div>';
  }
}
function renderWebhooks(w){
  if(!q('rtWebhookBox')||!w)return;
  q('rtWebhookBox').innerHTML=
    '<div class="rt140-row"><div class="rt140-code">'+esc(w.radarrUrl||'')+'</div><button class="rt140-btn" data-copy="'+esc(w.radarrUrl||'')+'">Copy Radarr</button></div>'+
    '<div class="rt140-row"><div class="rt140-code">'+esc(w.sonarrUrl||'')+'</div><button class="rt140-btn" data-copy="'+esc(w.sonarrUrl||'')+'">Copy Sonarr</button></div>'+
    '<div class="rt140-note">In Radarr/Sonarr: Settings → Connect → + → Webhook. Use the URL above and enable the events you want MEDIARR to receive.</div>';
  q('rtWebhookBox').querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy'));b.textContent='Copied';setTimeout(function(){b.textContent=b.getAttribute('data-copy').indexOf('/radarr?')>=0?'Copy Radarr':'Copy Sonarr';},1200);};});
}
async function openDashboard(){
  ensureDashboard(); q('rtDashboard').classList.add('show');
  try{
    var d=await api('/api/admin/realtime/status');
    RT.snapshot=d; RT.events=d.recent||[]; renderDashboard(); renderWebhooks(d.webhooks);
  }catch(e){ if(q('rtEvents'))q('rtEvents').innerHTML='<div class="rt140-event"><div></div><div class="rt140-event-kind">error</div><div>'+esc(e.message)+'</div></div>'; }
  connectSse();
}
function closeDashboard(){
  if(q('rtDashboard'))q('rtDashboard').classList.remove('show');
  if(RT.es){RT.es.close();RT.es=null;}
  var c=q('rtConn');if(c){c.className='rt140-live off';c.textContent='● disconnected';}
}
function connectSse(){
  if(RT.es)RT.es.close();
  var c=q('rtConn');
  try{
    RT.es=new EventSource('/api/admin/realtime/stream');
    RT.es.onopen=function(){if(c){c.className='rt140-live';c.textContent='● live';}};
    RT.es.onerror=function(){if(c){c.className='rt140-live off';c.textContent='● reconnecting';}};
    RT.es.addEventListener('snapshot',function(e){try{RT.snapshot=JSON.parse(e.data);renderDashboard();}catch(_){}});
    RT.es.addEventListener('mediarr',function(e){
      try{
        var ev=JSON.parse(e.data);
        if(ev.kind==='snapshot'){RT.snapshot=ev.data||RT.snapshot;}
        else {RT.events.unshift(ev);if(RT.events.length>80)RT.events.length=80;}
        renderDashboard();
      }catch(_){}
    });
  }catch(e){if(c){c.className='rt140-live off';c.textContent='● unavailable';}}
}

function injectMenuButton(){
  if(RT.mobile){
    var anchor=q('mTranscodes'); if(!anchor||q('mRealtime'))return;
    var b=document.createElement('button');b.id='mRealtime';b.className='btn btn-outline-gold text-start';b.textContent='⚡ Live Dashboard';
    b.onclick=function(){try{if(window.bootstrap)window.bootstrap.Offcanvas.getInstance(q('menu'))&&window.bootstrap.Offcanvas.getInstance(q('menu')).hide();}catch(_){}openDashboard();};
    anchor.insertAdjacentElement('afterend',b);
  }else{
    var a=q('openTranscodes');if(!a||q('openRealtime'))return;
    var d=document.createElement('div');d.id='openRealtime';d.className='settings-btn';d.style.display='';d.title='Live webhook and server event dashboard';
    d.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg> Live Dashboard';
    d.onclick=openDashboard;a.insertAdjacentElement('afterend',d);
  }
}

function ensureWizard(){
  if(q('rtWizard'))return;
  var o=document.createElement('div');o.id='rtWizard';o.className='rt140-overlay';
  o.innerHTML='<div class="rt140-panel rt140-wizard"><div class="rt140-head"><div><div class="rt140-title">MEDIARR Setup</div><div class="rt140-sub" id="wizSub">First-run configuration</div></div><button class="rt140-btn" id="wizX">Close</button></div><div class="rt140-steps" id="wizDots"></div><div class="rt140-body" id="wizBody"></div></div>';
  document.body.appendChild(o);
  q('wizX').onclick=function(){o.classList.remove('show');};
}
function field(id,label,type,ph,full){
  return '<div class="rt140-field'+(full?' full':'')+'"><label>'+esc(label)+'</label><input id="'+id+'" type="'+(type||'text')+'" placeholder="'+esc(ph||'')+'"></div>';
}
function wizardNav(back,next,finish){
  return '<div class="rt140-foot"><div><button class="rt140-btn" id="wizSkip">Skip wizard</button></div><div class="rt140-actions">'+
    (back?'<button class="rt140-btn" id="wizBack">Back</button>':'')+
    '<button class="rt140-btn primary" id="wizNext">'+(finish?'Finish setup':(next||'Next'))+'</button></div></div>';
}
function drawDots(){
  if(!q('wizDots'))return;
  var h='';for(var i=0;i<5;i++)h+='<div class="rt140-stepdot '+(i<=RT.wizardStep?'on':'')+'"></div>';q('wizDots').innerHTML=h;
}
function selectOptions(items,value,kind){
  var h='<option value="">Choose '+kind+'</option>';
  (items||[]).forEach(function(x){var v=x.id!=null?x.id:x.path;var t=x.name||x.path||v;h+='<option value="'+esc(v)+'"'+(String(value||'')===String(v)?' selected':'')+'>'+esc(t)+'</option>';});
  return h;
}
function stored(svc,key){var c=RT.setup&&RT.setup.config&&RT.setup.config[svc];return c&&c[key]!=null?c[key]:'';}
function renderWizard(){
  ensureWizard();drawDots();
  var b=q('wizBody'), step=RT.wizardStep, h='';
  if(step===0){
    h='<div class="rt140-welcome"><h2>Welcome to MEDIARR</h2><p>This wizard connects the services MEDIARR uses most, then gives you the real-time webhook URLs that keep the dashboard and library state synchronized immediately.</p><p>You can skip any service and configure it later in Settings.</p></div>'+wizardNav(false,'Start setup',false);
  }else if(step===1){
    h='<h3>Radarr</h3><div class="rt140-form">'+field('wizRadUrl','Server URL','text','http://radarr:7878',true)+field('wizRadKey','API key','password','Radarr API key',true)+
      '<div class="rt140-field"><label>Quality profile</label><select id="wizRadProfile">'+selectOptions((RT.tested.radarr||{}).profiles,stored('radarr','qualityProfileId'),'profile')+'</select></div>'+
      '<div class="rt140-field"><label>Root folder</label><select id="wizRadFolder">'+selectOptions((RT.tested.radarr||{}).folders,stored('radarr','rootFolderPath'),'folder')+'</select></div></div>'+
      '<button class="rt140-btn" id="wizTest">Test & load options</button><span class="rt140-test" id="wizTestMsg"></span>'+wizardNav(true,'Next: Sonarr',false);
  }else if(step===2){
    h='<h3>Sonarr</h3><div class="rt140-form">'+field('wizSonUrl','Server URL','text','http://sonarr:8989',true)+field('wizSonKey','API key','password','Sonarr API key',true)+
      '<div class="rt140-field"><label>Quality profile</label><select id="wizSonProfile">'+selectOptions((RT.tested.sonarr||{}).profiles,stored('sonarr','qualityProfileId'),'profile')+'</select></div>'+
      '<div class="rt140-field"><label>Root folder</label><select id="wizSonFolder">'+selectOptions((RT.tested.sonarr||{}).folders,stored('sonarr','rootFolderPath'),'folder')+'</select></div></div>'+
      '<button class="rt140-btn" id="wizTest">Test & load options</button><span class="rt140-test" id="wizTestMsg"></span>'+wizardNav(true,'Next: TMDB',false);
  }else if(step===3){
    h='<h3>TMDB</h3><p class="rt140-note">Optional, but recommended for richer discovery, people, studio, year and recommendation views.</p><div class="rt140-form">'+field('wizTmdbKey','TMDB API key','password','TMDB v3 API key',true)+'</div><button class="rt140-btn" id="wizTest">Test TMDB</button><span class="rt140-test" id="wizTestMsg"></span>'+wizardNav(true,'Next: Real-time events',false);
  }else{
    var w=RT.setup&&RT.setup.webhooks||{};
    h='<h3>Real-time Radarr / Sonarr events</h3><p class="rt140-note">Add these as Webhook connections in Radarr and Sonarr. MEDIARR will immediately learn about imports, downloads, deletes, renames and tests, and push them live to the dashboard.</p>'+
      '<div class="rt140-row"><div class="rt140-code">'+esc(w.radarrUrl||'')+'</div><button class="rt140-btn" data-wcopy="'+esc(w.radarrUrl||'')+'">Copy</button></div>'+
      '<div class="rt140-row"><div class="rt140-code">'+esc(w.sonarrUrl||'')+'</div><button class="rt140-btn" data-wcopy="'+esc(w.sonarrUrl||'')+'">Copy</button></div>'+
      '<p class="rt140-note">Radarr/Sonarr → Settings → Connect → + → Webhook. Paste the matching URL. The secret token is already included in the URL.</p>'+wizardNav(true,'',true);
  }
  b.innerHTML=h;
  if(step===1){q('wizRadUrl').value=stored('radarr','url');}
  if(step===2){q('wizSonUrl').value=stored('sonarr','url');}
  b.querySelectorAll('[data-wcopy]').forEach(function(x){x.onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(x.getAttribute('data-wcopy'));x.textContent='Copied';};});
  if(q('wizBack'))q('wizBack').onclick=function(){saveStepFields();RT.wizardStep--;renderWizard();};
  if(q('wizSkip'))q('wizSkip').onclick=skipWizard;
  if(q('wizTest'))q('wizTest').onclick=testWizardStep;
  if(q('wizNext'))q('wizNext').onclick=function(){saveStepFields();if(RT.wizardStep<4){RT.wizardStep++;renderWizard();}else finishWizard();};
}
function saveStepFields(){
  RT.setup=RT.setup||{config:{}};
  RT.setup.config=RT.setup.config||{};
  if(RT.wizardStep===1){
    RT.setup.config.radarr=Object.assign({},RT.setup.config.radarr||{},{
      url:q('wizRadUrl')?q('wizRadUrl').value.trim():'',
      apiKey:q('wizRadKey')?q('wizRadKey').value.trim():'',
      qualityProfileId:q('wizRadProfile')?q('wizRadProfile').value:'',
      rootFolderPath:q('wizRadFolder')?q('wizRadFolder').value:''
    });
  }else if(RT.wizardStep===2){
    RT.setup.config.sonarr=Object.assign({},RT.setup.config.sonarr||{},{
      url:q('wizSonUrl')?q('wizSonUrl').value.trim():'',
      apiKey:q('wizSonKey')?q('wizSonKey').value.trim():'',
      qualityProfileId:q('wizSonProfile')?q('wizSonProfile').value:'',
      rootFolderPath:q('wizSonFolder')?q('wizSonFolder').value:''
    });
  }else if(RT.wizardStep===3){
    RT.setup.config.tmdb=Object.assign({},RT.setup.config.tmdb||{}, {apiKey:q('wizTmdbKey')?q('wizTmdbKey').value.trim():''});
  }
}
async function testWizardStep(){
  var msg=q('wizTestMsg');if(msg){msg.className='rt140-test';msg.textContent=' Testing…';}
  try{
    if(RT.wizardStep===1||RT.wizardStep===2){
      var svc=RT.wizardStep===1?'radarr':'sonarr', pre=svc==='radarr'?'wizRad':'wizSon';
      var d=await post('/api/test',{svc:svc,url:q(pre+'Url').value.trim(),key:q(pre+'Key').value.trim()});
      RT.tested[svc]=d;
      if(msg){msg.className='rt140-test rt140-ok';msg.textContent=' ✓ '+(d.name||svc)+' '+(d.version||'');}
      var p=q(pre+'Profile'),f=q(pre+'Folder');if(p)p.innerHTML=selectOptions(d.profiles,stored(svc,'qualityProfileId'),'profile');if(f)f.innerHTML=selectOptions(d.folders,stored(svc,'rootFolderPath'),'folder');
    }else{
      var tm=await post('/api/test',{svc:'tmdb',key:q('wizTmdbKey').value.trim()});RT.tested.tmdb=tm;
      if(msg){msg.className='rt140-test rt140-ok';msg.textContent=' ✓ TMDB connected';}
    }
  }catch(e){if(msg){msg.className='rt140-test rt140-bad';msg.textContent=' ✕ '+e.message;}}
}
async function finishWizard(){
  saveStepFields();
  try{
    var body={radarr:RT.setup.config.radarr||{},sonarr:RT.setup.config.sonarr||{},tmdb:RT.setup.config.tmdb||{}};
    var d=await post('/api/admin/setup/complete',body);RT.setup.webhooks=d.webhooks||RT.setup.webhooks;
    q('rtWizard').classList.remove('show');
    location.reload();
  }catch(e){alert('Could not finish setup: '+e.message);}
}
async function skipWizard(){
  if(!confirm('Skip the setup wizard? You can configure services later in Settings.'))return;
  try{await post('/api/admin/setup/skip',{});q('rtWizard').classList.remove('show');}catch(e){alert(e.message);}
}
async function openWizard(auto){
  ensureWizard();
  try{
    RT.setup=await api('/api/admin/setup/status');
    RT.wizardStep=0;renderWizard();q('rtWizard').classList.add('show');
  }catch(e){if(!auto)alert('Could not open setup wizard: '+e.message);}
}

async function adminInit(){
  if(RT.initialized)return;
  try{
    var me=await api('/api/me');
    if(!me||me.role!=='admin')return;
    RT.admin=true;RT.mobile=!!q('mSettings');RT.initialized=true;
    addStyles();ensureDashboard();ensureWizard();injectMenuButton();
    var st=await api('/api/admin/setup/status');
    RT.setup=st;
    if(st.needed)openWizard(true);
  }catch(_){}
}
function bootWait(){
  adminInit();
  var n=0,t=setInterval(function(){n++;if(RT.initialized||n>180){clearInterval(t);return;}adminInit();},1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootWait);else bootWait();
})();