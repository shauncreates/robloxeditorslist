import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fixture,ids} from "./auth-fixture.mjs";
import {mockService} from "./mock-service.mjs";

const insertApplication=async db=>(await db.query("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url) values ('Applicant','YouTube','https://youtube.com/@fixture','CapCut',array['Test style'],'https://example.test') returning id")).rows[0].id;
const decide=(id,status="approved",reason="Examples meet the criteria.")=>({p_action:"update",p_id:id,p_status:status,p_offset:0,p_reason:reason});

test("review-lock migration preserves existing submissions, links, roles and ranking data",async()=>{
  const {db,rpc}=await fixture({decisions:false});
  try{
    const id=await insertApplication(db);await rpc(ids.reviewer,"rel_applications",decide(id));
    await rpc(ids.stranger,"rel_claim",{p_editor_id:"editor2",p_message:"Existing verification details"});
    const before=(await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0];
    const site=await rpc(ids.owner,"rel_site"),account=await rpc(ids.owner,"rel_context");
    const claims=(await db.query("select to_jsonb(c) as record from rel_private.profile_claims c")).rows;
    await db.exec(await readFile(new URL("../supabase/migrations/20261014232150_rel_review_locks_and_usernames.sql",import.meta.url),"utf8"));
    const after=(await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0];
    for(const key of Object.keys(before))assert.deepEqual(after[key],before[key]);
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
    const updated=await rpc(ids.owner,"rel_context");
    for(const key of Object.keys(account))assert.deepEqual(updated[key],account[key]);
    assert.match(updated.username,/^member-[a-f0-9]{32}$/);
    assert.deepEqual((await db.query("select to_jsonb(c) as record from rel_private.profile_claims c")).rows,claims);
    assert.equal((await db.query("select count(*)::int as n from rel_private.application_decisions")).rows[0].n,0);
    await assert.rejects(rpc(ids.owner,"rel_applications",decide(id,"rejected","Changed opinion")),/REL_APPLICATION_LOCKED/);
  }finally{await db.close()}
});

test("decisions are final, reasoned and attributed from the account with stable username history",async()=>{
  const {db,rpc,asUser}=await fixture();
  try{
    const site=await rpc(ids.owner,"rel_site"),id=await insertApplication(db);
    for(const role of [ids.member,ids.contributor])await assert.rejects(rpc(role,"rel_applications",decide(id)),/REL_FORBIDDEN/);
    for(const reason of [null,"   ","\t\n","x".repeat(1001)])await assert.rejects(rpc(ids.reviewer,"rel_applications",decide(id,"approved",reason)),/REL_REASON_REQUIRED/);
    await assert.rejects(rpc(ids.reviewer,"rel_applications",{p_action:"update",p_id:id,p_status:"approved"}),/REL_REASON_REQUIRED/);
    await rpc(ids.reviewer,"rel_username",{p_username:"Review_Name"});
    const result=await rpc(ids.reviewer,"rel_applications",decide(id));
    assert.equal(result.application.reviewed_by,ids.reviewer);assert.equal(result.application.reviewer_username,"review_name");
    assert.equal(result.application.review_reason,"Examples meet the criteria.");assert.ok(result.application.reviewed_at);
    for(const status of ["approved","rejected","pending"])for(const role of [ids.reviewer,ids.owner])await assert.rejects(rpc(role,"rel_applications",decide(id,status,"Replacement reason")),/REL_APPLICATION_LOCKED/);
    await assert.rejects(db.query("update public.editor_applications set notes='Changed submission' where id=$1",[id]),/REL_APPLICATION_LOCKED/);
    await assert.rejects(db.query("update public.editor_applications set review_reason='Replacement' where id=$1",[id]),/REL_APPLICATION_LOCKED/);
    await assert.rejects(db.query("delete from public.editor_applications where id=$1",[id]),/REL_APPLICATION_LOCKED/);
    await assert.rejects(asUser(ids.reviewer,"select * from rel_private.application_decisions"),/permission denied/);
    await db.query("update rel_private.accounts set username_changed_at=now()-interval '168 hours' where id=$1",[ids.reviewer]);
    await rpc(ids.reviewer,"rel_username",{p_username:"renamed_reviewer"});
    const history=(await db.query("select * from rel_private.application_decisions where application_id=$1",[id])).rows[0];
    assert.equal(history.reviewer_username,"review_name");assert.equal(history.reviewer_id,ids.reviewer);
    assert.equal(history.reason,result.application.review_reason);
    assert.equal(new Date(history.decided_at).getTime(),new Date(result.application.reviewed_at).getTime());
    assert.equal((await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0].reviewer_display,"review_name");
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
    await db.query("delete from auth.sessions where user_id=$1",[ids.reviewer]);
    await db.query("delete from auth.users where id=$1",[ids.reviewer]);
    const deleted=(await rpc(ids.owner,"rel_applications",{p_action:"list"})).applications[0];
    assert.equal(deleted.reviewed_by,null);assert.equal(deleted.reviewer_username,"review_name");
  }finally{await db.close()}
});

