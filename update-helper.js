'use strict';
const http = require('http');
const fs = require('fs');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const SELF_ID = process.env.MEDIARR_UPDATE_SELF_ID || '';
const TARGET_IMAGE = process.env.MEDIARR_UPDATE_TARGET_IMAGE || '';
const TARGET_VERSION = process.env.MEDIARR_UPDATE_TARGET_VERSION || '';
const OLD_VERSION = process.env.MEDIARR_UPDATE_OLD_VERSION || '';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function request(method, path, body, timeout=30000){
  return new Promise((resolve,reject)=>{
    const payload=body==null?null:Buffer.from(JSON.stringify(body));
    const headers={Host:'localhost',Accept:'application/json','Content-Length':payload?payload.length:0};
    if(payload) headers['Content-Type']='application/json';
    const req=http.request({socketPath:SOCKET,path,method,headers},res=>{
      let text=''; res.setEncoding('utf8');
      res.on('data',c=>{ if(text.length<2*1024*1024) text+=c; });
      res.on('end',()=>{ let data=null; if(text.trim()){try{data=JSON.parse(text)}catch(_){data=text}} resolve({status:res.statusCode||0,data,body:text}); });
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('Docker API timed out'))); req.on('error',reject);
    if(payload) req.write(payload); req.end();
  });
}
let API='';
async function apiVersion(){ if(API)return API; const r=await request('GET','/version'); if(r.status!==200||!r.data||!r.data.ApiVersion) throw new Error('Docker API unavailable'); API='/v'+r.data.ApiVersion; return API; }
async function api(method,path,body,ok=[200,201,204,304],timeout=30000){ const v=await apiVersion(); const r=await request(method,v+path,body,timeout); if(!ok.includes(r.status)){ const m=r.data&&r.data.message?r.data.message:(r.body||('HTTP '+r.status)); throw new Error(m); } return r; }
function log(msg){ console.log('[mediarr-updater] '+msg); }
function cleanEnv(env){ return (env||[]).filter(x=>!/^MEDIARR_VERSION=/.test(x)); }
function selectedHostConfig(h){
  h=h||{};
  const out={};
  for(const k of ['Binds','PortBindings','RestartPolicy','NetworkMode','ExtraHosts','GroupAdd','Devices','DeviceRequests','CapAdd','CapDrop','SecurityOpt','Privileged','ReadonlyRootfs','Tmpfs','ShmSize','Init','Runtime','Dns','DnsOptions','DnsSearch','Sysctls','IpcMode','PidMode','UTSMode','UsernsMode']){
    if(h[k]!=null) out[k]=h[k];
  }
  out.AutoRemove=false;
  return out;
}
function networking(inspect){
  const nets=(inspect.NetworkSettings&&inspect.NetworkSettings.Networks)||{}; const ep={};
  for(const [name,n] of Object.entries(nets)){
    const aliases=(n.Aliases||[]).filter(a=>a && a!==inspect.Id && !String(inspect.Id).startsWith(String(a)));
    ep[name]={Aliases:aliases};
    if(n.DriverOpts) ep[name].DriverOpts=n.DriverOpts;
  }
  return Object.keys(ep).length?{EndpointsConfig:ep}:undefined;
}
function createBody(old,image){
  const c=old.Config||{};
  const body={
    Image:image,
    Env:cleanEnv(c.Env),
    Cmd:c.Cmd||undefined,
    Entrypoint:c.Entrypoint||undefined,
    WorkingDir:c.WorkingDir||undefined,
    User:c.User||undefined,
    ExposedPorts:c.ExposedPorts||undefined,
    Labels:c.Labels||undefined,
    StopSignal:c.StopSignal||undefined,
    HostConfig:selectedHostConfig(old.HostConfig)
  };
  const net=networking(old); if(net) body.NetworkingConfig=net;
  for(const k of Object.keys(body)) if(body[k]===undefined) delete body[k];
  return body;
}
async function inspect(id){ return (await api('GET','/containers/'+encodeURIComponent(id)+'/json',null,[200])).data; }
async function waitHealthy(id,seconds=120){
  const until=Date.now()+seconds*1000; let sawHealth=false;
  while(Date.now()<until){
    await sleep(2500);
    let c; try{c=await inspect(id)}catch(e){return {ok:false,reason:'replacement disappeared: '+e.message};}
    const state=c.State||{}; if(!state.Running) return {ok:false,reason:'replacement stopped: '+(state.Error||state.Status||'not running')};
    const health=state.Health&&state.Health.Status;
    if(health){ sawHealth=true; if(health==='healthy') return {ok:true}; if(health==='unhealthy') return {ok:false,reason:'replacement became unhealthy'}; }
    else if(Date.now()+10000>=until) return {ok:true};
  }
  return {ok:!sawHealth,reason:sawHealth?'replacement never became healthy':''};
}
async function remove(id){ try{await api('POST','/containers/'+encodeURIComponent(id)+'/stop?t=10',null,[204,304]);}catch(_){} try{await api('DELETE','/containers/'+encodeURIComponent(id)+'?force=1',null,[204]);}catch(_){} }
async function createAndStart(name,body){ const c=await api('POST','/containers/create?name='+encodeURIComponent(name),body,[201]); const id=c.data&&c.data.Id; if(!id)throw new Error('Docker did not return a replacement container ID'); await api('POST','/containers/'+encodeURIComponent(id)+'/start',null,[204,304]); return id; }

(async()=>{
  if(!SELF_ID||!TARGET_IMAGE) throw new Error('Missing update parameters');
  if(!fs.existsSync(SOCKET)) throw new Error('Docker socket is missing');
  log('preparing '+(OLD_VERSION||'?')+' -> '+(TARGET_VERSION||TARGET_IMAGE));
  const old=await inspect(SELF_ID); const name=String(old.Name||'mediarr').replace(/^\//,''); const oldImage=(old.Config&&old.Config.Image)||'';
  if(!oldImage) throw new Error('Could not identify previous image for rollback');
  const oldBody=createBody(old,oldImage); const newBody=createBody(old,TARGET_IMAGE);
  await sleep(1500); // let the API response reach the browser
  log('stopping old container '+name);
  await api('POST','/containers/'+encodeURIComponent(SELF_ID)+'/stop?t=10',null,[204,304],30000);
  await api('DELETE','/containers/'+encodeURIComponent(SELF_ID),null,[204]);
  let replacement='';
  try{
    replacement=await createAndStart(name,newBody);
    log('replacement started; waiting for health check');
    const health=await waitHealthy(replacement,120);
    if(!health.ok) throw new Error(health.reason||'replacement did not become healthy');
    log('update completed successfully');
  }catch(e){
    log('update failed: '+e.message+'; rolling back');
    if(replacement) await remove(replacement);
    try{
      const rollback=await createAndStart(name,oldBody);
      const health=await waitHealthy(rollback,90);
      if(!health.ok) log('rollback container started but is not healthy: '+health.reason);
      else log('rollback completed successfully');
    }catch(re){ log('ROLLBACK FAILED: '+re.message); }
    process.exitCode=1;
  }
})().catch(e=>{ console.error('[mediarr-updater] fatal: '+(e&&e.stack||e)); process.exitCode=1; });