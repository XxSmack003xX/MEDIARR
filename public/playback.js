/*
 * MEDIARR playback engine (v2.19) — shared by the desktop and phone players.
 *
 * Decides how to play a video and keeps trying until something works:
 *   direct  the original file, straight from the server (fastest, full seeking)
 *   hls     a converted stream in pieces (seekable): original picture with converted sound,
 *           or fully converted when the browser can't show the picture / a lower quality was chosen
 *   live    converted on the fly as one stream (no seeking) — the last resort
 * The order comes from what the file is and what was chosen in the player. If a way fails to
 * start (or breaks while playing) the next one is tried from the same position, and the
 * message under the player says what happened. "Details" shows a report that can be copied.
 *
 *   MediarrPlayback.start({video, path, name, msg, options:{force,quality,aidx,stereo}, auto, ffmpeg,
 *                          hint(), onSid(sid), onReady(mode), download(anchor)})
 *   MediarrPlayback.stop(video)
 */
(function(){
'use strict';
if(window.MediarrPlayback)return;
const plans=new Map();   // path → {at, plan}
const T={plan:30000,direct:25000,hlsStart:45000,hlsFirst:30000,live:45000};
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc=encodeURIComponent;
function timed(p,ms,what){return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error(what+' took too long')),ms);p.then(v=>{clearTimeout(t);res(v);},e=>{clearTimeout(t);rej(e);});});}
async function getJson(url,ms){
  const ctl=window.AbortController?new AbortController():null;
  const r=await timed(fetch(url,{credentials:'same-origin',signal:ctl?ctl.signal:undefined}),ms,'The server').catch(e=>{if(ctl)try{ctl.abort();}catch(_){}throw e;});
  let j={};try{j=await r.json();}catch(_){}
  if(!r.ok){const e=new Error(j.message||('HTTP '+r.status));e.code=j.code||('http'+r.status);throw e;}
  return j;
}
function canHls(v){return !!((window.Hls&&window.Hls.isSupported&&window.Hls.isSupported())||(v.canPlayType&&v.canPlayType('application/vnd.apple.mpegurl')));}
function mediaErr(v){const e=v&&v.error;if(!e)return 'the browser gave up';return ({1:'loading was stopped',2:'the connection dropped',3:'the browser couldn’t decode it',4:'the browser can’t play this format'})[e.code]||('error '+e.code);}

function start(o){
  const v=o.video;if(!v)return null;
  stop(v);
  const S={o,v,alive:true,log:[],t0:Date.now(),offs:[],hls:null,sid:'',mode:'',step:-1,ladder:[],plan:null,notes:[],played:false,fails:0};
  v._mpb=S;
  S.note=(what,extra)=>{S.log.push(Object.assign({ms:Date.now()-S.t0,what},extra||{}));};
  S.on=(ev,fn)=>{v.addEventListener(ev,fn);S.offs.push(()=>v.removeEventListener(ev,fn));};
  run(S).catch(e=>{if(S.alive){S.note('crash',{error:String(e&&e.message||e)});dead(S,String(e&&e.message||e));}});
  return {stop:()=>stop(v),report:()=>report(S)};
}
function teardown(S){
  S.offs.splice(0).forEach(f=>{try{f();}catch(_){}});
  clearTimeout(S.watch);
  if(S.hls){try{S.hls.destroy();}catch(_){}S.hls=null;}
  if(S.sid){const sid=S.sid;S.sid='';try{fetch('/api/webdav/hls/stop?sid='+enc(sid),{credentials:'same-origin',keepalive:true}).catch(()=>{});}catch(_){}if(S.o.onSid)try{S.o.onSid(null);}catch(_){}}
}
function stop(v){const S=v&&v._mpb;if(!S)return;S.alive=false;teardown(S);v._mpb=null;}

