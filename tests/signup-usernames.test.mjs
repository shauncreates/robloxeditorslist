import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {fixture,ids,sessionId} from "./auth-fixture.mjs";
import {mockService} from "./mock-service.mjs";

const migration = new URL("../supabase/migrations/20261015001034_rel_signup_usernames.sql",import.meta.url);
const insertUser = (db,metadata,id=randomUUID()) => db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),$3) returning id",[id,id+"@example.test",metadata]);
const signupRequest = (service,body) => service.handle(new Request("https://rel.example.test/api/auth/signup",{
  method:"POST",headers:{origin:"https://rel.example.test","Content-Type":"application/json"},body:JSON.stringify({email:"new@example.test",password:"SignupTest123",...body}),
}));

test("username migration preserves existing accounts, submissions and rankings",async()=>{
  const {db,rpc}=await fixture({usernames:false});
  try{
    await rpc(ids.member,"rel_username",{p_username:"existing_member"});
    await rpc(ids.stranger,"rel_claim",{p_editor_id:"editor2",p_message:"Existing claim"});
    await db.exec("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url) values ('Existing','YouTube','https://youtube.com/@existing','CapCut',array['Test style'],'https://example.test')");
    const site=await rpc(ids.owner,"rel_site");
    const before=(await db.query("select to_jsonb(a) as account from rel_private.accounts a order by id")).rows;
    const applications=(await db.query("select to_jsonb(a) as application from public.editor_applications a")).rows;
    const claims=(await db.query("select to_jsonb(c) as claim from rel_private.profile_claims c")).rows;
    await db.exec(await readFile(migration,"utf8"));
    const after=(await db.query("select to_jsonb(a) as account from rel_private.accounts a order by id")).rows;
    after.forEach((row,index)=>{
      assert.equal(row.account.username_changed_at,null);
      delete row.account.username_changed_at;assert.deepEqual(row,before[index]);
    });
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
    assert.deepEqual((await db.query("select to_jsonb(a) as application from public.editor_applications a")).rows,applications);
    assert.deepEqual((await db.query("select to_jsonb(c) as claim from rel_private.profile_claims c")).rows,claims);
    assert.equal((await rpc(ids.member,"rel_context")).username_next_change_at,null);
  }finally{await db.close()}
});

test("signup requires a unique chosen username and ignores metadata permissions",async()=>{
  const {db,asUser,rpc}=await fixture();
  try{
    for(const username of [undefined,null,"",123,"ab","a".repeat(41),"person@email.test","_name","bad name"]){
      await assert.rejects(insertUser(db,{username,roles:["owner"]}),/REL_INVALID_USERNAME/);
    }
    const id=randomUUID();
    await insertUser(db,{username:"Chosen_Name",roles:["owner"],editor_id:"editor2",username_changed_at:"2000-01-01"},id);
    const account=(await db.query("select * from rel_private.accounts where id=$1",[id])).rows[0];
    assert.equal(account.username,"chosen_name");assert.deepEqual(account.roles,["member"]);
    assert.equal(account.editor_id,null);assert.ok(account.username_changed_at);
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2)",[sessionId(id),id]);
    await assert.rejects(rpc(id,"rel_username",{p_username:"changed_at_signup"}),/REL_USERNAME_COOLDOWN/);
    const outcomes=await Promise.allSettled([insertUser(db,{username:"same_name"}),insertUser(db,{username:"Same_Name"})]);
    assert.equal(outcomes.filter(outcome=>outcome.status==="fulfilled").length,1);
    assert.match(outcomes.find(outcome=>outcome.status==="rejected").reason.message,/REL_USERNAME_TAKEN/);
    assert.equal((await db.query("select count(*)::int as n from auth.users")).rows[0].n,7);
    await assert.rejects(asUser(ids.member,"select public.rel_signup_username_available('chosen_name')"),/permission denied/);
    await assert.rejects(db.transaction(async tx=>{
      await tx.exec("set local role anon");
      await tx.query("select public.rel_signup_username_available('chosen_name')");
    }),/permission denied/);
  }finally{await db.close()}
});

