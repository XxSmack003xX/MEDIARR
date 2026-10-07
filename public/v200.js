/* MEDIARR 2.0 — shared responsive Intelligence Hub for desktop, mobile and installed PWA. */
(function(){
'use strict';
const V='2.1.0';
let root=null,tab='overview',snap=null,notifyTimer=null,deferredInstall=null;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtBytes=n=>{n=Number(n)||0;if(!n)return '0 B';const u=['B','KB','MB','GB','TB','PB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return (i<2?n.toFixed(0):n.toFixed(1))+' '+u[i];};
const age=t=>{const s=Math.max(0,Math.floor((Date.now()-Number(t||0))/1000));if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';};
async function api(url,opt){const r=await fetch(url,opt);let j={};try{j=await r.json();}catch(_){}const d=j&&j.data!==undefined?j.data:j;if(!r.ok)throw new Error((d&&d.message)||('HTTP '+r.status));return d;}
function user(){try{return typeof currentUser!=='undefined'?currentUser:null;}catch(_){return null;}}
function css(){
 const s=document.createElement('style');s.id='v2Style';s.textContent=`
 #v2Launch{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:4200;border:1px solid rgba(232,176,75,.5);background:linear-gradient(135deg,#241d2b,#141217);color:#f6d58e;border-radius:999px;padding:12px 17px;font:800 13px Manrope,system-ui,sans-serif;box-shadow:0 15px 45px rgba(0,0,0,.45);cursor:pointer}
 #v2Launch b{background:#e8b04b;color:#17120b;border-radius:999px;padding:2px 7px;margin-left:7px}
 #v2Hub{position:fixed;inset:0;z-index:6500;background:#0c0b0ef5;color:#ece7f2;font-family:Manrope,system-ui,sans-serif;display:none;overflow:auto}
 #v2Hub.open{display:block}.v2shell{max-width:1500px;margin:auto;padding:20px 22px 70px}.v2top{display:flex;gap:12px;align-items:center;position:sticky;top:0;z-index:4;background:#0c0b0ef2;padding:10px 0 16px;backdrop-filter:blur(16px)}
 .v2brand{font-size:25px;font-weight:900;letter-spacing:.5px}.v2brand em{font-style:normal;color:#e8b04b}.v2sub{color:#9a90a8;font-size:12px}.v2close{margin-left:auto}.v2btn,.v2tab{border:1px solid #332b3a;background:#1a171e;color:#ece7f2;border-radius:10px;padding:9px 12px;cursor:pointer;font-weight:700}.v2btn:hover,.v2tab.on{border-color:#e8b04b;color:#e8b04b}.v2btn.good{border-color:#4ade80;color:#4ade80}.v2btn.bad{border-color:#f4607a;color:#f4607a}
 .v2tabs{display:flex;gap:8px;overflow:auto;padding:2px 0 15px}.v2grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px}.v2stat,.v2panel,.v2row{background:#17141b;border:1px solid #2e2834;border-radius:14px}.v2stat{padding:15px}.v2stat strong{display:block;font-size:24px;color:#fff}.v2stat span{font-size:11px;color:#9a90a8;text-transform:uppercase;letter-spacing:.7px}.v2panel{padding:16px;margin-top:12px}.v2panel h3{margin:0 0 12px;font-size:15px}.v2list{display:grid;gap:8px}.v2row{padding:11px 12px;display:flex;align-items:center;gap:10px}.v2row .grow{min-width:0;flex:1}.v2row .title{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v2meta{font-size:12px;color:#9a90a8;margin-top:3px}.v2pill{font-size:10px;border:1px solid #3a3341;border-radius:999px;padding:4px 7px;white-space:nowrap}.v2warn{border-color:#76552a}.v2bad{border-color:#743040}.v2ok{border-color:#285f3d}.v2empty{padding:30px;text-align:center;color:#9a90a8}.v2search{width:100%;background:#100e13;border:1px solid #332b3a;color:#fff;border-radius:12px;padding:12px 14px;font:inherit}.v2search:focus{outline:none;border-color:#e8b04b}.v2cols{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.v2toggle{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #27222d}.v2toggle:last-child{border:0}.v2toggle input[type=number]{width:90px;background:#100e13;color:#fff;border:1px solid #332b3a;border-radius:8px;padding:7px}.v2select{background:#100e13;color:#fff;border:1px solid #332b3a;border-radius:8px;padding:7px}
 .v2unread{box-shadow:inset 3px 0 #e8b04b}.v2hero{padding:18px;background:linear-gradient(135deg,#211a28,#131a20);border:1px solid #352c3e;border-radius:16px;margin-bottom:12px}.v2hero h2{margin:0 0 5px;font-size:22px}.v2hero p{margin:0;color:#aaa0b5;font-size:13px}.v2bar{height:6px;background:#2a2430;border-radius:9px;overflow:hidden;margin-top:8px}.v2bar i{display:block;height:100%;background:#e8b04b}
 @media(max-width:900px){.v2grid{grid-template-columns:repeat(3,1fr)}.v2cols{grid-template-columns:1fr}.v2shell{padding:12px 12px 80px}.v2brand{font-size:20px}}
 @media(max-width:520px){.v2grid{grid-template-columns:repeat(2,1fr)}#v2Launch{right:12px;bottom:12px}.v2row{align-items:flex-start;flex-wrap:wrap}.v2top{align-items:flex-start}.v2sub{display:none}}
 `;document.head.appendChild(s);
}
function shell(){
 if(document.getElementById('v2Hub'))return;
 css();
 const b=document.createElement('button');b.id='v2Launch';b.innerHTML='◆ MEDIARR 2.0 <b id="v2Badge">0</b>';b.onclick=()=>openHub();document.body.appendChild(b);
 root=document.createElement('div');root.id='v2Hub';root.innerHTML=`<div class="v2shell"><div class="v2top"><div><div class="v2brand">MEDIARR <em>2.0</em></div><div class="v2sub">Media Intelligence · Automation · Requests · Notifications</div></div><button class="v2btn" id="v2Install" style="display:none">Install app</button><button class="v2btn v2close">✕ Close</button></div><div class="v2tabs" id="v2Tabs"></div><main id="v2Body"><div class="v2empty">Loading…</div></main></div>`;
 document.body.appendChild(root);root.querySelector('.v2close').onclick=closeHub;
 const tabs=[['overview','Overview'],['search','Universal Search'],['pipeline','Pipeline'],['library','Library Intelligence'],['requests','Requests'],['notifications','Notifications'],['storage','Storage & Quality'],['automation','Automation']];
 const t=root.querySelector('#v2Tabs');for(const x of tabs){const z=document.createElement('button');z.className='v2tab';z.dataset.tab=x[0];z.textContent=x[1];z.onclick=()=>show(x[0]);t.appendChild(z);}
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const x=document.getElementById('v2Install');if(x)x.style.display='';});
 root.querySelector('#v2Install').onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;root.querySelector('#v2Install').style.display='none';};
}
function setTab(){root.querySelectorAll('.v2tab').forEach(x=>x.classList.toggle('on',x.dataset.tab===tab));}
async function openHub(initial){shell();root.classList.add('open');document.body.style.overflow='hidden';await show(initial||tab);}
function closeHub(){if(root)root.classList.remove('open');document.body.style.overflow='';}
function body(html){root.querySelector('#v2Body').innerHTML=html;}
async function ensureSnap(force){if(snap&&!force&&Date.now()-snap.generatedAt<30000)return snap;snap=await api('/api/v2/intelligence');return snap;}
function stat(n,label){return `<div class="v2stat"><strong>${esc(n)}</strong><span>${esc(label)}</span></div>`;}
async function overview(){
 const d=await ensureSnap(true),s=d.summary||{};
 body(`<div class="v2hero"><h2>Your media server, one lifecycle.</h2><p>Requested → Searching → Downloading → Imported → Verified on disk → Plex → Watched</p></div>
 <div class="v2grid">${stat(s.movies,'Movies')}${stat(s.series,'TV Series')}${stat(s.activeDownloads,'Active downloads')}${stat(s.missingMovies,'Missing movies')}${stat(s.missingEpisodes,'Missing episodes')}${stat(s.plexStreams,'Plex streams')}</div>
 <div class="v2cols"><section class="v2panel"><h3>Needs attention</h3><div class="v2list">${problemRows((d.problems||[]).slice(0,10))}</div></section>
 <section class="v2panel"><h3>Recent requests / additions</h3><div class="v2list">${requestRows((d.requests||[]).slice(0,10))}</div></section></div>`);
}
function problemRows(items){if(!items.length)return '<div class="v2empty">Everything looks healthy.</div>';return items.map(x=>`<div class="v2row ${x.severity==='warn'?'v2warn':''}"><div class="grow"><div class="title">${esc(x.title)}</div><div class="v2meta">${esc(x.detail)}</div></div><span class="v2pill">${esc(x.service)}</span>${x.action&&user()&&user().role==='admin'?'<button class="v2btn" data-repair="'+esc(x.service)+':'+esc(x.id)+'">Repair</button>':''}</div>`).join('');}
function requestRows(items){if(!items.length)return '<div class="v2empty">No recent requests.</div>';return items.map(x=>`<div class="v2row"><div class="grow"><div class="title">${esc(x.title)} ${x.year?'('+esc(x.year)+')':''}</div><div class="v2meta">${esc(x.username||'system')} · ${age(x.ts)}</div></div><span class="v2pill">${esc(x.service)}</span></div>`).join('');}
async function library(){
 const d=await ensureSnap(true);
 body(`<div class="v2grid">${stat(d.summary.missingMovies,'Missing movies')}${stat(d.summary.missingEpisodes,'Missing episodes')}${stat(d.summary.problems,'Issues')}${stat(d.summary.movies+d.summary.series,'Library titles')}</div><section class="v2panel"><h3>Media Intelligence findings</h3><div class="v2list">${problemRows(d.problems||[])}</div></section>`);
 root.querySelectorAll('[data-repair]').forEach(b=>b.onclick=async()=>{const [service,id]=b.dataset.repair.split(':');const old=b.textContent;b.disabled=true;b.textContent='Working…';try{const r=await api('/api/v2/admin/repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service,id})});b.textContent='✓ '+(r.message||'Queued');snap=null;}catch(e){b.textContent='⚠ '+e.message;}setTimeout(()=>{b.disabled=false;b.textContent=old;},3500);});
}
async function pipeline(){
 const d=await ensureSnap(true),p=d.pipeline||{},a=p.activity||{};
 body(`<div class="v2grid">${stat(a.active||0,'Active')}${stat(a.speed||'0 B/s','Download speed')}${stat(a.remaining||'—','Remaining')}${stat(a.timeLeft||'—','ETA')}${stat(a.completed24h||0,'Completed 24h')}${stat(a.failures||0,'Problems')}</div><div class="v2cols"><section class="v2panel"><h3>Recent Arr events</h3><div class="v2list">${(p.recent||[]).map(x=>`<div class="v2row"><div class="grow"><div class="title">${esc(x.title||x.eventType)}</div><div class="v2meta">${esc(x.service)} · ${esc(x.eventType)} · ${age(x.ts)}</div></div></div>`).join('')||'<div class="v2empty">No recent download/import events.</div>'}</div></section><section class="v2panel"><h3>Request pipeline</h3><div class="v2list">${requestRows((p.requests||[]).slice(0,20))}</div></section></div>`);
}
async function requests(){const d=await api('/api/v2/requests');body(`<section class="v2panel"><h3>${user()&&user().role==='admin'?'All recent requests':'My requests'}</h3><div class="v2list">${requestRows(d.items||[])}</div></section>`);}
async function notifications(){
 const d=await api('/api/v2/notifications');
 body(`<div style="display:flex;gap:8px;justify-content:flex-end"><button class="v2btn" id="v2ReadAll">Mark all read</button></div><section class="v2panel"><h3>Notification Center · ${d.unread||0} unread</h3><div class="v2list">${(d.items||[]).map(x=>`<div class="v2row ${x.read?'':'v2unread'}"><div class="grow"><div class="title">${esc(x.title)}</div><div class="v2meta">${esc(x.message)} · ${age(x.ts)}</div></div><span class="v2pill">${esc(x.event)}</span></div>`).join('')||'<div class="v2empty">No notifications yet. New MEDIARR events will appear here.</div>'}</div></section>`);
 const b=root.querySelector('#v2ReadAll');b.onclick=async()=>{await api('/api/v2/notifications/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});await refreshBadge();await notifications();};
}
async function storage(){
 const d=await ensureSnap(true),all=(d.movies||[]).concat(d.series||[]).sort((a,b)=>(b.size||0)-(a.size||0)),total=(d.storage&&d.storage.totalBytes)||0;
 body(`<div class="v2grid">${stat(fmtBytes(d.storage.moviesBytes),'Movies')}${stat(fmtBytes(d.storage.tvBytes),'TV')}${stat(fmtBytes(total),'Tracked storage')}${stat(all.filter(x=>x.quality).length,'Quality-tagged movies')}</div><section class="v2panel"><h3>Largest library items</h3><div class="v2list">${all.slice(0,40).map(x=>`<div class="v2row"><div class="grow"><div class="title">${esc(x.title)}</div><div class="v2meta">${esc(x.type)} ${x.quality?'· '+esc(x.quality):''}</div><div class="v2bar"><i style="width:${total?Math.max(1,(x.size/Math.max(...all.map(y=>y.size||0)))*100):0}%"></i></div></div><strong>${fmtBytes(x.size)}</strong></div>`).join('')}</div></section>`);
}
async function search(){
 body(`<div class="v2hero"><h2>Universal Search</h2><p>Search your Radarr/Sonarr library and TMDB at the same time.</p></div><input class="v2search" id="v2Q" placeholder="Search movies and TV shows…" autocomplete="off"><section class="v2panel"><div id="v2SearchResults" class="v2empty">Type at least 2 characters.</div></section>`);
 const q=root.querySelector('#v2Q'),out=root.querySelector('#v2SearchResults');let timer;
 q.oninput=()=>{clearTimeout(timer);timer=setTimeout(async()=>{const v=q.value.trim();if(v.length<2){out.className='v2empty';out.innerHTML='Type at least 2 characters.';return;}out.className='v2empty';out.textContent='Searching…';try{const d=await api('/api/v2/search?q='+encodeURIComponent(v));out.className='v2list';out.innerHTML=(d.items||[]).map((x,i)=>`<div class="v2row"><div class="grow"><div class="title">${esc(x.title)} ${x.year?'('+esc(x.year)+')':''}</div><div class="v2meta">${esc(x.source)} · ${esc(x.state||'')}</div></div><span class="v2pill">${esc(x.type)}</span>${x.source==='tmdb'?'<button class="v2btn good" data-add="'+i+'">+ Add</button>':''}</div>`).join('')||'<div class="v2empty">No matches.</div>';out.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{const x=d.items[Number(b.dataset.add)];b.disabled=true;b.textContent='Adding…';try{const r=await api('/api/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:x.type,title:x.title,year:x.year,tmdbId:x.tmdbId,search:true})});b.textContent=r.alreadyInLibrary?'Already added':'✓ Added';snap=null;}catch(e){b.textContent='⚠ '+e.message;}});}catch(e){out.className='v2empty';out.textContent=e.message;}},300);};
 setTimeout(()=>q.focus(),50);
}
async function automation(){
 if(!user()||user().role!=='admin'){body('<div class="v2empty">Automation controls are available to administrators.</div>');return;}
 const a=await api('/api/v2/admin/automation');
 body(`<div class="v2hero"><h2>Automation & Self-Healing</h2><p>Report mode is non-destructive. Repair mode can queue safe Radarr/Sonarr searches for monitored missing media.</p></div><div class="v2cols"><section class="v2panel"><h3>Rules</h3>
 <label class="v2toggle"><span>Scheduled automation</span><input id="aEnabled" type="checkbox" ${a.enabled?'checked':''}></label>
 <label class="v2toggle"><span>Mode</span><select id="aMode" class="v2select"><option value="report" ${a.mode==='report'?'selected':''}>Report only</option><option value="repair" ${a.mode==='repair'?'selected':''}>Auto repair</option></select></label>
 <label class="v2toggle"><span>Interval (minutes)</span><input id="aInterval" type="number" min="15" max="1440" value="${Number(a.intervalMinutes)||60}"></label>
 <label class="v2toggle"><span>Search missing movies</span><input id="aMovies" type="checkbox" ${a.searchMissingMovies!==false?'checked':''}></label>
 <label class="v2toggle"><span>Search missing aired episodes</span><input id="aEpisodes" type="checkbox" ${a.searchMissingEpisodes!==false?'checked':''}></label>
 <div style="display:flex;gap:8px;margin-top:12px"><button class="v2btn good" id="aSave">Save rules</button><button class="v2btn" id="aReport">Run report</button><button class="v2btn bad" id="aRepair">Run repair</button></div></section>
 <section class="v2panel"><h3>Last run</h3><div id="aLast">${a.lastResult?esc(JSON.stringify(a.lastResult,null,2)):'No automation run yet.'}</div></section></div>`);
 root.querySelector('#aSave').onclick=async()=>{const b=root.querySelector('#aSave');b.disabled=true;try{await api('/api/v2/admin/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:root.querySelector('#aEnabled').checked,mode:root.querySelector('#aMode').value,intervalMinutes:Number(root.querySelector('#aInterval').value),searchMissingMovies:root.querySelector('#aMovies').checked,searchMissingEpisodes:root.querySelector('#aEpisodes').checked})});b.textContent='✓ Saved';}catch(e){b.textContent='⚠ '+e.message;}setTimeout(()=>{b.disabled=false;b.textContent='Save rules';},2500);};
 async function run(mode,btn){btn.disabled=true;btn.textContent='Running…';try{const r=await api('/api/v2/admin/automation/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});root.querySelector('#aLast').innerHTML='<pre style="white-space:pre-wrap">'+esc(JSON.stringify(r,null,2))+'</pre>';snap=null;btn.textContent='✓ Complete';}catch(e){btn.textContent='⚠ '+e.message;}setTimeout(()=>{btn.disabled=false;btn.textContent=mode==='repair'?'Run repair':'Run report';},3000);}
 root.querySelector('#aReport').onclick=e=>run('report',e.currentTarget);root.querySelector('#aRepair').onclick=e=>run('repair',e.currentTarget);
}
async function show(which){tab=which;setTab();body('<div class="v2empty">Loading…</div>');try{if(which==='overview')await overview();else if(which==='search')await search();else if(which==='pipeline')await pipeline();else if(which==='library')await library();else if(which==='requests')await requests();else if(which==='notifications')await notifications();else if(which==='storage')await storage();else if(which==='automation')await automation();}catch(e){body('<div class="v2empty">⚠ '+esc(e.message)+'</div>');}}
async function refreshBadge(){if(!user())return;try{const d=await api('/api/v2/notifications');const b=document.getElementById('v2Badge');if(b)b.textContent=String(d.unread||0);}catch(_){}}
function boot(){shell();refreshBadge();if(notifyTimer)clearInterval(notifyTimer);notifyTimer=setInterval(()=>{if(!document.hidden)refreshBadge();},30000);const p=new URLSearchParams(location.search).get('v2');if(p)setTimeout(()=>openHub(p),300);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0));else setTimeout(boot,0);
window.MEDIARR2={open:openHub,version:V};
})();