import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture,ids,rankings} from "./auth-fixture.mjs";
import {mockService} from "./mock-service.mjs";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";

test("review migration preserves an existing database and the previous review RPC",async()=>{
  const {db,rpc}=await fixture({reviews:false});
  try{
    await db.query("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url,status,notes) values ('Existing','YouTube','https://youtube.com/@existing','CapCut',array['Test style'],'https://example.test','approved','Private existing notes')");
    const site=await rpc(ids.owner,"rel_site"),before=(await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0];
    await db.exec(await readFile(new URL("../supabase/migrations/20261014201617_rel_application_reviews.sql",import.meta.url),"utf8"));
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
    const after=(await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0];
    for(const key of Object.keys(before))assert.deepEqual(after[key],before[key]);
    assert.equal(after.review_reason,null);assert.equal(after.listed_editor_id,null);
    assert.equal((await db.query("select count(*)::int as n from rel_private.data_history")).rows[0].n,0);
  }finally{await db.close()}
});

test("review migration supports the live legacy schema without changing submissions or rankings",async()=>{
  const {db,rpc,asUser}=await fixture({reviews:false,legacyApplications:true});
  try{
    const before=(await db.query("insert into public.editor_applications(display_name,main_platform,main_platform_url,software,editing_styles,examples_url,status) values ('Existing','YouTube','https://youtube.com/@existing','CapCut',array['Test style'],null,'approved') returning *")).rows[0];
    const site=await rpc(ids.owner,"rel_site");
    await db.exec(await readFile(new URL("../supabase/migrations/20261014201617_rel_application_reviews.sql",import.meta.url),"utf8"));
    assert.deepEqual(await rpc(ids.owner,"rel_site"),site);
    const after=(await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0];
    const renamed={main_platform:"platform",main_platform_url:"profile_url",editing_styles:"styles"};
    for(const [key,value] of Object.entries(before)){
      if(value instanceof Date)assert.equal(new Date(after[key]).getTime(),value.getTime());
      else assert.deepEqual(after[renamed[key]||key],value);
    }
    for(const key of ["notes","reviewed_at","review_reason","reviewed_by","listed_editor_id"])assert.equal(after[key],null);
    await assert.rejects(asUser(ids.member,"select * from public.editor_applications"),/permission denied/);
    await assert.rejects(rpc(ids.member,"rel_applications",{p_action:"list"}),/REL_FORBIDDEN/);
    assert.equal((await rpc(ids.contributor,"rel_pending_editors",{p_action:"list",p_id:null,p_revision:null})).total,1);
    await db.exec("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url,notes) values ('New applicant','TikTok','https://tiktok.com/@new','CapCut',array_fill('Offered style'::text,array[31]),'https://example.test','Private notes')");
    await assert.rejects(db.exec("insert into public.editor_applications(display_name,platform,profile_url,software,styles) values ('Too many','TikTok','https://tiktok.com/@new','CapCut',array_fill('Style'::text,array[32]))"),/editor_applications_styles_check/);
    await rpc(ids.reviewer,"rel_applications",{p_action:"update",p_id:before.id,p_status:"approved",p_offset:0,p_reason:"Private reason"});
    const result=await rpc(ids.contributor,"rel_pending_editors",{p_action:"convert",p_id:before.id,p_revision:site.revision});
    const converted=await rpc(ids.owner,"rel_site");
    assert.deepEqual(converted.data.editors.slice(0,-1),site.data.editors);
    assert.deepEqual(converted.data.lists.main.slice(0,-1),site.data.lists.main);
    assert.equal(converted.data.lists.main.at(-1),result.editor_id);
    assert.ok(!JSON.stringify(converted.data).includes("Private"));
  }finally{await db.close()}
});

test("review migration refuses ambiguous legacy and current columns atomically",async()=>{
  const {db,rpc}=await fixture({reviews:false,legacyApplications:true});
  try{
    await db.exec("alter table public.editor_applications add column platform text");
    const before=await rpc(ids.owner,"rel_site");
    await assert.rejects(db.exec(await readFile(new URL("../supabase/migrations/20261014201617_rel_application_reviews.sql",import.meta.url),"utf8")),/REL_AMBIGUOUS_APPLICATION_COLUMNS/);
    await db.exec("rollback");
    const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='editor_applications'")).rows.map(row=>row.column_name);
    assert.ok(columns.includes("main_platform"));assert.ok(columns.includes("platform"));
    assert.ok(!columns.includes("review_reason"));assert.ok(!columns.includes("reviewed_at"));
    assert.deepEqual(await rpc(ids.owner,"rel_site"),before);
  }finally{await db.close()}
});

