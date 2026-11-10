/*
 * MEDIARR player (v2.14) — the video player's own controls, on the desktop and phone pages.
 *
 *   • seek bar with picture previews and chapter marks
 *   • Skip recap / Skip intro, and an Up Next card that plays the next episode
 *   • subtitles: tracks in the file, files next to it, uploads, online search, timing and size
 *   • Watch Together: one shared play / pause / position, with chat and reactions
 *
 * It wraps the existing <video> (#dlVideo / #mVideo) and leaves the playback engine
 * (direct play, HLS, transcoding, resume, casting) exactly as it was.
 */
(function(){
'use strict';
if(window.MediarrPlayer)return;

/* ---------- small helpers ---------- */
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(_){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}}};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function fmt(sec){sec=Math.max(0,Math.floor(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec/60)%60,s=sec%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0');}
async function api(url,opt){
  opt=opt||{};const o={method:opt.method||'GET',headers:{},cache:'no-store'};
  if(opt.body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(opt.body);}
  if(opt.raw!==undefined){o.body=opt.raw;o.headers['Content-Type']='application/octet-stream';}
  const r=await fetch(url,o);let d={};try{d=await r.json();}catch(_){}
  if(!r.ok)throw new Error(d.message||('HTTP '+r.status));return d;
}
function signedIn(){try{if(typeof currentUser!=='undefined'&&currentUser)return true;}catch(_){}try{if(typeof me!=='undefined'&&me)return true;}catch(_){}return false;}
function myName(){try{if(typeof currentUser!=='undefined'&&currentUser)return currentUser.username;}catch(_){}try{if(typeof me!=='undefined'&&me)return me.username;}catch(_){}return '';}
const TOUCH=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
const sv=(d,w)=>'<svg viewBox="0 0 24 24" width="'+(w||22)+'" height="'+(w||22)+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
const I={
  play:sv('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
  pause:sv('<rect x="6" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor" stroke="none"/>'),
  replay:sv('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  next:sv('<path d="M5 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18.5 5v14"/>'),
  prev:sv('<path d="M19 5v14L9 12z" fill="currentColor" stroke="none"/><path d="M5.5 5v14"/>'),
  vol:sv('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  mute:sv('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  subs:sv('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6.5 12.5h4M13 12.5h4.5M6.5 15.5h7M16 15.5h1.5"/>'),
  gear:sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',20),
  party:sv('<circle cx="9" cy="8" r="3.2"/><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0"/><circle cx="17.2" cy="9" r="2.5"/><path d="M17 14.2a5 5 0 0 1 4.4 5"/>'),
  pip:sv('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/>'),
  fs:sv('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'),
  fsx:sv('<path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20"/>'),
  x:sv('<path d="M6 6l12 12M18 6L6 18"/>',18),
  back:sv('<path d="M15 5l-7 7 7 7"/>',18),
  check:sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>',18),
  search:sv('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',18),
  upload:sv('<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/>',18),
  link:sv('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',18),
  trash:sv('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',16),
  send:sv('<path d="M4 12l16-7-6 16-2.5-6.5z" fill="currentColor" stroke="none"/>',18),
  skip:sv('<path d="M5 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M13 5v14l9-7z" fill="currentColor" stroke="none"/>',18)
};

/* ---------- preferences (per browser) ---------- */
const PREF=Object.assign({autoplay:true,autoSkip:false,previews:true,subSize:'m',subLang:'',volume:1,muted:false},LS.get('mediarr-player',{}));
const savePref=()=>LS.set('mediarr-player',PREF);

/* ---------- style ---------- */
const CSS=`
.mpx{--a:var(--gold,var(--bs-warning,#e8b04a));--glass:rgba(17,17,23,.78);position:relative;border-radius:14px;overflow:hidden;background:#000;color:#fff;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;outline:none;line-height:1.35;font-size:14px;text-align:left}
.mpx *{box-sizing:border-box}
.mpx-stage{position:relative;display:flex;align-items:center;justify-content:center;background:#000;min-height:170px;overflow:hidden}
.mpx video{display:block;width:100%;border-radius:0!important;background:#000}
.mpx.mpx-fs,.mpx.mpx-fill{position:fixed;inset:0;z-index:9000;border-radius:0;width:100vw;height:100vh;height:100dvh;display:flex}
.mpx:fullscreen{border-radius:0;width:100vw;height:100vh;display:flex}
.mpx.mpx-fs .mpx-stage,.mpx.mpx-fill .mpx-stage,.mpx:fullscreen .mpx-stage{flex:1;height:100%;min-width:0}
.mpx.mpx-fs video,.mpx.mpx-fill video,.mpx:fullscreen video{max-height:100%!important;height:100%;object-fit:contain}
.mpx-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,.62) 0,rgba(0,0,0,0) 24%,rgba(0,0,0,0) 58%,rgba(0,0,0,.86) 100%);transition:opacity .28s ease}
.mpx-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;pointer-events:none;transition:opacity .28s ease,transform .28s ease}
.mpx-titles{min-width:0;flex:1}
.mpx-title{font-weight:700;font-size:17px;letter-spacing:.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.mpx-sub{font-size:12.5px;opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.mpx-badge{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;background:var(--glass);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.16);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.mpx-badge i{width:8px;height:8px;border-radius:50%;background:#35d07f;box-shadow:0 0 0 0 rgba(53,208,127,.7);animation:mpxPulse 1.8s infinite}
@keyframes mpxPulse{70%{box-shadow:0 0 0 7px rgba(53,208,127,0)}100%{box-shadow:0 0 0 0 rgba(53,208,127,0)}}
.mpx-big{position:absolute;left:50%;top:50%;width:78px;height:78px;margin:-39px 0 0 -39px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(20,20,26,.55);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transform:scale(.8);pointer-events:none;transition:opacity .2s ease,transform .2s cubic-bezier(.2,.9,.3,1.3),background .15s}
.mpx-big svg{width:34px;height:34px}
.mpx.mpx-paused .mpx-big{opacity:1;transform:none;pointer-events:auto}
.mpx-big:hover{background:var(--a);color:#16130a;border-color:transparent}
.mpx-spin{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;border:3px solid rgba(255,255,255,.18);border-top-color:var(--a);animation:mpxSpin .8s linear infinite;display:none;pointer-events:none}
.mpx.mpx-wait .mpx-spin{display:block}.mpx.mpx-wait .mpx-big{opacity:0;pointer-events:none}
@keyframes mpxSpin{to{transform:rotate(360deg)}}
.mpx-flash{position:absolute;top:50%;transform:translateY(-50%);padding:12px 18px;border-radius:99px;background:rgba(20,20,26,.6);font-weight:800;font-size:15px;opacity:0;pointer-events:none}
.mpx-flash.l{left:12%}.mpx-flash.r{right:12%}.mpx-flash.on{animation:mpxFlash .55s ease}
@keyframes mpxFlash{0%{opacity:0;transform:translateY(-50%) scale(.85)}25%{opacity:1;transform:translateY(-50%) scale(1)}100%{opacity:0;transform:translateY(-50%) scale(1.05)}}
.mpx-bar{position:absolute;left:0;right:0;bottom:0;padding:0 12px 8px;transition:opacity .28s ease,transform .28s ease}
.mpx-seek{position:relative;height:24px;display:flex;align-items:center;cursor:pointer;touch-action:none;outline:none;margin:0 6px}
.mpx-rail{position:relative;width:100%;height:4px;border-radius:99px;background:rgba(255,255,255,.24);transition:height .15s ease;overflow:hidden}
.mpx-seek:hover .mpx-rail,.mpx-seek.drag .mpx-rail,.mpx-seek:focus-visible .mpx-rail{height:7px}
.mpx-buf,.mpx-fill,.mpx-ghost{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:99px}
.mpx-buf{background:rgba(255,255,255,.3)}.mpx-ghost{background:rgba(255,255,255,.28)}
.mpx-fill{background:linear-gradient(90deg,color-mix(in srgb,var(--a) 72%,#fff 0%),var(--a))}
.mpx-zone{position:absolute;top:0;bottom:0;background:rgba(255,255,255,.34)}
.mpx-marks{position:absolute;inset:0;pointer-events:none}
.mpx-marks i{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(0,0,0,.7)}
.mpx-knob{position:absolute;top:50%;left:0;width:15px;height:15px;margin:-7.5px 0 0 -7.5px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--a) 45%,transparent),0 2px 6px rgba(0,0,0,.5);transform:scale(0);transition:transform .15s ease;pointer-events:none}
.mpx-seek:hover .mpx-knob,.mpx-seek.drag .mpx-knob,.mpx-seek:focus-visible .mpx-knob{transform:scale(1)}
.mpx-tip{position:absolute;bottom:30px;left:0;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:3}
.mpx-seek.tip .mpx-tip{display:flex}
.mpx-tip-img{width:208px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#15151b linear-gradient(110deg,#15151b 30%,#24242d 50%,#15151b 70%);background-size:200% 100%;animation:mpxShim 1.2s linear infinite;border:2px solid rgba(255,255,255,.92);box-shadow:0 10px 30px rgba(0,0,0,.6)}
.mpx-tip-img img{display:block;width:100%;height:100%;object-fit:cover}
.mpx-tip.noimg .mpx-tip-img{display:none}
@keyframes mpxShim{to{background-position:-200% 0}}
.mpx-tip-ch{max-width:230px;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 6px #000}
.mpx-tip-t{padding:3px 9px;border-radius:99px;background:rgba(12,12,16,.88);font-weight:800;font-size:12.5px;font-variant-numeric:tabular-nums}
.mpx-row{display:flex;align-items:center;gap:2px;margin-top:-1px}
.mpx-b{flex:none;width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative;transition:background .15s,transform .12s,color .15s;padding:0}
.mpx-b:hover{background:rgba(255,255,255,.16)}.mpx-b:active{transform:scale(.9)}
.mpx-b:focus-visible,.mpx-btn:focus-visible,.mpx-item:focus-visible,.mpx-chip:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.mpx-b[hidden]{display:none}
.mpx-b.on{color:var(--a)}
.mpx-b .dot{position:absolute;right:7px;top:7px;width:9px;height:9px;border-radius:50%;background:#35d07f;border:2px solid #111;display:none}
.mpx-b.live .dot{display:block}
.mpx-volw{display:flex;align-items:center}
.mpx-vol{width:0;opacity:0;transition:width .2s ease,opacity .2s ease;accent-color:var(--a);height:4px;cursor:pointer;margin:0}
.mpx-volw:hover .mpx-vol,.mpx-vol:focus-visible{width:84px;opacity:1;margin:0 8px 0 2px}
.mpx-time{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;margin-left:8px;white-space:nowrap;opacity:.95}
.mpx-time span{opacity:.6;font-weight:500}
.mpx-grow{flex:1}
.mpx.mpx-idle .mpx-bar,.mpx.mpx-idle .mpx-top{opacity:0;pointer-events:none}
.mpx.mpx-idle .mpx-bar{transform:translateY(8px)}.mpx.mpx-idle .mpx-top{transform:translateY(-8px)}
.mpx.mpx-idle .mpx-shade{opacity:0}.mpx.mpx-idle .mpx-stage{cursor:none}
.mpx.mpx-idle .mpx-top .mpx-badge{pointer-events:none}
.mpx-skip{position:absolute;right:18px;bottom:78px;display:none;align-items:center;gap:8px;padding:11px 18px 11px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.55);background:rgba(18,18,24,.72);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#fff;font:inherit;font-weight:800;font-size:14px;cursor:pointer;overflow:hidden;transition:background .15s,color .15s,transform .15s,bottom .28s ease;animation:mpxUp .3s ease}
.mpx-skip.on{display:inline-flex}
.mpx-skip:hover{background:#fff;color:#111;transform:translateY(-1px)}
.mpx-skip b{position:absolute;left:0;bottom:0;height:3px;background:var(--a);width:0}
.mpx.mpx-idle .mpx-skip,.mpx.mpx-idle .mpx-up{bottom:22px}
@keyframes mpxUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.mpx-up{position:absolute;right:18px;bottom:78px;width:min(440px,calc(100% - 28px));display:none;gap:12px;padding:12px;border-radius:16px;background:var(--glass);-webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3);border:1px solid rgba(255,255,255,.16);box-shadow:0 18px 50px rgba(0,0,0,.55);animation:mpxUp .35s ease;transition:bottom .28s ease;overflow:hidden}
.mpx-up.on{display:flex}
.mpx-up-th{position:relative;flex:none;width:124px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#1d1d25;cursor:pointer}
.mpx-up-th img{width:100%;height:100%;object-fit:cover;display:block}
.mpx-up-th span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28)}
.mpx-up-th svg{width:26px;height:26px}
.mpx-up-m{flex:1;min-width:0;display:flex;flex-direction:column}
.mpx-eyebrow{font-size:10.5px;font-weight:900;letter-spacing:1.3px;text-transform:uppercase;color:var(--a)}
.mpx-up-t{font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.mpx-up-s{font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mpx-up-a{display:flex;gap:6px;margin-top:auto;padding-top:7px}
.mpx-up-a .mpx-btn{flex:1;min-width:0;padding-left:8px;padding-right:8px}
.mpx-up-bar{position:absolute;left:0;bottom:0;height:3px;width:0;background:var(--a);transition:width .25s linear}
.mpx-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:10px;padding:8px 14px;font:inherit;font-weight:800;font-size:13px;cursor:pointer;background:var(--a);color:#17130a;transition:filter .15s,transform .12s,background .15s;white-space:nowrap}
.mpx-btn:hover{filter:brightness(1.1)}.mpx-btn:active{transform:scale(.97)}
.mpx-btn.ghost{background:rgba(255,255,255,.12);color:#fff}.mpx-btn.ghost:hover{background:rgba(255,255,255,.2);filter:none}
.mpx-btn.wide{width:100%;padding:11px 14px;font-size:14px}
.mpx-btn[disabled]{opacity:.5;cursor:default}
.mpx-toast{position:absolute;left:50%;top:16px;transform:translateX(-50%);padding:8px 15px;border-radius:99px;background:var(--glass);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.16);font-weight:700;font-size:13px;white-space:nowrap;max-width:88%;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .25s ease,top .25s ease;z-index:4}
.mpx-toast.on{opacity:1;top:22px}
.mpx-float{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.mpx-float span{position:absolute;bottom:70px;font-size:34px;animation:mpxFloat 2.6s ease-out forwards;filter:drop-shadow(0 4px 10px rgba(0,0,0,.5))}
.mpx-float small{display:block;font-size:11px;font-weight:800;text-align:center;text-shadow:0 1px 5px #000}
@keyframes mpxFloat{0%{opacity:0;transform:translateY(20px) scale(.6)}12%{opacity:1;transform:translateY(0) scale(1.15)}100%{opacity:0;transform:translateY(-240px) scale(1)}}
/* side panel */
.mpx-panel{position:absolute;top:0;right:0;bottom:0;width:min(372px,100%);display:flex;flex-direction:column;background:rgba(15,15,20,.9);-webkit-backdrop-filter:blur(22px) saturate(1.3);backdrop-filter:blur(22px) saturate(1.3);border-left:1px solid rgba(255,255,255,.12);box-shadow:-20px 0 50px rgba(0,0,0,.45);animation:mpxSlide .24s ease;z-index:5;user-select:text;-webkit-user-select:text}
.mpx-panel[hidden]{display:none}
@keyframes mpxSlide{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
.mpx.mpx-narrow:not(.mpx-fs):not(.mpx-fill) .mpx-panel{position:static;width:auto;max-height:62vh;border-left:0;border-top:1px solid rgba(255,255,255,.12);box-shadow:none;animation:mpxUp .24s ease;background:#121218}
.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-bar,.mpx.mpx-haspanel.mpx-fs .mpx-bar,.mpx.mpx-haspanel.mpx-fill .mpx-bar{right:min(372px,100%)}
.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-top,.mpx.mpx-haspanel.mpx-fs .mpx-top{right:min(372px,100%)}
.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-skip,.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-up{right:calc(min(372px,100%) + 18px)}
.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-toast,.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-big,.mpx.mpx-haspanel:not(.mpx-narrow) .mpx-spin{left:calc((100% - min(372px,100%)) / 2)}
.mpx-ph{display:flex;align-items:center;gap:8px;padding:14px 12px 10px 18px}
.mpx-ph h3{margin:0;font-size:16px;font-weight:800;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
.mpx-ph .mpx-b{width:34px;height:34px}
.mpx-pb{flex:1;min-height:0;overflow-y:auto;padding:2px 12px 14px;scrollbar-width:thin;overscroll-behavior:contain}
.mpx-h{font-size:10.5px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;opacity:.55;margin:14px 8px 6px}
.mpx-item{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 10px;border:0;border-radius:10px;background:transparent;color:#fff;font:inherit;font-size:14px;text-align:left;cursor:pointer;transition:background .12s}
.mpx-item:hover{background:rgba(255,255,255,.09)}
.mpx-item .ck{flex:none;width:20px;height:20px;color:var(--a);opacity:0;display:flex}
.mpx-item.on .ck{opacity:1}.mpx-item.on{background:rgba(255,255,255,.07)}
.mpx-item .g{flex:1;min-width:0}
.mpx-item .g b{display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mpx-item .g small{display:block;font-size:11.5px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mpx-item.busy{opacity:.55;pointer-events:none}
.mpx-tag{flex:none;font-size:10px;font-weight:800;letter-spacing:.3px;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,.12);white-space:nowrap}
.mpx-tag.hi{background:color-mix(in srgb,var(--a) 26%,transparent);color:var(--a)}
.mpx-mini{flex:none;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#fff;opacity:.5;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.mpx-mini:hover{opacity:1;background:rgba(255,255,255,.12)}
.mpx-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 4px 0}
.mpx-tools.one{grid-template-columns:1fr}
.mpx-card{margin:12px 4px 0;padding:12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.mpx-rowx{display:flex;align-items:center;gap:8px}
.mpx-rowx+.mpx-rowx{margin-top:10px}
.mpx-rowx label,.mpx-lbl{flex:1;font-size:13px;font-weight:700}
.mpx-rowx small,.mpx-help{display:block;font-size:11.5px;font-weight:500;opacity:.6;line-height:1.4}
.mpx-step{width:34px;height:34px;border-radius:9px;border:0;background:rgba(255,255,255,.12);color:#fff;font:inherit;font-weight:900;font-size:16px;cursor:pointer}
.mpx-step:hover{background:rgba(255,255,255,.22)}
.mpx-val{min-width:62px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums;font-size:13px}
.mpx-chips{display:flex;flex-wrap:wrap;gap:6px}
.mpx-chip{border:1px solid rgba(255,255,255,.16);background:transparent;color:#fff;border-radius:99px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:background .12s,border-color .12s,color .12s}
.mpx-chip:hover{background:rgba(255,255,255,.1)}
.mpx-chip.on{background:var(--a);border-color:var(--a);color:#17130a}
.mpx-in{width:100%;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.35);color:#fff;font:inherit;font-size:14px;padding:0 12px;outline:none;min-width:0}
.mpx-in:focus{border-color:var(--a)}
.mpx-in::placeholder{color:rgba(255,255,255,.4)}
.mpx-sw{position:relative;flex:none;width:42px;height:24px;border-radius:99px;border:0;background:rgba(255,255,255,.2);cursor:pointer;transition:background .18s;padding:0}
.mpx-sw::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .18s}
.mpx-sw[aria-checked="true"]{background:var(--a)}.mpx-sw[aria-checked="true"]::after{transform:translateX(18px)}
.mpx-empty{padding:26px 14px;text-align:center;opacity:.65;font-size:13px}
.mpx-note{margin:10px 6px 0;font-size:12px;opacity:.6;line-height:1.45}
.mpx-note a{color:var(--a)}
.mpx-err{margin:10px 4px 0;padding:10px 12px;border-radius:10px;background:rgba(255,107,107,.14);border:1px solid rgba(255,107,107,.3);font-size:12.5px}
.mpx-ok{margin:10px 4px 0;padding:10px 12px;border-radius:10px;background:rgba(53,208,127,.14);border:1px solid rgba(53,208,127,.3);font-size:12.5px}
/* watch together */
.mpx-hero{margin:6px 4px 0;padding:22px 16px;border-radius:16px;text-align:center;background:radial-gradient(120% 120% at 50% 0,color-mix(in srgb,var(--a) 30%,transparent),transparent 70%),rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
.mpx-hero .em{font-size:34px;line-height:1}
.mpx-hero h4{margin:10px 0 4px;font-size:17px;font-weight:800;color:#fff}
.mpx-hero p{margin:0 0 14px;font-size:13px;opacity:.72;line-height:1.45}
.mpx-code{display:flex;justify-content:center;gap:6px;margin:4px 0 12px}
.mpx-code span{width:34px;height:42px;border-radius:9px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:19px;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--a)}
.mpx-or{display:flex;align-items:center;gap:10px;margin:16px 8px 10px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5}
.mpx-or::before,.mpx-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.18)}
.mpx-join{display:flex;gap:8px;margin:0 4px}
.mpx-join .mpx-in{text-transform:uppercase;letter-spacing:3px;font-weight:800;text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace}
.mpx-people{display:flex;flex-wrap:wrap;gap:6px;margin:0 4px}
.mpx-person{display:inline-flex;align-items:center;gap:7px;padding:4px 11px 4px 4px;border-radius:99px;background:rgba(255,255,255,.08);font-size:12.5px;font-weight:700}
.mpx-person i{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:900;color:#111}
.mpx-person em{font-style:normal;font-weight:600;opacity:.6;font-size:11px}
.mpx-reacts{display:flex;gap:4px;margin:10px 4px 0;justify-content:space-between}
.mpx-reacts button{flex:1;height:38px;border:0;border-radius:10px;background:rgba(255,255,255,.07);font-size:19px;cursor:pointer;transition:transform .12s,background .12s;padding:0}
.mpx-reacts button:hover{background:rgba(255,255,255,.16);transform:translateY(-2px) scale(1.12)}
.mpx-chat{margin:10px 4px 0;display:flex;flex-direction:column;gap:6px;max-height:210px;overflow-y:auto;scrollbar-width:thin;padding-right:2px}
.mpx-msg{align-self:flex-start;max-width:88%;padding:7px 11px;border-radius:14px 14px 14px 4px;background:rgba(255,255,255,.09);font-size:13px;overflow-wrap:anywhere}
.mpx-msg b{display:block;font-size:10.5px;opacity:.6;font-weight:800}
.mpx-msg.me{align-self:flex-end;border-radius:14px 14px 4px 14px;background:color-mix(in srgb,var(--a) 82%,#000);color:#17130a}
.mpx-msg.sys{align-self:center;background:transparent;opacity:.55;font-size:11.5px;padding:2px}
.mpx-say{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid rgba(255,255,255,.08)}
.mpx-say .mpx-btn{padding:0;width:40px;height:40px;flex:none}
/* phones / small stages */
.mpx.mpx-narrow .mpx-toast{font-size:12px;padding:6px 12px}.mpx.mpx-narrow .mpx-toast.on{top:50px}
.mpx.mpx-narrow .mpx-title{font-size:14.5px}.mpx.mpx-narrow .mpx-top{padding:10px 12px}
.mpx.mpx-narrow .mpx-bar{padding:0 4px 4px}
.mpx.mpx-narrow .mpx-b{width:38px;height:38px}
.mpx.mpx-narrow .mpx-time{font-size:12px;margin-left:4px}
.mpx.mpx-narrow .mpx-big{width:60px;height:60px;margin:-30px 0 0 -30px}.mpx.mpx-narrow .mpx-big svg{width:26px;height:26px}
.mpx.mpx-narrow .mpx-skip{right:10px;bottom:64px;padding:8px 13px;font-size:13px;border-radius:10px}
.mpx.mpx-narrow .mpx-up{right:8px;bottom:62px;padding:8px;gap:9px;width:min(310px,calc(100% - 16px))}
.mpx.mpx-narrow .mpx-up-th{width:92px}.mpx.mpx-narrow .mpx-up-t{font-size:13px}
.mpx.mpx-narrow .mpx-btn{padding:6px 11px;font-size:12px}
.mpx.mpx-narrow .mpx-btn.wide{padding:11px 14px;font-size:14px}
.mpx.mpx-narrow .mpx-tip-img{width:150px}
.mpx.mpx-narrow [data-a=prev],.mpx.mpx-narrow [data-a=pip],.mpx.mpx-touch .mpx-vol{display:none}
.mpx.mpx-narrow.mpx-idle .mpx-skip,.mpx.mpx-narrow.mpx-idle .mpx-up{bottom:12px}
video.mpx-cue-s::cue{font-size:72%}video.mpx-cue-m::cue{font-size:100%}video.mpx-cue-l::cue{font-size:135%}video.mpx-cue-xl::cue{font-size:175%}
video.mpx-v::cue{background:rgba(0,0,0,.55);color:#fff;text-shadow:0 1px 3px #000}
.mpx-legacy{margin-top:10px;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:12px;padding:0 12px}
.mpx-legacy>summary{cursor:pointer;padding:10px 0;font-size:13px;font-weight:700;color:var(--muted,var(--bs-secondary-color,#8f9bb3));list-style:none;display:flex;align-items:center;gap:8px}
.mpx-legacy>summary::-webkit-details-marker{display:none}
.mpx-legacy>summary::before{content:"›";display:inline-block;transition:transform .15s;font-size:16px}
.mpx-legacy[open]>summary::before{transform:rotate(90deg)}
.mpx-legacy>div{padding-bottom:12px}
#playerOverlay .modal.wide{max-width:min(1180px,96vw)}
@media (prefers-reduced-motion:reduce){.mpx *,.mpx{animation-duration:.01s!important;transition-duration:.01s!important}}
`;

/* ---------- state ---------- */
const X={v:null,wrap:null,kind:'',path:'',name:'',info:null,settings:null,panel:'',settled:false,
  sub:{mode:'off',id:'',offset:0,label:''},up:{on:false,dismissed:false,count:0,from:0},
  skipped:{},party:null,idleT:0,prefetch:0,lastTap:0,view:''};
const CID=(()=>{try{return Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');}catch(_){return Array.from({length:16},()=>Math.floor(Math.random()*16).toString(16)).join('');}})();
const E={};   // elements of the active player
const q=(sel)=>X.wrap?X.wrap.querySelector(sel):null;
const dur=()=>{const v=X.v;const d=v&&isFinite(v.duration)&&v.duration>0?v.duration:(X.info&&X.info.duration)||0;return d;};
const ids=()=>X.kind==='m'?{sub:'mSubSel',audio:'mAudioSel',qual:'mQualSel',tracks:'mPlayerTracks',ctl:'mPlayerCtl',msg:'mPlayerMsg'}:{sub:'subSel',audio:'audioSel',qual:'qualSel',tracks:'playerTracks',ctl:'playerCtl',msg:'playerMsg'};

/* ---------- build ---------- */
function build(v,kind){
  if(v.dataset.mpx)return v.closest('.mpx');
  v.dataset.mpx='1';
  const wrap=document.createElement('div');wrap.className='mpx mpx-paused'+(TOUCH?' mpx-touch':'');wrap.tabIndex=-1;
  wrap.innerHTML='<div class="mpx-stage"><div class="mpx-shade"></div>'
    +'<div class="mpx-top"><div class="mpx-titles"><div class="mpx-title"></div><div class="mpx-sub"></div></div><div class="mpx-badges"></div></div>'
    +'<button class="mpx-big" type="button" aria-label="Play">'+I.play+'</button><div class="mpx-spin"></div>'
    +'<div class="mpx-flash l"></div><div class="mpx-flash r"></div><div class="mpx-float"></div><div class="mpx-toast" role="status"></div>'
    +'<button class="mpx-skip" type="button"></button><div class="mpx-up"></div>'
    +'<div class="mpx-bar"><div class="mpx-seek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0"><div class="mpx-rail"><div class="mpx-buf"></div><div class="mpx-zones"></div><div class="mpx-ghost"></div><div class="mpx-fill"></div><div class="mpx-marks"></div></div><div class="mpx-knob"></div>'
    +'<div class="mpx-tip"><div class="mpx-tip-img"><img alt=""></div><div class="mpx-tip-ch"></div><div class="mpx-tip-t">0:00</div></div></div>'
    +'<div class="mpx-row">'
    +'<button class="mpx-b" type="button" data-a="play" aria-label="Play">'+I.play+'</button>'
    +'<button class="mpx-b" type="button" data-a="prev" aria-label="Previous episode" title="Previous episode" hidden>'+I.prev+'</button>'
    +'<button class="mpx-b" type="button" data-a="next" aria-label="Next episode" title="Next episode (N)" hidden>'+I.next+'</button>'
    +'<span class="mpx-volw"><button class="mpx-b" type="button" data-a="mute" aria-label="Mute" title="Mute (M)">'+I.vol+'</button><input class="mpx-vol" type="range" min="0" max="1" step="0.02" aria-label="Volume"></span>'
    +'<span class="mpx-time"><b>0:00</b> <span>/ 0:00</span></span><span class="mpx-grow"></span>'
    +'<button class="mpx-b" type="button" data-a="party" aria-label="Watch together" title="Watch together">'+I.party+'<span class="dot"></span></button>'
    +'<button class="mpx-b" type="button" data-a="subs" aria-label="Subtitles" title="Subtitles (C)">'+I.subs+'</button>'
    +'<button class="mpx-b" type="button" data-a="settings" aria-label="Settings" title="Settings">'+I.gear+'</button>'
    +'<button class="mpx-b" type="button" data-a="pip" aria-label="Picture in picture" title="Picture in picture"'+(document.pictureInPictureEnabled?'':' hidden')+'>'+I.pip+'</button>'
    +'<button class="mpx-b" type="button" data-a="fs" aria-label="Full screen" title="Full screen (F)">'+I.fs+'</button>'
    +'</div></div></div><aside class="mpx-panel" hidden></aside>';
  v.parentNode.insertBefore(wrap,v);
  const stage=wrap.firstChild;stage.insertBefore(v,stage.firstChild);
  v.controls=false;v.removeAttribute('controls');v.classList.add('mpx-v');
  // tuck the engine's own option rows (audio track, quality, transcoding, casting) into a drawer
  const I2=kind==='m'?{tracks:'mPlayerTracks',ctl:'mPlayerCtl'}:{tracks:'playerTracks',ctl:'playerCtl'};
  const tr=document.getElementById(I2.tracks),ctl=document.getElementById(I2.ctl);
  if(tr&&ctl&&!ctl.closest('.mpx-legacy')){const det=document.createElement('details');det.className='mpx-legacy';det.innerHTML='<summary>Audio, quality and casting</summary><div></div>';tr.parentNode.insertBefore(det,tr);det.lastChild.appendChild(tr);det.lastChild.appendChild(ctl);}
  wire(wrap,v,kind);
  return wrap;
}

function setActive(v,kind){
  X.v=v;X.kind=kind;X.wrap=build(v,kind);
  ['stage','shade','top','title','sub','badges','big','spin','toast','skip','up','bar','seek','rail','buf','fill','ghost','marks','zones','knob','tip','float','panel','time','vol'].forEach(k=>{E[k]=X.wrap.querySelector('.mpx-'+k);});
  E.tipImg=X.wrap.querySelector('.mpx-tip-img img');E.tipCh=X.wrap.querySelector('.mpx-tip-ch');E.tipT=X.wrap.querySelector('.mpx-tip-t');
}

/* ---------- wiring (once per video element) ---------- */
function wire(wrap,v,kind){
  const mine=()=>X.v===v;
  const on=(ev,fn)=>v.addEventListener(ev,e=>{if(mine())fn(e);});
  on('play',()=>{paintPlay();wake();partyLocal('play');});
  on('pause',()=>{paintPlay();wake();if(!v.ended)partyLocal('pause');});
  on('playing',()=>{wrap.classList.remove('mpx-wait');paintPlay();});
  on('waiting',()=>{if(!v.paused)wrap.classList.add('mpx-wait');});
  on('canplay',()=>{wrap.classList.remove('mpx-wait');if(!X.settled)setTimeout(()=>{if(!mine())return;X.settled=true;if(X.party&&X.party.pending){X.party.pending=false;partyApply(X.party.state);}},500);});
  on('loadstart',()=>{X.settled=false;wrap.classList.add('mpx-wait');keepSub();});
  on('emptied',()=>{wrap.classList.remove('mpx-wait');});
  on('error',()=>{wrap.classList.remove('mpx-wait');});
  on('timeupdate',()=>{paintTime();tickMarkers();});
  on('durationchange',()=>{paintTime();paintMarks();});
  on('progress',paintBuf);
  on('seeked',()=>{paintTime();tickMarkers(true);partyLocal('seek');});
  on('ended',()=>{paintPlay();onEnded();});
  on('volumechange',()=>{paintVol();PREF.volume=v.volume;PREF.muted=v.muted;savePref();});
  on('loadeddata',keepSub);
  if(v.textTracks&&v.textTracks.addEventListener)v.textTracks.addEventListener('change',()=>{if(mine())keepSub();});
  try{v.volume=clamp(Number(PREF.volume)||1,0,1);v.muted=!!PREF.muted;}catch(_){}

  wrap.querySelectorAll('[data-a]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();act(b.dataset.a);wake();}));
  wrap.querySelector('.mpx-big').addEventListener('click',e=>{e.stopPropagation();toggle();});
  wrap.querySelector('.mpx-vol').addEventListener('input',e=>{v.muted=false;v.volume=Number(e.target.value);});
  wrap.querySelector('.mpx-skip').addEventListener('click',e=>{e.stopPropagation();doSkip();});
  const stage=wrap.firstChild;
  // tap / click on the picture
  stage.addEventListener('click',e=>{
    if(!mine()||e.target.closest('.mpx-bar,.mpx-skip,.mpx-up,.mpx-big,.mpx-badge'))return;
    const touch=TOUCH||(e.pointerType&&e.pointerType!=='mouse');
    if(touch){
      const now=Date.now(),r=stage.getBoundingClientRect(),side=(e.clientX-r.left)/r.width;
      if(now-X.lastTap<320&&(side<.36||side>.64)){X.lastTap=0;nudge(side<.5?-10:10);return;}
      X.lastTap=now;
      if(wrap.classList.contains('mpx-idle'))wake();else if(!v.paused){wrap.classList.add('mpx-idle');}else wake();
    }else{toggle();}
  });
  stage.addEventListener('dblclick',e=>{if(!mine()||TOUCH||e.target.closest('.mpx-bar,.mpx-skip,.mpx-up,.mpx-big'))return;act('fs');});
  wrap.addEventListener('pointermove',e=>{if(mine()&&e.pointerType==='mouse')wake();},{passive:true});
  wrap.addEventListener('pointerdown',e=>{if(mine()&&e.target.closest('.mpx-bar,.mpx-panel,.mpx-up,.mpx-skip'))wake();},{passive:true});
  wrap.addEventListener('mouseleave',()=>{if(mine()&&!v.paused&&!X.panel)idleSoon(700);});

  // seek bar
  const seek=wrap.querySelector('.mpx-seek');let dragging=false;
  const frac=e=>{const r=seek.getBoundingClientRect();return clamp((e.clientX-r.left)/r.width,0,1);};
  const showTip=(f)=>{
    const d=dur();if(!d){seek.classList.remove('tip');return;}
    const t=f*d,r=seek.getBoundingClientRect(),tip=seek.querySelector('.mpx-tip');
    seek.classList.add('tip');
    const th=X.info&&X.info.thumbs&&PREF.previews?X.info.thumbs:null;
    tip.classList.toggle('noimg',!th);
    if(th){const i=clamp(Math.floor(t/th.interval),0,th.count-1),src='/api/player/thumb?path='+encodeURIComponent(X.path)+'&i='+i;const img=tip.querySelector('img');if(img.dataset.src!==src){img.dataset.src=src;img.style.opacity=0;img.onload=()=>{img.style.opacity=1;};img.onerror=()=>{img.style.opacity=0;};img.src=src;}}
    const ch=X.info&&X.info.chapters&&X.info.chapters.length>1?X.info.chapters.find(c=>t>=c.start&&t<c.end):null;
    tip.querySelector('.mpx-tip-ch').textContent=ch?ch.title:'';tip.querySelector('.mpx-tip-t').textContent=fmt(t);
    const w=tip.offsetWidth/2,x=clamp(f*r.width,Math.min(w-6,r.width/2),Math.max(r.width-w+6,r.width/2));
    tip.style.left=x+'px';
    seek.querySelector('.mpx-ghost').style.width=(f*100)+'%';
  };
  seek.addEventListener('pointerdown',e=>{if(!mine()||!dur())return;dragging=true;seek.classList.add('drag');try{seek.setPointerCapture(e.pointerId);}catch(_){}const f=frac(e);paintFill(f);showTip(f);e.preventDefault();});
  let quiet=0;   // after a click, keep the preview out of the way until the pointer moves on
  seek.addEventListener('pointermove',e=>{if(!mine())return;const f=frac(e);if(dragging){paintFill(f);showTip(f);}else if(e.pointerType==='mouse'&&Date.now()>quiet)showTip(f);});
  const end=e=>{if(!dragging)return;dragging=false;seek.classList.remove('drag');const f=frac(e);seekTo(f*dur());seek.classList.remove('tip');seek.querySelector('.mpx-ghost').style.width=0;quiet=Date.now()+(e.pointerType==='mouse'?900:0);};
  seek.addEventListener('pointerup',end);seek.addEventListener('pointercancel',()=>{dragging=false;seek.classList.remove('drag','tip');});
  seek.addEventListener('pointerleave',()=>{if(!dragging){seek.classList.remove('tip');seek.querySelector('.mpx-ghost').style.width=0;}});
  seek.addEventListener('keydown',e=>{if(!mine())return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();nudge(e.key==='ArrowLeft'?-10:10);}});
  seek._dragging=()=>dragging;

  if(window.ResizeObserver)new ResizeObserver(()=>{wrap.classList.toggle('mpx-narrow',wrap.clientWidth<640);}).observe(wrap);
  wrap.classList.toggle('mpx-narrow',(wrap.clientWidth||window.innerWidth)<640);
  document.addEventListener('fullscreenchange',()=>{const fs=document.fullscreenElement===wrap;wrap.classList.toggle('mpx-fs',fs);const b=wrap.querySelector('[data-a=fs]');if(b)b.innerHTML=fs||wrap.classList.contains('mpx-fill')?I.fsx:I.fs;});
}

/* ---------- painting ---------- */
function paintPlay(){
  const v=X.v;if(!v)return;const paused=v.paused||v.ended;
  X.wrap.classList.toggle('mpx-paused',paused&&!X.wrap.classList.contains('mpx-wait'));
  const b=q('[data-a=play]');if(b){b.innerHTML=v.ended?I.replay:paused?I.play:I.pause;b.setAttribute('aria-label',paused?'Play':'Pause');}
  E.big.innerHTML=v.ended?I.replay:I.play;
  if(paused)X.wrap.classList.remove('mpx-idle');else idleSoon();
}
function paintFill(f){E.fill.style.width=(f*100)+'%';E.knob.style.left=(f*100)+'%';}
function paintTime(){
  const v=X.v;if(!v)return;const d=dur(),t=v.currentTime||0;
  if(!(E.seek._dragging&&E.seek._dragging()))paintFill(d?clamp(t/d,0,1):0);
  E.time.innerHTML='<b>'+fmt(t)+'</b> <span>/ '+fmt(d)+'</span>';
  E.seek.setAttribute('aria-valuemax',Math.round(d));E.seek.setAttribute('aria-valuenow',Math.round(t));E.seek.setAttribute('aria-valuetext',fmt(t)+' of '+fmt(d));
}
function paintBuf(){const v=X.v,d=dur();if(!v||!d)return;let end=0;try{for(let i=0;i<v.buffered.length;i++)if(v.buffered.start(i)<=v.currentTime+1)end=Math.max(end,v.buffered.end(i));}catch(_){}E.buf.style.width=clamp(end/d*100,0,100)+'%';}
function paintVol(){const v=X.v;if(!v)return;const b=q('[data-a=mute]');const m=v.muted||v.volume===0;if(b){b.innerHTML=m?I.mute:I.vol;b.setAttribute('aria-label',m?'Unmute':'Mute');}E.vol.value=m?0:v.volume;}
function paintMarks(){
  const d=dur(),inf=X.info;E.marks.innerHTML='';E.zones.innerHTML='';
  if(!d||!inf)return;
  if(inf.chapters&&inf.chapters.length>1)E.marks.innerHTML=inf.chapters.slice(1).map(c=>'<i style="left:'+(c.start/d*100)+'%"></i>').join('');
  const m=inf.markers||{};
  E.zones.innerHTML=['recap','intro','credits'].filter(k=>m[k]).map(k=>'<div class="mpx-zone" style="left:'+(m[k].start/d*100)+'%;width:'+((Math.min(m[k].end,d)-m[k].start)/d*100)+'%"></div>').join('');
}
function paintTitles(){
  const inf=X.info;
  E.title.textContent=inf&&inf.title?inf.title:X.name.replace(/\.[a-z0-9]{2,4}$/i,'');
  E.sub.textContent=inf&&inf.sub?inf.sub:'';
  const p=q('[data-a=prev]'),n=q('[data-a=next]');
  if(p){p.hidden=!(inf&&inf.prev);if(inf&&inf.prev)p.title='Previous: '+inf.prev.title;}
  if(n){n.hidden=!(inf&&inf.next);if(inf&&inf.next)n.title='Next: '+inf.next.title+' (N)';}
  const pb=q('[data-a=party]');if(pb)pb.hidden=!!(X.settings&&X.settings.watchTogether===false);
  if(inf&&inf.title){const root=X.wrap.closest('#playerOverlay,#player'),hd=root&&root.querySelector('#playerTitle');if(hd)hd.textContent=inf.show&&inf.show!==inf.title?inf.show:inf.title;}
}
function toast(msg,ms){E.toast.textContent=msg;E.toast.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>E.toast.classList.remove('on'),ms||2200);}
function flash(side,text){const el=X.wrap.querySelector('.mpx-flash.'+side);el.textContent=text;el.classList.remove('on');void el.offsetWidth;el.classList.add('on');}

/* ---------- controls ---------- */
function wake(){if(!X.wrap)return;X.wrap.classList.remove('mpx-idle');idleSoon();}
function idleSoon(ms){clearTimeout(X.idleT);X.idleT=setTimeout(()=>{const v=X.v;if(!v||v.paused||X.panel||(E.seek._dragging&&E.seek._dragging())||X.wrap.querySelector('.mpx-bar:hover'))return;X.wrap.classList.add('mpx-idle');},ms||2800);}
function toggle(){const v=X.v;if(!v)return;if(v.ended){seekTo(0);v.play().catch(()=>{});return;}if(v.paused)v.play().catch(()=>{});else v.pause();}
function seekTo(t){const v=X.v,d=dur();if(!v||!d)return;try{v.currentTime=clamp(t,0,Math.max(0,d-0.25));}catch(_){}paintTime();}
function nudge(s){const v=X.v;if(!v||!dur())return;seekTo((v.currentTime||0)+s);flash(s<0?'l':'r',(s<0?'−':'+')+Math.abs(s)+'s');wake();}
function fullscreen(){
  const w=X.wrap;if(!w)return;
  const btn=q('[data-a=fs]');
  if(w.classList.contains('mpx-fill')){w.classList.remove('mpx-fill');document.documentElement.style.overflow='';if(btn)btn.innerHTML=I.fs;return;}
  if(document.fullscreenElement){document.exitFullscreen().catch(()=>{});return;}
  if(w.requestFullscreen)w.requestFullscreen().then(()=>{try{if(TOUCH&&screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(()=>{});}catch(_){}}).catch(()=>{w.classList.add('mpx-fill');if(btn)btn.innerHTML=I.fsx;});
  else{w.classList.add('mpx-fill');document.documentElement.style.overflow='hidden';if(btn)btn.innerHTML=I.fsx;}   // iPhone: fill the page
}
function act(a){
  const v=X.v;if(!v)return;
  if(a==='play')toggle();
  else if(a==='mute')v.muted=!(v.muted||v.volume===0),v.volume=v.volume||.6;
  else if(a==='fs')fullscreen();
  else if(a==='pip'){if(document.pictureInPictureElement)document.exitPictureInPicture().catch(()=>{});else if(v.requestPictureInPicture)v.requestPictureInPicture().catch(()=>toast('Picture in picture isn’t available for this video'));}
  else if(a==='next'){if(X.info&&X.info.next)go(X.info.next);}
  else if(a==='prev'){if(X.info&&X.info.prev)go(X.info.prev);}
  else if(a==='subs'||a==='party'||a==='settings')openPanel(X.panel===a?'':a);
}
function go(item,auto){
  if(!item)return;
  hideUp();
  const fn=X.kind==='m'?window.playVideoMobile:window.playVideoD;
  if(typeof fn==='function')fn(item.path,item.name);
  if(auto)toast('Playing next: '+item.title,2600);
}

/* ---------- skip intro / recap, Up Next ---------- */
function curSkip(){const v=X.v,m=X.info&&X.info.markers;if(!v||!m)return null;const t=v.currentTime;for(const k of ['recap','intro']){const z=m[k];if(z&&t>=z.start&&t<z.end-1)return {kind:k,to:z.end};}return null;}
function doSkip(){const s=curSkip();if(!s)return;X.skipped[s.kind]=true;seekTo(s.to);E.skip.classList.remove('on');toast(s.kind==='intro'?'Intro skipped':'Recap skipped',1400);}
function tickMarkers(){
  const v=X.v;if(!v||!X.info)return;
  const s=curSkip();
  if(s){
    if(PREF.autoSkip&&!X.skipped[s.kind]&&X.settled&&!X.party){doSkip();}
    else{const label=s.kind==='intro'?'Skip intro':'Skip recap';if(E.skip.dataset.k!==s.kind){E.skip.dataset.k=s.kind;E.skip.innerHTML=I.skip+'<span>'+label+'</span>';}E.skip.classList.add('on');}
  }else if(E.skip.classList.contains('on')){E.skip.classList.remove('on');E.skip.dataset.k='';}
  // Up Next
  const d=dur(),next=X.info.next;if(!next||!d||d<30){if(X.up.on)hideUp();return;}
  const cr=X.info.markers&&X.info.markers.credits;
  const from=cr?cr.start:d-Math.max(8,Math.min(25,d*0.04));
  const t=v.currentTime;
  if(t>=from&&!X.up.dismissed&&!v.ended){
    if(!X.up.on)showUp(next,!!cr,from);
    const b=E.up.querySelector('.mpx-up-bar'),lab=E.up.querySelector('[data-up-go]');
    if(PREF.autoplay){
      if(cr){const left=Math.max(0,10-(t-X.up.from));if(b)b.style.width=clamp((t-X.up.from)/10*100,0,100)+'%';if(lab)lab.textContent=left>0.4?'Play now · '+Math.ceil(left):'Play now';if(left<=0&&!v.paused){go(next,true);}}
      else{if(b)b.style.width=clamp((t-from)/(d-from)*100,0,100)+'%';}
    }
  }else if(X.up.on&&t<from-1){hideUp();}
}
function showUp(next,credits,from){
  X.up.on=true;X.up.from=X.v.currentTime;
  E.up.innerHTML='<div class="mpx-up-th" data-up-go2>'+(X.settings&&X.settings.seekPreviews?'<img alt="" src="/api/player/thumb?path='+encodeURIComponent(next.path)+'&i=1" onerror="this.remove()">':'')+'<span>'+I.play+'</span></div>'
    +'<div class="mpx-up-m"><div class="mpx-eyebrow">Up next</div><div class="mpx-up-t">'+esc(next.title)+'</div><div class="mpx-up-s">'+esc(next.sub||'')+'</div>'
    +'<div class="mpx-up-a"><button class="mpx-btn" type="button" data-up-go>Play now</button><button class="mpx-btn ghost" type="button" data-up-x>'+(credits?'Watch credits':'Not now')+'</button></div></div><div class="mpx-up-bar"></div>';
  E.up.classList.add('on');
  E.up.querySelector('[data-up-go]').onclick=e=>{e.stopPropagation();go(next);};
  E.up.querySelector('[data-up-go2]').onclick=e=>{e.stopPropagation();go(next);};
  E.up.querySelector('[data-up-x]').onclick=e=>{e.stopPropagation();X.up.dismissed=true;hideUp();};
}
function hideUp(){X.up.on=false;if(E.up){E.up.classList.remove('on');E.up.innerHTML='';}}
function onEnded(){
  const next=X.info&&X.info.next;
  if(next&&PREF.autoplay&&!X.up.dismissed)go(next,true);
  else{X.wrap.classList.remove('mpx-idle');}
}

/* ---------- seek previews: warm them up quietly ---------- */
function prefetch(){
  const th=X.info&&X.info.thumbs;const my=++X.prefetch;
  if(!th||!PREF.previews||(navigator.connection&&navigator.connection.saveData))return;
  const path=X.path;let i=0;
  const step=()=>{if(my!==X.prefetch||X.path!==path||i>=th.count)return;const im=new Image();im.onload=im.onerror=()=>setTimeout(step,i<12?40:140);im.src='/api/player/thumb?path='+encodeURIComponent(path)+'&i='+(i++);};
  setTimeout(step,1500);
}

/* ---------- subtitles ---------- */
function embSel(){return document.getElementById(ids().sub);}
function embOptions(){const s=embSel();return s?[].slice.call(s.options).filter(o=>o.value!=='').map(o=>({value:o.value,label:o.text})):[];}
function clearMine(){const v=X.v;if(!v)return;[].slice.call(v.querySelectorAll('track[data-mpx]')).forEach(t=>t.remove());}
function setEmb(val){const s=embSel();if(!s)return;if(s.value!==val){s.value=val;}s.dispatchEvent(new Event('change'));}
function subOff(){clearMine();X.sub={mode:'off',id:'',offset:0,label:''};setEmb('');PREF.subLang='';savePref();paintSubBtn();}
function subEmb(val,label){clearMine();X.sub={mode:'emb',id:val,offset:0,label};setEmb(val);PREF.subLang='emb:'+label;savePref();paintSubBtn();}
function subExt(s,keepOffset){
  const v=X.v;if(!v)return;
  const es=embSel();if(es&&es.value!==''){es.value='';es.dispatchEvent(new Event('change'));}
  clearMine();
  X.sub={mode:'ext',id:s.id,offset:keepOffset?X.sub.offset:0,label:s.label,lang:s.lang||''};
  const tr=document.createElement('track');tr.kind='subtitles';tr.label=s.label;tr.srclang=(s.lang||'und').slice(0,2)||'und';
  tr.src='/api/player/subs/file?path='+encodeURIComponent(X.path)+'&id='+encodeURIComponent(s.id)+(X.sub.offset?'&offset='+X.sub.offset:'');
  tr.setAttribute('data-mpx','1');tr.default=true;v.appendChild(tr);
  const show=()=>{try{tr.track.mode='showing';}catch(_){}};tr.addEventListener('load',show);show();setTimeout(show,300);
  PREF.subLang='ext:'+(s.lang||s.label);savePref();paintSubBtn();
}
// the engine switches every text track off when it (re)loads a source: put ours back
function keepSub(){
  const v=X.v;if(!v||X.sub.mode!=='ext')return;
  const tr=v.querySelector('track[data-mpx]');if(!tr)return;
  const es=embSel();if(es&&es.value!=='')return;
  setTimeout(()=>{try{if(tr.track.mode!=='showing')tr.track.mode='showing';}catch(_){}},60);
}
function liftCues(){
  const v=X.v;if(!v||!X.wrap)return;
  const up=!X.wrap.classList.contains('mpx-idle');
  try{for(const t of v.textTracks){if(t.mode!=='showing'||!t.activeCues)continue;for(const c of t.activeCues){const want=up?-4:'auto';if(c.line!==want&&(c._mpx||c.line==='auto'||c.line===-4)){c.line=want;c._mpx=true;}}}}catch(_){}
}
setInterval(liftCues,300);
function paintSubBtn(){const b=q('[data-a=subs]');if(b)b.classList.toggle('on',X.sub.mode!=='off');const v=X.v;if(v){['s','m','l','xl'].forEach(k=>v.classList.toggle('mpx-cue-'+k,PREF.subSize===k));}}
// carry the choice over to the next episode
function autoSub(){
  const want=PREF.subLang;if(!want||!X.info)return;
  if(want.startsWith('ext:')){const key=want.slice(4);const s=(X.info.subs||[]).find(x=>(x.lang||x.label)===key);if(s)subExt(s);}
  else if(want.startsWith('emb:')){const label=want.slice(4);let tries=0;const t=setInterval(()=>{const o=embOptions().find(x=>x.label===label);if(o){clearInterval(t);X.sub={mode:'emb',id:o.value,offset:0,label};setEmb(o.value);paintSubBtn();}else if(++tries>20)clearInterval(t);},400);}
}
const SRC_TAG={file:'File',opensubtitles:'OpenSubtitles',upload:'Uploaded'};

/* ---------- panels ---------- */
function openPanel(name,view){
  X.panel=name||'';X.view=view||'';
  const p=E.panel;if(!p)return;
  ['subs','party','settings'].forEach(k=>{const b=q('[data-a='+k+']');if(b)b.classList.toggle('on',k===X.panel||(k==='subs'&&X.sub.mode!=='off'));});
  X.wrap.classList.toggle('mpx-haspanel',!!X.panel);
  if(!X.panel){p.hidden=true;p.innerHTML='';idleSoon();return;}
  p.hidden=false;X.wrap.classList.remove('mpx-idle');
  if(name==='subs')renderSubs();else if(name==='party')renderParty();else if(name==='settings')renderSettings();
  if(X.wrap.classList.contains('mpx-narrow')&&!X.wrap.classList.contains('mpx-fs')&&!X.wrap.classList.contains('mpx-fill'))setTimeout(()=>{try{p.scrollIntoView({block:'nearest',behavior:'smooth'});}catch(_){}},60);
}
function head(title,backTo){return '<div class="mpx-ph">'+(backTo!=null?'<button class="mpx-b" type="button" data-back aria-label="Back">'+I.back+'</button>':'')+'<h3>'+esc(title)+'</h3><button class="mpx-b" type="button" data-close aria-label="Close">'+I.x+'</button></div>';}
function wireHead(backFn){const p=E.panel;const c=p.querySelector('[data-close]');if(c)c.onclick=()=>openPanel('');const b=p.querySelector('[data-back]');if(b)b.onclick=backFn;}
const sw=(id,on)=>'<button class="mpx-sw" type="button" role="switch" aria-checked="'+(on?'true':'false')+'" data-sw="'+id+'"></button>';

function renderSubs(){
  const p=E.panel,inf=X.info||{},st=X.settings||{};
  if(X.view==='search')return renderSubSearch();
  const emb=embOptions(),ext=inf.subs||[];
  const item=(on,attrs,label,small,tag,extra)=>'<button class="mpx-item'+(on?' on':'')+'" type="button" '+attrs+'><span class="ck">'+I.check+'</span><span class="g"><b>'+esc(label)+'</b>'+(small?'<small>'+esc(small)+'</small>':'')+'</span>'+(tag?'<span class="mpx-tag">'+esc(tag)+'</span>':'')+(extra||'')+'</button>';
  let h=head('Subtitles')+'<div class="mpx-pb">';
  h+=item(X.sub.mode==='off','data-s-off','Off','');
  if(emb.length){h+='<div class="mpx-h">In this video</div>';emb.forEach(o=>{h+=item(X.sub.mode==='emb'&&X.sub.id===o.value,'data-s-emb="'+esc(o.value)+'"',o.label,'');});}
  if(ext.length){h+='<div class="mpx-h">Added subtitles</div>';ext.forEach((s,i)=>{const mineOrAdmin=s.id.startsWith('s:')&&(st.admin||s.by===myName());h+=item(X.sub.mode==='ext'&&X.sub.id===s.id,'data-s-ext="'+i+'"',s.label,s.detail,SRC_TAG[s.source]||'',mineOrAdmin?'<span class="mpx-mini" role="button" tabindex="0" data-s-del="'+i+'" aria-label="Remove" title="Remove">'+I.trash+'</span>':'');});}
  if(!emb.length&&!ext.length)h+='<div class="mpx-empty">This video has no subtitles yet.'+(st.subSearch?' Search for some below.':' Add a subtitle file below.')+'</div>';
  h+='<div class="mpx-tools'+(st.subSearch?'':' one')+'">'+(st.subSearch?'<button class="mpx-btn" type="button" data-s-search>'+I.search+'Search online</button>':'')+'<button class="mpx-btn ghost" type="button" data-s-up>'+I.upload+'Add a file</button></div><input type="file" accept=".srt,.vtt,.ass,.ssa" data-s-file hidden>';
  if(!st.subSearch)h+='<div class="mpx-note">'+(st.admin?'Want to search online? <a href="#" data-s-setup>Add an OpenSubtitles key</a> (free).':'Online subtitle search isn’t set up on this server yet.')+'</div>';
  h+='<div data-s-msg></div>';
  if(X.sub.mode==='ext')h+='<div class="mpx-card"><div class="mpx-rowx"><span class="mpx-lbl">Timing<small>Subtitles early? Press +. Late? Press −.</small></span><button class="mpx-step" type="button" data-s-off-="-250" aria-label="Show subtitles earlier">−</button><span class="mpx-val" data-s-offv>'+offLabel()+'</span><button class="mpx-step" type="button" data-s-off-="250" aria-label="Show subtitles later">+</button></div></div>';
  h+='<div class="mpx-card"><div class="mpx-lbl" style="margin-bottom:8px">Size</div><div class="mpx-chips">'+[['s','Small'],['m','Medium'],['l','Large'],['xl','Extra large']].map(x=>'<button class="mpx-chip'+(PREF.subSize===x[0]?' on':'')+'" type="button" data-s-size="'+x[0]+'">'+x[1]+'</button>').join('')+'</div></div>';
  h+='</div>';p.innerHTML=h;wireHead();
  const msg=p.querySelector('[data-s-msg]');
  p.querySelector('[data-s-off]').onclick=()=>{subOff();renderSubs();};
  p.querySelectorAll('[data-s-emb]').forEach(b=>b.onclick=()=>{subEmb(b.dataset.sEmb,b.querySelector('b').textContent);renderSubs();});
  p.querySelectorAll('[data-s-ext]').forEach(b=>b.onclick=e=>{if(e.target.closest('[data-s-del]'))return;subExt(ext[Number(b.dataset.sExt)]);renderSubs();});
  p.querySelectorAll('[data-s-del]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const s=ext[Number(b.dataset.sDel)];try{const r=await api('/api/player/subs?path='+encodeURIComponent(X.path)+'&id='+encodeURIComponent(s.id),{method:'DELETE'});X.info.subs=r.subs;if(X.sub.id===s.id)subOff();renderSubs();}catch(err){msg.innerHTML='<div class="mpx-err">'+esc(err.message)+'</div>';}});
  const sb=p.querySelector('[data-s-search]');if(sb)sb.onclick=()=>openPanel('subs','search');
  const su=p.querySelector('[data-s-setup]');if(su)su.onclick=e=>{e.preventDefault();openPanel('settings','admin');};
  const file=p.querySelector('[data-s-file]');p.querySelector('[data-s-up]').onclick=()=>file.click();
  file.onchange=async()=>{const f=file.files[0];if(!f)return;msg.innerHTML='<div class="mpx-note">Adding '+esc(f.name)+'…</div>';
    try{const r=await api('/api/player/subs/upload?path='+encodeURIComponent(X.path)+'&name='+encodeURIComponent(f.name),{method:'POST',raw:f});X.info.subs=(X.info.subs||[]).concat([r.sub]);subExt(r.sub);renderSubs();toast('Subtitles added');}
    catch(err){msg.innerHTML='<div class="mpx-err">'+esc(err.message)+'</div>';}};
  p.querySelectorAll('[data-s-off-]').forEach(b=>b.onclick=()=>{const s=(X.info.subs||[]).find(x=>x.id===X.sub.id);if(!s)return;X.sub.offset=clamp(X.sub.offset+Number(b.getAttribute('data-s-off-')),-600000,600000);subExt(s,true);const o=p.querySelector('[data-s-offv]');if(o)o.textContent=offLabel();});
  p.querySelectorAll('[data-s-size]').forEach(b=>b.onclick=()=>{PREF.subSize=b.dataset.sSize;savePref();paintSubBtn();renderSubs();});
}
function offLabel(){const o=X.sub.offset||0;return (o>0?'+':o<0?'−':'')+(Math.abs(o)/1000).toFixed(2).replace(/0$/,'')+' s';}
function renderSubSearch(){
  const p=E.panel,st=X.settings||{},inf=X.info||{};
  const langs=String(st.subLangs||'en').split(',').filter(Boolean);
  const cur=LS.get('mediarr-player-sublang',langs[0])||langs[0];
  const guess=inf.episode!=null&&inf.show?inf.show+' S'+String(inf.season||1).padStart(2,'0')+'E'+String(inf.episode).padStart(2,'0'):(inf.title||X.name);
  p.innerHTML=head('Search subtitles',true)+'<div class="mpx-pb"><form data-q style="display:flex;gap:8px;margin:2px 4px 10px"><input class="mpx-in" name="q" placeholder="'+esc(guess)+'" aria-label="Search for subtitles" autocomplete="off"><button class="mpx-btn" type="submit" aria-label="Search" style="width:44px;padding:0;flex:none">'+I.search+'</button></form>'
    +'<div class="mpx-chips" style="margin:0 4px 6px" data-langs>'+langs.map(l=>'<button class="mpx-chip'+(l===cur?' on':'')+'" type="button" data-lang="'+esc(l)+'">'+esc(l.toUpperCase())+'</button>').join('')+'</div><div data-res><div class="mpx-empty">Searching…</div></div><div class="mpx-note">Results come from OpenSubtitles. A subtitle you pick is kept with this video for everyone.</div></div>';
  wireHead(()=>openPanel('subs'));
  const form=p.querySelector('[data-q]'),res=p.querySelector('[data-res]');let lang=langs.includes(cur)?cur:langs[0];
  const run=async()=>{
    res.innerHTML='<div class="mpx-empty">Searching…</div>';
    try{
      const r=await api('/api/player/subs/search?path='+encodeURIComponent(X.path)+'&lang='+encodeURIComponent(lang)+(form.q.value.trim()?'&q='+encodeURIComponent(form.q.value.trim()):''));
      if(X.panel!=='subs'||X.view!=='search')return;
      if(!r.results.length){res.innerHTML='<div class="mpx-empty">Nothing found. Try the title on its own, or another language.</div>';return;}
      res.innerHTML=r.results.map((x,i)=>'<button class="mpx-item" type="button" data-r="'+i+'"><span class="g"><b>'+esc(x.release||x.feature||'Subtitle')+'</b><small>'+esc([x.langName||x.lang,x.downloads?x.downloads.toLocaleString()+' downloads':'',x.feature].filter(Boolean).join(' · '))+'</small></span>'
        +(x.exact?'<span class="mpx-tag hi">Made for this file</span>':'')+(x.trusted?'<span class="mpx-tag">Trusted</span>':'')+(x.hi?'<span class="mpx-tag" title="Includes sounds, for deaf and hard-of-hearing viewers">SDH</span>':'')+(x.ai?'<span class="mpx-tag" title="Machine translated">AI</span>':'')+'</button>').join('');
      res.querySelectorAll('[data-r]').forEach(b=>b.onclick=async()=>{
        const x=r.results[Number(b.dataset.r)];b.classList.add('busy');
        try{const d=await api('/api/player/subs/download?path='+encodeURIComponent(X.path),{method:'POST',body:{fileId:x.fileId,lang:x.lang,release:x.release}});
          X.info.subs=(X.info.subs||[]).filter(s=>s.id!==d.sub.id).concat([d.sub]);subExt(d.sub);openPanel('subs');toast('Subtitles added'+(d.remaining!=null?' · '+d.remaining+' left today':''),2800);}
        catch(err){b.classList.remove('busy');const old=res.querySelector('.mpx-err');if(old)old.remove();res.insertAdjacentHTML('afterbegin','<div class="mpx-err">'+esc(err.message)+'</div>');}
      });
    }catch(err){res.innerHTML='<div class="mpx-err">'+esc(err.message)+'</div>';}
  };
  form.onsubmit=e=>{e.preventDefault();run();};
  p.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;LS.set('mediarr-player-sublang',lang);p.querySelectorAll('[data-lang]').forEach(z=>z.classList.toggle('on',z===b));run();});
  run();
}

function renderSettings(){
  const p=E.panel,st=X.settings||{},v=X.v;
  if(X.view==='admin')return renderAdmin();
  const proxy=(id,label)=>{const s=document.getElementById(id);if(!s||s.options.length<2)return '';return '<div class="mpx-h">'+label+'</div>'+[].slice.call(s.options).map(o=>'<button class="mpx-item'+(o.value===s.value?' on':'')+'" type="button" data-px="'+id+'" data-val="'+esc(o.value)+'"><span class="ck">'+I.check+'</span><span class="g"><b>'+esc(o.text)+'</b></span></button>').join('');};
  let h=head('Settings')+'<div class="mpx-pb"><div class="mpx-h">Speed</div><div class="mpx-chips" style="margin:0 4px">'+[0.5,0.75,1,1.25,1.5,2].map(r=>'<button class="mpx-chip'+(Math.abs((v.playbackRate||1)-r)<.01?' on':'')+'" type="button" data-rate="'+r+'">'+(r===1?'Normal':r+'×')+'</button>').join('')+'</div>'
    +'<div class="mpx-card"><div class="mpx-rowx"><span class="mpx-lbl">Play the next episode<small>Starts by itself when an episode ends.</small></span>'+sw('autoplay',PREF.autoplay)+'</div>'
    +'<div class="mpx-rowx"><span class="mpx-lbl">Skip intros and recaps<small>Jumps past them without asking, when the video marks them.</small></span>'+sw('autoSkip',PREF.autoSkip)+'</div>'
    +(st.seekPreviews?'<div class="mpx-rowx"><span class="mpx-lbl">Picture previews<small>Shows the scene as you move along the seek bar.</small></span>'+sw('previews',PREF.previews)+'</div>':'')+'</div>'
    +proxy(ids().audio,'Audio')+proxy(ids().qual,'Quality')
    +(st.admin?'<div class="mpx-tools one"><button class="mpx-btn ghost" type="button" data-admin>'+I.gear+'Player settings for everyone</button></div>':'')
    +'<div class="mpx-note">Shortcuts: Space play/pause · ← → 10 s · ↑ ↓ volume · F full screen · M mute · C subtitles · N next · S skip</div></div>';
  p.innerHTML=h;wireHead();
  p.querySelectorAll('[data-rate]').forEach(b=>b.onclick=()=>{v.playbackRate=Number(b.dataset.rate);renderSettings();});
  p.querySelectorAll('[data-sw]').forEach(b=>b.onclick=()=>{const k=b.dataset.sw;PREF[k]=!PREF[k];savePref();b.setAttribute('aria-checked',PREF[k]?'true':'false');if(k==='previews'&&PREF.previews)prefetch();});
  p.querySelectorAll('[data-px]').forEach(b=>b.onclick=()=>{const s=document.getElementById(b.dataset.px);if(!s)return;s.value=b.dataset.val;s.dispatchEvent(new Event('change'));setTimeout(renderSettings,50);});
  const a=p.querySelector('[data-admin]');if(a)a.onclick=()=>openPanel('settings','admin');
}
function renderAdmin(){
  const p=E.panel,c=(X.settings&&X.settings.config)||{opensubtitles:{}};const os=c.opensubtitles||{};
  p.innerHTML=head('Player settings',true)+'<div class="mpx-pb"><div class="mpx-note" style="margin-top:0">These apply to everyone on this server.</div>'
    +'<div class="mpx-card"><div class="mpx-rowx"><span class="mpx-lbl">Picture previews on the seek bar<small>Made with ffmpeg the first time a video is played, then kept.</small></span>'+sw('seekPreviews',c.seekPreviews!==false)+'</div>'
    +'<div class="mpx-rowx"><span class="mpx-lbl">Watch Together<small>Lets people watch in step from their own devices.</small></span>'+sw('watchTogether',c.watchTogether!==false)+'</div></div>'
    +'<div class="mpx-h">Online subtitle search</div><div class="mpx-card" style="margin-top:0"><div class="mpx-help" style="margin-bottom:10px">Uses OpenSubtitles. Create a free account at opensubtitles.com, then make an API key under “API consumers”. Signing in below raises the daily download allowance.</div>'
    +'<input class="mpx-in" data-f="apiKey" type="password" autocomplete="off" placeholder="'+(os.hasKey?'API key saved · leave empty to keep it':'API key')+'" aria-label="OpenSubtitles API key">'
    +'<input class="mpx-in" data-f="username" style="margin-top:8px" autocomplete="off" placeholder="OpenSubtitles username (optional)" aria-label="OpenSubtitles username" value="'+esc(os.username||'')+'">'
    +'<input class="mpx-in" data-f="password" type="password" style="margin-top:8px" autocomplete="new-password" placeholder="'+(os.hasPassword?'Password saved · leave empty to keep it':'Password (optional)')+'" aria-label="OpenSubtitles password">'
    +'<input class="mpx-in" data-f="subLangs" style="margin-top:8px" autocomplete="off" placeholder="Languages, e.g. en,es" aria-label="Subtitle languages" value="'+esc(c.subLangs||'en')+'"><div class="mpx-help" style="margin-top:6px">Languages to offer, as two-letter codes separated by commas.</div></div>'
    +'<div data-msg></div><div class="mpx-tools"><button class="mpx-btn" type="button" data-save>Save</button><button class="mpx-btn ghost" type="button" data-test>Save and test</button></div></div>';
  wireHead(()=>openPanel('settings'));
  const f=k=>p.querySelector('[data-f='+k+']').value;
  p.querySelectorAll('[data-sw]').forEach(b=>b.onclick=()=>b.setAttribute('aria-checked',b.getAttribute('aria-checked')==='true'?'false':'true'));
  const save=async test=>{
    const msg=p.querySelector('[data-msg]');msg.innerHTML='<div class="mpx-note">Saving…</div>';
    try{
      const r=await api('/api/player/settings',{method:'POST',body:{seekPreviews:p.querySelector('[data-sw=seekPreviews]').getAttribute('aria-checked')==='true',watchTogether:p.querySelector('[data-sw=watchTogether]').getAttribute('aria-checked')==='true',subLangs:f('subLangs'),opensubtitles:{apiKey:f('apiKey'),username:f('username'),password:f('password')},test:!!test}});
      X.settings=r;paintTitles();
      msg.innerHTML=r.test?('<div class="'+(r.test.ok?'mpx-ok':'mpx-err')+'">'+esc(r.test.ok?'OpenSubtitles: '+r.test.message:r.test.message)+'</div>'):'<div class="mpx-ok">Saved</div>';
    }catch(e){msg.innerHTML='<div class="mpx-err">'+esc(e.message)+'</div>';}
  };
  p.querySelector('[data-save]').onclick=()=>save(false);p.querySelector('[data-test]').onclick=()=>save(true);
}

/* ---------- Watch Together ---------- */
const COLORS=['#f7b267','#7bdff2','#b2f7ef','#f2b5d4','#c3f584','#ffd166','#a0c4ff','#ffadad'];
const colorOf=n=>{let h=0;for(const c of String(n))h=(h*31+c.charCodeAt(0))>>>0;return COLORS[h%COLORS.length];};
function inviteLink(id){return location.origin+'/?party='+id;}
function renderParty(){
  const p=E.panel,pt=X.party;
  if(!pt){
    p.innerHTML=head('Watch together')+'<div class="mpx-pb"><div class="mpx-hero"><div class="em">🍿</div><h4>Watch with friends</h4><p>Everyone presses play on their own device and stays in step: pause, skip or jump and it happens for all of you.</p><button class="mpx-btn wide" type="button" data-start>Start a watch party</button></div>'
      +'<div class="mpx-or">or join one</div><form class="mpx-join" data-join><input class="mpx-in" name="code" maxlength="6" placeholder="CODE" aria-label="Party code" autocomplete="off" autocapitalize="characters"><button class="mpx-btn ghost" type="submit">Join</button></form><div data-msg></div>'
      +'<div class="mpx-note">Friends need an account on this MEDIARR. Send them the invite link, or read them the six-letter code.</div></div>';
    wireHead();
    const msg=p.querySelector('[data-msg]');
    p.querySelector('[data-start]').onclick=async e=>{e.target.disabled=true;try{await partyStart();}catch(err){e.target.disabled=false;msg.innerHTML='<div class="mpx-err">'+esc(err.message)+'</div>';}};
    p.querySelector('[data-join]').onsubmit=async e=>{e.preventDefault();const code=e.target.code.value.trim().toUpperCase();if(code.length!==6){msg.innerHTML='<div class="mpx-err">Codes are six letters or numbers.</div>';return;}try{await partyJoin(code);}catch(err){msg.innerHTML='<div class="mpx-err">'+esc(err.message)+'</div>';}};
    return;
  }
  const mem=(pt.members||[]).filter(m=>m.online!==false);
  p.innerHTML=head('Watch together')+'<div class="mpx-pb"><div class="mpx-card" style="margin-top:2px;text-align:center"><div class="mpx-eyebrow" style="margin-bottom:8px">Party code</div><div class="mpx-code">'+pt.id.split('').map(c=>'<span>'+esc(c)+'</span>').join('')+'</div><button class="mpx-btn wide" type="button" data-copy>'+I.link+'Copy invite link</button></div>'
    +'<div class="mpx-h">Watching now · '+mem.length+'</div><div class="mpx-people">'+mem.map(m=>'<span class="mpx-person"><i style="background:'+colorOf(m.name)+'">'+esc(m.name.slice(0,1).toUpperCase())+'</i>'+esc(m.name)+(m.buffering?' <em>loading…</em>':'')+'</span>').join('')+'</div>'
    +'<div class="mpx-reacts">'+(pt.reactions||[]).slice(0,6).map(e=>'<button type="button" data-react="'+esc(e)+'" aria-label="React '+esc(e)+'">'+esc(e)+'</button>').join('')+'</div>'
    +'<div class="mpx-chat" data-chat></div><div class="mpx-tools one" style="margin-top:14px"><button class="mpx-btn ghost" type="button" data-leave>Leave the party</button></div></div>'
    +'<form class="mpx-say" data-say><input class="mpx-in" name="t" maxlength="300" placeholder="Say something…" aria-label="Message" autocomplete="off"><button class="mpx-btn" type="submit" aria-label="Send">'+I.send+'</button></form>';
  wireHead();paintChat();
  p.querySelector('[data-copy]').onclick=async e=>{const link=inviteLink(pt.id);try{await navigator.clipboard.writeText(link);e.currentTarget.innerHTML=I.check+'Link copied';}catch(_){prompt('Copy this invite link',link);}};
  p.querySelectorAll('[data-react]').forEach(b=>b.onclick=()=>{partySend({action:'react',emoji:b.dataset.react});});
  p.querySelector('[data-say]').onsubmit=e=>{e.preventDefault();const t=e.target.t.value.trim();if(!t)return;e.target.t.value='';partySend({action:'say',text:t});};
  p.querySelector('[data-leave]').onclick=()=>partyLeave();
}
function paintChat(){
  const box=E.panel&&E.panel.querySelector('[data-chat]');if(!box||!X.party)return;
  const me_=myName();
  box.innerHTML=(X.party.chat||[]).map(m=>m.sys?'<div class="mpx-msg sys">'+esc(m.text)+'</div>':'<div class="mpx-msg'+(m.from===me_?' me':'')+'">'+(m.from===me_?'':'<b>'+esc(m.from)+'</b>')+esc(m.text)+'</div>').join('')||'<div class="mpx-msg sys">Say hi 👋</div>';
  box.scrollTop=box.scrollHeight;
}
function paintPartyBadge(){
  const b=q('[data-a=party]');if(b)b.classList.toggle('live',!!X.party);
  if(!E.badges)return;
  E.badges.innerHTML=X.party?'<span class="mpx-badge" role="button" tabindex="0" title="Watch together"><i></i>'+((X.party.members||[]).filter(m=>m.online!==false).length||1)+' watching</span>':'';
  const el=E.badges.firstChild;if(el)el.onclick=e=>{e.stopPropagation();openPanel('party');};
}
function floatEmoji(emoji,from){const s=document.createElement('span');s.style.left=(8+Math.random()*78)+'%';s.innerHTML=esc(emoji)+'<small>'+esc(from||'')+'</small>';E.float.appendChild(s);setTimeout(()=>s.remove(),2700);}
async function partySend(body){if(!X.party)return null;const v=X.v;try{return await api('/api/party/'+X.party.id,{method:'POST',body:Object.assign({client:CID,pos:v?v.currentTime:0,buffering:!!(v&&X.wrap.classList.contains('mpx-wait'))},body)});}catch(e){if(/ended|wrong/.test(e.message))partyLeave(true);return null;}}
function partyConnect(room){
  if(X.party)partyLeave(true);
  const pt=X.party={id:room.id,state:Object.assign({},room.state,{rx:Date.now()}),members:room.members||[],chat:room.chat||[],reactions:room.reactions||[],mute:0,pending:false,es:null,ping:0};
  pt.es=new EventSource('/api/party/'+room.id+'/stream?client='+CID);
  pt.es.addEventListener('party',e=>{let m;try{m=JSON.parse(e.data);}catch(_){return;}partyEvent(m);});
  pt.ping=setInterval(async()=>{const r=await partySend({action:'ping'});if(!r||!X.party)return;X.party.members=r.members;paintPartyBadge();partyDrift(r.state);},4000);
  paintPartyBadge();if(X.panel==='party')renderParty();
}
function partyEvent(m){
  const pt=X.party;if(!pt)return;
  if(m.type==='hello'){pt.members=m.room.members;pt.chat=m.room.chat||pt.chat;pt.reactions=m.room.reactions||pt.reactions;partyApply(m.room.state,'hello');}
  else if(m.type==='members'){pt.members=m.members;if(m.joined){toast(m.joined+' joined');pt.chat.push({sys:true,text:m.joined+' joined'});}if(m.left){toast(m.left+' left');pt.chat.push({sys:true,text:m.left+' left'});}paintPartyBadge();if(X.panel==='party')renderParty();}
  else if(m.type==='state'){partyApply(m.state,m.action);}
  else if(m.type==='chat'){pt.chat.push(m.msg);if(pt.chat.length>80)pt.chat.shift();if(X.panel==='party')paintChat();else if(m.msg.from!==myName())toast(m.msg.from+': '+m.msg.text,3200);}
  else if(m.type==='react'){floatEmoji(m.emoji,m.from===myName()?'':m.from);}
  else if(m.type==='closed'){partyLeave(true);toast('The watch party has ended');}
}
function partyTarget(st){return (st.pos||0)+(st.playing?((st.age||0)+(Date.now()-st.rx))/1000:0);}
function partyApply(st,action){
  const pt=X.party;if(!pt||!st)return;
  st=Object.assign({},st,{rx:Date.now()});pt.state=st;
  if(st.path!==X.path){pt.mute=Date.now()+4000;pt.pending=true;pt.following=st.path;const fn=X.kind==='m'?window.playVideoMobile:window.playVideoD;if(typeof fn==='function')fn(st.path,st.name);if(action==='load')toast(st.by+' started '+st.name.replace(/\.[a-z0-9]{2,4}$/i,''),2800);return;}
  const v=X.v;if(!v)return;
  if(!X.settled||v.readyState<1){pt.pending=true;return;}
  pt.mute=Date.now()+1200;
  const t=partyTarget(st);
  if(Math.abs((v.currentTime||0)-t)>1.2){try{v.currentTime=clamp(t,0,Math.max(0,dur()-0.3));}catch(_){}}
  if(st.playing&&v.paused)v.play().catch(()=>toast('Tap play to join in'));
  if(!st.playing&&!v.paused)v.pause();
  const who=st.by&&st.by!==myName()?st.by:'';
  if(who&&action==='pause')toast(who+' paused');else if(who&&action==='play')toast(who+' pressed play');else if(who&&action==='seek')toast(who+' jumped to '+fmt(st.pos));
}
function partyDrift(st){
  const pt=X.party,v=X.v;if(!pt||!v||!st||!X.settled||Date.now()<pt.mute)return;
  st=Object.assign({},st,{rx:Date.now()});pt.state=st;
  if(st.path!==X.path)return partyApply(st);
  if(E.seek._dragging&&E.seek._dragging())return;
  const t=partyTarget(st);
  if(st.playing!==!v.paused||Math.abs((v.currentTime||0)-t)>2.5)partyApply(st);
}
function partyLocal(kind){
  const pt=X.party,v=X.v;if(!pt||!v)return;
  if(!X.settled||Date.now()<pt.mute||pt.pending)return;
  if(kind==='seek'&&v.seeking)return;
  pt.state=Object.assign({},pt.state,{pos:v.currentTime,playing:kind==='seek'?!v.paused:kind==='play',age:0,rx:Date.now(),by:myName()});
  partySend({action:kind,pos:v.currentTime,playing:!v.paused});
}
async function partyStart(){
  const v=X.v;if(!X.path)throw new Error('Play something first');
  const room=await api('/api/party',{method:'POST',body:{path:X.path,name:X.name,pos:v?v.currentTime:0,playing:!!(v&&!v.paused)}});
  partyConnect(room);toast('Watch party started');
  try{await navigator.clipboard.writeText(inviteLink(room.id));toast('Invite link copied',2600);}catch(_){}
}
async function partyJoin(code){
  const room=await api('/api/party/'+encodeURIComponent(String(code).toUpperCase()));
  if(room.state.path!==X.path){
    const fn=window.playVideoD||window.playVideoMobile;if(typeof fn!=='function')throw new Error('The player isn’t ready yet');
    X.joining=room;fn(room.state.path,room.state.name);   // attach() connects once the player is up
  }else partyConnect(room);
  toast('You joined the watch party');
}
function partyLeave(silent){
  const pt=X.party;if(!pt)return;X.party=null;
  try{pt.es.close();}catch(_){}clearInterval(pt.ping);
  if(!silent)api('/api/party/'+pt.id,{method:'POST',body:{client:CID,action:'leave'}}).catch(()=>{});
  paintPartyBadge();if(X.panel==='party')renderParty();
  if(!silent)toast('You left the watch party');
}

/* ---------- attach to a playback ---------- */
function attach(v,path,name,kind){
  if(!v)return;
  setActive(v,kind);
  const same=X.path===path;
  X.path=path;X.name=name||path.split('/').pop();X.info=null;X.skipped={};X.up={on:false,dismissed:false,count:0,from:0};X.settled=false;
  hideUp();E.skip.classList.remove('on');E.skip.dataset.k='';
  if(!same){clearMine();X.sub={mode:'off',id:'',offset:0,label:''};}
  X.wrap.classList.add('mpx-wait');X.wrap.classList.remove('mpx-idle');
  E.marks.innerHTML='';E.zones.innerHTML='';E.buf.style.width=0;paintFill(0);
  paintTitles();paintPlay();paintVol();paintTime();paintSubBtn();paintPartyBadge();
  if(X.panel)openPanel(X.panel==='party'?'party':'');
  // Watch Together: joining, following, or taking everyone along
  if(X.joining&&X.joining.state.path===path){const room=X.joining;X.joining=null;partyConnect(room);X.party.pending=true;X.party.mute=Date.now()+4000;}
  else if(X.party){
    if(X.party.following===path||X.party.state.path===path){X.party.following='';X.party.pending=true;}
    else{X.party.mute=Date.now()+2500;X.party.state=Object.assign({},X.party.state,{path,name:X.name,pos:0,playing:true,age:0,rx:Date.now()});partySend({action:'load',path,name:X.name,pos:0});}
  }
  const my=path;
  api('/api/player/info?path='+encodeURIComponent(path)).then(inf=>{
    if(X.path!==my)return;
    X.info=inf;X.settings=inf.settings;paintTitles();paintMarks();paintTime();prefetch();autoSub();
    if(X.panel==='subs'||X.panel==='settings')openPanel(X.panel,X.view);
  }).catch(()=>{});
}
function detach(){
  if(!X.path)return;
  X.path='';X.info=null;X.prefetch++;clearTimeout(X.idleT);
  if(X.party)partyLeave();
  hideUp();if(E.skip)E.skip.classList.remove('on');
  openPanel('');
  if(X.wrap){X.wrap.classList.remove('mpx-fill','mpx-wait');document.documentElement.style.overflow='';}
  if(document.fullscreenElement&&X.wrap&&document.fullscreenElement===X.wrap)document.exitFullscreen().catch(()=>{});
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown',e=>{
  if(!X.path||!X.v||!X.wrap||!X.wrap.offsetParent&&!X.wrap.classList.contains('mpx-fs')&&!X.wrap.classList.contains('mpx-fill'))return;
  const tg=e.target,typing=tg&&(/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)||tg.isContentEditable);
  if(e.key==='Escape'){
    if(X.panel){e.preventDefault();e.stopImmediatePropagation();openPanel('');return;}
    if(X.wrap.classList.contains('mpx-fill')){e.preventDefault();e.stopImmediatePropagation();fullscreen();return;}
    if(X.kind==='d'&&!document.fullscreenElement&&!typing0(e)&&typeof window.closePlayerD==='function'){e.preventDefault();window.closePlayerD();}
    return;
  }
  if(typing||e.ctrlKey||e.metaKey||e.altKey)return;
  const v=X.v,k=e.key;
  if(k===' '||k==='k'||k==='K'){if(tg&&tg.tagName==='BUTTON'&&k===' ')return;e.preventDefault();toggle();wake();}
  else if(k==='ArrowLeft'){e.preventDefault();nudge(e.shiftKey?-30:-10);}
  else if(k==='ArrowRight'){e.preventDefault();nudge(e.shiftKey?30:10);}
  else if(k==='ArrowUp'){e.preventDefault();v.muted=false;v.volume=clamp(v.volume+.1,0,1);wake();}
  else if(k==='ArrowDown'){e.preventDefault();v.volume=clamp(v.volume-.1,0,1);wake();}
  else if(k==='f'||k==='F')act('fs');
  else if(k==='m'||k==='M')act('mute');
  else if(k==='c'||k==='C')act('subs');
  else if(k==='n'||k==='N')act('next');
  else if(k==='s'||k==='S'){if(curSkip())doSkip();}
  else return;
},true);

/* ---------- hooks into the pages ---------- */
function typing0(e){const t=e.target;return !!(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable));}
function hook(fn,vid,kind){
  const orig=window[fn];if(typeof orig!=='function'||orig.__mpx)return false;
  const wrapped=function(path,name){const r=orig.apply(this,arguments);try{attach(document.getElementById(vid),String(path||''),String(name||''),kind);}catch(e){console.error('[player]',e);}return r;};
  wrapped.__mpx=true;if(orig.__mediarr170)wrapped.__mediarr170=true;window[fn]=wrapped;return true;
}
function install(){
  const s=document.createElement('style');s.id='mpxStyle';s.textContent=CSS;document.head.appendChild(s);
  const d=document.getElementById('dlVideo'),m=document.getElementById('mVideo');
  if(d)build(d,'d');if(m)build(m,'m');
  hook('playVideoD','dlVideo','d');hook('playVideoMobile','mVideo','m');
  // closing the player
  const ov=document.getElementById('playerOverlay');
  if(ov&&window.MutationObserver)new MutationObserver(()=>{if(!ov.classList.contains('show')&&X.kind==='d'&&X.path){const v=X.v;detach();try{if(v&&v.getAttribute('src')&&typeof window.closePlayerD==='function')window.closePlayerD();}catch(_){}}}).observe(ov,{attributes:true,attributeFilter:['class']});
  const mm=document.getElementById('player');if(mm)mm.addEventListener('hidden.bs.modal',()=>{if(X.kind==='m')detach();});
  window.addEventListener('pagehide',()=>{if(X.party)try{navigator.sendBeacon('/api/party/'+X.party.id,new Blob([JSON.stringify({client:CID,action:'leave'})],{type:'application/json'}));}catch(_){}});
  // invite links: /?party=CODE
  const code=(/[?&]party=([A-Za-z0-9]{6})\b/.exec(location.search)||[])[1];
  if(code){
    let tries=0;const t=setInterval(()=>{
      if(++tries>600)return clearInterval(t);
      let ready=false;try{ready=signedIn()&&typeof config!=='undefined'&&!!config;}catch(_){}
      if(!ready)return;clearInterval(t);
      try{const u=new URL(location.href);u.searchParams.delete('party');history.replaceState(null,'',u.pathname+(u.search||'')+u.hash);}catch(_){}
      setTimeout(()=>partyJoin(code).catch(e=>alert('Couldn’t join the watch party: '+e.message)),400);
    },500);
  }
}
window.MediarrPlayer={joinParty:code=>partyJoin(code),state:X,prefs:PREF};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
