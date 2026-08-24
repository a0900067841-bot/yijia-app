const CACHE="yijia-tm-alpha-8.90";
const PREFIXES=["yijia-tm-","yijia-pos-"];
const ASSETS=[
 "./","./index.html","./customer-display.html",
 "./style.css?v=v5.5.0-alpha.8.90",
 "./app.js?v=v5.5.0-alpha.8.90",
 "./network.js?v=v5.5.0-alpha.8.90",
 "./manifest.webmanifest","./icon-192.png","./icon-512.png"
];
self.addEventListener("install",e=>{
 self.skipWaiting();
 e.waitUntil(caches.open(CACHE).then(async c=>{
  for(const url of ASSETS){try{await c.add(new Request(url,{cache:"reload"}))}catch(err){console.warn("precache",url,err)}}
 }));
});
self.addEventListener("activate",e=>{
 e.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>PREFIXES.some(p=>k.startsWith(p))&&k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
 ]));
});
async function networkFirst(req){
 try{
  const res=await fetch(req,{cache:"no-store"});
  if(res&&res.ok)caches.open(CACHE).then(c=>c.put(req,res.clone())).catch(()=>{});
  return res;
 }catch(err){
  const cached=await caches.match(req,{ignoreSearch:true});
  if(cached)return cached;
  if(req.mode==="navigate"){
   const index=await caches.match("./index.html",{ignoreSearch:true});
   if(index)return index;
  }
  throw err;
 }
}
self.addEventListener("fetch",e=>{
 const req=e.request;if(req.method!=="GET")return;
 if(req.mode==="navigate"||["style","script","worker"].includes(req.destination)){e.respondWith(networkFirst(req));return}
 e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{if(res&&res.ok)caches.open(CACHE).then(c=>c.put(req,res.clone())).catch(()=>{});return res})));
});
