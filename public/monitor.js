/*
 * MEDIARR Resource Monitor (v2.15) — admin page on the desktop and phone sites.
 * CPU, memory, storage, network and temperatures with live charts, every process,
 * and Docker containers. Data comes from /api/admin/monitor every 2 seconds while
 * the page is open and visible.
 */
(function(){
'use strict';
if(window.MediarrMonitor)return;

const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(_){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}}};
const PHONE=location.pathname==='/m'||location.pathname.startsWith('/m/')||!!document.getElementById('mTranscodes');
function bytes(n,dec){n=Number(n)||0;const u=['B','KB','MB','GB','TB','PB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}const d=dec!=null?dec:(n>=100||i===0?0:n>=10?1:2);return n.toFixed(d).replace(/\.0+$/,'')+' '+u[i];}
function rate(n){return bytes(n,(n||0)>=1024*100?0:1)+'/s';}
function pct(n){n=Number(n)||0;return (n>=10||n===0?Math.round(n):n.toFixed(1))+'%';}
function dur(sec){sec=Math.max(0,Math.round(sec||0));const d=Math.floor(sec/86400),h=Math.floor(sec/3600)%24,m=Math.floor(sec/60)%60;if(d)return d+' d '+h+' h';if(h)return h+' h '+m+' min';if(m)return m+' min';return sec+' s';}
const level=p=>p>=90?'bad':p>=75?'warn':'ok';
const sv=(d,w)=>'<svg viewBox="0 0 24 24" width="'+(w||18)+'" height="'+(w||18)+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
const I={
  cpu:sv('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  mem:sv('<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7v10M10 7v10M14 7v10M18 7v10M5 17v3M19 17v3"/>'),
  disk:sv('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  net:sv('<path d="M7 17V5M3 9l4-4 4 4M17 7v12M13 15l4 4 4-4"/>'),
  pause:sv('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',16),
  play:sv('<path d="M7 5v14l11-7z"/>',16),
  search:sv('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',16),
  box:sv('<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  temp:sv('<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',14),
  host:sv('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',16),
  chev:sv('<path d="M9 6l6 6-6 6"/>',14),
  info:sv('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',16)
};

const CSS=`
.rm{--rm-a:var(--gold,var(--bs-warning,#e8b04a));--rm-ok:#35c98a;--rm-warn:#f0a73a;--rm-bad:#f0625d;--rm-blue:#5fa8ff;--rm-violet:#a78bfa;--rm-p:var(--panel,var(--bs-tertiary-bg,#171b25));--rm-p2:var(--panel2,var(--bs-secondary-bg,#1d2230));--rm-l:var(--line,var(--bs-border-color,#2a3142));--rm-t:var(--txt,var(--bs-body-color,#e9edf5));--rm-m:var(--muted,var(--bs-secondary-color,#8f9bb3));color:var(--rm-t);font-size:14px;line-height:1.4}
.rm *{box-sizing:border-box}
.rm-modal.modal{max-width:min(1280px,96vw)}
.rm-modal .modal-head{gap:14px}
.rm-modal .modal-body{padding:18px 22px 24px}
.rm-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.rm-host{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--rm-m);font-size:13px;flex:1;min-width:0}
.rm-host b{color:var(--rm-t);font-weight:700}
.rm-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;background:var(--rm-p);border:1px solid var(--rm-l);font-size:12px;font-weight:600;color:var(--rm-t);white-space:nowrap}
.rm-chip.dock{color:var(--rm-blue);border-color:color-mix(in srgb,var(--rm-blue) 40%,transparent);background:color-mix(in srgb,var(--rm-blue) 10%,transparent)}
.rm-live{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--rm-m);white-space:nowrap}
.rm-live i{width:8px;height:8px;border-radius:50%;background:var(--rm-ok);box-shadow:0 0 0 0 color-mix(in srgb,var(--rm-ok) 60%,transparent);animation:rmPulse 2s infinite}
.rm-live.off i{background:var(--rm-m);animation:none}
@keyframes rmPulse{70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.rm-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:10px;border:1px solid var(--rm-l);background:var(--rm-p);color:var(--rm-t);font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s}
.rm-btn:hover{border-color:var(--rm-a)}
.rm-tabs{display:flex;gap:4px;padding:4px;border-radius:12px;background:var(--rm-p);border:1px solid var(--rm-l);margin-bottom:16px;width:max-content;max-width:100%;overflow-x:auto}
.rm-tab{border:0;background:transparent;color:var(--rm-m);font:inherit;font-weight:700;font-size:13.5px;padding:8px 16px;border-radius:9px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:7px;transition:background .15s,color .15s}
.rm-tab:hover{color:var(--rm-t)}
.rm-tab.on{background:var(--rm-a);color:#17130a}
.rm-tab .n{font-size:11px;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,currentColor 16%,transparent)}
.rm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.rm-card{position:relative;background:var(--rm-p);border:1px solid var(--rm-l);border-radius:16px;padding:16px 16px 12px;overflow:hidden;min-width:0}
.rm-grid>.rm-card{display:flex;flex-direction:column}
.rm-grid>.rm-card .rm-spark{margin-top:auto;padding-top:12px;height:66px}
.rm-card h4{margin:0;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--rm-m)}
.rm-card h4 svg{color:var(--rm-a)}
.rm-card h4 .r{margin-left:auto;letter-spacing:0;text-transform:none;font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:4px}
.rm-stat{display:flex;align-items:center;gap:14px;margin-top:12px}
.rm-ring{position:relative;flex:none;width:84px;height:84px}
.rm-ring svg{width:84px;height:84px;transform:rotate(-90deg)}
.rm-ring .bg{stroke:color-mix(in srgb,var(--rm-t) 9%,transparent)}
.rm-ring .fg{transition:stroke-dashoffset .6s cubic-bezier(.3,.8,.3,1),stroke .3s}
.rm-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}
.rm-ok{color:var(--rm-ok);stroke:var(--rm-ok)}.rm-warn{color:var(--rm-warn);stroke:var(--rm-warn)}.rm-bad{color:var(--rm-bad);stroke:var(--rm-bad)}
.rm-facts{min-width:0;flex:1;display:grid;gap:3px;font-size:12.5px;color:var(--rm-m)}
.rm-facts b{color:var(--rm-t);font-weight:700;font-variant-numeric:tabular-nums}
.rm-big{font-size:26px;font-weight:800;line-height:1.1;color:var(--rm-t);font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.rm-big small{font-size:13px;font-weight:600;color:var(--rm-m);letter-spacing:0}
.rm-duo{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.rm-duo div{min-width:0}
.rm-duo span{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--rm-m);text-transform:uppercase;letter-spacing:.6px}
.rm-duo span i{width:8px;height:8px;border-radius:2px}
.rm-duo .rm-big{font-size:21px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-spark{display:block;width:100%;height:54px;margin-top:12px}
.rm-spark path.l{fill:none;stroke-width:1.8;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.rm-axis{display:flex;justify-content:space-between;font-size:10.5px;color:var(--rm-m);margin-top:2px;opacity:.8}
.rm-sec{margin-top:14px}
.rm-two{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;margin-top:14px}
.rm-cores{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:8px;margin-top:14px}
.rm-core{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:10.5px;color:var(--rm-m);font-variant-numeric:tabular-nums}
.rm-core .t{position:relative;width:100%;height:58px;border-radius:7px;background:color-mix(in srgb,var(--rm-t) 7%,transparent);overflow:hidden}
.rm-core .t i{position:absolute;left:0;right:0;bottom:0;border-radius:7px 7px 0 0;background:linear-gradient(to top,color-mix(in srgb,var(--rm-a) 70%,transparent),var(--rm-a));transition:height .5s ease}
.rm-core .t i.rm-warn{background:linear-gradient(to top,color-mix(in srgb,var(--rm-warn) 70%,transparent),var(--rm-warn))}
.rm-core .t i.rm-bad{background:linear-gradient(to top,color-mix(in srgb,var(--rm-bad) 70%,transparent),var(--rm-bad))}
.rm-core b{color:var(--rm-t);font-weight:700}
.rm-membar{display:flex;height:14px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--rm-t) 8%,transparent);margin-top:14px}
.rm-membar i{transition:width .5s ease}
.rm-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12px;color:var(--rm-m)}
.rm-legend span{display:inline-flex;align-items:center;gap:6px}
.rm-legend i{width:10px;height:10px;border-radius:3px}
.rm-legend b{color:var(--rm-t);font-weight:700}
.rm-disk{display:grid;grid-template-columns:40px minmax(0,1fr);gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--rm-l)}
.rm-disk:first-of-type{border-top:0;padding-top:8px}
.rm-disk .ic{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--rm-a) 13%,transparent);color:var(--rm-a)}
.rm-disk .ic.net{background:color-mix(in srgb,var(--rm-blue) 14%,transparent);color:var(--rm-blue)}
.rm-disk .nm{display:flex;align-items:baseline;gap:8px;min-width:0}
.rm-disk .nm b{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-disk .nm .tag{flex:none;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--rm-t) 9%,transparent);color:var(--rm-m)}
.rm-disk .nm .p{margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums}
.rm-disk .mp{font-size:11.5px;color:var(--rm-m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,Menlo,Consolas,monospace;margin-top:1px}
.rm-bar{height:8px;border-radius:99px;background:color-mix(in srgb,var(--rm-t) 9%,transparent);overflow:hidden;margin:8px 0 6px}
.rm-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--rm-a) 75%,#fff 0%),var(--rm-a));transition:width .5s ease}
.rm-bar i.rm-warn{background:var(--rm-warn)}.rm-bar i.rm-bad{background:var(--rm-bad)}
.rm-disk .ft{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--rm-m)}
.rm-disk .ft b{color:var(--rm-t);font-weight:700}
.rm-top5 .row{display:grid;grid-template-columns:minmax(0,1fr) 64px 76px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--rm-l);font-size:13px}
.rm-top5 .row:first-of-type{border-top:0}
.rm-top5 .row .n{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}
.rm-top5 .row .n small{font-weight:500;color:var(--rm-m);margin-left:6px}
.rm-top5 .row .v{text-align:right;font-variant-numeric:tabular-nums;color:var(--rm-m)}
.rm-top5 .row .v b{color:var(--rm-t)}
.rm-link{background:none;border:0;color:var(--rm-a);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:3px}
.rm-note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:color-mix(in srgb,var(--rm-blue) 9%,transparent);border:1px solid color-mix(in srgb,var(--rm-blue) 28%,transparent);font-size:13px;margin-bottom:14px;color:var(--rm-t)}
.rm-note svg{flex:none;color:var(--rm-blue);margin-top:1px}
.rm-note code{font-size:12px;padding:1px 6px;border-radius:5px;background:color-mix(in srgb,var(--rm-t) 10%,transparent)}
.rm-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.rm-search{position:relative;flex:1;min-width:200px;max-width:420px}
.rm-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--rm-m)}
.rm-search input{width:100%;height:38px;border-radius:11px;border:1px solid var(--rm-l);background:var(--rm-p);color:var(--rm-t);font:inherit;font-size:14px;padding:0 12px 0 36px;outline:none}
.rm-search input:focus{border-color:var(--rm-a)}
.rm-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--rm-m);cursor:pointer;user-select:none}
.rm-check input{accent-color:var(--rm-a);width:16px;height:16px}
.rm-count{margin-left:auto;font-size:12.5px;color:var(--rm-m)}
.rm-count b{color:var(--rm-t)}
.rm-tablew{border:1px solid var(--rm-l);border-radius:14px;overflow:auto;max-height:min(62vh,720px);background:var(--rm-p)}
.rm-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;font-variant-numeric:tabular-nums}
.rm-table th{position:sticky;top:0;z-index:1;background:var(--rm-p2);text-align:left;font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--rm-m);padding:10px 12px;border-bottom:1px solid var(--rm-l);white-space:nowrap;cursor:pointer;user-select:none}
.rm-table th.num,.rm-table td.num{text-align:right}
.rm-table th:hover{color:var(--rm-t)}
.rm-table th.on{color:var(--rm-a)}
.rm-table th.on::after{content:" ↓";}
.rm-table th.on.asc::after{content:" ↑";}
.rm-table td{padding:8px 12px;border-bottom:1px solid color-mix(in srgb,var(--rm-l) 60%,transparent);white-space:nowrap}
.rm-table tbody tr{cursor:pointer;transition:background .1s}
.rm-table tbody tr:hover{background:color-mix(in srgb,var(--rm-t) 4%,transparent)}
.rm-table tr.open{background:color-mix(in srgb,var(--rm-a) 7%,transparent)}
.rm-table tr.det td{white-space:normal;cursor:auto;background:color-mix(in srgb,var(--rm-a) 4%,transparent)}
.rm-pn{display:flex;align-items:center;gap:8px;min-width:0;max-width:420px}
.rm-pn b{flex:none;max-width:220px;font-weight:700;overflow:hidden;text-overflow:ellipsis}
.rm-pn .rm-badge{flex:none}
.rm-pn small{flex:1;color:var(--rm-m);overflow:hidden;text-overflow:ellipsis;font-size:12px;min-width:0}
.rm-badge{flex:none;font-size:10px;font-weight:800;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--rm-a) 20%,transparent);color:var(--rm-a)}
.rm-badge.blue{background:color-mix(in srgb,var(--rm-blue) 18%,transparent);color:var(--rm-blue)}
.rm-badge.gray{background:color-mix(in srgb,var(--rm-t) 9%,transparent);color:var(--rm-m)}
.rm-cell{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end}
.rm-mini{width:44px;height:5px;border-radius:99px;background:color-mix(in srgb,var(--rm-t) 9%,transparent);overflow:hidden}
.rm-mini i{display:block;height:100%;background:var(--rm-a);border-radius:99px}
.rm-mini i.rm-warn{background:var(--rm-warn)}.rm-mini i.rm-bad{background:var(--rm-bad)}
.rm-dim{color:var(--rm-m)}
.rm-det{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 18px;font-size:12.5px;color:var(--rm-m);padding:4px 0}
.rm-det b{display:block;color:var(--rm-t);font-weight:700}
.rm-cmd{grid-column:1/-1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--rm-t);padding:9px 11px;border-radius:9px;background:color-mix(in srgb,#000 30%,transparent);overflow-wrap:anywhere;user-select:text}
.rm-plist{display:flex;flex-direction:column;border:1px solid var(--rm-l);border-radius:14px;overflow:hidden;background:var(--rm-p)}
.rm-prow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:11px 14px;border-top:1px solid var(--rm-l);cursor:pointer}
.rm-prow:first-child{border-top:0}
.rm-prow .n{min-width:0;display:flex;align-items:center;gap:7px}
.rm-prow .n b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-prow .s{grid-column:1;font-size:11.5px;color:var(--rm-m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-prow .v{grid-row:1/3;grid-column:2;text-align:right;font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--rm-m);display:flex;flex-direction:column;justify-content:center;gap:2px}
.rm-prow .v b{color:var(--rm-t);font-size:14px}
.rm-prow .rm-det{grid-column:1/-1;margin-top:6px}
.rm-sortsel{height:38px;border-radius:11px;border:1px solid var(--rm-l);background:var(--rm-p);color:var(--rm-t);font:inherit;font-size:13px;padding:0 10px}
.rm-ctrs{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.rm-ctr{background:var(--rm-p);border:1px solid var(--rm-l);border-radius:14px;padding:14px;min-width:0}
.rm-ctr.self{border-color:color-mix(in srgb,var(--rm-a) 55%,transparent)}
.rm-ctr .hd{display:flex;align-items:center;gap:8px;min-width:0}
.rm-ctr .hd b{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-ctr .st{margin-left:auto;flex:none;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize}
.rm-ctr .st.running{background:color-mix(in srgb,var(--rm-ok) 16%,transparent);color:var(--rm-ok)}
.rm-ctr .st.other{background:color-mix(in srgb,var(--rm-t) 9%,transparent);color:var(--rm-m)}
.rm-ctr .im{font-size:11.5px;color:var(--rm-m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,Menlo,Consolas,monospace;margin-top:2px}
.rm-ctr .ln{display:grid;grid-template-columns:60px minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:10px;font-size:12px;color:var(--rm-m)}
.rm-ctr .ln b{color:var(--rm-t);font-variant-numeric:tabular-nums;font-weight:700}
.rm-ctr .ln .rm-bar{margin:0}
.rm-ctr.stopped{opacity:.6}
.rm-empty{padding:40px 16px;text-align:center;color:var(--rm-m)}
.rm-empty b{display:block;color:var(--rm-t);font-size:16px;margin-bottom:4px}
.rm-skel{height:220px;border-radius:16px;background:linear-gradient(110deg,var(--rm-p) 30%,var(--rm-p2) 50%,var(--rm-p) 70%);background-size:200% 100%;animation:rmShim 1.2s linear infinite}
@keyframes rmShim{to{background-position:-200% 0}}
@media (max-width:900px){.rm-two{grid-template-columns:1fr}}
@media (max-width:640px){
  .rm-host{flex-basis:100%;font-size:12.5px}
  .rm-live{margin-right:auto}
  .rm-disk{grid-template-columns:minmax(0,1fr)}.rm-disk .ic{display:none}
  .rm-grid{grid-template-columns:1fr 1fr;gap:10px}
  .rm-card{padding:13px 13px 10px;border-radius:14px}
  .rm-stat{flex-direction:column;align-items:flex-start;gap:8px}
  .rm-ring,.rm-ring svg{width:70px;height:70px}.rm-ring b{font-size:16px}
  .rm-duo{grid-template-columns:1fr;gap:6px}.rm-duo .rm-big{font-size:17px}
  .rm-big{font-size:21px}
  .rm-spark{height:40px}
  .rm-tabs{width:100%}.rm-tab{flex:1;justify-content:center;padding:8px 10px}
  .rm-search{min-width:0;max-width:none;flex-basis:100%}
  .rm-count{margin-left:0}
}
@media (prefers-reduced-motion:reduce){.rm *{animation:none!important;transition:none!important}}
`;

/* ---------- state ---------- */
const M={el:null,body:null,data:null,timer:0,paused:false,tab:LS.get('mediarr-monitor-tab','overview'),sort:LS.get('mediarr-monitor-sort',{k:'cpu',asc:false}),q:'',kernel:LS.get('mediarr-monitor-kernel',false),open:new Set(),busy:false,err:'',hover:-1};

/* ---------- charts ---------- */
let gid=0;
function spark(vals,max,color,opts){
  opts=opts||{};const n=vals.length,W=300,H=54;
  if(n<2)return '<svg class="rm-spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"></svg>';
  max=Math.max(max||0,1e-9);const step=W/(Math.max(n,opts.slots||n)-1),off=W-step*(n-1);
  const pts=vals.map((v,i)=>[off+i*step,H-2-Math.max(0,Math.min(1,v/max))*(H-6)]);
  const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const id='rmg'+(++gid);
  let extra='';
  if(opts.second){const p2=opts.second.map((v,i)=>[off+i*step,H-2-Math.max(0,Math.min(1,v/max))*(H-6)]);extra='<path class="l" d="'+p2.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')+'" stroke="'+opts.color2+'" stroke-dasharray="0"/>';}
  return '<svg class="rm-spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+color+'" stop-opacity=".38"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'
    +'<path d="'+line+' L'+W+' '+H+' L'+off.toFixed(1)+' '+H+' Z" fill="url(#'+id+')"/><path class="l" d="'+line+'" stroke="'+color+'"/>'+extra+'</svg>';
}
function ring(p,label){
  const r=36,c=2*Math.PI*r,off=c*(1-Math.max(0,Math.min(100,p))/100),lv='rm-'+level(p);
  return '<div class="rm-ring"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="'+r+'" fill="none" stroke-width="8"/><circle class="fg '+lv+'" cx="42" cy="42" r="'+r+'" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg><b>'+esc(label!=null?label:pct(p))+'</b></div>';
}
function colorVar(name){const el=M.el||document.body;const v=getComputedStyle(el.querySelector('.rm')||el).getPropertyValue(name).trim();return v||'#e8b04a';}

/* ---------- views ---------- */
function header(d){
  const h=d.host;
  return '<div class="rm-top"><div class="rm-host">'+I.host+'<b>'+esc(h.name)+'</b><span>·</span><span>'+esc(h.os)+'</span><span>·</span><span>up '+dur(h.uptime)+'</span>'
    +(h.container?'<span class="rm-chip dock">'+I.box+' '+esc(h.runtime)+'</span>':'')+'</div>'
    +'<span class="rm-live'+(M.paused?' off':'')+'"><i></i>'+(M.paused?'Paused':'Live · every 2 s')+'</span>'
    +'<button class="rm-btn" type="button" data-pause>'+(M.paused?I.play+'Resume':I.pause+'Pause')+'</button></div>'
    +'<div class="rm-tabs" role="tablist">'+[['overview','Overview'],['procs','Processes',d.procs.count],...(d.containers&&d.containers.available?[['docker','Docker',(d.containers.list||[]).filter(c=>c.state==='running').length]]:[])]
      .map(t=>'<button class="rm-tab'+(M.tab===t[0]?' on':'')+'" type="button" role="tab" aria-selected="'+(M.tab===t[0])+'" data-tab="'+t[0]+'">'+t[1]+(t[2]!=null?'<span class="n">'+t[2]+'</span>':'')+'</button>').join('')+'</div>';
}
function overview(d){
  const a=colorVar('--rm-a'),blue='#5fa8ff',vio='#a78bfa',ok='#35c98a';
  const H=d.hist,c=d.cpu,m=d.mem,slots=180;
  const memP=m.total?m.used/m.total*100:0;
  const netMax=Math.max(1024*16,...H.rx,...H.tx),ioMax=Math.max(1024*64,...H.rd,...H.wr);
  const axis='<div class="rm-axis"><span>'+Math.round(slots*(d.step||2000)/60000)+' min ago</span><span>now</span></div>';
  let h='<div class="rm-grid">';
  h+='<div class="rm-card"><h4>'+I.cpu+'CPU'+(c.temp!=null?'<span class="r '+(c.temp>=85?'rm-bad':c.temp>=72?'rm-warn':'')+'">'+I.temp+c.temp+' °C</span>':'')+'</h4><div class="rm-stat">'+ring(c.pct)+'<div class="rm-facts"><span><b>'+d.host.cores+'</b> '+(d.host.cores===1?'core':'cores')+(d.host.mhz?' · <b>'+(d.host.mhz/1000).toFixed(2)+'</b> GHz':'')+'</span><span>Load <b>'+c.load.map(v=>v.toFixed(2)).join(' · ')+'</b></span>'+(c.iowait>=1?'<span>Waiting on disks <b>'+pct(c.iowait)+'</b></span>':'')+(c.tasks?'<span><b>'+c.tasks.total.toLocaleString()+'</b> threads</span>':'')+'</div></div>'+spark(H.cpu,100,a,{slots})+axis+'</div>';
  h+='<div class="rm-card"><h4>'+I.mem+'Memory</h4><div class="rm-stat">'+ring(memP)+'<div class="rm-facts"><span><b>'+bytes(m.used)+'</b> of '+bytes(m.total)+' used</span><span><b>'+bytes(m.available)+'</b> available</span>'+(m.swapTotal?'<span>Swap <b>'+bytes(m.swapUsed)+'</b> of '+bytes(m.swapTotal)+'</span>':'')+(m.limit?'<span>MEDIARR limit <b>'+bytes(m.limit.used)+'</b> of '+bytes(m.limit.max)+'</span>':'')+'</div></div>'+spark(H.mem,m.total,vio,{slots})+axis+'</div>';
  h+='<div class="rm-card"><h4>'+I.disk+'Disk activity</h4><div class="rm-duo"><div><span><i style="background:'+ok+'"></i>Read</span><div class="rm-big">'+rate(d.io.read)+'</div></div><div><span><i style="background:'+a+'"></i>Write</span><div class="rm-big">'+rate(d.io.write)+'</div></div></div>'+spark(H.rd,ioMax,ok,{slots,second:H.wr,color2:a})+axis+'</div>';
  h+='<div class="rm-card"><h4>'+I.net+'Network</h4><div class="rm-duo"><div><span><i style="background:'+blue+'"></i>Download</span><div class="rm-big">'+rate(d.net.rx)+'</div></div><div><span><i style="background:'+vio+'"></i>Upload</span><div class="rm-big">'+rate(d.net.tx)+'</div></div></div>'+spark(H.rx,netMax,blue,{slots,second:H.tx,color2:vio})+axis+'</div>';
  h+='</div>';
  // storage + memory/cores
  const disks=d.disks||[];
  h+='<div class="rm-two"><div class="rm-card"><h4>'+I.disk+'Storage'+(disks.filter(x=>!x.network).length>1?'<span class="r">'+bytes(disks.filter(x=>!x.network).reduce((s,x)=>s+x.free,0))+' free on local disks</span>':'')+'</h4>'
    +(disks.length?disks.map(x=>{const lv=level(x.pct);return '<div class="rm-disk"><div class="ic'+(x.network?' net':'')+'">'+(x.network?I.net:I.disk)+'</div><div style="min-width:0"><div class="nm"><b>'+esc(x.name)+'</b>'+(x.type?'<span class="tag">'+esc(x.network?'network · '+x.type:x.type)+'</span>':'')+'<span class="p rm-'+lv+'">'+pct(x.pct)+'</span></div>'
      +'<div class="mp" title="'+esc(x.mounts.join('\n'))+'">'+esc(x.mounts.join(' · '))+'</div><div class="rm-bar"><i class="'+(lv==='ok'?'':'rm-'+lv)+'" style="width:'+Math.min(100,x.pct)+'%"></i></div>'
      +'<div class="ft"><span><b>'+bytes(x.used)+'</b> used</span><span><b>'+bytes(x.free)+'</b> free</span><span>'+bytes(x.size)+' total</span>'+(x.read!=null?'<span>↓ '+rate(x.read)+' · ↑ '+rate(x.write)+'</span>':'')+'</div></div></div>';}).join('')
    :'<div class="rm-empty">No disks found</div>')+'</div>';
  const used=m.used,cache=Math.min(m.cache,m.available),free=Math.max(0,m.total-used-cache);
  h+='<div style="display:grid;gap:14px;align-content:start"><div class="rm-card"><h4>'+I.mem+'Memory breakdown</h4><div class="rm-membar"><i style="width:'+(used/m.total*100)+'%;background:'+vio+'"></i><i style="width:'+(cache/m.total*100)+'%;background:color-mix(in srgb,'+vio+' 40%,transparent)"></i></div>'
    +'<div class="rm-legend"><span><i style="background:'+vio+'"></i>In use <b>'+bytes(used)+'</b></span><span><i style="background:color-mix(in srgb,'+vio+' 40%,transparent)"></i>Cache <b>'+bytes(cache)+'</b></span><span><i style="background:color-mix(in srgb,var(--rm-t) 12%,transparent)"></i>Free <b>'+bytes(free)+'</b></span></div>'
    +'<div class="rm-legend" style="margin-top:6px;font-size:11.5px">Cache is memory the computer borrows to speed up files and gives back when programs need it.</div></div>'
    +'<div class="rm-card"><h4>'+I.cpu+'Cores<span class="r">'+esc(d.host.cpuModel)+'</span></h4><div class="rm-cores">'+c.cores.map((v,i)=>{const lv=level(v);return '<div class="rm-core" title="Core '+(i+1)+': '+v+'%"><div class="t"><i class="'+(lv==='ok'?'':'rm-'+lv)+'" style="height:'+Math.max(2,v)+'%"></i></div><b>'+v+'%</b></div>';}).join('')+'</div></div>';
  const top=(d.procs.list||[]).slice().sort((x,y)=>y.cpu-x.cpu||y.mem-x.mem).slice(0,6);
  h+='<div class="rm-card rm-top5"><h4>'+I.cpu+'Busiest processes<span class="r"><button class="rm-link" type="button" data-tab="procs">All '+d.procs.count+' '+I.chev+'</button></span></h4><div style="margin-top:8px">'
    +top.map(p=>'<div class="row"><div class="n">'+esc(p.name)+(p.pid===d.host.mediarrPid?'<span class="rm-badge" style="margin-left:6px">MEDIARR</span>':'')+'<small>'+p.pid+'</small></div><div class="v"><b>'+pct(p.cpu)+'</b></div><div class="v">'+bytes(p.mem)+'</div></div>').join('')+'</div></div>';
  h+='</div></div>';
  return h;
}
const STATE={R:'Running',S:'Sleeping',D:'Waiting on disk',Z:'Zombie',T:'Stopped',t:'Stopped',I:'Idle',X:'Dead',W:'Paging',P:'Parked'};
function procsView(d){
  const P=d.procs,host=d.host;
  if((P.list||[]).length<P.count&&!M.err)return '<div class="rm-tools"><span class="rm-count" style="margin-left:0">Reading '+P.count.toLocaleString()+' processes…</span></div><div class="rm-skel" style="height:420px"></div>';
  let list=(P.list||[]).filter(p=>M.kernel||!p.kernel);
  const q=M.q.trim().toLowerCase();
  if(q)list=list.filter(p=>(p.name+' '+p.cmd+' '+p.user+' '+p.pid).toLowerCase().includes(q));
  const k=M.sort.k,dir=M.sort.asc?1:-1;
  list.sort((a,b)=>{const x=a[k],y=b[k];const r=typeof x==='string'?x.localeCompare(y):(x-y);return (r||(b.cpu-a.cpu)||(b.mem-a.mem))*dir;});
  const hidden=(P.list||[]).filter(p=>p.kernel).length;
  let h='';
  if(P.scope==='container')h+='<div class="rm-note">'+I.info+'<div>You’re seeing the processes inside MEDIARR’s container. CPU, memory and disks above are for the whole computer'+(d.containers&&d.containers.available?', and the <b>Docker</b> tab shows every container':'')+'. To list every process on the computer, add <code>pid: host</code> to MEDIARR in your Docker Compose file.</div></div>';
  if(host.platform==='win32')h+='<div class="rm-note">'+I.info+'<div>Windows doesn’t give MEDIARR the CPU use of each process, so only memory is shown.</div></div>';
  h+='<div class="rm-tools"><label class="rm-search">'+I.search+'<input type="search" data-q placeholder="Find a process, user or PID" value="'+esc(M.q)+'" aria-label="Find a process"></label>'
    +(hidden?'<label class="rm-check"><input type="checkbox" data-kernel'+(M.kernel?' checked':'')+'>Show '+hidden+' kernel tasks</label>':'')
    +(PHONE?'<select class="rm-sortsel" data-sortsel aria-label="Sort by">'+[['cpu','CPU'],['mem','Memory'],['name','Name'],['pid','PID'],['up','Running time']].map(o=>'<option value="'+o[0]+'"'+(k===o[0]?' selected':'')+'>Sort: '+o[1]+'</option>').join('')+'</select>':'')
    +'<span class="rm-count"><b>'+list.length.toLocaleString()+'</b> of '+P.count.toLocaleString()+' processes'+(P.threads?' · '+P.threads.toLocaleString()+' threads':'')+'</span></div>';
  if(!list.length)return h+'<div class="rm-empty"><b>No matching processes</b>Try another word.</div>';
  const det=p=>'<div class="rm-det"><div class="rm-cmd">'+esc(p.cmd||('['+p.name+']'))+'</div><span>PID<b>'+p.pid+'</b></span><span>Parent PID<b>'+p.ppid+'</b></span><span>State<b>'+esc(STATE[p.state]||p.state)+'</b></span>'+(p.threads?'<span>Threads<b>'+p.threads+'</b></span>':'')+'<span>Memory<b>'+bytes(p.mem)+' ('+pct(p.memPct)+')</b></span>'+(p.up?'<span>Running for<b>'+dur(p.up)+'</b></span>':'')+(p.user?'<span>User<b>'+esc(p.user)+'</b></span>':'')+'</div>';
  const tag=p=>p.pid===host.mediarrPid?'<span class="rm-badge">MEDIARR</span>':/^ffmpeg$|^ffprobe$/.test(p.name)?'<span class="rm-badge blue">'+(p.name==='ffmpeg'?'Transcoding':'Reading media')+'</span>':p.kernel?'<span class="rm-badge gray">kernel</span>':p.state==='Z'?'<span class="rm-badge gray">zombie</span>':'';
  const bar=(v,max)=>{const p=Math.min(100,v/max*100),lv=level(p);return '<span class="rm-mini"><i class="'+(lv==='ok'?'':'rm-'+lv)+'" style="width:'+Math.max(p>0?3:0,p)+'%"></i></span>';};
  const shown=list.slice(0,M.all?list.length:400);
  if(PHONE){
    h+='<div class="rm-plist">'+shown.map(p=>'<div class="rm-prow" data-pid="'+p.pid+'"><div class="n"><b>'+esc(p.name)+'</b>'+tag(p)+'</div><div class="s">'+esc((p.user?p.user+' · ':'')+'PID '+p.pid+(p.up?' · '+dur(p.up):''))+'</div><div class="v"><b>'+pct(p.cpu)+'</b><span>'+bytes(p.mem)+'</span></div>'+(M.open.has(p.pid)?det(p):'')+'</div>').join('')+'</div>';
  }else{
    const th=(key,label,num)=>'<th class="'+(num?'num ':'')+(k===key?'on'+(M.sort.asc?' asc':''):'')+'" data-sort="'+key+'" aria-sort="'+(k===key?(M.sort.asc?'ascending':'descending'):'none')+'">'+label+'</th>';
    h+='<div class="rm-tablew"><table class="rm-table"><thead><tr>'+th('name','Process')+th('pid','PID',1)+th('user','User')+th('cpu','CPU',1)+th('mem','Memory',1)+th('threads','Threads',1)+th('up','Running for',1)+th('state','State')+'</tr></thead><tbody>'
      +shown.map(p=>{const o=M.open.has(p.pid);return '<tr data-pid="'+p.pid+'" class="'+(o?'open':'')+'"><td><div class="rm-pn"><b>'+esc(p.name)+'</b>'+tag(p)+(p.cmd&&p.cmd!==p.name?'<small>'+esc(p.cmd)+'</small>':'')+'</div></td><td class="num rm-dim">'+p.pid+'</td><td class="rm-dim">'+esc(p.user)+'</td>'
        +'<td class="num"><span class="rm-cell">'+bar(p.cpu,100)+'<b>'+pct(p.cpu)+'</b></span></td><td class="num"><span class="rm-cell">'+bar(p.memPct,100)+'<b>'+bytes(p.mem)+'</b></span></td><td class="num rm-dim">'+(p.threads||'–')+'</td><td class="num rm-dim">'+(p.up?dur(p.up):'–')+'</td><td class="rm-dim">'+esc(STATE[p.state]||p.state)+'</td></tr>'
        +(o?'<tr class="det"><td colspan="8">'+det(p)+'</td></tr>':'');}).join('')+'</tbody></table></div>';
  }
  if(list.length>shown.length)h+='<div style="text-align:center;margin-top:12px"><button class="rm-btn" type="button" data-all>Show all '+list.length.toLocaleString()+'</button></div>';
  return h;
}
function dockerView(d){
  const C=d.containers||{};
  if(C.error)return '<div class="rm-empty"><b>Docker isn’t available</b>'+esc(C.error)+'</div>';
  const list=C.list||[];
  if(!list.length)return '<div class="rm-empty"><b>'+(C.at?'No containers':'Reading containers…')+'</b>'+(C.at?'Docker has no containers on this computer.':'')+'</div>';
  const run=list.filter(c=>c.state==='running');
  const cpuSum=run.reduce((s,c)=>s+c.cpu,0),memSum=run.reduce((s,c)=>s+c.mem,0);
  let h='<div class="rm-tools"><span class="rm-count" style="margin-left:0"><b>'+run.length+'</b> running of '+list.length+' containers · together <b>'+pct(cpuSum)+'</b> CPU and <b>'+bytes(memSum)+'</b> memory</span></div><div class="rm-ctrs">';
  const total=d.mem.total||1;
  h+=list.map(c=>{const on=c.state==='running',memMax=c.memLimit&&c.memLimit<total*0.98?c.memLimit:total,mp=c.mem/memMax*100,cl=level(c.cpu),ml=level(mp);
    return '<div class="rm-ctr'+(c.self?' self':'')+(on?'':' stopped')+'"><div class="hd"><b>'+esc(c.name)+'</b>'+(c.self?'<span class="rm-badge">MEDIARR</span>':'')+'<span class="st '+(on?'running':'other')+'">'+esc(c.state)+'</span></div><div class="im" title="'+esc(c.status)+'">'+esc(c.image)+'</div>'
      +(on?'<div class="ln"><span>CPU</span><div class="rm-bar"><i class="'+(cl==='ok'?'':'rm-'+cl)+'" style="width:'+Math.min(100,c.cpu)+'%"></i></div><b>'+pct(c.cpu)+'</b></div>'
      +'<div class="ln"><span>Memory</span><div class="rm-bar"><i class="'+(ml==='ok'?'':'rm-'+ml)+'" style="width:'+Math.min(100,mp)+'%"></i></div><b>'+bytes(c.mem)+(memMax!==total?' / '+bytes(memMax):'')+'</b></div>'
      +'<div class="ln"><span>Network</span><span>↓ '+bytes(c.rx)+' · ↑ '+bytes(c.tx)+'</span><b>'+(c.pids?c.pids+' proc':'')+'</b></div>':'<div class="ln"><span style="grid-column:1/-1">'+esc(c.status)+'</span></div>')+'</div>';}).join('');
  return h+'</div>';
}

/* ---------- render ---------- */
function render(){
  const b=M.body;if(!b)return;
  const d=M.data;
  if(!d){b.innerHTML='<div class="rm">'+(M.err?'<div class="rm-empty"><b>Couldn’t load the monitor</b>'+esc(M.err)+'</div>':'<div class="rm-grid">'+'<div class="rm-skel"></div>'.repeat(4)+'</div>')+'</div>';return;}
  if(M.tab==='docker'&&!(d.containers&&d.containers.available))M.tab='overview';
  // keep the search box and scroll position while the numbers refresh
  const active=document.activeElement,typing=active&&active.matches&&active.matches('.rm [data-q]'),caret=typing?active.selectionStart:0;
  const tw=b.querySelector('.rm-tablew'),st=tw?tw.scrollTop:0;
  let body=M.tab==='procs'?procsView(d):M.tab==='docker'?dockerView(d):overview(d);
  b.innerHTML='<div class="rm">'+header(d)+(M.err?'<div class="rm-note">'+I.info+'<div>'+esc(M.err)+' Showing the last reading.</div></div>':'')+body+'</div>';
  const nt=b.querySelector('.rm-tablew');if(nt)nt.scrollTop=st;
  if(typing){const i=b.querySelector('[data-q]');if(i){i.focus();try{i.setSelectionRange(caret,caret);}catch(_){}}}
}
function wire(){
  const b=M.body;
  b.addEventListener('click',e=>{
    const t=e.target.closest('[data-tab]');if(t){M.tab=t.dataset.tab;LS.set('mediarr-monitor-tab',M.tab);render();load();return;}
    if(e.target.closest('[data-pause]')){M.paused=!M.paused;render();if(!M.paused)load();return;}
    const s=e.target.closest('[data-sort]');if(s){const k=s.dataset.sort;M.sort=M.sort.k===k?{k,asc:!M.sort.asc}:{k,asc:k==='name'||k==='user'||k==='pid'};LS.set('mediarr-monitor-sort',M.sort);render();return;}
    if(e.target.closest('[data-all]')){M.all=true;render();return;}
    if(e.target.closest('.rm-cmd'))return;
    const r=e.target.closest('[data-pid]');if(r){const pid=Number(r.dataset.pid);if(M.open.has(pid))M.open.delete(pid);else M.open.add(pid);render();}
  });
  b.addEventListener('input',e=>{if(e.target.matches('[data-q]')){M.q=e.target.value;render();}});
  b.addEventListener('change',e=>{
    if(e.target.matches('[data-kernel]')){M.kernel=e.target.checked;LS.set('mediarr-monitor-kernel',M.kernel);render();}
    if(e.target.matches('[data-sortsel]')){const k=e.target.value;M.sort={k,asc:k==='name'||k==='pid'};LS.set('mediarr-monitor-sort',M.sort);render();}
  });
}
async function load(){
  if(M.busy||M.paused||!isOpen())return;
  M.busy=true;
  try{
    const r=await fetch('/api/admin/monitor?procs='+(M.tab==='procs'?'all':'8'),{cache:'no-store'});
    let j={};try{j=await r.json();}catch(_){}
    if(!r.ok)throw new Error(j.message||('HTTP '+r.status));
    M.data=j;M.err='';
  }catch(e){M.err=e.message||'Network error';}
  finally{M.busy=false;}
  if(isOpen()&&!M.paused&&!(M.tab==='procs'&&window.getSelection&&String(window.getSelection()).length))render();
}
function isOpen(){if(!M.el)return false;return PHONE?M.el.classList.contains('show'):M.el.classList.contains('show');}
function tick(){if(document.visibilityState==='visible')load();}

/* ---------- the window ---------- */
function build(){
  if(M.el)return;
  const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
  if(PHONE){
    const el=document.createElement('div');el.className='modal fade';el.id='monitorModal';el.tabIndex=-1;el.setAttribute('aria-labelledby','monitorTitle');
    el.innerHTML='<div class="modal-dialog modal-fullscreen"><div class="modal-content"><div class="modal-header"><h6 class="modal-title" id="monitorTitle">Resource Monitor</h6><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body" id="monitorBody" style="padding:14px"></div></div></div>';
    document.body.appendChild(el);M.el=el;
    el.addEventListener('shown.bs.modal',()=>{start();});el.addEventListener('hidden.bs.modal',stop);
  }else{
    const el=document.createElement('div');el.className='overlay';el.id='monitorOverlay';
    el.innerHTML='<div class="modal rm-modal" role="dialog" aria-modal="true" aria-labelledby="monitorTitle"><div class="modal-head"><h2 id="monitorTitle">Resource Monitor</h2><button class="x" id="closeMonitor" aria-label="Close">&times;</button></div><div class="modal-body" id="monitorBody"></div></div>';
    document.body.appendChild(el);M.el=el;
    el.querySelector('#closeMonitor').onclick=close;
    el.addEventListener('click',e=>{if(e.target===el)close();});
    new MutationObserver(()=>{if(!el.classList.contains('show'))stop();}).observe(el,{attributes:true,attributeFilter:['class']});
  }
  M.body=M.el.querySelector('#monitorBody');wire();
}
function start(){render();load();clearInterval(M.timer);M.timer=setInterval(tick,2000);}
function stop(){clearInterval(M.timer);M.timer=0;M.open.clear();M.all=false;}
function open(){
  build();M.err='';
  if(PHONE){try{const menu=document.getElementById('menu');const oc=menu&&window.bootstrap&&bootstrap.Offcanvas.getInstance(menu);if(oc)oc.hide();}catch(_){}bootstrap.Modal.getOrCreateInstance(M.el).show();}
  else{M.el.classList.add('show');start();}
}
function close(){if(!M.el)return;if(PHONE){try{bootstrap.Modal.getOrCreateInstance(M.el).hide();}catch(_){}}else M.el.classList.remove('show');stop();}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&isOpen())load();});

function install(){
  const btn=document.getElementById('openMonitor')||document.getElementById('mMonitor');
  if(btn)btn.addEventListener('click',open);
  if(/[?&]monitor=1\b/.test(location.search)){let n=0;const t=setInterval(()=>{let ready=false;try{ready=(typeof currentUser!=='undefined'&&currentUser&&currentUser.role==='admin')||(typeof me!=='undefined'&&me&&me.role==='admin');}catch(_){}if(ready||++n>60){clearInterval(t);if(ready)open();}},500);}
}
window.MediarrMonitor={open,close,state:M};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