function say(S,text,opts){
  const m=S.o.msg;if(!m)return;
  opts=opts||{};
  m.textContent='';
  const span=document.createElement('span');span.textContent=text||'';m.appendChild(span);
  if(opts.download&&S.o.download){const a=document.createElement('a');a.href='#';a.textContent='Download it instead';a.style.cssText='color:var(--gold,#e8b04a);margin-left:6px';a.onclick=e=>{e.preventDefault();S.o.download(a);};m.appendChild(a);}
  if(opts.retry){const a=document.createElement('a');a.href='#';a.textContent='Try again';a.style.cssText='color:var(--gold,#e8b04a);margin-left:10px';a.onclick=e=>{e.preventDefault();start(S.o);};m.appendChild(a);}
  if(opts.details||S.fails){
    const a=document.createElement('a');a.href='#';a.textContent='Details';a.setAttribute('data-playback-details','');a.style.cssText='color:var(--muted,#8f97a8);margin-left:10px;text-decoration:underline';
    a.onclick=e=>{e.preventDefault();
      let box=m.querySelector('pre');if(box){box.parentNode.remove();return;}
      const wrap=document.createElement('div');wrap.style.cssText='margin-top:8px';
      box=document.createElement('pre');box.style.cssText='white-space:pre-wrap;font-size:12px;line-height:1.45;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.12);color:inherit;max-height:240px;overflow:auto;margin:0 0 6px;text-align:left';
      box.textContent=report(S);
      const c=document.createElement('a');c.href='#';c.textContent='Copy';c.style.cssText='color:var(--gold,#e8b04a);font-size:13px';
      c.onclick=async ev=>{ev.preventDefault();try{await navigator.clipboard.writeText(box.textContent);c.textContent='Copied';}catch(_){const r=document.createRange();r.selectNodeContents(box);const s=getSelection();s.removeAllRanges();s.addRange(r);c.textContent='Selected — press Ctrl+C';}};
      wrap.appendChild(box);wrap.appendChild(c);m.appendChild(wrap);};
    m.appendChild(a);
  }
}
function report(S){
  const o=S.o,p=S.plan||{};
  const L=['MEDIARR playback report','file: '+(o.name||o.path||'').slice(-120),
    'chosen: '+['force='+!!o.options.force,'quality='+o.options.quality,'audio track='+(o.options.aidx||0),'stereo='+!!o.options.stereo,'auto='+!!o.auto,'ffmpeg='+!!o.ffmpeg].join(', '),
    'file info: '+(S.plan?[p.container,p.video,p.pixelFormat,p.audio,(p.audioChannels||'?')+'ch',p.duration?Math.round(p.duration)+'s':'no length',p.mode+(p.reason?' ('+p.reason+')':'')].filter(Boolean).join(', '):'not available'),
    'tried: '+(S.ladder.join(' → ')||'nothing yet')+'   playing: '+(S.mode||'nothing'),
    'hls.js: '+(window.Hls?(window.Hls.version||'loaded')+(window.Hls.isSupported&&window.Hls.isSupported()?'':' (not supported here)'):'not loaded')+'   native HLS: '+(S.v.canPlayType&&S.v.canPlayType('application/vnd.apple.mpegurl')?'yes':'no'),
    'browser: '+navigator.userAgent,''];
  S.log.forEach(e=>{const x=Object.assign({},e);delete x.ms;delete x.what;const rest=Object.keys(x).map(k=>k+'='+(typeof x[k]==='object'?JSON.stringify(x[k]):x[k])).join(' ');L.push(String((e.ms/1000).toFixed(1)).padStart(6)+'s  '+e.what+(rest?'  '+rest:''));});
  return L.join('\n');
}
function dead(S,why){
  S.mode='';teardown(S);
  say(S,'This video couldn’t be played'+(why?' ('+why+').':'.'),{download:true,retry:true,details:true});
}

