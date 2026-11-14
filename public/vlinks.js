/*
 * MEDIARR direct movie and TV links (v2.16) — desktop and phone sites.
 * Share a movie, an episode, a season or a whole show as a link that plays in VLC,
 * Infuse, Kodi, a browser or a smart TV without signing in. Links are made with link
 * keys that expire; a key can cover one file or folder, or everything.
 *   MediarrLinks.share({path, name, kind:'file'|'folder', targets:[…]})
 *   MediarrLinks.manage()
 */
(function(){
'use strict';
if(window.MediarrLinks)return;

const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PHONE=!!document.getElementById('mDownloads');
const sv=(d,w)=>'<svg viewBox="0 0 24 24" width="'+(w||18)+'" height="'+(w||18)+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
const I={
  link:sv('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  film:sv('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>'),
  tv:sv('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M8 2l4 4 4-4"/>'),
  folder:sv('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  globe:sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  copy:sv('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',16),
  open:sv('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',16),
  check:sv('<path d="M5 12l5 5 9-10"/>',16),
  x:sv('<path d="M6 6l12 12M18 6L6 18"/>',18),
  shield:sv('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',16),
  warn:sv('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',16),
  key:sv('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',16),
  plus:sv('<path d="M12 5v14M5 12h14"/>',16),
  trash:sv('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',15)
};
const LINK_CHOICES=[[1,'1 hour'],[24,'1 day'],[168,'7 days'],[720,'30 days'],[2160,'90 days'],[8760,'1 year'],[0,'Never expires']];
const DAY_OPTS=[[1,'1 day'],[7,'7 days'],[30,'30 days'],[90,'90 days'],[365,'1 year']];

const CSS=`
.vl-back{--vl-a:var(--gold,var(--bs-warning,#e8b04a));--vl-p:var(--panel,var(--bs-tertiary-bg,#171b25));--vl-p2:var(--panel2,var(--bs-secondary-bg,#1d2230));--vl-bg:var(--bg2,var(--bs-body-bg,#12151d));--vl-l:var(--line,var(--bs-border-color,#2a3142));--vl-t:var(--txt,var(--bs-body-color,#e8eaf0));--vl-m:var(--muted,var(--bs-secondary-color,#8f97a8));--vl-ok:#35c98a;--vl-warn:#f0a73a;--vl-bad:#f0625d;
  position:fixed;inset:0;z-index:9500;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 24px;overflow-y:auto;background:rgba(6,6,10,.62);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:vlFade .18s ease;font-size:14px;line-height:1.45;color:var(--vl-t);text-align:left}
.vl-back *{box-sizing:border-box}
@keyframes vlFade{from{opacity:0}}
@keyframes vlRise{from{opacity:0;transform:translateY(16px) scale(.985)}}
.vl-sheet{width:100%;max-width:560px;background:var(--vl-bg);border:1px solid var(--vl-l);border-radius:20px;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);animation:vlRise .24s cubic-bezier(.2,.8,.3,1);overflow:hidden}
.vl-sheet.wide{max-width:720px}
.vl-head{position:relative;display:flex;align-items:center;gap:14px;padding:20px 20px 18px;background:radial-gradient(120% 140% at 0% 0%,color-mix(in srgb,var(--vl-a) 16%,transparent),transparent 60%);border-bottom:1px solid var(--vl-l)}
.vl-ic{flex:none;width:44px;height:44px;border-radius:13px;display:grid;place-items:center;color:#17130a;background:linear-gradient(140deg,color-mix(in srgb,var(--vl-a) 80%,#fff),var(--vl-a));box-shadow:0 8px 20px -8px color-mix(in srgb,var(--vl-a) 70%,transparent)}
.vl-ht{min-width:0;flex:1}
.vl-ht h3{margin:0;font-size:18px;font-weight:800;letter-spacing:-.2px;color:var(--vl-t)}
.vl-ht p{margin:2px 0 0;color:var(--vl-m);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vl-x{flex:none;width:36px;height:36px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--vl-m);display:grid;place-items:center;cursor:pointer}
.vl-x:hover{color:var(--vl-t);background:var(--vl-p)}
.vl-body{padding:18px 20px 20px;display:grid;gap:14px}
.vl-f{display:grid;gap:6px;min-width:0}
.vl-f>label,.vl-lab{font-size:11.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:var(--vl-m)}
.vl-row{display:flex;gap:12px;flex-wrap:wrap}
.vl-row>.vl-f{flex:1;min-width:190px}
.vl-sel,.vl-inp{width:100%;height:42px;padding:0 12px;border-radius:11px;border:1px solid var(--vl-l);background:var(--vl-p);color:var(--vl-t);font:inherit;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s;min-width:0}
.vl-sel{appearance:none;-webkit-appearance:none;padding-right:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238f97a8' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;cursor:pointer}
.vl-sel:focus,.vl-inp:focus{border-color:var(--vl-a);box-shadow:0 0 0 3px color-mix(in srgb,var(--vl-a) 22%,transparent)}
.vl-sel option,.vl-sel optgroup{background:var(--vl-bg);color:var(--vl-t)}
.vl-url{display:flex;gap:8px;align-items:stretch}
.vl-url .vl-inp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--vl-t);background:var(--vl-p2)}
.vl-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:42px;padding:0 16px;border-radius:11px;border:1px solid var(--vl-l);background:var(--vl-p);color:var(--vl-t);font:inherit;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none;transition:transform .1s,background .15s,border-color .15s}
.vl-btn:hover{border-color:var(--vl-a);color:var(--vl-t)}
.vl-btn:active{transform:scale(.97)}
.vl-btn.pri{background:var(--vl-a);border-color:var(--vl-a);color:#17130a}
.vl-btn.pri:hover{filter:brightness(1.07);color:#17130a}
.vl-btn.ok{background:var(--vl-ok);border-color:var(--vl-ok);color:#06210f}
.vl-btn.sm{height:34px;padding:0 12px;font-size:13px;border-radius:9px}
.vl-btn.dan{color:var(--vl-bad)}
.vl-btn.dan:hover{border-color:var(--vl-bad)}
.vl-btn[disabled]{opacity:.55;cursor:default}
.vl-opts{display:flex;gap:8px;flex-wrap:wrap}
.vl-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:99px;border:1px solid var(--vl-l);background:var(--vl-p);color:var(--vl-m);font-size:13px;font-weight:700;cursor:pointer;user-select:none;transition:all .15s}
.vl-chip input{display:none}
.vl-chip i{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;display:inline-block;position:relative}
.vl-chip.box i{border-radius:4px}
.vl-chip.on{color:var(--vl-t);border-color:var(--vl-a);background:color-mix(in srgb,var(--vl-a) 12%,var(--vl-p))}
.vl-chip.on i{border-color:var(--vl-a);background:var(--vl-a);box-shadow:inset 0 0 0 2px var(--vl-bg)}
.vl-note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--vl-p);border:1px solid var(--vl-l);color:var(--vl-m);font-size:13px}
.vl-note svg{flex:none;margin-top:1px;color:var(--vl-ok)}
.vl-note b{color:var(--vl-t)}
.vl-note.warn{border-color:color-mix(in srgb,var(--vl-warn) 45%,transparent);background:color-mix(in srgb,var(--vl-warn) 9%,var(--vl-p))}
.vl-note.warn svg{color:var(--vl-warn)}
.vl-note.bad svg{color:var(--vl-bad)}
.vl-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:2px}
.vl-a{background:none;border:0;padding:0;font:inherit;font-size:13px;font-weight:700;color:var(--vl-a);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.vl-a:hover{text-decoration:underline}
.vl-apps{font-size:12px;color:var(--vl-m)}
.vl-sec{display:flex;align-items:center;gap:10px;margin:6px 0 -2px}
.vl-sec h4{margin:0;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--vl-m)}
.vl-sec:after{content:"";flex:1;height:1px;background:var(--vl-l)}
.vl-keys{display:grid;gap:10px}
.vl-key{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:13px 14px;border-radius:14px;border:1px solid var(--vl-l);background:var(--vl-p);align-items:start}
.vl-key.exp{opacity:.7}
.vl-kic{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--vl-a) 14%,transparent);color:var(--vl-a)}
.vl-key.all .vl-kic{background:color-mix(in srgb,#5fa8ff 14%,transparent);color:#5fa8ff}
.vl-km{min-width:0}
.vl-km b{display:block;font-size:14.5px;color:var(--vl-t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vl-km .s{font-size:12.5px;color:var(--vl-m);overflow-wrap:anywhere}
.vl-km .s .bad{color:var(--vl-bad);font-weight:700}
.vl-km .s .soon{color:var(--vl-warn);font-weight:700}
.vl-ka{grid-column:2;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.vl-ka .vl-sel{height:34px;width:auto;min-width:150px;font-size:13px;border-radius:9px}
.vl-empty{padding:18px;border:1px dashed var(--vl-l);border-radius:14px;text-align:center;color:var(--vl-m);font-size:13.5px}
.vl-tog{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:12px;background:var(--vl-p);border:1px solid var(--vl-l);cursor:pointer}
.vl-tog>span:first-child{flex:1;min-width:0}
.vl-tog b{display:block;color:var(--vl-t);font-size:14px}
.vl-tog small{display:block;color:var(--vl-m);font-size:12.5px}
.vl-sw{position:relative;flex:none;width:44px;height:26px}
.vl-sw input{opacity:0;width:0;height:0;position:absolute}
.vl-sw i{position:absolute;inset:0;border-radius:99px;background:var(--vl-l);transition:background .2s}
.vl-sw i:after{content:"";position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.vl-sw input:checked+i{background:var(--vl-a)}
.vl-sw input:checked+i:after{transform:translateX(18px)}
.vl-spin{width:26px;height:26px;border:3px solid var(--vl-l);border-top-color:var(--vl-a);border-radius:50%;animation:vlSpin .8s linear infinite;margin:18px auto}
@keyframes vlSpin{to{transform:rotate(360deg)}}
.vl-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9600;padding:10px 16px;border-radius:12px;background:#111;color:#fff;font-size:13.5px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.4);animation:vlRise .2s ease;display:flex;align-items:center;gap:8px}
.vl-toast svg{color:#35c98a}
.vl-share-btn{display:inline-flex;align-items:center;gap:6px}
@media (max-width:600px){
  .vl-back{padding:0;align-items:flex-end}
  .vl-sheet,.vl-sheet.wide{max-width:none;border-radius:20px 20px 0 0;border-bottom:0;max-height:92vh;overflow-y:auto;animation:vlUp .26s cubic-bezier(.2,.8,.3,1)}
  .vl-head{padding:16px 16px 14px}
  .vl-body{padding:16px 16px calc(18px + env(safe-area-inset-bottom))}
  .vl-url{flex-wrap:wrap}
  .vl-url .vl-inp{flex:1 1 100%}
  .vl-url .vl-btn{flex:1}
  .vl-ka .vl-sel{flex:1 1 100%}
}
@keyframes vlUp{from{transform:translateY(40px);opacity:.4}}
@media (prefers-reduced-motion:reduce){.vl-back,.vl-sheet,.vl-toast{animation:none}}
`;

/* ---------- helpers ---------- */
async function api(url,opts){
  opts=opts||{};
  const r=await fetch(url,{method:opts.method||'GET',credentials:'same-origin',headers:opts.body?{'Content-Type':'application/json'}:{},body:opts.body?JSON.stringify(opts.body):undefined});
  let j={};try{j=await r.json();}catch(_){}
  if(r.status===401)throw new Error('Sign in again to manage direct links.');
  if(!r.ok)throw new Error(j.message||('HTTP '+r.status));
  return j;
}
const plural=(n,w)=>n.toLocaleString()+' '+w+(n===1?'':'s');
function relTime(ts){
  const d=ts-Date.now(),a=Math.abs(d),m=Math.round(a/60000),h=Math.round(a/3600000),dd=Math.round(a/86400000);
  const s=m<1?'less than a minute':m<60?plural(m,'minute'):h<48?plural(h,'hour'):dd<60?plural(dd,'day'):dd<730?plural(Math.round(dd/30),'month'):plural(Math.round(dd/365),'year');
  return d>=0?'in '+s:s+' ago';
}
const expText=k=>!k.expires?'Never expires':k.expired?'Expired '+relTime(k.expires):'Expires '+relTime(k.expires);
const linkChoices=p=>LINK_CHOICES.filter(([h])=>h===0?!p.maxDays:(!p.maxDays||h<=p.maxDays*24));
const inScope=(k,path)=>!k.scope||path===k.scope||path.startsWith(k.scope+'/');
const encPath=p=>String(p||'').split('/').filter(Boolean).map(encodeURIComponent).join('/');
const baseName=p=>String(p||'').split('/').filter(Boolean).pop()||'';
function linkUrl(key,t,o){
  o=o||{};
  const q=[];if(o.transcode)q.push('transcode=1');if(o.dl&&t.kind==='file')q.push('dl=1');
  const base=location.origin+'/video/d/'+key+'/';
  const u=t.kind==='file'?base+'f/'+encPath(t.path):base+'folder/'+(t.path?encPath(t.path)+'/':'')+'playlist.m3u8';
  return u+(q.length?'?'+q.join('&'):'');
}
async function copyText(text,input){
  try{await navigator.clipboard.writeText(text);return true;}
  catch(_){if(input){input.focus();input.select();try{return document.execCommand('copy');}catch(__){}}return false;}
}
let toastT=0;
function toast(msg,good){
  document.querySelectorAll('.vl-toast').forEach(t=>t.remove());
  const t=document.createElement('div');t.className='vl-toast';t.setAttribute('role','status');t.innerHTML=(good?I.check:'')+esc(msg);
  (document.querySelector('.vl-back:last-of-type')||document.body).appendChild(t);
  clearTimeout(toastT);toastT=setTimeout(()=>t.remove(),2400);
}
function scopeText(k){
  if(!k.scope)return 'Everything you can browse';
  return (k.scopeKind==='file'?'Only ':'Only the folder ')+'“'+baseName(k.scope)+'”';
}
const kindIcon=t=>t.kind==='file'?I.film:t.show?I.tv:t.path?I.folder:I.globe;
function thingWord(t){
  if(t.kind==='file')return t.episode?'episode':'video';
  if(t.season)return 'season';
  if(t.show)return 'show';
  return t.path?'folder':'library';
}

let cssDone=false;
function sheet(title,sub,icon,wide){
  if(!cssDone){const st=document.createElement('style');st.id='vlinksStyle';st.textContent=CSS;document.head.appendChild(st);cssDone=true;}
  const back=document.createElement('div');back.className='vl-back';
  back.innerHTML='<div class="vl-sheet'+(wide?' wide':'')+'" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><div class="vl-head"><div class="vl-ic">'+icon+'</div><div class="vl-ht"><h3>'+esc(title)+'</h3>'+(sub?'<p title="'+esc(sub)+'">'+esc(sub)+'</p>':'')+'</div><button class="vl-x" type="button" aria-label="Close">'+I.x+'</button></div><div class="vl-body"><div class="vl-spin"></div></div></div>';
  // inside an open Bootstrap modal (phone site) so its focus trap leaves our fields alone
  const host=[...document.querySelectorAll('.modal.show')].pop()||document.body;
  host.appendChild(back);
  const key=e=>{if(e.key==='Escape'&&back.isConnected&&back===[...document.querySelectorAll('.vl-back')].pop()){e.stopPropagation();e.preventDefault();close();}};
  // on window, so it runs before the pages' own Esc handlers (player, overlays)
  const close=()=>{back.remove();window.removeEventListener('keydown',key,true);};
  window.addEventListener('keydown',key,true);
  back.addEventListener('click',e=>{if(e.target===back)close();});
  back.querySelector('.vl-x').onclick=close;
  setTimeout(()=>{try{back.querySelector('.vl-x').focus({preventScroll:true});}catch(_){}},30);
  return {el:back,body:back.querySelector('.vl-body'),close};
}
function expirySelect(id,pol,cur){
  const def=cur!=null?cur:(pol.defaultDays?pol.defaultDays*24:0);
  return '<select class="vl-sel" id="'+id+'">'+linkChoices(pol).map(([h,l])=>'<option value="'+h+'"'+(h===def?' selected':'')+'>'+l+'</option>').join('')+'</select>';
}

const S={data:null,at:0};
async function load(force){
  if(!force&&S.data&&Date.now()-S.at<15000)return S.data;
  S.data=await api('/api/video/keys');S.at=Date.now();
  return S.data;
}

/* ---------- share one movie, episode, season, show or folder ---------- */
function share(opts){
  opts=opts||{};
  const targets=(opts.targets&&opts.targets.length?opts.targets:[{path:opts.path||'',kind:opts.kind==='folder'?'folder':'file',label:opts.name||baseName(opts.path)||'Everything'}])
    .map(t=>Object.assign({},t,{path:String(t.path||'').split('/').filter(Boolean).join('/')}));
  let ti=Math.max(0,Math.min(targets.length-1,Number(opts.index)||0));
  const m=sheet('Direct link',opts.title||targets[ti].label||baseName(targets[ti].path),I.link);
  let sel='',fmt={transcode:false,dl:false},busy=false;
  const paint=async()=>{
    let d;
    try{d=await load();}catch(e){m.body.innerHTML='<div class="vl-note bad">'+I.warn+'<div>'+esc(e.message)+'</div></div>';return;}
    if(!m.el.isConnected)return;
    const t=targets[ti],pol=d.policy,word=thingWord(t);
    if(!pol.enabled){m.body.innerHTML='<div class="vl-note warn">'+I.warn+'<div><b>Direct links are turned off on this server.</b> '+(d.canCreate===false?'Ask your admin to turn them on.':'An admin can turn them on in Direct links.')+'</div></div>';return;}
    if(!d.canCreate){m.body.innerHTML='<div class="vl-note warn">'+I.warn+'<div><b>Only admins can share direct links here.</b> Ask your admin to share this for you, or to let everyone make links.</div></div>';return;}
    const usable=d.keys.filter(k=>!k.expired&&inScope(k,t.path));
    // prefer a key made for exactly this, then the narrowest one that covers it
    if(!sel||(sel!=='new-this'&&sel!=='new-all'&&!usable.some(k=>k.id===sel))){
      const exact=usable.find(k=>k.scope===t.path&&k.scope);
      const narrow=usable.slice().sort((a,b)=>(b.scope||'').length-(a.scope||'').length)[0];
      sel=exact?exact.id:(narrow&&narrow.scope)?narrow.id:'new-this';
      if(sel==='new-this'&&!t.path)sel=narrow?narrow.id:'new-all';
    }
    const k=usable.find(x=>x.id===sel);
    let h='';
    if(targets.length>1){
      const groups={};targets.forEach((x,i)=>{(groups[x.group||'']=groups[x.group||'']||[]).push([x,i]);});
      h+='<div class="vl-f"><label for="vlWhat">What to share</label><select class="vl-sel" id="vlWhat">'+Object.keys(groups).map(g=>(g?'<optgroup label="'+esc(g)+'">':'')+groups[g].map(([x,i])=>'<option value="'+i+'"'+(i===ti?' selected':'')+'>'+esc(x.label+(x.count?' · '+plural(x.count,'episode'):''))+'</option>').join('')+(g?'</optgroup>':'')).join('')+'</select></div>';
    }
    const newThis=t.path?'<option value="new-this"'+(sel==='new-this'?' selected':'')+'>＋ New key just for this '+word+'</option>':'';
    h+='<div class="vl-f"><label for="vlKey">Link key</label><select class="vl-sel" id="vlKey">'
      +(usable.length?'<optgroup label="Your keys">'+usable.map(x=>'<option value="'+x.id+'"'+(x.id===sel?' selected':'')+'>'+esc(x.label)+' · '+(x.scope?(x.scope===t.path?'just this':'“'+esc(baseName(x.scope))+'”'):'everything')+' · '+esc(expText(x).toLowerCase())+'</option>').join('')+'</optgroup>':'')
      +'<optgroup label="Make a new key">'+newThis+'<option value="new-all"'+(sel==='new-all'?' selected':'')+'>＋ New key for everything</option></optgroup></select></div>';
    if(!k){
      const isThis=sel==='new-this';
      h+='<div class="vl-row"><div class="vl-f"><label for="vlName">Key name</label><input class="vl-inp" id="vlName" maxlength="80" value="'+esc(isThis?(t.label||baseName(t.path)):'Everything')+'"></div>'
        +'<div class="vl-f"><label for="vlHours">Works for</label>'+expirySelect('vlHours',pol)+'</div></div>'
        +'<div class="vl-note">'+I.shield+'<div>'+(isThis?'This key opens <b>only this '+word+'</b>'+(t.kind==='folder'?' and what’s inside it':'')+'. Safe to share with friends.':'This key opens <b>everything you can browse</b>, so keep it to your own devices. To share with someone else, make a key just for this '+word+'.')+'</div></div>'
        +'<div class="vl-foot"><button class="vl-a" type="button" data-manage>'+I.key+'Manage link keys</button><button class="vl-btn pri" type="button" id="vlCreate">'+I.link+'Create link</button></div>';
      m.body.innerHTML=h;
    }else{
      const url=linkUrl(k.key,t,fmt);
      const wider=k.scope!==t.path;
      h+='<div class="vl-f"><label for="vlUrl">'+(t.kind==='file'?'Link to this '+word:'Playlist (M3U) with every episode and video')+'</label><div class="vl-url"><input class="vl-inp" id="vlUrl" readonly value="'+esc(url)+'"><button class="vl-btn pri" type="button" id="vlCopy">'+I.copy+'Copy</button><a class="vl-btn" id="vlOpen" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+I.open+'Open</a></div></div>'
        +'<div class="vl-opts" role="group" aria-label="Link options">'
        +'<label class="vl-chip'+(!fmt.transcode?' on':'')+'"><input type="radio" name="vlFmt" value="orig"'+(!fmt.transcode?' checked':'')+'><i></i>Original file</label>'
        +'<label class="vl-chip'+(fmt.transcode?' on':'')+'" title="MEDIARR converts the video while it plays, for players that can’t open the original. Seeking isn’t possible."><input type="radio" name="vlFmt" value="tc"'+(fmt.transcode?' checked':'')+'><i></i>Convert while playing</label>'
        +(t.kind==='file'?'<label class="vl-chip box'+(fmt.dl?' on':'')+'"><input type="checkbox" id="vlDl"'+(fmt.dl?' checked':'')+'><i></i>Download instead of play</label>':'')
        +'</div>'
        +(!k.scope&&t.path?'<div class="vl-note warn">'+I.warn+'<div>This key opens <b>everything you can browse</b>, not just this '+word+'. To share with someone else, pick <b>New key just for this '+word+'</b>.</div></div>'
          :'<div class="vl-note">'+I.shield+'<div>Anyone with this link can '+(t.kind==='file'?'watch this '+word:'play every video in this '+word)+' without signing in '+(k.expires?'until <b>'+esc(new Date(k.expires).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+'</b> ('+esc(relTime(k.expires))+')':'until you revoke the key')+'.'+(wider&&k.scope?' The key covers all of “'+esc(baseName(k.scope))+'”.':'')+'</div></div>')
        +'<div class="vl-foot"><button class="vl-a" type="button" data-manage>'+I.key+'Manage link keys</button><span class="vl-apps">'+(t.kind==='file'?'Plays in a browser, VLC, Infuse, Kodi, MX Player and smart TVs':'Open in VLC, Infuse, Kodi, MPV or MX Player')+'</span></div>';
      m.body.innerHTML=h;
      const inp=m.body.querySelector('#vlUrl');inp.onclick=()=>inp.select();
      const cb=m.body.querySelector('#vlCopy');
      cb.onclick=async()=>{const okc=await copyText(inp.value,inp);if(okc){cb.classList.add('ok');cb.innerHTML=I.check+'Copied';setTimeout(()=>{if(cb.isConnected){cb.classList.remove('ok');cb.innerHTML=I.copy+'Copy';}},1800);}else toast('Select the link and copy it');};
      m.body.querySelectorAll('input[name=vlFmt]').forEach(r=>r.onchange=()=>{fmt.transcode=r.value==='tc';paint();});
      const dl=m.body.querySelector('#vlDl');if(dl)dl.onchange=()=>{fmt.dl=dl.checked;paint();};
    }
    const what=m.body.querySelector('#vlWhat');if(what)what.onchange=()=>{ti=Number(what.value)||0;sel='';const sub=m.el.querySelector('.vl-ht p');if(sub){sub.textContent=targets[ti].label;sub.title=targets[ti].label;}paint();};
    m.body.querySelector('#vlKey').onchange=e=>{sel=e.target.value;paint();};
    m.body.querySelector('[data-manage]').onclick=()=>{manage();};
    const cr=m.body.querySelector('#vlCreate');
    if(cr)cr.onclick=async()=>{
      if(busy)return;busy=true;cr.disabled=true;
      const isThis=sel==='new-this';
      try{
        const r=await api('/api/video/keys',{method:'POST',body:{label:m.body.querySelector('#vlName').value,hours:Number(m.body.querySelector('#vlHours').value),scope:isThis?t.path:'',scopeKind:isThis?t.kind:''}});
        d.keys.unshift(r.key);S.at=Date.now();sel=r.key.id;toast('Link ready',true);
      }catch(e){toast(e.message);}
      busy=false;paint();
    };
  };
  paint();
  return m;
}

/* ---------- manage keys (and, for admins, the server's rules) ---------- */
function manage(){
  const m=sheet('Direct links','Watch movies and shows outside MEDIARR',I.link,true);
  const isAdmin=()=>{try{if(typeof currentUser!=='undefined'&&currentUser)return currentUser.role==='admin';}catch(_){}try{if(typeof me!=='undefined'&&me)return me.role==='admin';}catch(_){}return false;};
  const paint=async()=>{
    const admin=isAdmin();
    let d;
    try{d=await api('/api/video/keys'+(admin?'?all=1':''));S.data=d;S.at=Date.now();}catch(e){m.body.innerHTML='<div class="vl-note bad">'+I.warn+'<div>'+esc(e.message)+'</div></div>';return;}
    if(!m.el.isConnected)return;
    const pol=d.policy,ch=linkChoices(pol);
    const keyIcon=k=>!k.scope?I.globe:k.scopeKind==='file'?I.film:I.folder;
    const meta=k=>{const soon=k.expires&&!k.expired&&k.expires-Date.now()<86400000;return '<span class="'+(k.expired?'bad':soon?'soon':'')+'">'+esc(expText(k))+'</span> · '+(k.uses?'used '+plural(k.uses,'time')+', last '+esc(relTime(k.lastUsed)):'not used yet');};
    let h='<p style="margin:0;color:var(--vl-m);font-size:13.5px">A direct link plays a movie, an episode or a whole show in VLC, Infuse, Kodi, a browser or a smart TV, without signing in. Share any video from <b style="color:var(--vl-t)">Downloads</b> or a movie or show page. Every link uses a key that stops working when it expires or when you revoke it.</p>';
    if(!pol.enabled)h+='<div class="vl-note warn">'+I.warn+'<div><b>Direct links are turned off</b>, so no link works right now. '+(admin?'Turn them on below. Keys are kept.':'Ask your admin to turn them on.')+'</div></div>';
    else if(!d.canCreate)h+='<div class="vl-note warn">'+I.warn+'<div><b>Only admins can share direct links on this server.</b></div></div>';
    h+='<div class="vl-sec"><h4>Your keys</h4></div>';
    h+=d.keys.length?'<div class="vl-keys">'+d.keys.map(k=>'<div class="vl-key'+(k.expired?' exp':'')+(k.scope?'':' all')+'"><div class="vl-kic">'+keyIcon(k)+'</div><div class="vl-km"><b>'+esc(k.label)+'</b><div class="s">'+esc(scopeText(k))+(k.scope?' <span style="opacity:.75">('+esc(k.scope)+')</span>':'')+'</div><div class="s">'+meta(k)+'</div></div>'
      +'<div class="vl-ka"><select class="vl-sel" data-exp="'+k.id+'" aria-label="Change how long it works"><option value="">Change expiry…</option>'+ch.map(([hh,l])=>'<option value="'+hh+'">'+(hh?'Works for '+l+' from now':'Never expires')+'</option>').join('')+'</select>'
      +(k.scope?'<button class="vl-btn sm" type="button" data-copy="'+k.id+'">'+I.copy+'Copy link</button>':'')
      +'<button class="vl-btn sm dan" type="button" data-rev="'+k.id+'">'+I.trash+'Revoke</button></div></div>').join('')+'</div>'
      :'<div class="vl-empty">You don’t have any link keys yet. Use the '+I.link.replace('width="18" height="18"','width="14" height="14" style="vertical-align:-2px"')+' button next to a video in Downloads, or <b>Direct link</b> on a movie or show.</div>';
    if(pol.enabled&&d.canCreate)h+='<div><button class="vl-btn" type="button" id="vlNewAll">'+I.plus+'New key for everything</button></div>';
    if(admin){
      const opt=(v,l,cur)=>'<option value="'+v+'"'+(v===cur?' selected':'')+'>'+l+'</option>';
      h+='<div class="vl-sec"><h4>For everyone (admin)</h4></div>'
        +'<label class="vl-tog"><span><b>Allow direct links</b><small>Turn off to stop every movie and TV link at once. Keys are kept, so turning it back on restores them.</small></span><span class="vl-sw"><input type="checkbox" id="vlpOn"'+(pol.enabled?' checked':'')+'><i></i></span></label>'
        +'<label class="vl-tog"><span><b>Let everyone make links</b><small>Off: only admins can share, and links made by other people stop working.</small></span><span class="vl-sw"><input type="checkbox" id="vlpUsers"'+(pol.users?' checked':'')+'><i></i></span></label>'
        +'<div class="vl-row"><div class="vl-f"><label for="vlpMax">Longest a key can work</label><select class="vl-sel" id="vlpMax">'+DAY_OPTS.map(([v,l])=>opt(v,l,pol.maxDays)).join('')+opt(0,'No limit (keys can be permanent)',pol.maxDays)+'</select></div>'
        +'<div class="vl-f"><label for="vlpDef">Default for new keys</label><select class="vl-sel" id="vlpDef">'+DAY_OPTS.map(([v,l])=>opt(v,l,pol.defaultDays)).join('')+opt(0,'Never expires',pol.defaultDays)+'</select></div></div>'
        +'<div style="margin-top:-6px;font-size:12px;color:var(--vl-m)">Lowering the limit also shortens keys that already run longer.</div>'
        +'<div class="vl-sec"><h4>Everyone’s keys</h4></div>'
        +((d.all||[]).length?'<div class="vl-keys">'+d.all.map(k=>'<div class="vl-key'+(k.expired?' exp':'')+(k.scope?'':' all')+'"><div class="vl-kic">'+keyIcon(k)+'</div><div class="vl-km"><b>'+esc(k.username)+' · '+esc(k.label)+'</b><div class="s">'+esc(scopeText(k))+(k.scope?' <span style="opacity:.75">('+esc(k.scope)+')</span>':'')+'</div><div class="s">'+meta(k)+'</div></div><div class="vl-ka"><button class="vl-btn sm dan" type="button" data-rev="'+k.id+'">'+I.trash+'Revoke</button></div></div>').join('')+'</div>':'<div class="vl-empty">Nobody has a link key.</div>');
    }
    m.body.innerHTML=h;
    m.body.querySelectorAll('[data-exp]').forEach(s=>s.onchange=async()=>{if(s.value==='')return;try{await api('/api/video/keys/'+s.dataset.exp,{method:'POST',body:{hours:Number(s.value)}});toast('Updated',true);paint();}catch(e){toast(e.message);s.value='';}});
    m.body.querySelectorAll('[data-rev]').forEach(b=>b.onclick=async()=>{
      if(b.dataset.sure!=='1'){b.dataset.sure='1';b.innerHTML=I.trash+'Sure? Revoke';setTimeout(()=>{if(b.isConnected){b.dataset.sure='';b.innerHTML=I.trash+'Revoke';}},3500);return;}
      try{await api('/api/video/keys/'+b.dataset.rev,{method:'DELETE'});toast('Key revoked. Its links stop working now.',true);paint();}catch(e){toast(e.message);}
    });
    m.body.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const k=d.keys.find(x=>x.id===b.dataset.copy);if(!k)return;toast(await copyText(linkUrl(k.key,{path:k.scope,kind:k.scopeKind==='file'?'file':'folder'}))?'Link copied':'Couldn’t copy',true);});
    const nb=m.body.querySelector('#vlNewAll');
    if(nb)nb.onclick=()=>{
      const box=document.createElement('div');box.className='vl-key';box.style.display='block';
      box.innerHTML='<div class="vl-row"><div class="vl-f"><label for="vlnName">Key name</label><input class="vl-inp" id="vlnName" maxlength="80" value="My devices"></div><div class="vl-f"><label for="vlnHours">Works for</label>'+expirySelect('vlnHours',pol)+'</div></div><div class="vl-note" style="margin-top:12px">'+I.shield+'<div>Opens <b>everything you can browse</b>. Best for your own TV or phone. Links are made from Downloads or a movie or show page.</div></div><div class="vl-foot" style="margin-top:12px;justify-content:flex-end"><button class="vl-btn" type="button" data-cancel>Cancel</button><button class="vl-btn pri" type="button" data-make>'+I.plus+'Create key</button></div>';
      nb.parentNode.replaceWith(box);
      box.querySelector('[data-cancel]').onclick=paint;
      box.querySelector('[data-make]').onclick=async()=>{try{await api('/api/video/keys',{method:'POST',body:{label:box.querySelector('#vlnName').value,hours:Number(box.querySelector('#vlnHours').value)}});toast('Key created',true);paint();}catch(e){toast(e.message);}};
      box.querySelector('#vlnName').focus();
    };
    if(admin){
      const save=async()=>{try{await api('/api/config',{method:'POST',body:{videoLinks:{enabled:m.body.querySelector('#vlpOn').checked,users:m.body.querySelector('#vlpUsers').checked,maxDays:Number(m.body.querySelector('#vlpMax').value),defaultDays:Number(m.body.querySelector('#vlpDef').value)}}});toast('Saved',true);paint();}catch(e){toast(e.message);}};
      ['#vlpOn','#vlpUsers','#vlpMax','#vlpDef'].forEach(s=>{const el=m.body.querySelector(s);if(el)el.onchange=save;});
    }
  };
  paint();
  return m;
}

/* ---------- targets for a movie or show page: the movie, or the whole show, each season, each episode ---------- */
function commonDir(paths){
  const split=paths.map(p=>String(p||'').split('/').filter(Boolean).slice(0,-1));
  if(!split.length)return '';
  const out=[];
  for(let i=0;;i++){const s=split[0][i];if(s==null||!split.every(x=>x[i]===s))break;out.push(s);}
  return out.join('/');
}
function targetsForItems(items,info){
  info=info||{};
  items=(items||[]).filter(x=>x&&x.path);
  if(!items.length)return [];
  if(info.kind==='movie'||items.length===1&&!(items[0].episodes||[]).length)return items.map(x=>({path:x.path,kind:'file',label:x.label||x.name||baseName(x.path)}));
  const out=[];
  const show=commonDir(items.map(x=>x.path));
  out.push({path:show,kind:'folder',show:true,label:(info.title||baseName(show)||'Whole show')+' · whole show',count:items.length,group:''});
  const bySeason=new Map();
  items.forEach(x=>{const n=Number(x.seasonNumber)||0;if(!bySeason.has(n))bySeason.set(n,[]);bySeason.get(n).push(x);});
  if(bySeason.size>1)[...bySeason.keys()].sort((a,b)=>a-b).forEach(n=>{
    const list=bySeason.get(n),dir=commonDir(list.map(x=>x.path));
    // only when the season has its own folder (otherwise the playlist would hold other seasons too)
    const others=items.filter(x=>(Number(x.seasonNumber)||0)!==n);
    if(dir&&dir!==show&&!others.some(x=>x.path.startsWith(dir+'/')))out.push({path:dir,kind:'folder',season:n,label:n?'Season '+n:'Specials',count:list.length,group:'Seasons'});
  });
  items.forEach(x=>out.push({path:x.path,kind:'file',episode:true,label:x.label||x.name||baseName(x.path),group:'Episodes'}));
  return out;
}

/* ---------- menu entries ---------- */
function install(){
  if(PHONE){
    const dl=document.getElementById('mDownloads');
    if(dl&&!document.getElementById('mLinks')){
      const b=document.createElement('button');b.id='mLinks';b.type='button';b.className='btn btn-outline-gold text-start';b.textContent='🔗 Direct links';b.style.display=dl.style.display;
      dl.after(b);
      b.onclick=()=>{try{const menu=document.getElementById('menu');const oc=menu&&window.bootstrap&&bootstrap.Offcanvas.getInstance(menu);if(oc)oc.hide();}catch(_){}manage();};
      new MutationObserver(()=>{b.style.display=dl.style.display;}).observe(dl,{attributes:true,attributeFilter:['style']});
    }
  }else{
    const dl=document.getElementById('openDownloads');
    if(dl&&!document.getElementById('openLinks')){
      const b=document.createElement('div');b.className='settings-btn';b.id='openLinks';b.title='Share movies and shows as links that play anywhere';b.style.display=dl.style.display;
      b.innerHTML=I.link.replace('width="18" height="18"','width="16" height="16"')+' Direct links';
      dl.after(b);b.onclick=manage;
      new MutationObserver(()=>{b.style.display=dl.style.display;}).observe(dl,{attributes:true,attributeFilter:['style']});
    }
  }
  if(/[?&]links=1\b/.test(location.search)){let n=0;const t=setInterval(()=>{let ready=false;try{ready=(typeof currentUser!=='undefined'&&!!currentUser)||(typeof me!=='undefined'&&!!me);}catch(_){}if(ready||++n>60){clearInterval(t);if(ready)manage();}},500);}
}
window.MediarrLinks={share,manage,targetsForItems,icon:I.link,linkUrl};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
