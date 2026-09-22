import {createPageCache,createCachedFetch,type CacheIdentity} from './page-cache';
const project=String(import.meta.env.VITE_SUPABASE_URL||'').trim().replace(/\/$/,'');
export const pageCache=createPageCache({project,storage:()=>typeof window==='undefined'?undefined:window.sessionStorage});
const PREF_PREFIX='buymore:ui:v1:';
let channel:BroadcastChannel|undefined;
try{if(typeof BroadcastChannel!=='undefined')channel=new BroadcastChannel('buymore-cache-v1');}catch{/* Cross-tab invalidation is optional. */}
function event(name:string){if(typeof window!=='undefined')window.dispatchEvent(new Event(name));}
export function invalidatePageCache(broadcast=true){
  pageCache.invalidate();
  if(broadcast)channel?.postMessage({type:'invalidate',userId:pageCache.getIdentity()?.userId});
}
function purgePreferences(scope:string){
  if(!scope||typeof window==='undefined')return;
  try{const s=window.sessionStorage,prefix=PREF_PREFIX+encodeURIComponent(scope)+':';for(let i=s.length-1;i>=0;i--){const key=s.key(i);if(key?.startsWith(prefix))s.removeItem(key);}}catch{/* Browser storage can be disabled. */}
}
export function clearPageCache(broadcast=true){
  const userId=pageCache.getIdentity()?.userId;purgePreferences(pageCache.getScope());pageCache.clearIdentity();
  if(broadcast&&userId)channel?.postMessage({type:'logout',userId});
}
export function establishCacheIdentity(identity:CacheIdentity|null){
  const old=pageCache.getScope();pageCache.setIdentity(identity);
  if(old&&old!==pageCache.getScope())purgePreferences(old);
}
if(channel)channel.onmessage=({data})=>{
  if(!data?.userId||data.userId!==pageCache.getIdentity()?.userId)return;
  if(data.type==='logout')clearPageCache(false);else if(data.type==='invalidate')invalidatePageCache(false);
  event('buymore:refresh-authority');event('buymore:refresh-pages');
};
export const cachedSupabaseFetch=createCachedFetch({
  cache:pageCache,origin:project,fetch:(...args)=>globalThis.fetch(...args),
  onStale:()=>event('buymore:stale-cache'),
  onDenied:()=>event('buymore:refresh-authority'),
  onMutation:()=>channel?.postMessage({type:'invalidate',userId:pageCache.getIdentity()?.userId}),
});
/** Preferences are presentation only: never store credentials, pending writes or permission decisions here. */
export function readPagePreference<T>(scope:string,name:string,fallback:T):T {
  if(!scope||typeof window==='undefined')return fallback;
  try{
    const raw=window.sessionStorage.getItem(PREF_PREFIX+encodeURIComponent(scope)+':'+name);
    if(!raw||raw.length>20_000)return fallback;
    const record=JSON.parse(raw);
    if(!record||record.expiresAt<Date.now()||!sameShape(fallback,record.value))return fallback;
    return record.value as T;
  }catch{return fallback;}
}
function sameShape(base:unknown,value:unknown):boolean {
  if(base===null)return value===null;
  if(Array.isArray(base))return Array.isArray(value)&&value.length<=100&&value.every(v=>base.length?sameShape(base[0],v):typeof v==='string');
  if(typeof base==='object')return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>k in (base as object))&&Object.keys(base as object).every(k=>sameShape((base as Record<string,unknown>)[k],(value as Record<string,unknown>)[k])));
  if(typeof base==='number')return typeof value==='number'&&Number.isFinite(value)&&value>=0;
  return typeof base===typeof value;
}
export function writePagePreference<T>(scope:string,name:string,value:T){
  if(!scope||typeof window==='undefined')return;
  try{const raw=JSON.stringify({value,expiresAt:Date.now()+86_400_000});if(raw.length<20_000)window.sessionStorage.setItem(PREF_PREFIX+encodeURIComponent(scope)+':'+name,raw);}catch{/* Do not fail cloud operations because preferences cannot be stored. */}
}
