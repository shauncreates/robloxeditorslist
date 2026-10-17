import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixture, ids, sessionId } from "./auth-fixture.mjs";
import { mockService } from "./mock-service.mjs";

const setup = options => fixture({profiles:true,notifications:true,tiktok:true,youtube:true,popularity:true,...options});
const site = f => f.rpc(ids.owner,"rel_site");
const account = async (f,id=ids.stranger) => (await f.db.query("select editor_id,roles from rel_private.accounts where id=$1",[id])).rows[0];
async function setEditors(f,edit) {
  const current = await site(f);
  edit(current.data.editors);
  await f.db.query("update public.roblox_editor_site_data set data=$1 where id='site-data'",[current.data]);
}
async function connection(f,username="new_editor",id=ids.stranger) {
  await f.db.query(`insert into rel_private.tiktok_connections(user_id,open_id,username,display_name,verified_at,expires_at)
    values($1,$2,$3,'Fixture',now(),now()+interval '29 days') on conflict(user_id) do update set
    username=excluded.username,verified_at=excluded.verified_at,expires_at=excluded.expires_at`,[id,"fixture-"+id,username]);
}
const applicationData = {display_name:"Applicant",platform:"TikTok",profile_url:"https://www.tiktok.com/@new_editor",software:"CapCut",styles:["Test style"],examples_url:"https://example.test/showreel"};
const submit = (f,data=applicationData,requestId=randomUUID()) => f.rpc(ids.stranger,"rel_submit_application",{p_request_id:requestId,p_data:data});
const approve = (f,id) => f.rpc(ids.reviewer,"rel_applications",{p_action:"update",p_id:id,p_status:"approved",p_reason:"Review complete",p_message:"Accepted"});
const convert = async (f,id) => f.rpc(ids.contributor,"rel_pending_editors",{p_action:"convert",p_id:id,p_revision:(await site(f)).revision});
const match = f => f.rpc(ids.stranger,"rel_tiktok",{p_action:"match"});
const request = (f,path,user,body,extra={}) => f.handle(new Request("https://rel.example.test"+path,{
  method:body===undefined?"GET":"POST", headers:{origin:"https://rel.example.test",...(user?{cookie:"__Host-rel_access="+user}:{}),"Content-Type":"application/json",...extra},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
}));

test("migration preserves existing records and warm public RPCs resolve the new wrappers", async () => {
  const f=await setup({autoLinks:false});
  try {
    await connection(f);
    await f.rpc(ids.stranger,"rel_tiktok",{p_action:"status"});
    const legacyRequest=randomUUID();await submit(f,applicationData,legacyRequest);
    await f.rpc(ids.stranger,"rel_my_applications");
    await f.rpc(ids.reviewer,"rel_applications",{p_action:"list"});
    await f.rpc(ids.contributor,"rel_pending_editors",{p_action:"list",p_id:null,p_revision:null});
    const snapshot=async()=> (await f.db.query(`select jsonb_build_object(
      'site',(select to_jsonb(d) from public.roblox_editor_site_data d where id='site-data'),
      'accounts',(select jsonb_agg(to_jsonb(a) order by id) from rel_private.accounts a),
      'applications',(select jsonb_agg(to_jsonb(a) order by id) from public.editor_applications a),
      'connections',(select jsonb_agg(to_jsonb(c) order by user_id) from rel_private.tiktok_connections c),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from rel_private.audit a)) as state`)).rows[0].state;
    const before=await snapshot();
    await f.db.exec(await readFile(new URL("../supabase/migrations/20261017140000_rel_automatic_editor_links.sql",import.meta.url),"utf8"));
    assert.deepEqual(await snapshot(),before);
    assert.equal((await submit(f,applicationData,legacyRequest)).tiktok_check,null);
    assert.equal((await match(f)).editor_link.status,"no_match");
    assert.equal((await f.rpc(ids.stranger,"rel_my_applications")).applications[0].tiktok_check,null);
    assert.equal((await f.rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0].tiktok_check,null);
    assert.equal((await f.rpc(ids.contributor,"rel_pending_editors",{p_action:"list",p_id:null,p_revision:null})).total,0);
  } finally {await f.db.close();}
});