async function run(S){
  const o=S.o,v=S.v,opt=o.options=Object.assign({force:false,quality:'orig',aidx:0,stereo:false},o.options||{});
  say(S,'Getting ready…');
  // what the file is (cached for a while; the server caches the probe too)
  if(o.ffmpeg){
    const hit=plans.get(o.path);
    if(hit&&Date.now()-hit.at<300000)S.plan=hit.plan;
    else{
      try{S.plan=await getJson('/api/webdav/playback-plan?path='+enc(o.path),T.plan);if(S.plan&&S.plan.reason!=='probe-failed')plans.set(o.path,{at:Date.now(),plan:S.plan});S.note('file info',{mode:S.plan.mode,reason:S.plan.reason||''});}
      catch(e){S.note('file info failed',{error:e.message});}
      if(!S.alive)return;
    }
  }
  const p=S.plan||{};
  const tracks=p.audioTracks||[];
  const ch=(tracks[opt.aidx]&&tracks[opt.aidx].channels)||(opt.aidx?0:p.audioChannels)||0;
  S.ac2=!!(opt.stereo&&ch>2);
  const explicit=!!(opt.force||opt.quality!=='orig'||opt.aidx>0);
  const needs=!!(o.auto&&p.mode==='hls');
  let ladder=!o.ffmpeg?['direct']:explicit?['hls','live']:needs?['hls','live','direct']:['direct','hls','live'];
  if(!canHls(v))ladder=ladder.filter(x=>x!=='hls');
  S.ladder=ladder;S.explicit=explicit;
  S.startAt=0;
  next(S,'');
}
function next(S,why){
  if(!S.alive)return;
  teardown(S);
  if(why){S.fails++;S.notes.push(why);}
  S.step++;
  const mode=S.ladder[S.step];
  if(!mode)return dead(S,why);
  S.mode=mode;S.note('try '+mode,S.startAt>1?{from:Math.round(S.startAt)+'s'}:null);
  const names={direct:'the original file',hls:'a converted stream',live:'live conversion'};
  say(S,(why?'Couldn’t play '+names[S.ladder[S.step-1]]+' ('+why+'). Trying '+names[mode]+'…':mode==='direct'?'Starting…':'Preparing the stream…'));
  ({direct:playDirect,hls:playHls,live:playLive})[mode](S).catch(e=>{if(S.alive&&S.mode===mode)fail(S,mode,e&&e.message||String(e));});
}
function fail(S,mode,why){
  if(!S.alive||S.mode!==mode)return;
  S.note(mode+' failed',{why});
  const v=S.v;
  if(S.played&&isFinite(v.currentTime)&&v.currentTime>1)S.startAt=v.currentTime;
  next(S,why);
}
// resolves once the video has something to show; rejects on an error or when nothing arrives in time
function untilReady(S,mode,ms){
  const v=S.v;
  return new Promise((res,rej)=>{
    let done=false;
    const ok=()=>{if(done||!S.alive||S.mode!==mode)return;if(v.readyState>=2){done=true;clearTimeout(S.watch);res();}};
    S.on('loadeddata',ok);S.on('canplay',ok);S.on('playing',ok);
    S.on('error',()=>{if(done||!v.getAttribute('src')&&!S.hls)return;done=true;clearTimeout(S.watch);rej(new Error(mediaErr(v)));});
    S.watch=setTimeout(()=>{if(done)return;done=true;rej(new Error('nothing arrived in '+Math.round(ms/1000)+' seconds'));},ms);
    ok();
  });
}
function settled(S,mode,text){
  if(!S.alive||S.mode!==mode)return;
  S.played=true;S.note(mode+' playing');
  const v=S.v;
  // it broke later on: carry on from the same spot with the next way of playing
  S.on('error',()=>{if(S.alive&&S.mode===mode&&(v.getAttribute('src')||S.hls))fail(S,mode,mediaErr(v));});
  S.on('timeupdate',()=>{if(v.currentTime>1)S.startAt=v.currentTime;});
  const first=S.notes.length?'Couldn’t play it the usual way ('+S.notes[S.notes.length-1]+'). ':'';
  say(S,first+text);
  if(S.o.onReady)try{S.o.onReady(mode);}catch(_){}
}
function tryPlay(v){try{const pr=v.play&&v.play();if(pr&&pr.catch)pr.catch(()=>{});}catch(_){}}

