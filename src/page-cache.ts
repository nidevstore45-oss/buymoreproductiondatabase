/** Bounded, authorization-scoped read cache. This is never an authorization source. */
export interface CacheIdentity {
  userId: string; role: string; factories: string[]; revision: string; aal: string;
  token: string; validUntil: number;
}
interface CacheEntry { body: string; status: number; headers: [string,string][]; savedAt: number; persistent: boolean }
interface CacheOptions {
  project: string; storage?: () => Pick<Storage,'getItem'|'setItem'|'removeItem'> | undefined;
  now?: () => number; ttlMs?: number; maxAgeMs?: number; maxEntries?: number; maxChars?: number;
}
const PREFIX='buymore:read-cache:v1:';
const SAFE_HEADERS=['content-type','content-range','range-unit'];
export function createPageCache(options: CacheOptions) {
  const now=options.now??Date.now, ttl=options.ttlMs??30_000, maxAge=options.maxAgeMs??300_000;
  const maxEntries=options.maxEntries??48, maxChars=options.maxChars??800_000;
  let identity:CacheIdentity|null=null, scope='', epoch=0;
  const entries=new Map<string,CacheEntry>();
  const listeners=new Set<()=>void>();
  const storage=()=>{try{return options.storage?.();}catch{return undefined;}};
  const storageKey=()=>PREFIX+encodeURIComponent(scope);
  const emit=()=>listeners.forEach(fn=>fn());
  function removeStored(){if(scope)try{storage()?.removeItem(storageKey());}catch{/* Cache is optional. */}}
  function trim(){
    for(const [key,e] of entries)if(e.savedAt>now()||now()-e.savedAt>maxAge)entries.delete(key);
    let size=[...entries].reduce((n,[key,e])=>n+key.length+e.body.length,0);
    while(entries.size>maxEntries||size>maxChars){const first=entries.keys().next().value as string|undefined;if(!first)break;const e=entries.get(first)!;size-=first.length+e.body.length;entries.delete(first);}
  }
  function persist(){try{const rows=[...entries].filter(([,e])=>e.persistent);if(rows.length)storage()?.setItem(storageKey(),JSON.stringify({version:1,rows}));else removeStored();}catch{/* Memory cache still works when browser storage is unavailable. */}}
  function restore(){
    try{
      const raw=storage()?.getItem(storageKey());if(!raw||raw.length>maxChars*2)return;
      const parsed=JSON.parse(raw);if(parsed.version!==1||!Array.isArray(parsed.rows))return;
      for(const pair of parsed.rows){if(!Array.isArray(pair)||pair.length!==2)continue;const [key,e]=pair;
        if(typeof key!=='string'||!e||typeof e.body!=='string'||e.body.length>250_000||e.status!==200||!Number.isFinite(e.savedAt)||!Array.isArray(e.headers)||e.persistent!==true)continue;
        if(!e.headers.every((h:unknown)=>Array.isArray(h)&&h.length===2&&SAFE_HEADERS.includes(h[0])&&typeof h[1]==='string'))continue;
        entries.set(key,e);
      }trim();
    }catch{removeStored();}
  }
  const api={
    setIdentity(next:CacheIdentity|null){
      const oldScope=scope;
      const nextScope=next?.userId&&next.role?JSON.stringify([options.project,next.userId,next.role,[...next.factories].sort(),next.revision,next.aal]):'';
      if(nextScope!==scope){removeStored();entries.clear();epoch++;scope=nextScope;identity=next;if(scope)restore();emit();}
      else identity=next;
      // Initial verification may restore a previous reload's sessionStorage entry.
      if(!oldScope&&scope)restore();
    },
    clearIdentity(){removeStored();entries.clear();identity=null;scope='';epoch++;emit();},
    invalidate(){entries.clear();removeStored();epoch++;},
    getScope:()=>scope,
    getIdentity:()=>identity,
    getEpoch:()=>epoch,
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    authorized(token:string){return Boolean(scope&&identity&&identity.token===token&&identity.validUntil>now());},
    entryCount:()=>entries.size,
    read(key:string,stale=false):CacheEntry|null{
      if(!identity||identity.validUntil<=now())return null;
      const e=entries.get(key);if(!e)return null;
      const age=now()-e.savedAt;if(age<0||age>maxAge){entries.delete(key);persist();return null;}
      if(!stale&&age>ttl)return null;
      entries.delete(key);entries.set(key,e);return e;
    },
    write(key:string,entry:Omit<CacheEntry,'savedAt'>){
      if(!identity||identity.validUntil<=now()||entry.body.length>250_000)return;
      entries.delete(key);entries.set(key,{...entry,savedAt:now()});trim();persist();
    },
    response(e:CacheEntry,stale=false){const headers=new Headers(e.headers);headers.set('x-buymore-cache',stale?'stale':'hit');return new Response(e.body,{status:e.status,headers});},
  };
  return api;
}
export type PageCache=ReturnType<typeof createPageCache>;
const READ_RPCS=new Set(['buymore_dashboard','buymore_production_page','buymore_plan_page']);
const UNCACHED_READ_RPCS=new Set(['buymore_export_snapshot','get_public_invitation']);
const READ_TABLES=new Set(['master_items','production_data','production_targets','activity_logs','work_orders','production_batches','user_favorites','saved_filters','attachments','production_quality','shift_closures','change_requests']);
interface FetchOptions { cache:PageCache; origin:string; fetch:typeof fetch; onStale?:()=>void; onDenied?:()=>void; onMutation?:()=>void }
export function createCachedFetch(options:FetchOptions):typeof fetch {
  const {cache}=options;
  return async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init?.headers).forEach((v,k)=>headers.set(k,v));
    const token=(headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
    const sameProject=url.origin===options.origin;
    const path=url.pathname.replace(/^\/rest\/v1\//,'');
    const rpc=path.startsWith('rpc/')?path.slice(4):'';
    let body=typeof init?.body==='string'?init.body:'';
    if(!body&&input instanceof Request&&method==='POST')try{body=await input.clone().text();}catch{/* Stream not eligible for cache. */}
    let payload:Record<string,unknown>={};try{payload=body?JSON.parse(body):{};}catch{/* Never cache an unparseable RPC payload. */}
    let eligible=false,persistent=true;
    if(sameProject&&url.pathname.startsWith('/rest/v1/')){
      eligible=method==='GET'&&READ_TABLES.has(path);
      if(method==='POST'&&READ_RPCS.has(rpc)&&body&&payload&&typeof payload==='object'&&!payload.p_max_id)eligible=true;
      // User directory can be kept only in memory; self-profile and permission lookups stay live.
      if(method==='GET'&&path==='profiles'&&url.searchParams.has('limit')&&!url.searchParams.has('id')){eligible=true;persistent=false;}
      if(path==='activity_logs'&&(url.search.includes('SESSION_')||url.search.includes('SESSION%')))persistent=false;
    }
    const signal=init?.signal??(input instanceof Request?input.signal:undefined);
    if(signal?.aborted)throw new DOMException('Request aborted','AbortError');
    const authorized=cache.authorized(token);
    const requestScope=cache.getScope(),epoch=cache.getEpoch();
    const key=JSON.stringify([method,url.pathname,url.search,body,headers.get('accept'),headers.get('prefer'),headers.get('range'),headers.get('accept-profile')]);
    if(eligible&&authorized){const hit=cache.read(key);if(hit)return cache.response(hit);}
    const mutation=sameProject&&!['GET','HEAD','OPTIONS'].includes(method)&&
      !READ_RPCS.has(rpc)&&!UNCACHED_READ_RPCS.has(rpc)&&!url.pathname.startsWith('/auth/')&&
      (url.pathname.startsWith('/rest/')||url.pathname.startsWith('/functions/')||url.pathname.startsWith('/storage/'));
    try{
      const result=await options.fetch(input,init);
      if(requestScope&&requestScope!==cache.getScope())throw new DOMException('Session or access scope changed','AbortError');
      if(sameProject&&(result.status===401||result.status===403)){cache.invalidate();options.onDenied?.();return result;}
      if(mutation&&result.ok){cache.invalidate();options.onMutation?.();}
      if(eligible&&authorized&&result.status===200&&cache.getEpoch()===epoch&&cache.authorized(token)){
        const contentType=result.headers.get('content-type')??'';
        if(contentType.includes('json')){
          const text=await result.clone().text();
          if(cache.getEpoch()===epoch&&requestScope===cache.getScope())cache.write(key,{body:text,status:200,headers:SAFE_HEADERS.flatMap(h=>result.headers.has(h)?[[h,result.headers.get(h)!] as [string,string]]:[]),persistent});
        }
      }
      return result;
    }catch(error){
      if(error instanceof Error&&error.name==='AbortError')throw error;
      // Only connection failure may use stale data. HTTP and SQL errors are never converted to success.
      if(error instanceof TypeError&&eligible&&authorized&&cache.getEpoch()===epoch&&cache.authorized(token)){
        const old=cache.read(key,true);if(old){options.onStale?.();return cache.response(old,true);}
      }
      throw error;
    }
  };
}