test("matching uses exact normalised TikTok identities and rejects deceptive or conflicting profile values", async () => {
  const f=await setup();
  try {
    for (const value of ["@FiXtUrE.Editor_1","fixture.editor_1"," https://www.TikTok.com/@Fixture.Editor_1/?lang=en "])
      assert.equal((await f.db.query("select rel_private.tiktok_username($1) as username",[value])).rows[0].username,"fixture.editor_1");
    for (const value of ["https://tiktok.com.evil.test/@fixture","https://tiktok.com@evil.test/@fixture","https://evil.test/@fixture","https://tiktok.com/@fixture/video/123","https://tiktok.com:443/@fixture","@@fixture","Display Name","fixture\nname"])
      assert.equal((await f.db.query("select rel_private.tiktok_username($1) as username",[value])).rows[0].username,null);
    assert.equal((await f.db.query("select rel_private.editor_tiktok_username($1) as username",[{tiktok:"one",links:{tiktok:"https://tiktok.com/@two"}}])).rows[0].username,null);
    await setEditors(f,editors=>{editors[1].tiktok="someone_else";editors[1].name="new_editor";editors[1].handle="@new_editor";});
    await f.db.query("update rel_private.accounts set username='new_editor' where id=$1",[ids.stranger]);
    await connection(f);
    const before=await site(f);
    assert.equal((await match(f)).editor_link.status,"no_match");
    await setEditors(f,editors=>{editors[1].tiktok="";editors[1].links={tiktok:"https://www.tiktok.com/@NEW_EDITOR/"};});
    const eligible=await site(f);
    assert.deepEqual((await match(f)).editor_link,{status:"linked",editor_id:"editor2"});
    assert.deepEqual(await account(f),{editor_id:"editor2",roles:["member"]});
    assert.equal((await match(f)).editor_link.status,"already_linked");
    assert.deepEqual(await site(f),eligible);
    assert.deepEqual(eligible.data.lists,before.data.lists);
    const audit=(await f.db.query("select * from rel_private.audit where action='auto_link_editor'")).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].actor_id,ids.stranger);assert.equal(audit[0].details.method,"tiktok_oauth");
  } finally {await f.db.close();}
});

test("OAuth confirmation links the exact editor only after confirmation and publishes its audience", async () => {
  const f=await mockService({tiktok:true});
  try {
    await setEditors(f,editors=>{editors[1].tiktok="@Fixture_Editor";});
    const before=await site(f), start=await request(f,"/api/account/tiktok/start","stranger",{});
    const state=new URL((await start.json()).url).searchParams.get("state");
    const callback=await request(f,"/api/account/tiktok/callback?state="+state+"&code=fixture-tiktok-code-"+randomUUID(),null,undefined,{cookie:"__Host-rel_tiktok_state="+state});
    assert.equal(new URL(callback.headers.get("Location")).search,"?tiktok=ready");
    assert.equal((await account(f)).editor_id,null);
    const finish=callback.headers.getSetCookie().find(c=>c.startsWith("__Host-rel_tiktok_finish=")).split(";")[0];
    const response=await request(f,"/api/account/tiktok","stranger",{action:"finish"},{cookie:"__Host-rel_access=stranger; "+finish});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).editor_link,{status:"linked",editor_id:"editor2"});
    assert.deepEqual(await account(f),{editor_id:"editor2",roles:["member"]});
    assert.deepEqual(await site(f),before);
    const popularity=await request(f,"/api/popularity?platform=tiktok");
    assert.equal(popularity.status,200);
    assert.match(await popularity.text(),/42000/);
    assert.equal((await request(f,"/api/account/tiktok","stranger",{action:"disconnect"})).status,200);
    assert.equal((await account(f)).editor_id,"editor2");
  } finally {await f.close();}
});