async function playDirect(S){
  const v=S.v,p=S.plan||{};
  v.src='/api/webdav/stream?path='+enc(S.o.path);v.load();
  if(S.startAt>1){const at=S.startAt;const seek=()=>{try{v.currentTime=at;}catch(_){}};S.on('loadedmetadata',seek);}
  tryPlay(v);
  await untilReady(S,'direct',T.direct);
  // sound but no picture: the browser can't decode this video
  if(p.video&&v.videoWidth===0&&S.ladder.length>S.step+1)throw new Error('the browser can’t show this picture');
  settled(S,'direct',S.o.auto&&S.plan&&!S.notes.length?'Auto: Direct play':S.notes.length?'Playing the original file.':'');
}
async function playHls(S){
  const v=S.v,o=S.o,opt=o.options,p=S.plan||{};
  let qs='path='+enc(o.path)+'&q='+enc(opt.quality);
  if(S.ac2)qs+='&ac=2';
  if(opt.aidx>0)qs+='&aidx='+opt.aidx;
  if(!S.explicit&&p.forceVideo)qs+='&vc=1';
  const hint=o.hint?o.hint():null;
  let from=S.startAt>1?S.startAt:0;
  if(hint){qs+='&party='+enc(hint.party);if(!from&&hint.start>3)from=hint.start;}
  if(from>3)qs+='&start='+Math.floor(from);
  let j;
  try{j=await getJson('/api/webdav/hls/start?'+qs,T.hlsStart);}
  catch(e){throw new Error(e.code==='no-duration'?'this file doesn’t say how long it is':e.code==='probe-failed'?'the server couldn’t read the file':e.message);}
  if(!S.alive||S.mode!=='hls'){try{fetch('/api/webdav/hls/stop?sid='+enc(j.sid),{credentials:'same-origin'}).catch(()=>{});}catch(_){}return;}
  S.sid=j.sid;if(o.onSid)try{o.onSid(j.sid);}catch(_){}
  S.note('stream ready',{kind:j.mode+(j.exact?' exact':'')+(j.shared?' shared':''),start:j.start||0});
  const url='/api/webdav/hls/'+j.sid+'/index.m3u8';
  const h2=o.hint?o.hint():null;
  const at=from>3?from:(h2&&h2.start>3?h2.start:(j.start||0));
  const ready=untilReady(S,'hls',T.hlsFirst);
  if(window.Hls&&window.Hls.isSupported&&window.Hls.isSupported()){
    const hls=new window.Hls({maxBufferLength:30,maxMaxBufferLength:90,startPosition:at>0?at:-1,fragLoadingMaxRetry:4,manifestLoadingMaxRetry:2});
    S.hls=hls;let net=0,med=0;
    const E=window.Hls.Events||{},Y=window.Hls.ErrorTypes||{};
    hls.on(E.ERROR,(ev,d)=>{
      if(!d)return;
      S.note('hls '+(d.fatal?'error':'warning'),{type:d.type,details:d.details});
      if(!d.fatal||!S.alive||S.hls!==hls)return;
      // recover the way hls.js recommends before giving up on this way of playing
      if(d.type===Y.NETWORK_ERROR&&net++<2){try{hls.startLoad();return;}catch(_){}}
      if(d.type===Y.MEDIA_ERROR&&med++<2){try{hls.recoverMediaError();return;}catch(_){}}
      fail(S,'hls',d.details||d.type||'stream error');
    });
    hls.loadSource(url);hls.attachMedia(v);
  }else{
    v.src=url;if(at>0){const seek=()=>{try{v.currentTime=at;}catch(_){}};S.on('loadedmetadata',seek);}v.load();
  }
  tryPlay(v);
  await ready;
  const kind=j.shared?'Sharing the watch party’s stream':j.mode==='transcode'?(opt.quality==='orig'?'Converting the video for this browser':'Converting to '+opt.quality+'p'):j.mode==='remux-audio'?(S.ac2?'Original picture, sound converted to stereo':'Original picture, sound converted'):'Original picture and sound';
  settled(S,'hls',(o.auto&&!S.explicit&&!S.notes.length?'Auto: ':'')+kind);
}
async function playLive(S){
  const v=S.v,o=S.o,opt=o.options,p=S.plan||{};
  let src='/api/webdav/stream?path='+enc(o.path)+'&transcode=1';
  if(S.ac2)src+='&ac=2';if(opt.aidx>0)src+='&aidx='+opt.aidx;if(!S.explicit&&p.forceVideo)src+='&vc=1';
  v.src=src;v.load();tryPlay(v);
  await untilReady(S,'live',T.live);
  settled(S,'live','Converting live (no seeking)'+(S.notes.length?'':': this browser can’t play converted streams in pieces')+'.');
}

window.MediarrPlayback={start,stop,sid:v=>(v&&v._mpb&&v._mpb.sid)||'',mode:v=>(v&&v._mpb&&v._mpb.mode)||'',report:v=>(v&&v._mpb?report(v._mpb):''),_plans:plans,_timeouts:T};
})();
