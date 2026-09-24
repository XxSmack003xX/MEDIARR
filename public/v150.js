(function(){
'use strict';

function esc(v){ return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function fmtBytes(n){ n=Number(n)||0; if(!n)return '—'; var u=['B','KB','MB','GB','TB'];var i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return n.toFixed(i>1&&n<100?1:0)+' '+u[i]; }
function fmtPct(a,b){ a=Number(a)||0;b=Number(b)||0;return b?Math.round(a/b*100):0; }
function qs(o){ var p=new URLSearchParams();Object.keys(o||{}).forEach(function(k){var v=o[k];if(v!==null&&v!==undefined&&v!=='')p.set(k,v);});return p.toString(); }
async function get(url){ var r=await fetch(url,{cache:'no-store'}),t='';try{t=await r.text();}catch(_){}var d={};try{d=t?JSON.parse(t):{};}catch(_){}if(!r.ok)throw new Error(d.message||('HTTP '+r.status));return d; }

function style(){
  if(document.getElementById('umd150Style'))return;
  var s=document.createElement('style');s.id='umd150Style';
  s.textContent=[
    '.umd{margin:14px 0 18px}.umd-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.umd-title{font-weight:900;font-size:14px;letter-spacing:.3px}.umd-time{font-size:10px;color:var(--muted,#8f9bb3)}',
    '.umd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.umd-card{background:var(--panel2,var(--bg2,#171e2a));border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:12px;padding:12px;min-width:0}.umd-k{font-size:9px;text-transform:uppercase;letter-spacing:1.1px;color:var(--muted,#8f9bb3);font-weight:900}.umd-v{font-size:15px;font-weight:900;margin-top:4px;word-break:break-word}.umd-sub{font-size:10px;color:var(--muted,#8f9bb3);margin-top:4px;line-height:1.35}',
    '.umd-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#7f8a9e;margin-right:6px}.umd-dot.good{background:#35d07f}.umd-dot.warn{background:#f0b84b}.umd-dot.bad{background:#ff626c}',
    '.umd-progress{height:5px;background:rgba(127,138,158,.22);border-radius:99px;overflow:hidden;margin-top:8px}.umd-progress span{display:block;height:100%;background:var(--gold,#d9a441)}',
    '.umd-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.umd-chip{font-size:10px;font-weight:800;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:999px;padding:4px 7px;background:var(--bg,#0c111b)}',
    '.umd-tech{margin-top:9px;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:12px;overflow:hidden}.umd-tech-head{padding:9px 11px;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:900;color:var(--muted,#8f9bb3);background:var(--panel2,var(--bg2,#171e2a))}.umd-tech-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0}.umd-tech-cell{padding:9px 11px;border-top:1px solid var(--line,var(--bs-border-color,#2a3447));border-right:1px solid var(--line,var(--bs-border-color,#2a3447));min-width:0}.umd-tech-cell:nth-child(4n){border-right:0}.umd-tech-cell b{display:block;font-size:11px;overflow:hidden;text-overflow:ellipsis}.umd-tech-cell span{display:block;font-size:9px;color:var(--muted,#8f9bb3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px}',
    '.umd-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.umd-btn{border:1px solid var(--line,var(--bs-border-color,#2a3447));background:var(--panel2,var(--bg2,#171e2a));color:var(--txt,var(--bs-body-color,#eef3ff));border-radius:8px;padding:7px 10px;font-size:11px;font-weight:800;cursor:pointer;text-decoration:none}.umd-btn.primary{background:var(--gold,#d9a441);border-color:var(--gold,#d9a441);color:#17120a}.umd-btn.good{border-color:#35d07f;color:#35d07f}.umd-btn.play{background:#35d07f;border-color:#35d07f;color:#07140d}.umd-btn.favorite-on{border-color:#ff4d6d;color:#ff6b82;background:rgba(255,77,109,.08)}.umd-btn:disabled{opacity:.55;cursor:default}',
    '.umd-seasons{margin-top:9px;display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px}.umd-season{border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:8px;padding:7px 8px;background:var(--bg,#0c111b)}.umd-season b{font-size:10px}.umd-season div{font-size:9px;color:var(--muted,#8f9bb3);margin-top:2px}',
    '.umd-playlist{margin-top:8px;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:10px;background:var(--panel2,var(--bg2,#171e2a));overflow:hidden}.umd-play-head{padding:8px 10px;font-size:10px;color:var(--muted,#8f9bb3);font-weight:800;border-bottom:1px solid var(--line,var(--bs-border-color,#2a3447))}.umd-play-items{max-height:260px;overflow:auto}.umd-play-item{width:100%;display:flex;align-items:center;gap:9px;text-align:left;border:0;border-bottom:1px solid var(--line,var(--bs-border-color,#2a3447));background:transparent;color:inherit;padding:9px 10px;cursor:pointer}.umd-play-item:last-child{border-bottom:0}.umd-play-item:hover{background:rgba(53,208,127,.08)}.umd-play-icon{color:#35d07f;font-weight:900}.umd-play-main{min-width:0;flex:1}.umd-play-label{display:block;font-size:11px;font-weight:900}.umd-play-name{display:block;font-size:9px;color:var(--muted,#8f9bb3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.umd-loading{padding:12px;border:1px solid var(--line,var(--bs-border-color,#2a3447));border-radius:10px;color:var(--muted,#8f9bb3);font-size:11px}.umd-error{padding:10px;border:1px solid rgba(255,98,108,.4);border-radius:10px;color:#ff747d;font-size:11px}',
    '@media(max-width:760px){.umd-grid{grid-template-columns:1fr 1fr}.umd-tech-grid{grid-template-columns:1fr 1fr}.umd-tech-cell:nth-child(4n){border-right:1px solid var(--line,var(--bs-border-color,#2a3447))}.umd-tech-cell:nth-child(2n){border-right:0}}'
  ].join('');
  document.head.appendChild(s);
}

function cell(label,value){
  if(value===null||value===undefined||value==='')return '';
  return '<div class="umd-tech-cell"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';
}
function chips(items){ return (items||[]).filter(Boolean).map(function(x){return '<span class="umd-chip">'+esc(x)+'</span>';}).join(''); }
function mediaKind(d){
  d=d||{};
  var id=d.identity||{},svc=String(d.service||id.service||'').toLowerCase(),t=String(d.type||id.type||'').toLowerCase();
  if(svc==='radarr')return 'movie';
  if(svc==='sonarr')return 'series';
  if(t==='movie'||t==='film')return 'movie';
  if(t==='series'||t==='show'||t==='tv'||t==='episode'||t==='season')return 'series';
  if(d.tv&&d.tv.episodes)return 'series';
  if(d.media)return 'movie';
  return 'movie';
}
function normTitle(v){return String(v||'').toLowerCase().replace(/\(\d{4}\)/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function favoriteMatch(f,d){
  var id=d.identity||{};
  if(id.imdbId&&f.imdbId&&String(id.imdbId).toLowerCase()===String(f.imdbId).toLowerCase())return true;
  if(id.tvdbId&&f.tvdbId&&String(id.tvdbId)===String(f.tvdbId))return true;
  if(id.tmdbId&&f.tmdbId&&String(id.tmdbId)===String(f.tmdbId))return true;
  return !!(id.title&&f.title&&normTitle(id.title)===normTitle(f.title));
}
async function favoriteState(d){
  if(mediaKind(d)==='movie')return {favorited:false};
  try{
    var x=await get('/api/favorites'),list=Array.isArray(x.favorites)?x.favorites:[];
    return {favorited:list.some(function(f){return favoriteMatch(f,d);})};
  }catch(_){return {favorited:false};}
}
function favoriteItem(d,o){
  var id=d.identity||{},a=d.arr||{},p=d.plex||{};
  return {
    title:id.title||a.title||o.title||'',
    imdbId:id.imdbId||'',
    tmdbId:id.tmdbId||null,
    tvdbId:id.tvdbId||null,
    poster:o.poster||p.art||''
  };
}
function setFavoriteButton(btn,on){
  if(!btn)return;
  btn.dataset.favorited=on?'1':'0';
  btn.classList.toggle('favorite-on',on);
  btn.textContent=on?'♥ Remove from Favorites':'♡ Add to Favorites';
}
function serviceCard(d){
  var a=d.arr||{}, name=mediaKind(d)==='movie'?'Radarr':'Sonarr';
  if(!a.configured)return '<div class="umd-card"><div class="umd-k">'+name+'</div><div class="umd-v"><span class="umd-dot"></span>Not configured</div><div class="umd-sub">Configure '+name+' in Settings.</div></div>';
  if(!a.inLibrary)return '<div class="umd-card"><div class="umd-k">'+name+'</div><div class="umd-v"><span class="umd-dot warn"></span>Not in library</div><div class="umd-sub">Ready to add from the controls below.</div></div>';
  var bits=[a.monitored?'Monitored':'Unmonitored',a.status,a.minimumAvailability,a.seriesType].filter(Boolean);
  return '<div class="umd-card"><div class="umd-k">'+name+'</div><div class="umd-v"><span class="umd-dot good"></span>In library</div><div class="umd-sub">'+esc(bits.join(' · '))+'</div></div>';
}
function downloadCard(d){
  if(!d.arr||!d.arr.inLibrary)return '<div class="umd-card"><div class="umd-k">Download</div><div class="umd-v"><span class="umd-dot"></span>Not tracked</div><div class="umd-sub">Add the title to begin tracking.</div></div>';
  if(mediaKind(d)==='movie'){
    var m=d.media||{}, have=!!m.hasFile;
    return '<div class="umd-card"><div class="umd-k">Download</div><div class="umd-v"><span class="umd-dot '+(have?'good':'warn')+'"></span>'+(have?'Downloaded':'Missing')+'</div><div class="umd-sub">'+(have?esc(fmtBytes((m.file&&m.file.size)||m.sizeOnDisk)):'Radarr has no movie file yet.')+'</div></div>';
  }
  var e=d.tv&&d.tv.episodes||{},pct=fmtPct(e.downloaded,e.total);
  return '<div class="umd-card"><div class="umd-k">Episodes</div><div class="umd-v">'+(e.downloaded||0)+' / '+(e.total||0)+'</div><div class="umd-sub">'+pct+'% downloaded · '+(e.missing||0)+' missing monitored</div><div class="umd-progress"><span style="width:'+pct+'%"></span></div></div>';
}
function plexCard(d){
  var p=d.plex||{};
  if(!p.configured)return '<div class="umd-card"><div class="umd-k">Plex</div><div class="umd-v"><span class="umd-dot"></span>Not configured</div><div class="umd-sub">Server-level Plex connection is disabled.</div></div>';
  if(!p.available)return '<div class="umd-card"><div class="umd-k">Plex</div><div class="umd-v"><span class="umd-dot warn"></span>Not available</div><div class="umd-sub">Not found on the configured Plex server yet.</div></div>';
  var watched=p.viewCount>0?'Watched':p.viewOffset>0?'In progress':'Ready to watch';
  return '<div class="umd-card"><div class="umd-k">Plex</div><div class="umd-v"><span class="umd-dot good"></span>Available</div><div class="umd-sub">'+esc(watched+(p.year?' · '+p.year:''))+'</div></div>';
}
function mediaCard(d){
  var t=d.tmdb||{}, arr=d.arr||{};
  var status=t.status||arr.status||'';
  var genre=(t.genres||[]).slice(0,2).join(' · ');
  return '<div class="umd-card"><div class="umd-k">Media</div><div class="umd-v">'+esc(status||'Details')+'</div><div class="umd-sub">'+esc([genre,t.runtime?(t.runtime+' min'):'',t.voteAverage?('★ '+t.voteAverage.toFixed(1)):''].filter(Boolean).join(' · '))+'</div></div>';
}
function tech(d){
  if(mediaKind(d)==='movie'){
    var m=d.media||{},f=m.file||{},v=f.video||{},a=f.audio||{};
    if(!m.hasFile||!f)return '';
    var rows='';
    rows+=cell('Quality',f.quality);rows+=cell('Resolution',v.resolution);rows+=cell('Dynamic range',v.dynamicRange);rows+=cell('Video', [v.codec,v.bitDepth?v.bitDepth+'-bit':'',v.fps?v.fps+' fps':''].filter(Boolean).join(' · '));
    rows+=cell('Audio',[a.codec,a.channels?(a.channels+'ch'):'',a.streams>1?(a.streams+' tracks'):''].filter(Boolean).join(' · '));rows+=cell('Size',fmtBytes(f.size||m.sizeOnDisk));rows+=cell('Audio languages',(a.languages||[]).join(', '));rows+=cell('Subtitles',(f.subtitles||[]).join(', '));
    rows+=cell('Release group',f.releaseGroup);rows+=cell('Edition',f.edition);rows+=cell('Path',f.relativePath||m.path);
    return '<div class="umd-tech"><div class="umd-tech-head">Media file</div><div class="umd-tech-grid">'+rows+'</div></div>';
  }
  var tv=d.tv||{},fs=tv.files||{},ep=tv.episodes||{};
  if(!d.arr||!d.arr.inLibrary)return '';
  var rows2='';
  rows2+=cell('Episode files',fs.count||0);rows2+=cell('Total size',fmtBytes(fs.size));rows2+=cell('Quality',(fs.qualities||[]).join(', '));rows2+=cell('Video codecs',(fs.videoCodecs||[]).join(', '));
  rows2+=cell('Audio codecs',(fs.audioCodecs||[]).join(', '));rows2+=cell('Dynamic range',(fs.dynamicRanges||[]).join(', '));rows2+=cell('Languages',(fs.languages||[]).join(', '));rows2+=cell('Subtitles',(fs.subtitles||[]).join(', '));
  rows2+=cell('Monitored',ep.monitored||0);rows2+=cell('Missing',ep.missing||0);rows2+=cell('Unaired',ep.unaired||0);rows2+=cell('Folder',d.arr.path||d.arr.rootFolderPath);
  var seasons=(tv.seasons||[]).map(function(x){var pct=fmtPct(x.downloaded,x.episodes);return '<div class="umd-season"><b>Season '+x.seasonNumber+' · '+pct+'%</b><div>'+x.downloaded+'/'+x.episodes+' downloaded · '+x.missing+' missing</div><div class="umd-progress"><span style="width:'+pct+'%"></span></div></div>';}).join('');
  return '<div class="umd-tech"><div class="umd-tech-head">TV library status</div><div class="umd-tech-grid">'+rows2+'</div></div>'+(seasons?'<div class="umd-seasons">'+seasons+'</div>':'');
}
function playbackItems(d){
  var p=d&&d.playback||{},items=Array.isArray(p.items)?p.items:[];
  return p.available?items.filter(function(x){return x&&x.path;}):[];
}
function actionHtml(d,o,fav){
  var a=d.arr||{},kind=mediaKind(d),plays=playbackItems(d),src=(d.playback&&d.playback.sourceLabel)||'Local/WebDAV',h='<div class="umd-actions">';
  if(plays.length===1)h+='<button class="umd-btn play" data-umd-play="0" title="Play from '+esc(src)+'">▶ Play</button>';
  else if(plays.length>1)h+='<button class="umd-btn play" data-umd-play-toggle title="Choose an episode from '+esc(src)+'">▶ Play</button>';
  if(kind!=='movie')h+='<button class="umd-btn'+(fav&&fav.favorited?' favorite-on':'')+'" data-umd-favorite data-favorited="'+(fav&&fav.favorited?'1':'0')+'">'+(fav&&fav.favorited?'♥ Remove from Favorites':'♡ Add to Favorites')+'</button>';
  if(d.plex&&d.plex.available&&d.plex.webUrl)h+='<a class="umd-btn good" target="_blank" rel="noopener" href="'+esc(d.plex.webUrl)+'">▶ Open in Plex</a>';
  if(a.inLibrary&&o.admin){
    h+='<button class="umd-btn primary" data-umd-release>⚡ Browse releases</button>';
    h+='<button class="umd-btn" data-umd-search>🔍 Search now</button>';
  }
  h+='<button class="umd-btn" data-umd-refresh>↻ Refresh details</button></div>';
  if(plays.length>1){
    h+='<div class="umd-playlist" data-umd-playlist hidden><div class="umd-play-head">'+esc(src)+' · '+plays.length+' downloaded episode file'+(plays.length===1?'':'s')+'</div><div class="umd-play-items">';
    plays.forEach(function(x,i){h+='<button class="umd-play-item" data-umd-play="'+i+'"><span class="umd-play-icon">▶</span><span class="umd-play-main"><span class="umd-play-label">'+esc(x.label||x.name||('Episode '+(i+1)))+'</span><span class="umd-play-name">'+esc(x.name||x.path)+'</span></span></button>';});
    h+='</div></div>';
  }
  return h;
}
function wireActions(mount,d,o){
  var plays=playbackItems(d);
  function startPlay(item){
    if(!item||!item.path)return;
    var name=item.name||item.label||item.path.split('/').pop()||'Media';
    if(typeof window.playVideoD==='function'){ window.playVideoD(item.path,name); return; }
    if(typeof window.playVideoMobile==='function'){
      try{var detail=document.getElementById('detail');if(detail&&window.bootstrap)bootstrap.Modal.getInstance(detail)?.hide();}catch(_){}
      setTimeout(function(){window.playVideoMobile(item.path,name);},100);
      return;
    }
    window.open('/api/webdav/stream?path='+encodeURIComponent(item.path),'_blank','noopener');
  }
  mount.querySelectorAll('[data-umd-play]').forEach(function(btn){btn.onclick=function(){startPlay(plays[Number(btn.getAttribute('data-umd-play'))||0]);};});
  var playToggle=mount.querySelector('[data-umd-play-toggle]'),playlist=mount.querySelector('[data-umd-playlist]');
  if(playToggle&&playlist)playToggle.onclick=function(){var open=!playlist.hidden;playlist.hidden=open;playToggle.textContent=open?'▶ Play':'▲ Hide episodes';};
  var ref=mount.querySelector('[data-umd-refresh]');if(ref)ref.onclick=function(){load(o,true);};
  var fav=mount.querySelector('[data-umd-favorite]');
  if(fav)fav.onclick=async function(){
    var was=fav.dataset.favorited==='1',old=fav.textContent;
    fav.disabled=true;fav.textContent=was?'Removing…':'Adding…';
    try{
      var r=await fetch('/api/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:was?'remove':'add',item:favoriteItem(d,o)})});
      var j={};try{j=await r.json();}catch(_){}
      if(!r.ok)throw new Error(j.message||('HTTP '+r.status));
      setFavoriteButton(fav,!!j.favorited);
      if(window.MEDIARRUserHome&&typeof window.MEDIARRUserHome.refresh==='function')window.MEDIARRUserHome.refresh();
      try{window.dispatchEvent(new CustomEvent('mediarr:favorites-changed',{detail:{favorited:!!j.favorited,item:favoriteItem(d,o)}}));}catch(_){}
    }catch(e){
      fav.textContent='⚠ '+(e.message||'Favorite failed');
      setTimeout(function(){fav.textContent=old;fav.disabled=false;},2200);
      return;
    }
    fav.disabled=false;
  };
  var rel=mount.querySelector('[data-umd-release]');
  if(rel)rel.onclick=function(){
    try{
      if(mediaKind(d)==='movie'){
        if(typeof window.openReleases==='function')window.openReleases('radarr',{movieId:d.arr.id},d.arr.title||d.identity.title);
        else if(typeof window.openManualReleasesM==='function')window.openManualReleasesM('radarr',{movieId:d.arr.id},d.arr.title||d.identity.title);
      }else{
        if(typeof window.openSeriesReleasePickerM==='function')window.openSeriesReleasePickerM(d.arr.id,d.arr.title||d.identity.title);
        else {
          var ep=document.getElementById('epList')||document.querySelector('.seasons');
          if(ep&&ep.scrollIntoView)ep.scrollIntoView({behavior:'smooth',block:'start'});
        }
      }
    }catch(e){}
  };
  var sr=mount.querySelector('[data-umd-search]');
  if(sr)sr.onclick=async function(){
    sr.disabled=true;var old=sr.textContent;sr.textContent='Searching…';
    try{
      var kind=mediaKind(d);
      var cmd=kind==='movie'?{name:'MoviesSearch',movieIds:[d.arr.id]}:{name:'SeriesSearch',seriesId:d.arr.id};
      var r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({svc:kind==='movie'?'radarr':'sonarr',cmd:cmd})});
      if(!r.ok)throw new Error('HTTP '+r.status);sr.textContent='✓ Search started';
    }catch(e){sr.textContent='⚠ Search failed';}
    setTimeout(function(){sr.disabled=false;sr.textContent=old;},2500);
  };
}
async function load(o,refresh){
  style();
  var mount=document.getElementById(o.mount);if(!mount)return;
  mount.className='umd';
  mount.innerHTML='<div class="umd-loading">'+(refresh?'Refreshing':'Loading unified media status')+'…</div>';
  try{
    var d=await get('/api/media/detail?'+qs({type:o.type,arrId:o.arrId,imdbId:o.imdbId,tmdbId:o.tmdbId,tvdbId:o.tvdbId,title:o.title,year:o.year}));
    var normalizedKind=mediaKind(d);
    d.type=normalizedKind;
    d.service=normalizedKind==='movie'?'radarr':'sonarr';
    var fav=await favoriteState(d);
    mount.innerHTML='<div class="umd-head"><div class="umd-title">Unified media status</div><div class="umd-time">Live from MEDIARR · '+new Date(d.generatedAt||Date.now()).toLocaleTimeString()+'</div></div>'+
      '<div class="umd-grid">'+serviceCard(d)+downloadCard(d)+plexCard(d)+mediaCard(d)+'</div>'+
      ((d.tmdb&&d.tmdb.tagline)?'<div class="umd-row">'+chips([d.tmdb.tagline].concat(d.tmdb.networks||[]))+'</div>':'')+
      tech(d)+actionHtml(d,o,fav);
    wireActions(mount,d,o);
  }catch(e){mount.innerHTML='<div class="umd-error">Could not load unified media status: '+esc(e.message)+'</div>';}
}
window.MEDIARRUnifiedDetail={load:load};
})();