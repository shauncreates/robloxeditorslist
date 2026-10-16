import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

export const ids = {
  member:"00000000-0000-4000-8000-000000000001", contributor:"00000000-0000-4000-8000-000000000002",
  reviewer:"00000000-0000-4000-8000-000000000003", owner:"00000000-0000-4000-8000-000000000004",
  stranger:"00000000-0000-4000-8000-000000000005",
};
export const sessionId = id => id.replace("00000000-0000", "11111111-1111");
export const rankings = {
  site:{title:"Test list"}, styles:[{id:"style",name:"Test style",color:"#123456"}],
  editors:[{id:"editor1",name:"One",flares:["style"],note:"Original"},{id:"editor2",name:"Two",flares:[],note:"Original two"}],
  lists:{main:["editor2","editor1"],style:["editor1"]},
};
export async function fixture({reviews=true,decisions=reviews,usernames=decisions,profiles=false,tiers=profiles,requestLimits=true,legacyApplications=false}={}){
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz,raw_user_meta_data jsonb);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.jwt(),auth.uid() to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  `);
  for(const file of ["supabase/migrations/202610130001_roblox_editors.sql","supabase/migrations/202610130002_editor_applications.sql","supabase/auth-roles.sql",...(reviews?["supabase/migrations/20261014201617_rel_application_reviews.sql"]:[]),...(decisions?["supabase/migrations/20261014232150_rel_review_locks_and_usernames.sql"]:[])]){
    try {
      if(legacyApplications && file.endsWith("202610130002_editor_applications.sql")){
        await db.exec(`
          create table public.editor_applications (
            id uuid primary key default gen_random_uuid(),
            display_name text not null check (char_length(display_name) between 1 and 60),
            main_platform text not null check (main_platform in ('TikTok','YouTube')),
            main_platform_url text not null check (char_length(main_platform_url) between 1 and 500),
            software text not null check (char_length(software) between 1 and 200),
            editing_styles text[] not null default '{}'::text[],
            examples_url text check (examples_url is null or char_length(examples_url) <= 1000),
            status text not null default 'pending' check (status in ('pending','approved','rejected')),
            created_at timestamptz not null default now()
          );
          alter table public.editor_applications enable row level security;
        `);
      }else await db.exec(await readFile(new URL("../"+file,import.meta.url),"utf8"));
    }
    catch(error) { await db.close(); throw new Error(file+": "+error.message+" at "+error.position); }
  }
  // Fixture data only; no production URL, credentials, data.js or remote database.
  await db.query("insert into public.roblox_editor_site_data(id,data) values ('site-data',$1)",[rankings]);
  for(const [name,id] of Object.entries(ids)){
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),$3)",[id,name+"@example.test",{roles:["owner"],editor_id:"editor2"}]);
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2)",[sessionId(id),id]);
    if(decisions)await db.query("update rel_private.accounts set username=$1 where id=$2",[name,id]);
  }
  await db.query("update rel_private.accounts set roles=$1 where id=$2",[["member","owner"],ids.owner]);
  await db.query("update rel_private.accounts set roles=$1 where id=$2",[["member","list_contributor"],ids.contributor]);
  await db.query("update rel_private.accounts set roles=$1 where id=$2",[["member","application_reviewer"],ids.reviewer]);
  await db.query("update rel_private.accounts set editor_id='editor1' where id=$1",[ids.member]);
  if(usernames)await db.exec(await readFile(new URL("../supabase/migrations/20261015001034_rel_signup_usernames.sql",import.meta.url),"utf8"));
  if(profiles)await db.exec(await readFile(new URL("../supabase/migrations/20261015110000_rel_public_profiles.sql",import.meta.url),"utf8"));
  if(tiers)await db.exec(await readFile(new URL("../supabase/migrations/20261015130000_rel_contributor_tiers.sql",import.meta.url),"utf8"));
  if(requestLimits)await db.exec(await readFile(new URL("../supabase/migrations/20261015230000_rel_request_limits.sql",import.meta.url),"utf8"));
  const asUser = (id,sql,args=[])=>db.transaction(async tx=>{
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,session_id:sessionId(id),role:"authenticated"})]);
    return tx.query(sql,args);
  });
  const rpc = async (id,name,args={})=>{
    const keys=Object.keys(args);
    const result=await asUser(id,`select public.${name}(${keys.map((key,i)=>key+'=> $'+(i+1)).join(',')}) as result`,Object.values(args));
    return result.rows[0].result;
  };
  return {db,asUser,rpc};
}
