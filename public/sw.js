const CACHE='mediarr-pwa-v1.9.1';
const SHELL=['/','/m','/manifest.webmanifest','/icons/mediarr-icon.svg','/icons/mediarr-icon-192.png','/icons/mediarr-icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(SHELL.map(url=>cache.add(url).catch(()=>null)))));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mediarr-pwa-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{ if(event.data&&event.data.type==='SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;
  // APIs, authenticated media, HLS, and app JS/HTML are always network-first/no-cache.
  // This prevents stale MEDIARR state and old release code from being served by the PWA.
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/hls/')||url.pathname.startsWith('/v')&&url.pathname.endsWith('.js')){
    event.respondWith(fetch(req));
    return;
  }
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(()=>caches.match(url.pathname==='/m'||url.pathname.startsWith('/mobile')?'/m':'/')));
    return;
  }
  if(SHELL.includes(url.pathname)||url.pathname.startsWith('/icons/')){
    event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res;})));
  }
});
