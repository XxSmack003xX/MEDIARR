(function(){
'use strict';

var cache={at:0,data:null,loading:null};
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function ago(ts){if(!ts)return '';var n=Date.now()-Number(ts),m=Math.floor(n/60000);if(m<1)return 'now';if(m<60)return m+'m ago';var h=Math.floor(m/60);if(h<24)return h+'h ago';var d=Math.floor(h/24);return d+'d ago';}
function dateText(v){if(!v)return '';try{var d=new Date(v);return d.toLocaleDateString([], {month:'short',day:'numeric'})+' · '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}catch(_){return String(v);}}
function poster(v,title){return v?'<img class="uh-poster" src="'+esc(v)+'" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="uh-ph">'+esc((title||'?').slice(0,1))+'</div>':'<div class="uh-ph" style="display:flex">'+esc((title||'?').slice(0,1))+'</div>';}
function kindOf(x){
  x=x||{};
  var svc=String(x.service||'').toLowerCase(),t=String(x.type||'').toLowerCase();
  if(svc==='sonarr')return 'series';
  if(svc==='radarr')return 'movie';
  if(t==='series'||t==='show'||t==='tv'||t==='episode'||t==='season')return 'series';
  if(t==='movie'||t==='film')return 'movie';
  if(x.tvdbId||(x.ids&&x.ids.tvdbId)||x.next||x.inSonarr!==undefined)return 'series';
  return 'movie';
}
function titleOf(x){return x.show||x.title||'Untitled';}
function mediaShape(x){
  return {
    kind:kindOf(x), title:titleOf(x), year:x.year||'',
    imdb:x.imdbId||(x.ids&&x.ids.imdbId)||'', tmdb:x.tmdbId||(x.ids&&x.ids.tmdbId)||null,
    tvdb:x.tvdbId||(x.ids&&x.ids.tvdbId)||null, poster:x.poster||x.art||''
  };
}
function openMedia(x){
  if(x&&x.source==='mediarr'&&x.path){
    var name=x.type==='episode'?[x.show,('S'+String(x.season||0).padStart(2,'0')+'E'+String(x.episode||0).padStart(2,'0')),x.title].filter(Boolean).join(' · '):(x.title||x.path.split('/').pop());
    var meta={type:x.type||'movie',title:x.title||'',show:x.show||'',season:x.season,episode:x.episode,year:x.year||'',poster:x.poster||'',imdbId:x.imdbId||'',tmdbId:x.tmdbId||null,tvdbId:x.tvdbId||null};
    if(typeof window.playVideoD==='function'){window.playVideoD(x.path,name,meta);return;}
    if(typeof window.playVideoMobile==='function'){window.playVideoMobile(x.path,name,meta);return;}
  }
  if(x.webUrl && (x.source==='plex'||x.localRatingKey||x.ratingKey)){window.open(x.webUrl,'_blank','noopener');return;}
  var it=mediaShape(x), type=it.kind==='series'?'series':'movie';
  try{
    if(document.getElementById('detailOverlay')){
      if(it.tmdb && typeof window.openDetailFromTmdb==='function'){
        window.openDetailFromTmdb(type==='series'?'tv':'movie',it.tmdb,{
          title:it.title,name:it.title,poster:it.poster,release_date:type==='movie'?(it.year?it.year+'-01-01':''):'',
          first_air_date:type==='series'?(it.year?it.year+'-01-01':''):''
        });return;
      }
      var id=it.imdb || (it.tmdb?('tmdb:'+it.tmdb):'');
      if(id && typeof window.openDetail==='function'){window.openDetail(type,id,{name:it.title,title:it.title,poster:it.poster,year:it.year,releaseInfo:it.year},it.tmdb||'');return;}
    }
    if(typeof window.openDetail==='function'){
      window.openDetail({kind:type==='series'?'series':'movie',id:it.imdb||it.tmdb,imdb:it.imdb||null,tmdb:it.tmdb||null,title:it.title,year:it.year,poster:it.poster});
    }
  }catch(_){}
}
function addStyles(){
  if(document.getElementById('userHome160Style'))return;
  var s=document.createElement('style');s.id='userHome160Style';
  s.textContent=[
    '.uh{width:100%;min-width:0}.uh-hero{display:flex;justify-content:space-between;align-items:end;gap:16px;padding:4px 0 18px}.uh-hero h2{font-size:30px;margin:0;font-weight:900;letter-spacing:.2px}.uh-hero p{margin:5px 0 0;color:var(--muted,var(--bs-secondary-color,#8f9bb3));font-size:12px}.uh-refresh{border:1px solid var(--line,var(--bs-border-color,#2a3447));background:var(--panel2,var(--bg2,#171e2a));color:var(--txt,var(--bs-body-color,#eef3ff));border-radius:9px;padding:8px 11px;font-size:11px;font-weight:800;cursor:pointer}',
    '.uh-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:20px}.uh-stat{border:1px solid var(--line,var(--bs-border-color,#2a3447));background:var(--panel2,var(--bg2,#171e2a));border-radius:12px;padding:11px}.uh-stat-k{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));font-weight:900}.uh-stat-v{font-size:16px;font-weight:900;margin-top:3px}.uh-stat-s{font-size:9px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));margin-top:3px}',
    '.uh-section{margin:0 0 23px}.uh-sec-head{display:flex;justify-content:space-between;align-items:end;gap:10px;margin-bottom:9px}.uh-sec-head h3{margin:0;font-size:17px;font-weight:900}.uh-sec-head span{font-size:10px;color:var(--muted,var(--bs-secondary-color,#8f9bb3))}',
    '.uh-rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(145px,175px);gap:10px;overflow-x:auto;padding:2px 2px 9px;scroll-snap-type:x proximity}.uh-card{scroll-snap-align:start;position:relative;overflow:hidden;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:12px;background:var(--panel2,var(--bg2,#171e2a));cursor:pointer;min-width:0}.uh-card:hover{transform:translateY(-1px);filter:brightness(1.04)}.uh-img{position:relative;aspect-ratio:2/3;background:var(--bg,#0c111b);overflow:hidden}.uh-poster{width:100%;height:100%;object-fit:cover;display:block}.uh-ph{width:100%;height:100%;display:none;align-items:center;justify-content:center;font-size:35px;font-weight:900;color:var(--muted,var(--bs-secondary-color,#8f9bb3));background:linear-gradient(145deg,var(--panel2,var(--bg2,#171e2a)),var(--bg,#0c111b))}.uh-meta{padding:8px 9px 9px}.uh-title{font-size:11px;font-weight:900;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.uh-sub{font-size:9px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));margin-top:3px;line-height:1.35;min-height:12px}.uh-badge{position:absolute;top:7px;left:7px;background:rgba(5,8,14,.82);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:3px 6px;font-size:8px;font-weight:900;color:#fff}.uh-progress{height:4px;background:rgba(255,255,255,.16);position:absolute;left:0;right:0;bottom:0}.uh-progress span{display:block;height:100%;background:var(--gold,#d9a441)}',
    '.uh-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.uh-row{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:9px;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:11px;background:var(--panel2,var(--bg2,#171e2a));padding:7px;cursor:pointer;min-width:0}.uh-row-img{width:42px;height:58px;border-radius:6px;object-fit:cover;background:var(--bg,#0c111b)}.uh-row-main{min-width:0}.uh-row-title{font-size:11px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.uh-row-sub{font-size:9px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));margin-top:3px}.uh-status{font-size:9px;font-weight:900;border-radius:999px;padding:4px 7px;background:rgba(127,138,158,.14);white-space:nowrap}.uh-status.good{color:#35d07f;background:rgba(53,208,127,.12)}.uh-status.warn{color:#e8b04b;background:rgba(232,176,75,.12)}',
    '.uh-empty{border:1px dashed var(--line,var(--bs-border-color,#2a3447));border-radius:12px;padding:14px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));font-size:11px}.uh-empty b{color:var(--txt,var(--bs-body-color,#eef3ff))}.uh-plex-note{font-size:10px;color:var(--muted,var(--bs-secondary-color,#8f9bb3));margin:-8px 0 18px}',
    '@media(max-width:760px){.uh-hero{padding-top:2px}.uh-hero h2{font-size:23px}.uh-stats{grid-template-columns:1fr 1fr}.uh-stat{padding:9px}.uh-list{grid-template-columns:1fr}.uh-rail{grid-auto-columns:minmax(125px,42vw);gap:8px}.uh-section{margin-bottom:18px}.uh-sec-head h3{font-size:15px}}'
  ].join('');
  document.head.appendChild(s);
}
function card(x,opt){
  opt=opt||{};var title=titleOf(x),sub=opt.sub||x.year||'',badge=opt.badge||'',progress=opt.progress;
  return '<div class="uh-card" data-uh-idx="'+opt.idx+'"><div class="uh-img">'+poster(x.poster||x.art,title)+(badge?'<span class="uh-badge">'+esc(badge)+'</span>':'')+(progress!=null?'<div class="uh-progress"><span style="width:'+Math.max(0,Math.min(100,Number(progress)||0))+'%"></span></div>':'')+'</div><div class="uh-meta"><div class="uh-title">'+esc(title)+'</div><div class="uh-sub">'+esc(sub)+'</div></div></div>';
}
function railSection(title,sub,items,cardFn,ctx){
  if(!items||!items.length)return '';
  var html='<section class="uh-section"><div class="uh-sec-head"><h3>'+esc(title)+'</h3><span>'+esc(sub||'')+'</span></div><div class="uh-rail">';
  items.forEach(function(x,i){ctx.push(x);html+=cardFn(x,{idx:ctx.length-1});});return html+'</div></section>';
}
function requestSection(items,ctx){
  if(!items||!items.length)return '';
  var h='<section class="uh-section"><div class="uh-sec-head"><h3>My Requests</h3><span>Your recent MEDIARR adds</span></div><div class="uh-list">';
  items.slice(0,8).forEach(function(x){ctx.push(x);var idx=ctx.length-1,cl=x.ready?'good':x.inLibrary?'warn':'',sub=[x.service==='sonarr'?'Sonarr':'Radarr',x.year,ago(x.ts)].filter(Boolean).join(' · ');
    h+='<div class="uh-row" data-uh-idx="'+idx+'">'+(x.poster?'<img class="uh-row-img" src="'+esc(x.poster)+'" loading="lazy">':'<div class="uh-row-img uh-ph" style="display:flex">'+esc((x.title||'?')[0])+'</div>')+'<div class="uh-row-main"><div class="uh-row-title">'+esc(x.title)+'</div><div class="uh-row-sub">'+esc(sub)+'</div></div><span class="uh-status '+cl+'">'+esc(x.status)+'</span></div>';});
  return h+'</div></section>';
}
function upcomingSection(items,ctx){
  if(!items||!items.length)return '';
  var h='<section class="uh-section"><div class="uh-sec-head"><h3>Up Next</h3><span>Upcoming episodes from your favorites</span></div><div class="uh-list">';
  items.slice(0,8).forEach(function(x){ctx.push(x);var idx=ctx.length-1,n=x.next||{},sub='S'+String(n.season||0).padStart(2,'0')+'E'+String(n.episode||0).padStart(2,'0')+(n.name?' · '+n.name:'');
    h+='<div class="uh-row" data-uh-idx="'+idx+'">'+(x.poster?'<img class="uh-row-img" src="'+esc(x.poster)+'" loading="lazy">':'<div class="uh-row-img uh-ph" style="display:flex">'+esc((x.title||'?')[0])+'</div>')+'<div class="uh-row-main"><div class="uh-row-title">'+esc(x.title)+'</div><div class="uh-row-sub">'+esc(sub)+'</div></div><span class="uh-status warn">'+esc(dateText(n.airDate))+'</span></div>';});
  return h+'</div></section>';
}
function render(mount,d,user){
  addStyles();var ctx=[],p=d.plex||{},limit=user&&Number(user.dailyLimit)||0,used=user&&Number(user.addedToday)||0;
  var countReq=(d.requests||[]).length, fav=(d.favorites||[]).length;
  var html='<div class="uh"><div class="uh-hero"><div><h2>'+esc((user&&user.username?user.username+"'s ":"")+'Home')+'</h2><p>Your Plex activity, requests, favorites and discovery in one place.</p></div><button class="uh-refresh" data-uh-refresh>↻ Refresh</button></div>';
  html+='<div class="uh-stats">'+
    '<div class="uh-stat"><div class="uh-stat-k">Plex profile</div><div class="uh-stat-v">'+esc(p.linked?(p.account||'Linked'):'Not linked')+'</div><div class="uh-stat-s">'+(p.linked?'Personal Plex sections enabled':'Link Plex in Profile to personalize watching')+'</div></div>'+
    '<div class="uh-stat"><div class="uh-stat-k">Requests today</div><div class="uh-stat-v">'+used+(limit?' / '+limit:'')+'</div><div class="uh-stat-s">'+(limit?'Daily request limit':'No daily limit')+'</div></div>'+
    '<div class="uh-stat"><div class="uh-stat-k">Favorites</div><div class="uh-stat-v">'+fav+'</div><div class="uh-stat-s">'+(d.upcoming||[]).length+' upcoming favorite'+((d.upcoming||[]).length===1?'':'s')+'</div></div>'+
    '<div class="uh-stat"><div class="uh-stat-k">My recent requests</div><div class="uh-stat-v">'+countReq+'</div><div class="uh-stat-s">'+(d.requests||[]).filter(function(x){return x.ready;}).length+' available now</div></div></div>';

  var localContinue=d.continueWatching||[], plexContinue=p.continueWatching||[], combinedContinue=localContinue.concat(plexContinue).slice(0,24);
  html+=railSection('Continue Watching',localContinue.length&&plexContinue.length?'MEDIARR + Plex':localContinue.length?'Local / WebDAV playback':'Your Plex profile',combinedContinue,function(x,o){
    o.badge=x.source==='mediarr'?'MEDIARR':(kindOf(x)==='series'?'TV':'Movie');
    o.sub=x.type==='episode'?[x.show,'S'+String(x.season||0).padStart(2,'0')+'E'+String(x.episode||0).padStart(2,'0')].filter(Boolean).join(' · '):(x.year||'');
    o.progress=x.progressPct;return card(x,o);
  },ctx);
  if(!p.linked){
    html+='<div class="uh-plex-note">'+(localContinue.length?'Local/WebDAV progress is being tracked. ':'')+'Link your Plex account/profile from MEDIARR Profile to merge Plex Continue Watching, watch history and your Plex Watchlist here.</div>';
  }

  html+=requestSection(d.requests||[],ctx);
  html+=upcomingSection(d.upcoming||[],ctx);

  html+=railSection('Plex Watchlist','Saved in your Plex account',p.watchlist||[],function(x,o){o.badge=kindOf(x)==='series'?'TV':'Movie';o.sub=x.year||'';return card(x,o);},ctx);
  html+=railSection('Favorites','Your MEDIARR favorite shows',d.favorites||[],function(x,o){o.badge='Favorite';o.sub=x.ts?('Saved '+ago(x.ts)):'';return card(x,o);},ctx);
  html+=railSection('Recently Available','Downloaded in your library',d.recentlyAvailable||[],function(x,o){o.badge=kindOf(x)==='series'?'TV':'Movie';if(x.progress&&x.progress.total)o.sub=x.progress.downloaded+'/'+x.progress.total+' episodes';else o.sub=x.year||'';return card(x,o);},ctx);
  html+=railSection('Recommended for You','Based on recent watching and favorites',d.recommendations||[],function(x,o){o.badge=kindOf(x)==='series'?'TV':'Movie';o.sub=x.year||'';return card(x,o);},ctx);
  html+=railSection('Recently Watched','Your Plex history',p.recentlyWatched||[],function(x,o){o.badge=kindOf(x)==='series'?'TV':'Movie';o.sub=[x.type==='episode'?x.show:'',x.viewedAt?ago(x.viewedAt):''].filter(Boolean).join(' · ');return card(x,o);},ctx);
  html+=railSection('Discover Now','Recently released and airing',d.discover||[],function(x,o){o.badge=kindOf(x)==='series'?'TV':'Movie';o.sub=x.year||'';return card(x,o);},ctx);

  if(!(d.continueWatching||[]).length && !(p.continueWatching||[]).length && !(d.requests||[]).length && !(d.upcoming||[]).length && !(d.recommendations||[]).length && !(d.discover||[]).length){
    html+='<div class="uh-empty"><b>Your home is ready.</b><br>Link Plex, favorite a TV show, or add a TMDB key to start filling it with personalized content.</div>';
  }
  html+='</div>';
  mount.innerHTML=html;
  mount.querySelectorAll('[data-uh-idx]').forEach(function(el){el.onclick=function(){var x=ctx[Number(el.getAttribute('data-uh-idx'))];if(x)openMedia(x);};});
  var r=mount.querySelector('[data-uh-refresh]');if(r)r.onclick=function(){cache.at=0;show({mount:mount.id,user:user,surface:document.getElementById('detailOverlay')?'desktop':'mobile',force:true});};
}
async function fetchHome(force){
  if(!force&&cache.data&&Date.now()-cache.at<15000)return cache.data;
  if(cache.loading)return cache.loading;
  cache.loading=fetch('/api/home',{cache:'no-store'}).then(async function(r){var d={};try{d=await r.json();}catch(_){}if(!r.ok)throw new Error(d.message||('HTTP '+r.status));cache.data=d;cache.at=Date.now();return d;}).finally(function(){cache.loading=null;});
  return cache.loading;
}
async function show(opt){
  opt=opt||{};var mount=typeof opt.mount==='string'?document.getElementById(opt.mount):opt.mount;if(!mount)return false;
  addStyles();mount.innerHTML='<div class="uh"><div class="uh-empty">Loading your home…</div></div>';
  try{var d=await fetchHome(!!opt.force);render(mount,d,opt.user||d.user||{});return true;}
  catch(e){mount.innerHTML='<div class="uh"><div class="uh-empty"><b>Personal home unavailable.</b><br>'+esc(e.message)+'</div></div>';return false;}
}
window.MEDIARRUserHome={show:show,refresh:function(){cache.at=0;cache.data=null;}};
})();