test("username changes enforce seven days atomically, including Owners and metadata edits",async()=>{
  const {db,rpc}=await fixture();
  try{
    const site=await rpc(ids.owner,"rel_site");
    const first=await rpc(ids.member,"rel_username",{p_username:"My_Name"});
    assert.equal(first.username,"my_name");assert.ok(first.username_next_change_at);
    const unchanged=await rpc(ids.member,"rel_username",{p_username:"MY_NAME"});
    assert.deepEqual(unchanged,first);
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2",[{username:"bypass",roles:["owner"],username_changed_at:"2000-01-01"},ids.member]);
    await assert.rejects(rpc(ids.member,"rel_username",{p_username:"bypass"}),/REL_USERNAME_COOLDOWN/);
    assert.equal((await rpc(ids.member,"rel_context")).username,"my_name");
    const owner=await rpc(ids.owner,"rel_username",{p_username:"owner_name"});
    await assert.rejects(rpc(ids.owner,"rel_username",{p_username:"owner_again"}),/REL_USERNAME_COOLDOWN/);
    assert.ok(owner.username_next_change_at);
    await db.query("update rel_private.accounts set username_changed_at=now()-interval '168 hours'+interval '1 hour' where id=$1",[ids.member]);
    await assert.rejects(rpc(ids.member,"rel_username",{p_username:"too_soon"}),/REL_USERNAME_COOLDOWN/);
    await db.query("update rel_private.accounts set username_changed_at=now()-interval '168 hours' where id=$1",[ids.member]);
    await db.transaction(async tx=>{
      await tx.query("update rel_private.accounts set username_changed_at=now()-interval '168 hours' where id=$1",[ids.stranger]);
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.stranger,session_id:sessionId(ids.stranger),role:"authenticated"})]);
      assert.equal((await tx.query("select public.rel_username('exact_boundary') as changed")).rows[0].changed.username,"exact_boundary");
    });
    const outcomes=await Promise.allSettled([rpc(ids.member,"rel_username",{p_username:"next_one"}),rpc(ids.member,"rel_username",{p_username:"next_two"})]);
    assert.equal(outcomes.filter(outcome=>outcome.status==="fulfilled").length,1);
    assert.match(outcomes.find(outcome=>outcome.status==="rejected").reason.message,/REL_USERNAME_COOLDOWN/);
    assert.equal((await db.query("select count(*)::int as n from rel_private.audit where action='change_username' and actor_id=$1",[ids.member])).rows[0].n,2);
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
    assert.deepEqual((await rpc(ids.member,"rel_context")).roles,["member"]);
    assert.equal((await rpc(ids.member,"rel_context")).editor_id,"editor1");
  }finally{await db.close()}
});

test("signup and username APIs reject invalid, taken and early changes without bypasses",async()=>{
  const service=await mockService();
  try{
    for(const username of [undefined,"",123,"ab","person@email.test","_wrong"]){
      service.clearLog();assert.equal((await signupRequest(service,{username})).status,400);
      assert.equal(service.log().length,0);
    }
    assert.equal((await signupRequest(service,{username:"OWNER"})).status,409);
    const created=await signupRequest(service,{username:"Chosen_Name",roles:["owner"],data:{username:"owner",roles:["owner"]}});
    assert.equal(created.status,201);assert.equal(created.headers.getSetCookie().length,0);
    const account=(await service.db.query("select * from rel_private.accounts where username='chosen_name'")).rows[0];
    assert.deepEqual(account.roles,["member"]);
    assert.equal(account.editor_id,null);
    const change=new Request("https://rel.example.test/api/account/username",{method:"POST",headers:{origin:"https://rel.example.test","Content-Type":"application/json",cookie:"__Host-rel_access=member"},body:JSON.stringify({username:"new_member"})});
    assert.equal((await service.handle(change)).status,200);
    const early=new Request(change.url,{method:"POST",headers:change.headers,body:JSON.stringify({username:"second_name",username_changed_at:"2000-01-01",userId:ids.owner})});
    const rejected=await service.handle(early);
    assert.equal(rejected.status,409);assert.match((await rejected.json()).error,/every 7 days/);
    service.failures.availability=503;service.clearLog();
    assert.equal((await signupRequest(service,{username:"available_name"})).status,503);
    assert.equal(service.log().some(entry=>entry.path==="/auth/v1/signup"),false);
    delete service.failures.availability;service.failures.signup=429;
    assert.equal((await signupRequest(service,{username:"available_name"})).status,429);
  }finally{await service.close()}
});
