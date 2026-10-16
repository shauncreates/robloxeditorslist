import { fixture, ids, sessionId } from "./auth-fixture.mjs";
import { randomUUID } from "node:crypto";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { secureResponse } from "../functions/_security.js";

export const env={SUPABASE_URL:"https://rel-test.invalid",SUPABASE_PUBLISHABLE_KEY:"test-public",SUPABASE_SERVICE_ROLE_KEY:"test-server"};
export async function mockService(){
  const {db,rpc}=await fixture({profiles:true});
  const originalFetch=globalThis.fetch;
  const users=new Map(Object.keys(ids).map(name=>[name,{id:ids[name],email:name+"@example.test",email_confirmed_at:"2026-10-14T00:00:00Z"}]));
  const sessions=new Map(users);
  const passwords=new Map([...users.values()].map(user=>[user.id,"test-password-123"]));
  const recoveryCodes=new Map(),failures={};
  let requestLog=[];
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);
    // Synthetic avatar responses exercise uploads without contacting TikTok.
    if(url.href==='https://www.tiktok.com/@fixture_editor')return new Response('{"avatarLarger":"https://p16.tiktokcdn.com/fixture-avatar.png"}');
    if(url.href==='https://p16.tiktokcdn.com/fixture-avatar.png')return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6cAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
    if(url.origin!==env.SUPABASE_URL)throw new Error("Tests must not contact external services: "+url.origin);
    requestLog.push({path:url.pathname,body:typeof options.body==='string'?JSON.parse(options.body):options.body?{bytes:options.body.byteLength}:undefined,headers:options.headers});
    if(url.pathname.startsWith('/storage/v1/object/editor-avatars/'))return response({ok:true});
    const token=new Headers(options.headers).get("authorization")?.replace(/^Bearer /,"");
    const user=sessions.get(token);
    if(url.pathname==="/auth/v1/user"){
      if(!user)return response({error:"Invalid token"},401);
      if(options.method==="PUT"){
        if(failures.update)return response({},failures.update);
        passwords.set(user.id,JSON.parse(options.body).password);
      }
      return response(user);
    }
    if(url.pathname==="/auth/v1/recover"){
      if(failures.recover)return response({},failures.recover);
      const email=JSON.parse(options.body).email.toLowerCase();
      const account=[...users.values()].find(user=>user.email===email);
      if(account)recoveryCodes.set(email,{user:account,code:"123456",expires:Date.now()+60000});
      return response({});
    }
    if(url.pathname==="/auth/v1/verify"){
      if(failures.verify)return response({},failures.verify);
      const body=JSON.parse(options.body),pending=recoveryCodes.get(body.email.toLowerCase());
      if(body.type!=="recovery"||!pending||body.token!==pending.code||pending.expires<Date.now())return response({},403);
      recoveryCodes.delete(body.email.toLowerCase());
      const accessToken=randomUUID();sessions.set(accessToken,pending.user);
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2) on conflict (id) do nothing",[sessionId(pending.user.id),pending.user.id]);
      return response({access_token:accessToken,refresh_token:"refresh-"+accessToken});
    }
    if(url.pathname==="/auth/v1/token"){
      const body=JSON.parse(options.body);
      const passwordGrant=url.searchParams.get("grant_type")==="password";
      let accessToken=body.refresh_token?.replace(/^refresh-/,"");
      if(passwordGrant){
        const account=users.get(body.email?.split('@')[0]);
        if(!account||body.email!==account.email||body.password!==passwords.get(account.id))return response({},401);
        accessToken=randomUUID();sessions.set(accessToken,account);
        await db.query("insert into auth.sessions(id,user_id) values ($1,$2) on conflict (id) do nothing",[sessionId(account.id),account.id]);
      }else if(!sessions.has(accessToken))return response({},401);
      return response({access_token:accessToken,refresh_token:"refresh-"+accessToken,expires_in:3600});
    }
    if(url.pathname==="/auth/v1/signup"){
      if(failures.signup)return response({},failures.signup);
      const body=JSON.parse(options.body),id=randomUUID();
      if([...users.values()].some(user=>user.email===body.email))return response({id:"pending-confirmation"});
      try{
        await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)",[id,body.email,body.data]);
        const user={id,email:body.email,email_confirmed_at:null};
        users.set(body.email.split('@')[0],user);passwords.set(id,body.password);
        return response(user);
      }catch{return response({message:"Database error saving new user"},500)}
    }
    if(url.pathname==="/auth/v1/logout"){
      if(failures.logout)return response({},failures.logout);
      if(user){
        await db.query("delete from auth.sessions where id=$1",[sessionId(user.id)]);
        for(const [accessToken,account] of sessions)if(account.id===user.id)sessions.delete(accessToken);
      }
      return new Response(null,{status:204});
    }
    if(url.pathname.startsWith("/rest/v1/rpc/")){
      if(url.pathname.endsWith('/rel_take_rate_limit')&&token===env.SUPABASE_SERVICE_ROLE_KEY){
        if(failures.rateLimit)return response({},failures.rateLimit);
        const body=JSON.parse(options.body);
        return response(await db.transaction(async tx=>{
          await tx.exec('set local role service_role');
          return (await tx.query('select public.rel_take_rate_limit($1,$2) as result',[body.p_action,body.p_subject_hash])).rows[0].result;
        }));
      }
      if(["rel_public_profile","rel_public_contributors"].includes(url.pathname.split('/').pop())&&token===env.SUPABASE_SERVICE_ROLE_KEY){
        if(failures.profiles)return response({},failures.profiles);
        const name=url.pathname.split('/').pop(),args=JSON.parse(options.body);
        try{return response(await db.transaction(async tx=>{
          await tx.exec("set local role service_role");
          return (await tx.query(`select public.${name}(${Object.keys(args).map((key,i)=>key+'=> $'+(i+1)).join(',')}) as result`,Object.values(args))).rows[0].result;
        }))}catch(error){return response({message:error.message,code:error.code},400)}
      }
      if(url.pathname.endsWith("/rel_signup_username_available") && token===env.SUPABASE_SERVICE_ROLE_KEY){
        if(failures.availability)return response({},failures.availability);
        return response(await db.transaction(async tx=>{
          await tx.exec("set local role service_role");
          return (await tx.query("select public.rel_signup_username_available($1) as available",[JSON.parse(options.body).p_username])).rows[0].available;
        }));
      }
      if(!user)return response({message:"REL_UNAUTHENTICATED"},401);
      try{return response(await rpc(user.id,url.pathname.split('/').pop(),JSON.parse(options.body)))}
      catch(error){return response({message:error.message,code:error.code},400)}
    }
    if(url.pathname==="/rest/v1/roblox_editor_site_data"){
      return response((await db.query("select data from public.roblox_editor_site_data")).rows);
    }
    if(url.pathname==="/rest/v1/editor_applications"&&options.method==="POST"){
      const body=JSON.parse(options.body),keys=Object.keys(body);
      await db.query(`insert into public.editor_applications(${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(body));
      return response({},201);
    }
    throw new Error("Unexpected test request "+url.pathname);
  };
  const routes={
    "/api/data":"data", "/api/save":"save", "/api/avatar":"avatar", "/api/applications":"applications", "/api/profiles":"profiles", "/api/contributors":"contributors",
    "/api/applications/admin":"applications/admin",
    "/api/applications/pending":"applications/pending",
    ...Object.fromEntries(["signin","signup","session","refresh","signout","forgot-password","reset-password","confirmation"].map(name=>["/api/auth/"+name,"auth/"+name])),
    ...Object.fromEntries(["site","profile","claim","users","username","links","contributor","contributors"].map(name=>["/api/account/"+name,"account/"+name])),
  };
  async function handle(request){
    const headers=new Headers(request.headers);
    if(!headers.has('cf-connecting-ip'))headers.set('cf-connecting-ip','192.0.2.1');
    request=new Request(request,{headers});
    Object.defineProperty(request,'cf',{value:{}});
    const route=routes[new URL(request.url).pathname];
    if(!route)return response({error:"Not found"},404);
    const mod=await import("../functions/api/"+route+".js");
    const handler=mod['onRequest'+request.method[0]+request.method.slice(1).toLowerCase()];
    if(!handler)return response({error:"Method not allowed"},405);
    return secureResponse(await middleware({request,env,next:()=>handler({request,env})}));
  }
  const {onRequest:adminGate}=await import("../functions/admin/_middleware.js");
  const handleAdmin=async(request,next)=>secureResponse(await adminGate({request,env,next}));
  return {db,rpc,handle,handleAdmin,sessions,recoveryCodes,failures,log:()=>requestLog,clearLog:()=>{requestLog=[]},close:async()=>{globalThis.fetch=originalFetch;await db.close()}};
}