test("review reasons and conversion are role-checked, private and preserve existing rank order",async()=>{
  const {db,rpc}=await fixture();
  try{
    const before=await rpc(ids.owner,"rel_site");
    const {rows}=await db.query("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url,notes) values ('Applicant','YouTube','https://youtube.com/@fixture','CapCut',array['Test style'],'https://example.test','Private submission note') returning id");
    const id=rows[0].id,review={p_action:"update",p_id:id,p_status:"approved",p_offset:0,p_reason:"Private reviewer reason"};
    await assert.rejects(rpc(ids.member,"rel_applications",review),/REL_FORBIDDEN/);
    await rpc(ids.reviewer,"rel_applications",review);
    const reviewed=(await rpc(ids.reviewer,"rel_applications",{p_action:"list"})).applications[0];
    assert.equal(reviewed.review_reason,"Private reviewer reason");assert.equal(reviewed.reviewed_by,ids.reviewer);
    assert.deepEqual(await rpc(ids.owner,"rel_site"),before);
    const listArgs={p_action:"list",p_id:null,p_revision:null};
    await assert.rejects(rpc(ids.member,"rel_pending_editors",listArgs),/REL_FORBIDDEN/);
    await assert.rejects(rpc(ids.reviewer,"rel_pending_editors",listArgs),/REL_FORBIDDEN/);
    assert.equal((await rpc(ids.contributor,"rel_pending_editors",listArgs)).total,1);
    await assert.rejects(rpc(ids.contributor,"rel_pending_editors",{p_action:"convert",p_id:id,p_revision:ids.owner}),/REL_CONFLICT/);
    const result=await rpc(ids.contributor,"rel_pending_editors",{p_action:"convert",p_id:id,p_revision:before.revision});
    const after=await rpc(ids.owner,"rel_site");
    assert.deepEqual(after.data.editors.slice(0,-1),before.data.editors);
    for(const key of Object.keys(before.data.lists))assert.deepEqual(after.data.lists[key].slice(0,-1),before.data.lists[key]);
    assert.equal(after.data.lists.main.at(-1),result.editor_id);assert.equal(after.data.lists.style.at(-1),result.editor_id);
    assert.equal(after.data.editors.at(-1).note,"");assert.ok(!JSON.stringify(after.data).includes("Private"));
    assert.equal((await rpc(ids.contributor,"rel_pending_editors",listArgs)).total,0);
    await assert.rejects(rpc(ids.contributor,"rel_pending_editors",{p_action:"convert",p_id:id,p_revision:after.revision}),/REL_NOT_FOUND/);
    await assert.rejects(rpc(ids.reviewer,"rel_applications",{...review,p_status:"rejected"}),/REL_APPLICATION_LISTED/);
    assert.equal((await db.query("select count(*)::int as n from rel_private.data_history")).rows[0].n,1);
  }finally{await db.close()}
});

test("application options follow saved styles and admin HTML is gated before it is returned",async()=>{
  const service=await mockService();
  const request=(path,token,body)=>service.handle(new Request("https://rel.example.test"+path,{method:body===undefined?"GET":"POST",headers:{origin:"https://rel.example.test","Content-Type":"application/json",...(token?{cookie:"__Host-rel_access="+token}: {})},body:body===undefined?undefined:JSON.stringify(body)}));
  try{
    const applicant={requestId:randomUUID(),displayName:"Applicant",platform:"YouTube",profileUrl:"https://youtube.com/@fixture",software:"CapCut",styles:[rankings.styles[0].name],examplesUrl:"https://example.test"};
    assert.equal((await request("/api/applications","stranger",applicant)).status,201);
    assert.equal((await request("/api/applications","member",{...applicant,requestId:randomUUID(),styles:["Not offered"]})).status,400);
    const current=(await request("/api/account/site","owner"));const site=await current.json();
    site.data.styles.push({id:"new-style",name:"New checkbox style",color:"#123456"});
    assert.equal((await request("/api/save","contributor",{data:site.data,revision:site.revision})).status,200);
    assert.equal((await request("/api/applications","member",{...applicant,requestId:randomUUID(),styles:["New checkbox style","Other: Custom"]})).status,201);
    assert.equal((await request("/api/applications/pending")).status,401);
    assert.equal((await request("/api/applications/pending","member")).status,403);
    assert.equal((await request("/api/applications/pending","reviewer")).status,403);
    assert.equal((await request("/api/applications/pending","contributor")).status,200);
    assert.equal((await request("/api/applications/admin","reviewer",{action:"update",reason:"a".repeat(1001)})).status,400);
    for(const [token,expected] of [[null,"/signin/"],["member","/account/"],["stranger","/account/"]]){
      let returned=false;const response=await service.handleAdmin(new Request("https://rel.example.test/admin/",{headers:token?{cookie:"__Host-rel_access="+token}:{}}),async()=>{returned=true;return new Response("admin")});
      assert.equal(response.status,302);assert.equal(new URL(response.headers.get("location")).pathname,expected);assert.equal(returned,false);
    }
    const allowed=await service.handleAdmin(new Request("https://rel.example.test/admin/",{headers:{cookie:"__Host-rel_access=contributor"}}),async()=>new Response("admin"));
    assert.equal(allowed.status,200);assert.equal(allowed.headers.get("cache-control"),"private, no-store");
    assert.equal(await allowed.text(),"admin");
    const refreshed=await service.handleAdmin(new Request("https://rel.example.test/admin/",{headers:{cookie:"__Host-rel_access=expired; __Host-rel_refresh=refresh-owner"}}),async()=>new Response("admin after refresh"));
    assert.equal(refreshed.status,200);assert.equal(await refreshed.text(),"admin after refresh");assert.equal(refreshed.headers.getSetCookie().length,2);
  }finally{await service.close()}
});