test("duplicate identities, claimed editors and previous Owner decisions do not change existing links", async () => {
  const f=await setup();
  try {
    await connection(f);
    await setEditors(f,editors=>{editors[0].tiktok="new_editor";editors[1].tiktok="NEW_EDITOR";});
    assert.equal((await match(f)).editor_link.status,"review_required");
    await setEditors(f,editors=>{editors[0].tiktok="";});
    await setEditors(f,editors=>{editors[1].links={tiktok:"https://tiktok.com/@different_editor"};});
    assert.equal((await match(f)).editor_link.status,"review_required");
    await setEditors(f,editors=>{editors[1].links={};});
    await f.db.query("update rel_private.accounts set editor_id='editor2' where id=$1",[ids.owner]);
    assert.equal((await match(f)).editor_link.status,"review_required");
    await f.db.query("update rel_private.accounts set editor_id=null where id=$1",[ids.owner]);
    await f.db.query("insert into rel_private.profile_claims(user_id,editor_id,message,status) values($1,'editor2','Fixture request','rejected')",[ids.stranger]);
    assert.equal((await match(f)).editor_link.status,"review_required");
    await f.db.query("update rel_private.profile_claims set status='pending',editor_id='editor1' where user_id=$1",[ids.stranger]);
    assert.equal((await match(f)).editor_link.status,"review_required");
    await f.db.query("delete from rel_private.profile_claims where user_id=$1",[ids.stranger]);
    await f.db.query("update rel_private.accounts set editor_id='editor2' where id=$1",[ids.stranger]);
    assert.deepEqual((await match(f)).editor_link,{status:"already_linked",editor_id:"editor2"});
    assert.equal((await account(f,ids.member)).editor_id,"editor1");
    assert.equal((await f.db.query("select count(*)::int n from rel_private.audit where action='auto_link_editor'")).rows[0].n,0);
  } finally {await f.db.close();}
});

test("approved matching TikTok applications link their original applicant when published and preserve rank order", async () => {
  const f=await setup();
  try {
    await connection(f);
    const requestId=randomUUID(), submitted=await submit(f,{...applicationData,profile_url:"https://www.tiktok.com/@New_Editor/?lang=en"},requestId);
    assert.equal(submitted.tiktok_check.status,"verified");
    const replay=await submit(f,applicationData,requestId);
    assert.equal(replay.replayed,true);assert.deepEqual(replay.tiktok_check,submitted.tiktok_check);
    assert.equal((await account(f)).editor_id,null);
    const reviewed=await f.rpc(ids.reviewer,"rel_applications",{p_action:"list"});
    assert.equal(reviewed.applications[0].tiktok_check.status,"verified");
    assert.doesNotMatch(JSON.stringify(reviewed),/fixture-00000000/);
    await approve(f,submitted.id);
    assert.equal((await account(f)).editor_id,null);
    const before=await site(f), result=await convert(f,submitted.id), after=await site(f);
    assert.deepEqual(result.editor_link,{status:"linked",editor_id:result.editor_id});
    assert.deepEqual(await account(f),{editor_id:result.editor_id,roles:["member"]});
    assert.equal((await account(f,ids.member)).editor_id,"editor1");
    assert.equal((await account(f,ids.contributor)).editor_id,null);
    assert.deepEqual(after.data.editors.slice(0,-1),before.data.editors);
    for (const key of Object.keys(before.data.lists)) assert.deepEqual(after.data.lists[key].slice(0,-1),before.data.lists[key]);
    const event=(await f.db.query("select * from rel_private.audit where action='auto_link_editor'")).rows[0];
    assert.equal(event.actor_id,ids.contributor);assert.equal(event.target,ids.stranger);
    assert.equal(event.details.application_id,submitted.id);assert.equal(event.details.method,"approved_application");
    const own=(await f.rpc(ids.stranger,"rel_my_applications")).applications[0];
    assert.equal(own.listed_editor_id,result.editor_id);assert.equal(own.tiktok_check.status,"verified");
  } finally {await f.db.close();}
});

