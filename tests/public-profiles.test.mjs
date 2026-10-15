import test from "node:test";
import assert from "node:assert/strict";
import { mockService } from "./mock-service.mjs";
import { ids, rankings } from "./auth-fixture.mjs";

const origin = "https://rel.example.test";
const request = (path, user, body) => new Request(origin + path, {
  method:body ? "POST" : "GET", headers:{Origin:origin,...(user ? {Cookie:"__Host-rel_access=" + user} : {}),...(body ? {"Content-Type":"application/json"} : {})},
  ...(body ? {body:JSON.stringify(body)} : {}),
});

test("public profiles join only verified identities and preserve rankings", async () => {
  const service = await mockService();
  try {
    const get = async path => {
      const response = await service.handle(request(path));assert.equal(response.status,200);
      return response.json();
    };
    const member = await get("/api/profiles?account=" + ids.member);
    assert.deepEqual(member.account,{id:ids.member,username:"member"});
    assert.equal(member.editor.id,"editor1");
    assert.deepEqual(member.placements,[{key:"main",name:"Overall",rank:2},{key:"style",name:"Test style",rank:1}]);
    assert.deepEqual(member.styles,[{id:"style",name:"Test style"}]);
    assert.deepEqual(await get("/api/profiles?editor=editor1"),member);
    const unranked = await get("/api/profiles?account=" + ids.stranger);
    assert.equal(unranked.editor,null);assert.deepEqual(unranked.placements,[]);
    const editor = await get("/api/profiles?editor=editor2");assert.equal(editor.account,null);assert.equal(editor.editor.name,"Two");
    const unlinked = await get("/api/profiles?contributor=seeshaun");
    assert.equal(unlinked.account,null);assert.equal(unlinked.credits[0].name,"@seeshaun");
    assert.equal((await get("/api/contributors")).length,4);
    for (const user of [undefined,"member","contributor","reviewer"]) {
      assert.equal((await service.handle(request("/api/account/contributor",user,{userId:ids.member,credit:"seeshaun"}))).status,user?403:401);
      await assert.rejects(service.rpc(ids[user] || ids.member,"rel_contributor_link",{p_user_id:ids.member,p_credit:"seeshaun"}),/REL_FORBIDDEN/);
    }
    const before = (await service.db.query("select data,revision from public.roblox_editor_site_data")).rows[0];
    const accountsBefore = (await service.db.query("select * from rel_private.accounts order by id")).rows;
    assert.equal((await service.handle(request("/api/account/contributor","owner",{userId:ids.member,credit:"seeshaun"}))).status,200);
    const linked = await get("/api/profiles?contributor=seeshaun");
    assert.deepEqual(linked.account,member.account);assert.equal(linked.editor.id,"editor1");assert.equal(linked.credits[0].contribution,"Website owner.");
    await service.rpc(ids.owner,"rel_contributor_link",{p_user_id:ids.stranger,p_credit:"seeshaun"});
    assert.equal((await get("/api/profiles?contributor=seeshaun")).account.id,ids.stranger);
    assert.deepEqual((await get("/api/profiles?account="+ids.member)).credits,[]);
    await service.rpc(ids.owner,"rel_contributor_link",{p_user_id:ids.stranger,p_credit:"balloond"});
    assert.equal((await get("/api/profiles?contributor=seeshaun")).account,null);
    await service.rpc(ids.owner,"rel_contributor_link",{p_user_id:ids.stranger,p_credit:null});
    assert.equal((await get("/api/profiles?contributor=balloond")).account,null);
    await assert.rejects(service.rpc(ids.owner,"rel_contributor_link",{p_user_id:ids.member,p_credit:"fake"}),/REL_INVALID/);
    assert.deepEqual((await service.db.query("select data,revision from public.roblox_editor_site_data")).rows[0],before);
    assert.deepEqual(before.data,rankings);
    assert.deepEqual((await service.db.query("select * from rel_private.accounts order by id")).rows,accountsBefore);
    const audit = (await service.db.query("select actor_id,action,details from rel_private.audit order by id desc limit 1")).rows[0];
    assert.equal(audit.actor_id,ids.owner);assert.equal(audit.action,"link_contributor");assert.equal(audit.details.actor_username,"owner");
    await service.rpc(ids.member,"rel_username",{p_username:"renamed-member"});
    assert.equal((await get("/api/profiles?account="+ids.member)).account.username,"renamed-member");
  } finally { await service.close(); }
});

