/*
 * MEDIARR Library health (v2.20) — admin page on the desktop and phone sites.
 * Lists movies and episodes Plex has no video details for ("Resolution: None") and repairs them:
 * Plex analyses the file again, or Radarr/Sonarr replace it. Talks to /api/admin/health.
 *   MediarrHealth.open()
 */
(function(){
'use strict';
if(window.MediarrHealth)return;
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PHONE=!!document.getElementById('mMonitor');
const sv=(d,w)=>'<svg viewBox="0 0 24 24" width="'+(w||18)+'" height="'+(w||18)+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
const I={
  pulse:sv('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  film:sv('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',16),
  tv:sv('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M8 2l4 4 4-4"/>',16),
  x:sv('<path d="M6 6l12 12M18 6L6 18"/>'),
  scan:sv('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',16),
  dl:sv('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',16),
  wrench:sv('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',16),
  eye:sv('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',16),
  off:sv('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>',16),
  check:sv('<path d="M5 12l5 5 9-10"/>',16),
  chev:sv('<path d="M9 6l6 6-6 6"/>',14),
  warn:sv('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',16)
};
const STATE={queued:['Queued','q'],analyzing:['Plex is analysing','w'],replacing:['Starting','w'],searching:['Searching','w'],downloading:['Downloading','w'],imported:['Imported, waiting for Plex','w'],'no-release':['No release yet','m'],manual:['Needs you','m'],failed:['Failed','b'],fixed:['Fixed','g'],cancelled:['Cancelled','q']};
const ACTIVE=['queued','analyzing','replacing','searching','downloading','imported'];

const CSS=`
.lh-back{--a:var(--gold,var(--bs-warning,#e8b04a));--p:var(--panel,var(--bs-tertiary-bg,#171b25));--p2:var(--panel2,var(--bs-secondary-bg,#1d2230));--bg:var(--bg2,var(--bs-body-bg,#12151d));--l:var(--line,var(--bs-border-color,#2a3142));--t:var(--txt,var(--bs-body-color,#e8eaf0));--m:var(--muted,var(--bs-secondary-color,#8f97a8));--g:#35c98a;--w:#f0a73a;--b:#f0625d;--bl:#5fa8ff;
  position:fixed;inset:0;z-index:9400;display:flex;justify-content:center;align-items:flex-start;padding:4vh 16px 24px;overflow-y:auto;background:rgba(6,6,10,.62);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);font-size:14px;line-height:1.45;color:var(--t);animation:lhFade .18s ease;text-align:left}
.lh-back *{box-sizing:border-box}
@keyframes lhFade{from{opacity:0}}@keyframes lhRise{from{opacity:0;transform:translateY(14px)}}@keyframes lhSpin{to{transform:rotate(360deg)}}
.lh{width:100%;max-width:1080px;background:var(--bg);border:1px solid var(--l);border-radius:20px;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);animation:lhRise .24s cubic-bezier(.2,.8,.3,1);overflow:hidden}
.lh-head{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid var(--l);background:radial-gradient(120% 160% at 0 0,color-mix(in srgb,var(--a) 14%,transparent),transparent 60%)}
.lh-ic{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;flex:none;color:#17130a;background:linear-gradient(140deg,color-mix(in srgb,var(--a) 80%,#fff),var(--a))}
.lh-head h3{margin:0;font-size:18px;font-weight:800;color:var(--t)}.lh-head p{margin:1px 0 0;color:var(--m);font-size:13px}
.lh-x{margin-left:auto;width:36px;height:36px;border-radius:10px;border:0;background:transparent;color:var(--m);display:grid;place-items:center;cursor:pointer}.lh-x:hover{background:var(--p);color:var(--t)}
.lh-body{padding:18px 20px 22px;display:grid;gap:16px}
.lh-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--l);background:var(--p);color:var(--t);font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none}
.lh-btn:hover{border-color:var(--a);color:var(--t)}.lh-btn.pri{background:var(--a);border-color:var(--a);color:#17130a}.lh-btn.pri:hover{filter:brightness(1.07)}
.lh-btn.sm{height:32px;padding:0 11px;font-size:12.5px;border-radius:8px}.lh-btn[disabled]{opacity:.5;cursor:default}.lh-btn.warn{background:var(--w);border-color:var(--w);color:#1d1305}
.lh-scan{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px;border:1px solid var(--l);border-radius:14px;background:var(--p)}
.lh-scan .txt{flex:1;min-width:220px}.lh-scan b{color:var(--t)}.lh-scan .s{color:var(--m);font-size:13px}
.lh-bar{height:6px;border-radius:99px;background:var(--l);overflow:hidden;margin-top:8px}.lh-bar i{display:block;height:100%;background:var(--a);border-radius:99px;transition:width .3s}
.lh-spin{width:16px;height:16px;border:2px solid var(--l);border-top-color:var(--a);border-radius:50%;animation:lhSpin .8s linear infinite;display:inline-block;vertical-align:-3px;margin-right:6px}
.lh-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.lh-tile{padding:12px 14px;border:1px solid var(--l);border-radius:14px;background:var(--p)}.lh-tile .n{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--t);line-height:1.1}.lh-tile .k{font-size:12px;color:var(--m);margin-top:2px}
.lh-tile.b .n{color:var(--b)}.lh-tile.w .n{color:var(--w)}.lh-tile.g .n{color:var(--g)}
.lh-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.lh-seg{display:flex;gap:4px;padding:3px;border:1px solid var(--l);border-radius:11px;background:var(--p);flex-wrap:wrap}
.lh-seg button{border:0;background:transparent;color:var(--m);font:inherit;font-size:12.5px;font-weight:700;padding:6px 10px;border-radius:8px;cursor:pointer}.lh-seg button.on{background:var(--p2);color:var(--t);box-shadow:inset 0 0 0 1px var(--l)}
.lh-seg button span{opacity:.7;margin-left:4px;font-weight:600}
.lh-q{flex:1;min-width:160px;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--l);background:var(--p);color:var(--t);font:inherit;font-size:13.5px;outline:none}.lh-q:focus{border-color:var(--a)}
.lh-bulk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--a) 10%,var(--p));border:1px solid color-mix(in srgb,var(--a) 35%,var(--l))}
.lh-bulk .c{font-weight:700;margin-right:auto}
.lh-list{border:1px solid var(--l);border-radius:14px;overflow:hidden;background:var(--p)}
.lh-row{display:grid;grid-template-columns:auto auto 1fr auto;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid var(--l);cursor:pointer}
.lh-row:first-child{border-top:0}.lh-row:hover{background:color-mix(in srgb,var(--p2) 70%,transparent)}
.lh-row input{width:17px;height:17px;accent-color:var(--a);cursor:pointer;margin:0}
.lh-kind{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--p2);color:var(--m)}
.lh-main{min-width:0}.lh-main b{display:block;color:var(--t);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lh-main .s{color:var(--m);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lh-main .f{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--m);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lh-side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.lh-tag{font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:99px;border:1px solid var(--l);color:var(--m);white-space:nowrap}
.lh-tag.r{color:var(--w);border-color:color-mix(in srgb,var(--w) 40%,var(--l))}.lh-tag.s{color:var(--bl);border-color:color-mix(in srgb,var(--bl) 40%,var(--l))}
.lh-pill{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.lh-pill.q{background:var(--p2);color:var(--m)}.lh-pill.w{background:color-mix(in srgb,var(--w) 16%,transparent);color:var(--w)}.lh-pill.m{background:color-mix(in srgb,var(--b) 14%,transparent);color:var(--b)}.lh-pill.b{background:color-mix(in srgb,var(--b) 18%,transparent);color:var(--b)}.lh-pill.g{background:color-mix(in srgb,var(--g) 16%,transparent);color:var(--g)}
.lh-pill.w:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;animation:lhPulse 1.4s infinite}
@keyframes lhPulse{50%{opacity:.3}}
.lh-more{grid-column:1/-1;margin:2px 0 4px 44px;display:grid;gap:10px;cursor:default}
.lh-steps{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:12.5px;color:var(--m)}
.lh-steps li{display:flex;gap:10px}.lh-steps time{flex:none;width:118px;opacity:.8}
.lh-acts{display:flex;gap:8px;flex-wrap:wrap}
.lh-empty{padding:28px 18px;text-align:center;color:var(--m)}.lh-empty b{display:block;color:var(--t);font-size:15px;margin-bottom:4px}
.lh-empty .ok{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;margin:0 auto 10px;background:color-mix(in srgb,var(--g) 16%,transparent);color:var(--g)}
.lh-note{display:flex;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--w) 40%,var(--l));background:color-mix(in srgb,var(--w) 8%,var(--p));color:var(--m);font-size:13px}.lh-note svg{flex:none;color:var(--w);margin-top:1px}.lh-note b{color:var(--t)}
details.lh-det{border:1px solid var(--l);border-radius:14px;background:var(--p)}
details.lh-det>summary{list-style:none;cursor:pointer;padding:12px 16px;font-weight:700;display:flex;align-items:center;gap:8px;color:var(--t)}
details.lh-det>summary::-webkit-details-marker{display:none}details.lh-det>summary svg{transition:transform .2s;color:var(--m)}details.lh-det[open]>summary svg{transform:rotate(90deg)}
details.lh-det>summary small{color:var(--m);font-weight:600;margin-left:auto}
.lh-det .in{padding:0 16px 14px;display:grid;gap:10px}
.lh-opt{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--p2);cursor:pointer}
.lh-opt input{margin-top:3px;accent-color:var(--a);width:16px;height:16px;flex:none}.lh-opt b{display:block;color:var(--t);font-size:13.5px}.lh-opt small{color:var(--m);font-size:12.5px}
.lh-sel{height:36px;padding:0 10px;border-radius:9px;border:1px solid var(--l);background:var(--p2);color:var(--t);font:inherit;font-size:13.5px}
.lh-fixed{display:grid;gap:6px}.lh-fixed div{display:flex;gap:10px;align-items:baseline;font-size:13px;color:var(--m)}.lh-fixed b{color:var(--t);font-weight:700}.lh-fixed span.h{margin-left:auto;font-size:12px;white-space:nowrap}
@media (max-width:760px){
  .lh-back{padding:0;align-items:stretch}.lh{border-radius:0;border:0;min-height:100%}
  .lh-head{padding:14px 14px}.lh-body{padding:14px 12px 28px}
  .lh-tiles{grid-template-columns:repeat(2,1fr)}
  .lh-row{grid-template-columns:auto 1fr;gap:10px;padding:11px 12px}.lh-kind{display:none}.lh-side{grid-column:2;justify-content:flex-start}
  .lh-more{margin-left:0}.lh-steps time{width:92px}
}
`;
const plural=(n,w)=>Number(n||0).toLocaleString()+' '+w+(n===1?'':'s');
function ago(ts){if(!ts)return '';const s=Math.round((Date.now()-ts)/1000);if(s<60)return 'just now';const m=Math.round(s/60);if(m<60)return m+' min ago';const h=Math.round(m/60);if(h<48)return h+' h ago';return Math.round(h/24)+' days ago';}
const when=ts=>ts?new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
async function api(url,body){
  const r=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  let j={};try{j=await r.json();}catch(_){}
  if(!r.ok)throw new Error(j.message||('HTTP '+r.status));
  return j;
}
let cssDone=false,cur=null;
function open(){
  if(cur&&cur.el.isConnected)return cur;
  if(!cssDone){const s=document.createElement('style');s.id='lhStyle';s.textContent=CSS;document.head.appendChild(s);cssDone=true;}
  const back=document.createElement('div');back.className='lh-back';back.id='libraryHealth';
  back.innerHTML='<div class="lh" role="dialog" aria-modal="true" aria-label="Library health"><div class="lh-head"><div class="lh-ic">'+I.pulse+'</div><div><h3>Library health</h3><p>Movies and episodes Plex has no video details for, and their repair</p></div><button class="lh-x" type="button" aria-label="Close">'+I.x+'</button></div><div class="lh-body"><div class="lh-empty"><span class="lh-spin"></span>Loading…</div></div></div>';
  const host=[...document.querySelectorAll('.modal.show')].pop()||document.body;
  host.appendChild(back);
  const V={el:back,body:back.querySelector('.lh-body'),data:null,filter:'all',q:'',sel:new Set(),openRow:new Set(),timer:0,sure:''};
  const key=e=>{if(e.key==='Escape'&&back.isConnected&&!document.querySelector('.vl-back')){e.stopPropagation();e.preventDefault();close();}};
  const close=()=>{clearTimeout(V.timer);back.remove();window.removeEventListener('keydown',key,true);cur=null;};
  V.close=close;
  window.addEventListener('keydown',key,true);
  back.addEventListener('click',e=>{if(e.target===back)close();});
  back.querySelector('.lh-x').onclick=close;
  cur=V;
  load(V);
  return V;
}
async function load(V){
  clearTimeout(V.timer);
  if(!V.el.isConnected)return;
  try{V.data=await api('/api/admin/health');V.err='';}catch(e){V.err=e.message;}
  paint(V);
  const d=V.data,busy=d&&(d.scan.status==='running'||d.items.some(x=>x.repair&&['queued','analyzing','replacing'].includes(x.repair.state)));
  V.timer=setTimeout(()=>load(V),busy?2000:15000);
}
function pill(r){if(!r)return '';const s=STATE[r.state]||[r.state,'q'];return '<span class="lh-pill '+s[1]+'">'+esc(s[0])+'</span>';}
function rowHtml(V,it){
  const r=it.repair,on=V.sel.has(it.id),openRow=V.openRow.has(it.id);
  const arr=it.arr?'<span class="lh-tag '+(it.arr.svc==='radarr'?'r':'s')+'">'+(it.arr.svc==='radarr'?'Radarr':'Sonarr')+'</span>':'<span class="lh-tag" title="Not in Radarr or Sonarr, so MEDIARR can’t get a replacement by itself">Not in '+(it.kind==='movie'?'Radarr':'Sonarr')+'</span>';
  const meta=[it.kind==='episode'&&it.title?'“'+it.title+'”':'',it.sectionTitle,(it.reasonText||[])[0],it.fileText].filter(Boolean).join(' · ');
  let h='<div class="lh-row" data-id="'+esc(it.id)+'"><input type="checkbox" aria-label="Select '+esc(it.label)+'"'+(on?' checked':'')+(it.ignored?' disabled':'')+'><div class="lh-kind">'+(it.kind==='movie'?I.film:I.tv)+'</div><div class="lh-main"><b>'+esc(it.label)+'</b><div class="s">'+esc(meta)+'</div>'+(it.file?'<div class="f" title="'+esc(it.file)+'">'+esc(it.file)+'</div>':'')+'</div><div class="lh-side">'+arr+(it.ignored?'<span class="lh-pill q">Ignored</span>':pill(r))+'</div>';
  if(openRow){
    const steps=(r&&r.steps||[]).slice().reverse();
    h+='<div class="lh-more">'+(steps.length?'<ul class="lh-steps">'+steps.map(s=>'<li><time>'+esc(when(s.at))+'</time><span>'+esc(s.text)+'</span></li>').join('')+'</ul>':'<div class="s" style="color:var(--m);font-size:12.5px">Found '+esc(ago(it.firstSeen))+'. Not repaired yet.</div>')
      +'<div class="lh-acts">'+(it.ignored?'<button class="lh-btn sm" data-act="unignore">'+I.eye+'Stop ignoring</button>':((!r||!ACTIVE.includes(r.state))?'<button class="lh-btn sm pri" data-act="repair">'+I.wrench+(r&&r.state!=='cancelled'?'Try again':'Repair')+'</button>':'')+'<button class="lh-btn sm" data-act="ignore">'+I.off+'Ignore</button>')+'</div></div>';
  }
  return h+'</div>';
}
function paint(V){
  if(!V.el.isConnected)return;
  const d=V.data;
  if(!d){V.body.innerHTML='<div class="lh-note">'+I.warn+'<div>'+esc(V.err||'Couldn’t load')+'</div></div>';return;}
  const focus=document.activeElement&&document.activeElement.classList.contains('lh-q');
  let h='';
  if(!d.ready){V.body.innerHTML='<div class="lh-note">'+I.warn+'<div><b>Connect Plex first.</b> Library health reads your Plex libraries. Add the Plex address and token in Settings → Plex, then come back.</div></div>';return;}
  if(!d.radarr&&!d.sonarr)h+='<div class="lh-note">'+I.warn+'<div><b>Radarr and Sonarr aren’t connected</b>, so MEDIARR can find dead items and ask Plex to re-read them, but can’t download replacements.</div></div>';
  // scan card
  const sc=d.scan||{};
  let st='';
  if(sc.status==='running'){const pr=sc.progress||{},pct=pr.total?Math.round(100*pr.done/pr.total):null;st='<b><span class="lh-spin"></span>'+esc(pr.phase||'Checking')+(pr.total?' ('+pr.done+'/'+pr.total+')':'')+'…</b><div class="lh-bar"><i style="width:'+(pct==null?12:Math.max(4,pct))+'%"></i></div>';}
  else if(sc.status==='done'){const c=sc.counts||{};st='<b>Last checked '+esc(ago(sc.finishedAt))+'</b><div class="s">'+plural(c.movies,'movie')+' and '+plural(c.episodes,'episode')+' in '+plural(c.sections,'library').replace('librarys','libraries')+', took '+Math.max(1,Math.round((sc.finishedAt-sc.startedAt)/1000))+' s'+(sc.why==='scheduled'?' (scheduled)':'')+'</div>';}
  else if(sc.status==='error')st='<b style="color:var(--b)">The last check failed</b><div class="s">'+esc(sc.error||'')+'</div>';
  else st='<b>Not checked yet</b><div class="s">A check reads every movie and episode in Plex. Large libraries take a minute or two.</div>';
  h+='<div class="lh-scan"><div class="txt">'+st+'</div><button class="lh-btn pri" data-act="scan"'+(sc.status==='running'?' disabled':'')+'>'+I.scan+(sc.status==='never'||!sc.status?'Check my library':'Check again')+'</button>'+(d.items.length?'<a class="lh-btn" href="/api/admin/health/export.csv" download>'+I.dl+'Download list</a>':'')+'</div>';
  if(sc.status==='never'&&!d.items.length){V.body.innerHTML=h+settingsHtml(d);wire(V);return;}
  const s=d.summary;
  h+='<div class="lh-tiles"><div class="lh-tile b"><div class="n">'+s.total.toLocaleString()+'</div><div class="k">without video details</div></div><div class="lh-tile"><div class="n">'+s.missing.toLocaleString()+'</div><div class="k">file missing</div></div><div class="lh-tile w"><div class="n">'+s.repairing.toLocaleString()+'</div><div class="k">being repaired</div></div><div class="lh-tile g"><div class="n">'+s.fixed.toLocaleString()+'</div><div class="k">fixed</div></div></div>';
  // list
  const items=d.items;
  const groups={all:items.filter(x=>!x.ignored),movie:items.filter(x=>!x.ignored&&x.kind==='movie'),episode:items.filter(x=>!x.ignored&&x.kind==='episode'),active:items.filter(x=>x.repair&&ACTIVE.includes(x.repair.state)),attention:items.filter(x=>!x.ignored&&x.repair&&['manual','failed','no-release'].includes(x.repair.state)),ignored:items.filter(x=>x.ignored)};
  const names={all:'All',movie:'Movies',episode:'Episodes',active:'Repairing',attention:'Needs you',ignored:'Ignored'};
  if(!groups[V.filter])V.filter='all';
  const ql=V.q.trim().toLowerCase();
  const shown=groups[V.filter].filter(x=>!ql||(x.label+' '+(x.title||'')+' '+(x.file||'')+' '+(x.sectionTitle||'')).toLowerCase().includes(ql));
  for(const id of [...V.sel])if(!items.some(x=>x.id===id&&!x.ignored))V.sel.delete(id);
  if(items.length){
    h+='<div class="lh-tools"><div class="lh-seg" role="tablist">'+Object.keys(names).filter(k=>k==='all'||groups[k].length).map(k=>'<button type="button" data-f="'+k+'" class="'+(V.filter===k?'on':'')+'">'+names[k]+'<span>'+groups[k].length+'</span></button>').join('')+'</div><input class="lh-q" type="search" placeholder="Search titles or paths" value="'+esc(V.q)+'" aria-label="Search"></div>';
    const n=V.sel.size,todo=groups.all.filter(x=>!x.repair||!ACTIVE.includes(x.repair.state)).length;
    h+='<div class="lh-bulk"><span class="c">'+(n?plural(n,'item')+' selected':'Select items, or repair everything at once')+'</span>'
      +(n?'<button class="lh-btn sm" data-act="ignore-sel">'+I.off+'Ignore</button><button class="lh-btn sm '+(V.sure==='sel'?'warn':'pri')+'" data-act="repair-sel">'+I.wrench+(V.sure==='sel'?'Sure? Repair '+n:'Repair '+n)+'</button>':'')
      +(todo?'<button class="lh-btn sm '+(V.sure==='all'?'warn':'')+'" data-act="repair-all">'+I.wrench+(V.sure==='all'?'Sure? Repair all '+todo:'Repair all '+todo)+'</button>':'')+'</div>';
    if(V.sure)h+='<div class="lh-note">'+I.warn+'<div><b>What repairing does:</b> if the file is there, Plex analyses it again. Otherwise '+(d.settings.blocklist?'the release it came from is blocklisted, ':'')+'the dead file is removed from Radarr/Sonarr and they search for a new one. Items not in Radarr/Sonarr are only marked as needing you.</div></div>';
    h+='<div class="lh-list">'+(shown.length?shown.slice(0,500).map(x=>rowHtml(V,x)).join(''):'<div class="lh-empty">Nothing here.</div>')+'</div>';
    if(shown.length>500)h+='<div class="s" style="color:var(--m);font-size:12.5px">Showing the first 500 of '+shown.length.toLocaleString()+'. Search to narrow it down, or download the full list.</div>';
  }else if(sc.status==='done'){
    h+='<div class="lh-list"><div class="lh-empty"><div class="ok">'+I.check+'</div><b>Everything in Plex has video details</b>No dead or unreadable movies or episodes found.</div></div>';
  }
  if(d.fixed.length)h+='<details class="lh-det"><summary>'+I.chev+'Recently fixed<small>'+d.fixed.length+'</small></summary><div class="in"><div class="lh-fixed">'+d.fixed.slice(0,30).map(x=>'<div><b>'+esc(x.label)+'</b><span>'+esc(x.how||'')+'</span><span class="h">'+esc(ago(x.fixedAt))+'</span></div>').join('')+'</div></div></details>';
  h+=settingsHtml(d);
  const openDet=[...V.body.querySelectorAll('details.lh-det')].map(x=>x.open);
  V.body.innerHTML=h;
  [...V.body.querySelectorAll('details.lh-det')].forEach((x,i)=>{if(openDet[i])x.open=true;});
  wire(V);
  if(focus){const q=V.body.querySelector('.lh-q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length);}}
}
function settingsHtml(d){
  const s=d.settings||{};
  const opt=(k,t,sub)=>'<label class="lh-opt"><input type="checkbox" data-set="'+k+'"'+(s[k]?' checked':'')+'><span><b>'+t+'</b><small>'+sub+'</small></span></label>';
  return '<details class="lh-det"><summary>'+I.chev+'Settings<small>'+({off:'Checks: when you ask',daily:'Checks: daily',weekly:'Checks: weekly'}[s.schedule]||'')+'</small></summary><div class="in">'
    +'<label style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-weight:700">Check automatically</span><select class="lh-sel" data-set="schedule">'+[['off','No, only when I ask'],['daily','Every day'],['weekly','Every week']].map(([v,l])=>'<option value="'+v+'"'+(s.schedule===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'
    +opt('analyzeFirst','Ask Plex to analyse the file first','When the file is there, Plex often only needs to read it again. Nothing is deleted or downloaded.')
    +opt('blocklist','Blocklist the release a dead file came from','Marks that download as failed in Radarr/Sonarr, so the same bad release isn’t grabbed again.')
    +opt('autoRepair','Repair new finds automatically','After each check, anything new is repaired without asking. You get a notification either way.')
    +'</div></details>';
}
function wire(V){
  const B=V.body,d=V.data;
  B.querySelectorAll('[data-act="scan"]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/admin/health/scan',{});}catch(e){alert(e.message);}load(V);});
  B.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{V.filter=b.dataset.f;V.sure='';paint(V);});
  const q=B.querySelector('.lh-q');if(q)q.oninput=()=>{V.q=q.value;paint(V);};
  B.querySelectorAll('.lh-row').forEach(row=>{
    const id=row.dataset.id,cb=row.querySelector('input');
    cb.onclick=e=>{e.stopPropagation();if(cb.checked)V.sel.add(id);else V.sel.delete(id);V.sure='';paint(V);};
    row.onclick=e=>{if(e.target.closest('.lh-more'))return;if(V.openRow.has(id))V.openRow.delete(id);else V.openRow.add(id);paint(V);};
    row.querySelectorAll('[data-act]').forEach(b=>b.onclick=async e=>{e.stopPropagation();b.disabled=true;
      try{if(b.dataset.act==='repair')await api('/api/admin/health/repair',{ids:[id]});else await api('/api/admin/health/ignore',{ids:[id],ignore:b.dataset.act==='ignore'});}catch(err){alert(err.message);}
      load(V);});
  });
  const two=(act,fn)=>{const b=B.querySelector('[data-act="'+act+'"]');if(!b)return;b.onclick=async()=>{const k=act==='repair-all'?'all':'sel';if(V.sure!==k){V.sure=k;paint(V);return;}V.sure='';b.disabled=true;try{await fn();}catch(e){alert(e.message);}V.sel.clear();load(V);};};
  two('repair-sel',()=>api('/api/admin/health/repair',{ids:[...V.sel]}));
  two('repair-all',()=>api('/api/admin/health/repair',{all:true}));
  const ig=B.querySelector('[data-act="ignore-sel"]');if(ig)ig.onclick=async()=>{await api('/api/admin/health/ignore',{ids:[...V.sel],ignore:true}).catch(e=>alert(e.message));V.sel.clear();load(V);};
  B.querySelectorAll('[data-set]').forEach(el=>el.onchange=async()=>{const body={};body[el.dataset.set]=el.type==='checkbox'?el.checked:el.value;try{await api('/api/admin/health/settings',body);}catch(e){alert(e.message);}load(V);});
}

/* menu entries next to Resource Monitor (admins only, like it) */
function install(){
  if(PHONE){
    const mon=document.getElementById('mMonitor');
    if(mon&&!document.getElementById('mLibHealth')){
      const b=document.createElement('button');b.id='mLibHealth';b.type='button';b.className=mon.className;b.textContent='🩺 Library health';b.style.display=mon.style.display;
      mon.after(b);
      b.onclick=()=>{try{const m=document.getElementById('menu');const oc=m&&window.bootstrap&&bootstrap.Offcanvas.getInstance(m);if(oc)oc.hide();}catch(_){}open();};
      new MutationObserver(()=>{b.style.display=mon.style.display;}).observe(mon,{attributes:true,attributeFilter:['style']});
    }
  }else{
    const mon=document.getElementById('openMonitor');
    if(mon&&!document.getElementById('openLibHealth')){
      const b=document.createElement('div');b.className='settings-btn';b.id='openLibHealth';b.title='Find movies and episodes Plex can’t play, and repair them';b.style.display=mon.style.display;
      b.innerHTML=I.pulse.replace('width="18" height="18"','width="16" height="16"')+' Library health';
      mon.after(b);b.onclick=open;
      new MutationObserver(()=>{b.style.display=mon.style.display;}).observe(mon,{attributes:true,attributeFilter:['style']});
    }
  }
}
window.MediarrHealth={open};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
