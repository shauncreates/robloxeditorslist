import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, ids, rankings, sessionId } from "./auth-fixture.mjs";

test("database enforces roles, ownership, active sessions and ranking integrity",async()=>{
  const {db,rpc,asUser}=await fixture();
  try {
    const site=()=>rpc(ids.owner,"rel_site");
    const first=await site();
    const account=await rpc(ids.stranger,"rel_context");
    assert.deepEqual(account.roles,["member"]);assert.equal(account.editor_id,null);
    await assert.rejects(asUser(ids.member,"update rel_private.accounts set roles=array['member','owner'] where id=$1",[ids.member]),/permission denied/);
    await assert.rejects(asUser(ids.owner,"update public.roblox_editor_site_data set data='{}'::jsonb"),/permission denied/);
    await assert.rejects(asUser(ids.reviewer,"select * from public.editor_applications"),/permission denied/);
    await assert.rejects(rpc(ids.member,"rel_users",{p_action:"list"}),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.member,"rel_applications",{p_action:"list"}),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.reviewer,"rel_save_site",{p_revision:first.revision,p_data:rankings}),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.member,"rel_save_site",{p_revision:first.revision,p_data:rankings}),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.member,"rel_save_site",{p_revision:first.revision,p_data:null,p_profile:{id:"editor2",name:"Stolen"}}),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.member,"rel_save_site",{p_revision:first.revision,p_data:null,p_profile:{flares:[]}}),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.member,"rel_save_site",{p_revision:first.revision,p_data:null,p_profile:{links:{youtube:"javascript:alert(1)"}}}),/REL_FORBIDDEN/);
    const own=await rpc(ids.member,"rel_save_site",{p_revision:first.revision,p_data:null,p_profile:{name:"Updated",software:"After Effects, Blender"}});
    const after=await site();
    assert.equal(after.data.editors[0].software,"After Effects, Blender");
    assert.deepEqual(after.data.lists,rankings.lists);assert.deepEqual(after.data.styles,rankings.styles);
    assert.deepEqual(after.data.editors[1],rankings.editors[1]);assert.deepEqual(after.data.editors[0].flares,["style"]);
    assert.deepEqual((await db.query("select data from rel_private.data_history where revision=$1",[first.revision])).rows[0].data,rankings);
    await assert.rejects(rpc(ids.contributor,"rel_save_site",{p_revision:first.revision,p_data:rankings}),/REL_CONFLICT/);
    const changed=structuredClone(after.data);changed.lists.main.reverse();
    const saved=await rpc(ids.contributor,"rel_save_site",{p_revision:own.revision,p_data:changed});
    const settings=structuredClone(changed);settings.site.title="Unauthorized";
    await assert.rejects(rpc(ids.contributor,"rel_save_site",{p_revision:saved.revision,p_data:settings}),/REL_FORBIDDEN/);
    const empty=structuredClone(changed);empty.editors=[];
    await assert.rejects(rpc(ids.owner,"rel_save_site",{p_revision:saved.revision,p_data:empty}),/REL_INVALID/);
    const broken=structuredClone(changed);broken.lists.main=["unknown"];
    await assert.rejects(rpc(ids.owner,"rel_save_site",{p_revision:saved.revision,p_data:broken}),/REL_INVALID/);
    const duplicate=structuredClone(changed);duplicate.editors[1].id=duplicate.editors[0].id;
    await assert.rejects(rpc(ids.owner,"rel_save_site",{p_revision:saved.revision,p_data:duplicate}),/REL_INVALID/);
    const deleted=structuredClone(changed);deleted.editors.splice(0,1);deleted.lists={main:["editor2"]};
    await assert.rejects(rpc(ids.owner,"rel_save_site",{p_revision:saved.revision,p_data:deleted}),/REL_INVALID/);
    await assert.rejects(rpc(ids.owner,"rel_users",{p_action:"update",p_user_id:ids.owner,p_roles:["member"]}),/REL_LAST_OWNER/);
    await assert.rejects(rpc(ids.owner,"rel_users",{p_action:"update",p_user_id:ids.owner,p_roles:["member","owner"],p_disabled:true}),/REL_LAST_OWNER/);
    await rpc(ids.stranger,"rel_claim",{p_editor_id:"editor2",p_message:"Verify my listed social account."});
    assert.equal((await rpc(ids.stranger,"rel_context")).editor_id,null);
    await assert.rejects(rpc(ids.reviewer,"rel_users",{p_action:"approve_claim",p_user_id:ids.stranger}),/REL_FORBIDDEN/);
    await rpc(ids.owner,"rel_users",{p_action:"approve_claim",p_user_id:ids.stranger});
    assert.equal((await rpc(ids.stranger,"rel_context")).editor_id,"editor2");
    await rpc(ids.owner,"rel_users",{p_action:"update",p_user_id:ids.contributor,p_roles:["member"]});
    await assert.rejects(rpc(ids.contributor,"rel_save_site",{p_revision:saved.revision,p_data:changed}),/REL_FORBIDDEN/);
    await rpc(ids.owner,"rel_users",{p_action:"update",p_user_id:ids.member,p_roles:["member"],p_editor_id:"editor1",p_disabled:true});
    await assert.rejects(rpc(ids.member,"rel_context"),/REL_FORBIDDEN/);
    await db.query("delete from auth.sessions where id=$1",[sessionId(ids.stranger)]);
    await assert.rejects(rpc(ids.stranger,"rel_context"),/REL_UNAUTHENTICATED/);
    await db.query("update auth.sessions set not_after=now()-interval '1 minute' where user_id=$1",[ids.reviewer]);
    await assert.rejects(rpc(ids.reviewer,"rel_context"),/REL_UNAUTHENTICATED/);
    // Even accidental future SELECT grants remain covered by the existing RLS.
    await db.exec("grant select on public.editor_applications,public.roblox_editor_site_data to anon");
    await db.transaction(async tx=>{
      await tx.exec("set local role anon");
      assert.equal((await tx.query("select * from public.editor_applications")).rows.length,0);
      assert.equal((await tx.query("select * from public.roblox_editor_site_data")).rows.length,0);
    });
    await assert.rejects(db.transaction(async tx=>{await tx.exec("set local role anon");return tx.query("select public.rel_context()");}),/permission denied/);
    const current=await site();
    await db.exec("delete from public.roblox_editor_site_data");
    await assert.rejects(rpc(ids.owner,"rel_save_site",{p_revision:current.revision,p_data:rankings}),/REL_MISSING_DATA/);
    assert.equal((await db.query("select count(*)::int as n from public.roblox_editor_site_data")).rows[0].n,0);
  } finally { await db.close(); }
});

test("application approval changes only application status and records the reviewer",async()=>{
  const {db,rpc}=await fixture();
  try{
    const before=await rpc(ids.owner,"rel_site");
    const {rows}=await db.query("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url) values ('Applicant','YouTube','https://youtube.com/@test','Blender',array['Velocity'],'https://example.test') returning id");
    await rpc(ids.reviewer,"rel_applications",{p_action:"update",p_id:rows[0].id,p_status:"approved",p_offset:0,p_reason:"Examples meet the criteria."});
    const apps=await rpc(ids.reviewer,"rel_applications",{p_action:"list"});
    assert.equal(apps.applications[0].status,"approved");assert.ok(apps.applications[0].reviewed_at);
    assert.deepEqual(await rpc(ids.owner,"rel_site"),before);
    assert.equal((await db.query("select actor_id from rel_private.audit where action='review_application'")).rows[0].actor_id,ids.reviewer);
    await assert.rejects(rpc(ids.reviewer,"rel_applications",{p_action:"update",p_id:ids.owner,p_status:"approved"}),/REL_NOT_FOUND/);
  }finally{await db.close();}
});