test("public profiles hide private fields, inactive accounts and unverified claims", async () => {
  const service = await mockService();
  try {
    await service.rpc(ids.stranger,"rel_claim",{p_editor_id:"editor2",p_message:"Private verification details"});
    await service.rpc(ids.owner,"rel_contributor_link",{p_user_id:ids.member,p_credit:"seeshaun"});
    let response = await service.handle(request("/api/profiles?account="+ids.stranger));
    const profile = await response.json();assert.equal(profile.editor,null);
    assert.doesNotMatch(JSON.stringify(profile),/email|roles|claim|verification|disabled|session|application|@example.test/);
    for (const sql of ["update rel_private.accounts set disabled=true", "update auth.users set email_confirmed_at=null", "update auth.users set banned_until=now()+interval '1 day'", "update auth.users set is_anonymous=true"]) {
      await service.db.query(sql + " where id=$1",[ids.member]);
      assert.equal((await service.handle(request("/api/profiles?account="+ids.member))).status,404);
      response = await service.handle(request("/api/profiles?editor=editor1"));
      const editor = await response.json();assert.equal(editor.account,null);assert.equal(editor.editor.name,"One");
      response = await service.handle(request("/api/profiles?contributor=seeshaun"));assert.equal((await response.json()).account,null);
      response = await service.handle(request("/api/contributors"));assert.equal((await response.json())[0].account,null);
      await service.db.query("update rel_private.accounts set disabled=false where id=$1",[ids.member]);
      await service.db.query("update auth.users set email_confirmed_at=now(),banned_until=null,is_anonymous=false where id=$1",[ids.member]);
    }
    for (const role of ["anon","authenticated"]) {
      for (const sql of ["select * from rel_private.contributor_credits","select public.rel_public_contributors()","select public.rel_public_profile(null,'editor1',null)","select rel_private.public_account('"+ids.member+"')"]) {
        await assert.rejects(service.db.transaction(async tx=>{await tx.exec("set local role "+role);return tx.exec(sql)}),/permission denied/);
      }
    }
    for (const query of ["", "?account=bad", "?editor=editor1&account="+ids.member, "?editor=editor1&editor=editor2", "?roles=owner", "?constructor=anything", "?__proto__=anything", "?editor=%3Cscript%3E"]) assert.equal((await service.handle(request("/api/profiles"+query))).status,400);
    for (const query of ["?editor=missing", "?account=00000000-0000-4000-8000-000000000099", "?contributor=unknown"]) assert.equal((await service.handle(request("/api/profiles"+query))).status,404);
    const crossSite = request("/api/account/contributor","owner",{userId:ids.member,credit:null});crossSite.headers.set("Origin","https://untrusted.test");
    assert.equal((await service.handle(crossSite)).status,403);
    service.failures.profiles=500;
    response=await service.handle(request("/api/profiles?editor=editor1"));assert.equal(response.status,503);assert.equal(response.headers.get("Cache-Control"),"no-store");
    assert.doesNotMatch(await response.text(),/test-server|rel_private|database/);
    delete service.failures.profiles;
    await service.db.query("delete from public.roblox_editor_site_data where id='site-data'");
    assert.equal((await service.handle(request("/api/profiles?editor=editor1"))).status,503);
    assert.equal((await service.handle(request("/api/profiles?account="+ids.member))).status,503);
    await service.db.query("delete from auth.sessions where user_id=$1",[ids.member]);
    await service.db.query("delete from auth.users where id=$1",[ids.member]);
    assert.equal((await service.handle(request("/api/profiles?account="+ids.member))).status,404);
    response=await service.handle(request("/api/profiles?contributor=seeshaun"));assert.equal((await response.json()).account,null);
  } finally { await service.close(); }
});