test("two competing decisions produce one journal entry and no ranking writes",async()=>{
  const {db,rpc}=await fixture();
  try{
    const site=await rpc(ids.owner,"rel_site"),id=await insertApplication(db);
    const outcomes=await Promise.allSettled([rpc(ids.reviewer,"rel_applications",decide(id)),rpc(ids.owner,"rel_applications",decide(id,"rejected","Different criteria."))]);
    assert.equal(outcomes.filter(result=>result.status==="fulfilled").length,1);
    assert.match(outcomes.find(result=>result.status==="rejected").reason.message,/REL_APPLICATION_LOCKED/);
    assert.equal((await db.query("select count(*)::int as n from rel_private.application_decisions")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from rel_private.audit where action='review_application'")).rows[0].n,1);
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
  }finally{await db.close()}
});

test("Owner link queue lists requests independently of user pagination and hides account emails",async()=>{
  const {db,rpc}=await fixture();
  try{
    const site=await rpc(ids.owner,"rel_site");
    await db.query("update rel_private.accounts set created_at=now()-interval '2 days' where id=$1",[ids.stranger]);
    await db.exec("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) select gen_random_uuid(),'new-'||n::text||'@example.test',now(),jsonb_build_object('username','new_member_'||n::text) from generate_series(1,51) n");
    await rpc(ids.stranger,"rel_claim",{p_editor_id:"editor2",p_message:"Verify through the listed account"});
    const users=await rpc(ids.owner,"rel_users",{p_action:"list"});
    assert.equal(users.users.some(user=>user.id===ids.stranger),false);
    assert.ok(!JSON.stringify(users).includes("@example.test"));
    const args={p_status:"pending",p_offset:0};
    for(const role of [ids.member,ids.reviewer,ids.contributor])await assert.rejects(rpc(role,"rel_profile_links",args),/REL_FORBIDDEN/);
    const links=await rpc(ids.owner,"rel_profile_links",args);
    assert.equal(links.total,1);assert.equal(links.claims[0].username,"stranger");
    assert.equal(links.claims[0].editor_id,"editor2");assert.ok(!JSON.stringify(links).includes("@example.test"));
    await rpc(ids.owner,"rel_users",{p_action:"approve_claim",p_user_id:ids.stranger});
    assert.equal((await rpc(ids.stranger,"rel_context")).editor_id,"editor2");
    assert.equal((await rpc(ids.owner,"rel_profile_links",args)).total,0);
    const reviewed=await rpc(ids.owner,"rel_profile_links",{...args,p_status:"approved"});
    assert.equal(reviewed.claims[0].reviewer_username,"owner");
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
  }finally{await db.close()}
});

test("username and link APIs enforce ownership, roles, uniqueness and private review attribution",async()=>{
  const service=await mockService();
  const request=(path,token,body)=>service.handle(new Request("https://rel.example.test"+path,{method:body===undefined?"GET":"POST",headers:{origin:"https://rel.example.test","Content-Type":"application/json",...(token?{cookie:"__Host-rel_access="+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
  try{
    const before=await service.rpc(ids.member,"rel_context");
    assert.equal((await request("/api/account/username",null,{username:"new_name"})).status,401);
    assert.equal((await request("/api/account/username","member",{username:"owner"})).status,409);
    assert.equal((await request("/api/account/username","member",{username:"my@email.test"})).status,400);
    const changed=await request("/api/account/username","member",{username:"My_Name",userId:ids.owner,roles:["owner"]});
    assert.equal(changed.status,200);assert.equal((await changed.json()).username,"my_name");
    assert.deepEqual((await service.rpc(ids.member,"rel_context")).roles,before.roles);
    assert.equal((await service.rpc(ids.owner,"rel_context")).username,"owner");
    for(const role of [null,"member","reviewer","contributor"])assert.equal((await request("/api/account/links",role)).status,role?403:401);
    assert.equal((await request("/api/account/links","owner")).status,200);
    const id=await insertApplication(service.db);
    const body={action:"update",id,status:"rejected",reason:"Missing examples.",message:"Please share a public showreel with more examples.",reviewed_by:ids.owner,reviewer_username:"owner"};
    assert.equal((await request("/api/applications/admin","reviewer",{...body,reason:""})).status,400);
    const result=await request("/api/applications/admin","reviewer",body);
    assert.equal(result.status,200);assert.equal((await result.json()).application.reviewer_username,"reviewer");
    assert.equal((await request("/api/applications/admin","owner",{...body,status:"approved"})).status,409);
    assert.equal((await request("/api/applications/admin","owner",{...body,status:"pending"})).status,400);
    const listed=await (await request("/api/applications/admin","owner",{action:"list_reviewed"})).json();
    assert.ok(!JSON.stringify(listed).includes("@example.test"));
  }finally{await service.close()}
});
