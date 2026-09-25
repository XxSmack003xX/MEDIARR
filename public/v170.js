(function(){
'use strict';

function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
async function json(url,opt){var r=await fetch(url,opt||{cache:'no-store'}),d={};try{d=await r.json();}catch(_){}if(!r.ok)throw new Error(d.message||('HTTP '+r.status));return d;}
function addStyles(){
  if(document.getElementById('mediarr170Style'))return;
  var s=document.createElement('style');s.id='mediarr170Style';s.textContent=[
    '.pm170{margin-top:12px;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:12px;background:var(--panel2,var(--bg2,#171e2a));padding:12px}.pm170 h3{margin:0 0 4px;font-size:14px}.pm170-note{font-size:10px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));line-height:1.4;margin-bottom:10px}.pm170-row{display:grid;grid-template-columns:105px 1fr 1fr auto;gap:7px;align-items:end;margin:7px 0}.pm170 label{font-size:9px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));font-weight:800}.pm170 input,.pm170 select{width:100%;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:7px;background:var(--bg,#0c111b);color:var(--txt,var(--bs-body-color,#eef3ff));padding:7px;font-size:10px}.pm170 button{border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:7px;background:var(--bg,#0c111b);color:inherit;padding:7px 9px;font-size:10px;font-weight:800;cursor:pointer}.pm170 button.primary{background:var(--gold,#d9a441);border-color:var(--gold,#d9a441);color:#17120a}.pm170-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.pm170-test{margin-top:12px;padding-top:10px;border-top:1px solid var(--line,var(--bs-border-color,#2a3447))}.pm170-result{margin-top:8px;font-family:monospace;font-size:9px;line-height:1.5;word-break:break-all}.pm170-ok{color:#35d07f}.pm170-bad{color:#ff626c}.pm170-warn{color:#f0b84b}',
    '@media(max-width:760px){.pm170-row{grid-template-columns:1fr 1fr}.pm170-row>div:nth-child(2),.pm170-row>div:nth-child(3){grid-column:span 1}.pm170-row>button{grid-column:2}.pm170{padding:10px}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- per-user Continue Watching ---------------- */
var active={path:'',name:'',meta:{},video:null,lastSent:0,resume:0,resumeApplied:false};
function postProgress(ended){
  var v=active.video;if(!active.path||!v)return;
  var dur=Number(v.duration)||0,pos=Number(v.currentTime)||0;
  if(!dur||!isFinite(dur)||!isFinite(pos))return;
  active.lastSent=Date.now();
  fetch('/api/playback/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:active.path,title:active.name,position:ended?dur:pos,duration:dur,ended:!!ended,meta:active.meta||{}})}).then(function(){
    try{if(window.MEDIARRUserHome&&typeof window.MEDIARRUserHome.refresh==='function')window.MEDIARRUserHome.refresh();}catch(_){}
  }).catch(function(){});
}
function applyResume(){
  var v=active.video;if(!v||active.resumeApplied||!active.resume)return;
  var dur=Number(v.duration)||0;if(!dur||!isFinite(dur))return;
  var pos=Math.min(active.resume,Math.max(0,dur-5));
  if(pos>=10&&pos<dur*.95){try{v.currentTime=pos;active.resumeApplied=true;}catch(_){}}
}
function bindVideo(v){
  if(!v||v.dataset.mediarrProgress170==='1')return;
  v.dataset.mediarrProgress170='1';
  v.addEventListener('loadedmetadata',applyResume);
  v.addEventListener('durationchange',applyResume);
  v.addEventListener('timeupdate',function(){if(active.video!==v)return;if(Date.now()-active.lastSent>10000)postProgress(false);});
  v.addEventListener('pause',function(){if(active.video===v&&v.currentTime>3)postProgress(false);});
  v.addEventListener('ended',function(){if(active.video===v)postProgress(true);});
}
async function prepareResume(path){
  active.resume=0;active.resumeApplied=false;
  try{var d=await json('/api/playback/progress?path='+encodeURIComponent(path));var x=d.item||{};if(!x.completed&&Number(x.position)>9&&Number(x.progressPct)<95)active.resume=Number(x.position)||0;applyResume();}catch(_){}
}
function patchPlayer(name,videoId){
  var orig=window[name];if(typeof orig!=='function'||orig.__mediarr170)return;
  function wrapped(path,title,meta){
    active.path=String(path||'');active.name=String(title||'');active.meta=meta||{};active.lastSent=0;active.video=document.getElementById(videoId);active.resume=0;active.resumeApplied=false;
    var r=orig.apply(this,arguments);
    active.video=document.getElementById(videoId);bindVideo(active.video);prepareResume(active.path);
    return r;
  }
  wrapped.__mediarr170=true;wrapped.__original=orig;window[name]=wrapped;
}
function installProgress(){
  patchPlayer('playVideoD','dlVideo');patchPlayer('playVideoMobile','mVideo');
  window.addEventListener('beforeunload',function(){try{postProgress(false);}catch(_){}});
}

/* ---------------- Path Mapping Manager ---------------- */
var adminKnown=null, managerSeq=0;
async function isAdmin(){
  if(adminKnown!=null)return adminKnown;
  try{var d=await json('/api/me');adminKnown=!!(d&&d.role==='admin');}catch(_){adminKnown=false;}
  return adminKnown;
}
function managerHost(){
  var desktop=document.querySelector('.svc[data-svc="webdav"]');
  if(desktop)return {anchor:desktop,mobile:false};
  var wu=document.getElementById('s_webdav_url');
  if(wu){var card=wu.closest('.card');if(card)return {anchor:card,mobile:true};}
  return null;
}
function ruleRow(r){
  r=r||{};return '<div class="pm170-row" data-pm-row>'+
    '<div><label>Service</label><select data-pm-service><option value="all"'+(r.service==='all'?' selected':'')+'>Both</option><option value="radarr"'+(r.service==='radarr'?' selected':'')+'>Radarr</option><option value="sonarr"'+(r.service==='sonarr'?' selected':'')+'>Sonarr</option></select></div>'+
    '<div><label>Arr root</label><input data-pm-root value="'+esc(r.arrRoot||'')+'" placeholder="/movies"></div>'+
    '<div><label>Media source prefix</label><input data-pm-prefix value="'+esc(r.targetPrefix||'')+'" placeholder="movies or blank"></div>'+
    '<button type="button" data-pm-remove>Remove</button></div>';
}
function collectRules(box){
  var out=[];box.querySelectorAll('[data-pm-row]').forEach(function(row,i){var root=row.querySelector('[data-pm-root]').value.trim();if(!root)return;out.push({id:'map'+(i+1),name:'',service:row.querySelector('[data-pm-service]').value,arrRoot:root,targetPrefix:row.querySelector('[data-pm-prefix]').value.trim(),enabled:true});});return out;
}
function wireRows(box){box.querySelectorAll('[data-pm-remove]').forEach(function(b){b.onclick=function(){var r=b.closest('[data-pm-row]');if(r)r.remove();};});}
async function fillManager(box){
  var list=box.querySelector('[data-pm-list]'),status=box.querySelector('[data-pm-status]');
  try{
    var d=await json('/api/admin/path-mappings');
    box.dataset.radarrRoot=d.radarrRoot||'';box.dataset.sonarrRoot=d.sonarrRoot||'';
    box.querySelector('[data-pm-source]').textContent=(d.source==='local'?'Local folder: ':'WebDAV root: ')+(d.sourceRoot||'/');
    list.innerHTML=(d.rules||[]).map(ruleRow).join('')||'<div class="pm170-note" data-pm-empty>No explicit mappings yet. MEDIARR still tries automatic mapping.</div>';wireRows(box);
    status.textContent='';
  }catch(e){status.textContent='Could not load mappings: '+e.message;status.className='pm170-bad';}
}
function renderTest(out,el){
  var h='<div><b>Source:</b> '+esc(out.source||'')+' · '+esc(out.sourceRoot||'/')+'</div>';
  h+='<div><b>Selected:</b> '+(out.selected?'<span class="pm170-ok">'+esc(out.selected)+'</span>':'<span class="pm170-bad">No existing file matched</span>')+'</div>';
  (out.candidates||[]).forEach(function(x){h+='<div class="'+(x.exists?'pm170-ok':'pm170-bad')+'">'+(x.exists?'✓ ':'✕ ')+esc(x.path)+' <span style="opacity:.65">('+esc(x.kind||'candidate')+(x.mapping?' · '+esc(x.mapping):'')+')</span></div>';});
  el.innerHTML=h;
}
async function injectManager(){
  if(!(await isAdmin()))return;
  var h=managerHost();if(!h)return;
  var next=h.anchor.nextElementSibling;if(next&&next.classList&&next.classList.contains('pm170'))return;
  addStyles();
  var box=document.createElement('div');box.className='pm170';box.id='pm170-'+(++managerSeq);
  box.innerHTML='<h3>🧭 Path Mapping Manager</h3><div class="pm170-note">Map the paths Radarr/Sonarr report to the Local/WebDAV source MEDIARR can actually see. Rules run before automatic path guessing.</div>'+
    '<div class="pm170-note"><b data-pm-source>Loading source…</b></div><div data-pm-list></div>'+
    '<div class="pm170-actions"><button type="button" data-pm-add-r>+ Radarr mapping</button><button type="button" data-pm-add-s>+ Sonarr mapping</button><button type="button" class="primary" data-pm-save>Save mappings</button><span class="pm170-note" data-pm-status></span></div>'+
    '<div class="pm170-test"><b style="font-size:11px">Test a real Arr file path</b><div class="pm170-row"><div><label>Service</label><select data-pm-test-service><option value="radarr">Radarr</option><option value="sonarr">Sonarr</option></select></div><div style="grid-column:span 2"><label>Full file path reported by Arr</label><input data-pm-test-path placeholder="/movies/Movie (2026)/Movie.mkv"></div><button type="button" data-pm-test>Test</button></div><div class="pm170-result" data-pm-result></div></div>';
  h.anchor.insertAdjacentElement('afterend',box);
  await fillManager(box);
  var list=box.querySelector('[data-pm-list]');
  function add(service){var empty=list.querySelector('[data-pm-empty]');if(empty)empty.remove();var root=service==='radarr'?box.dataset.radarrRoot:box.dataset.sonarrRoot;list.insertAdjacentHTML('beforeend',ruleRow({service:service,arrRoot:root||'',targetPrefix:''}));wireRows(box);}
  box.querySelector('[data-pm-add-r]').onclick=function(){add('radarr');};box.querySelector('[data-pm-add-s]').onclick=function(){add('sonarr');};
  box.querySelector('[data-pm-save]').onclick=async function(){var b=this,st=box.querySelector('[data-pm-status]');b.disabled=true;st.textContent='Saving…';try{var d=await json('/api/admin/path-mappings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:collectRules(box)})});st.textContent='✓ '+(d.rules||[]).length+' mapping'+((d.rules||[]).length===1?'':'s')+' saved';st.className='pm170-note pm170-ok';}catch(e){st.textContent='✕ '+e.message;st.className='pm170-note pm170-bad';}b.disabled=false;};
  box.querySelector('[data-pm-test]').onclick=async function(){var out=box.querySelector('[data-pm-result]'),p=box.querySelector('[data-pm-test-path]').value.trim(),svc=box.querySelector('[data-pm-test-service]').value;if(!p){out.innerHTML='<span class="pm170-warn">Paste a Radarr/Sonarr full file path first.</span>';return;}out.textContent='Testing candidates against the configured media source…';try{renderTest(await json('/api/admin/path-mappings/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service:svc,arrPath:p})}),out);}catch(e){out.innerHTML='<span class="pm170-bad">'+esc(e.message)+'</span>';}};
}
function installManagerObserver(){
  var queued=false;function kick(){if(queued)return;queued=true;setTimeout(function(){queued=false;injectManager();},80);}
  new MutationObserver(kick).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});kick();
}

addStyles();
setTimeout(function(){installProgress();installManagerObserver();},0);
})();