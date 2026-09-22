import { createClient } from 'npm:@supabase/supabase-js@2.39.0';
// Supabase supplies URL/ANON_KEY/SERVICE_ROLE_KEY in the Edge environment.
// Only APP_ALLOWED_ORIGINS must be set explicitly. Never prefix server secrets with VITE_.
Deno.serve(async(request:Request)=>{
  const origin=request.headers.get('origin')||'';
  const allowed=(Deno.env.get('APP_ALLOWED_ORIGINS')||'').split(',').map(v=>v.trim()).filter(Boolean);
  const headers={'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Origin':allowed.includes(origin)?origin:'',
    'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(!allowed.includes(origin))return reply({error:'Origin belum diizinkan pada APP_ALLOWED_ORIGINS.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!anon||!service)return reply({error:'Konfigurasi server belum lengkap.'},503);
    const authorization=request.headers.get('authorization')||'';
    if(!/^Bearer \S+$/.test(authorization))return reply({error:'Authentication required'},401);
    const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const userResult=await client.auth.getUser();if(userResult.error||!userResult.data.user)return reply({error:'Sesi tidak valid.'},401);
    const check=await client.rpc('buymore_admin_check');if(check.error||check.data!==true)return reply({error:check.error?.message||'Admin access required'},403);
    const raw=await request.text();if(raw.length>4096)return reply({error:'Permintaan terlalu besar.'},413);
    const body=JSON.parse(raw);const email=String(body.email||'').trim().toLowerCase(),name=String(body.full_name||'').trim();
    if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!name||name.length>128)return reply({error:'Email dan nama wajib valid.'},400);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await admin.auth.admin.inviteUserByEmail(email,{data:{full_name:name},redirectTo:`${origin}/?recovery=1`});
    if(result.error||!result.data.user)return reply({error:result.error?.message||'Undangan tidak dapat dibuat.'},400);
    const saved=await admin.from('profiles').upsert({id:result.data.user.id,email,full_name:name,role:'operator',is_active:false},{onConflict:'id'});
    if(saved.error)return reply({invited:false,user_id:result.data.user.id,error:'Undangan Auth dibuat, tetapi profil belum siap. Status profil belum dapat dikonfirmasi. Periksa akun, trigger profiles, dan Auth di Supabase sebelum digunakan.'},409);
    // Write an attributed business audit using the validated admin identity, not client metadata.
    const log=await admin.from('activity_logs').insert({user_id:userResult.data.user.id,user_name:userResult.data.user.email||userResult.data.user.id,activity_type:'INSERT',table_name:'profiles',record_id:result.data.user.id,
      description:'USER_INVITE: akun nonaktif dibuat melalui Supabase Auth',description_id:'USER_INVITE: akun nonaktif dibuat melalui Supabase Auth',
      metadata:{event_subtype:'USER_INVITE',actor_id:userResult.data.user.id,new_data:{email,full_name:name,role:'operator',is_active:false}},created_at:new Date().toISOString()});
    if(log.error)return reply({invited:false,error:'Undangan dan profil dibuat, tetapi audit gagal. Akun tetap nonaktif; Admin perlu memeriksa Log Aktivitas.'},409);
    return reply({invited:true,user_id:result.data.user.id});
  }catch(error){return reply({error:error instanceof SyntaxError?'JSON tidak valid.':'Undangan gagal diproses. Periksa log fungsi Supabase.'},500);}
});