test("application evidence cannot be forged and expired or changed connections require a fresh matching proof", async () => {
  for (const scenario of ["not_connected","different_profile","expired","changed"]) {
    const f=await setup();
    try {
      if (scenario!=="not_connected") await connection(f,scenario==="different_profile"?"someone_else":"new_editor");
      const app=await submit(f,{...applicationData,tiktok_check:{status:"verified"},user_id:ids.owner});
      assert.equal(app.tiktok_check.status,scenario==="not_connected"?"not_connected":scenario==="different_profile"?"different_profile":"verified");
      if (scenario==="expired") await f.db.query("update rel_private.tiktok_connections set expires_at=now()-interval '1 second' where user_id=$1",[ids.stranger]);
      if (scenario==="changed") await connection(f,"someone_else");
      await approve(f,app.id);
      const result=await convert(f,app.id);
      assert.notEqual(result.editor_link.status,"linked");
      assert.equal((await account(f)).editor_id,null);
      await connection(f);
      assert.deepEqual((await match(f)).editor_link,{status:"linked",editor_id:result.editor_id});
    } finally {await f.db.close();}
  }
});

test("an application cannot create a duplicate existing TikTok editor or publish an archived decision", async () => {
  const f=await setup();
  try {
    await connection(f);
    await setEditors(f,editors=>{editors[1].tiktok="new_editor";});
    const app=await submit(f);await approve(f,app.id);
    const before=await site(f);
    await assert.rejects(convert(f,app.id),/REL_EDITOR_ALREADY_LISTED/);
    assert.deepEqual(await site(f),before);
    await f.rpc(ids.owner,"rel_applications",{p_action:"archive",p_id:app.id});
    await assert.rejects(convert(f,app.id),/REL_APPLICATION_ARCHIVED/);
    assert.equal((await f.db.query("select listed_editor_id from public.editor_applications where id=$1",[app.id])).rows[0].listed_editor_id,null);
  } finally {await f.db.close();}
});

test("automatic matching is an authenticated same-origin POST and cannot nominate another account or consume flow cookies", async () => {
  const f=await mockService({tiktok:true});
  try {
    await connection(f);
    await setEditors(f,editors=>{editors[1].tiktok="new_editor";});
    assert.equal((await request(f,"/api/account/tiktok","stranger")).status,200);
    assert.equal((await account(f)).editor_id,null);
    assert.equal((await request(f,"/api/account/tiktok",null,{action:"match"})).status,401);
    assert.equal((await request(f,"/api/account/tiktok","stranger",{action:"match"},{origin:"https://evil.test"})).status,403);
    const response=await request(f,"/api/account/tiktok","stranger",{action:"match",userId:ids.owner,editorId:"editor1"});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).editor_link,{status:"linked",editor_id:"editor2"});
    assert.deepEqual(response.headers.getSetCookie(),[]);
    assert.equal((await account(f,ids.owner)).editor_id,null);
    assert.equal((await account(f,ids.member)).editor_id,"editor1");
  } finally {await f.close();}
});

test("private linking and evidence cannot be invoked or read directly and revoked sessions cannot match", async () => {
  const f=await setup();
  try {
    await connection(f);
    await setEditors(f,editors=>{editors[1].tiktok="new_editor";});
    for (const sql of ["select rel_private.match_tiktok_editor($1)","select rel_private.application_tiktok_check($1)","select rel_private.submit_application_before_editor_links($1,'{}')"])
      await assert.rejects(f.asUser(ids.stranger,sql,[ids.stranger]),/permission denied/);
    await assert.rejects(f.asUser(ids.stranger,"select * from rel_private.application_identity_checks"),/permission denied/);
    await f.db.query("delete from auth.sessions where id=$1",[sessionId(ids.stranger)]);
    await assert.rejects(match(f),/REL_UNAUTHENTICATED/);
    assert.equal((await account(f)).editor_id,null);
  } finally {await f.db.close();}
});
