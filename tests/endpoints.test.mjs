import {test} from "node:test";
import assert from "node:assert/strict";
import {mockService} from "./mock-service.mjs";
import {rankings,ids} from "./auth-fixture.mjs";

test("Cloudflare functions enforce authentication, ownership and roles with no shared-password bypass",async()=>{
  const service=await mockService();
  try{
    const request=(path,token,body,origin="https://rel.example.test")=>service.handle(new Request("https://rel.example.test"+path,{
      method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",origin,...(token?{cookie:"__Host-rel_access="+token+"; __Host-rel_refresh=refresh-"+token}:{})},body:body===undefined?undefined:JSON.stringify(body),
    }));
    const site=await (await request("/api/account/site","owner")).json();
    for(const [path,body] of [["/api/save",{data:rankings,revision:site.revision,password:"old-password"}],["/api/avatar",{username:"x",editorId:"editor1",password:"old-password"}],["/api/applications/admin",{action:"list",password:"old-password"}],["/api/account/users",{action:"list"}]]){
      assert.equal((await request(path,null,body)).status,401,path);
    }
    assert.equal((await request("/api/save","reviewer",{data:rankings,revision:site.revision})).status,403);
    assert.equal((await request("/api/account/users","contributor",{action:"list"})).status,403);
    assert.equal((await request("/api/applications/admin","member",{action:"list"})).status,403);
    assert.equal((await request("/api/avatar","member",{username:"other",editorId:"editor2"})).status,403);
    assert.equal((await request("/api/account/profile","stranger",{profile:{name:"Hacker"},revision:site.revision})).status,403);
    assert.equal((await request("/api/account/profile","member",{profile:{id:"editor2"},revision:site.revision})).status,403);
    const edit=await request("/api/account/profile","member",{profile:{software:"CapCut"},revision:site.revision});
    assert.equal(edit.status,200);const updated=await edit.json();assert.ok(updated.revision);
    assert.equal((await request("/api/save","owner",{data:rankings,revision:site.revision})).status,409);
    assert.equal((await request("/api/account/users","owner",{action:"list"})).status,200);
    assert.equal((await request("/api/applications/admin","reviewer",{action:"list"})).status,200);
    for(const origin of ["https://evil.example.test","null",""]){
      assert.equal((await request("/api/save","owner",{data:rankings,revision:updated.revision},origin)).status,403);
      assert.equal((await request("/api/auth/signin",null,{email:"owner@example.test",password:"test-password-123"},origin)).status,403);
    }
    assert.equal((await request("/api/auth/signin",null,{email:"owner@example.test",password:"wrong"})).status,401);
    const login=await request("/api/auth/signin",null,{email:"owner@example.test",password:"test-password-123"});
    assert.equal(login.status,200);
    const cookies=login.headers.getSetCookie();assert.equal(cookies.length,2);
    for(const cookie of cookies)assert.match(cookie,/HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
    const loginBody=await login.json();assert.equal(loginBody.account.id,ids.owner);
    assert.equal(loginBody.access_token,undefined);assert.equal(loginBody.refresh_token,undefined);
    service.clearLog();
    const signup=await request("/api/auth/signup",null,{email:"new@example.test",password:"SignupTest123",roles:["owner"],editorId:"editor2",data:{roles:["owner"]}});
    assert.equal(signup.status,201);
    assert.deepEqual(service.log()[0].body,{email:"new@example.test",password:"SignupTest123"});
    assert.equal((await request("/api/auth/signup",null,{email:"new@example.test",password:"short"})).status,400);
    const refresh=await request("/api/auth/refresh","member",{});assert.equal(refresh.status,200);assert.equal(refresh.headers.getSetCookie().length,2);
    const large=await request("/api/account/claim","member",{message:"a".repeat(20000)});assert.equal(large.status,413);
    const logout=await request("/api/auth/signout","member",{});assert.equal(logout.status,200);
    assert.ok(logout.headers.getSetCookie().every(cookie=>cookie.includes("Max-Age=0")));
    assert.equal((await request("/api/auth/session","member")).status,401);
    assert.equal((await request("/api/auth/refresh","member",{})).status,401);
    const renewedLogin=await request("/api/auth/signin",null,{email:"member@example.test",password:"test-password-123"});
    assert.equal(renewedLogin.status,200);
    const renewedToken=renewedLogin.headers.getSetCookie().find(cookie=>cookie.startsWith("__Host-rel_access=")).split(';')[0].split('=')[1];
    assert.notEqual(renewedToken,"member");
    assert.equal((await request("/api/auth/session",renewedToken)).status,200);
    assert.equal((await request("/api/auth/session","member")).status,401);
    await service.db.exec("delete from public.roblox_editor_site_data");
    assert.equal((await request("/api/account/site","owner")).status,409);
    assert.equal((await request("/api/save","owner",{data:rankings,revision:updated.revision})).status,409);
  }finally{await service.close()}
});

test('public submission, profile claims, role changes and permitted avatars work through the API',async()=>{
  const service=await mockService();
  try{
    const request=(path,token,body)=>service.handle(new Request('https://rel.example.test'+path,{
      method:body===undefined?'GET':'POST',headers:{origin:'https://rel.example.test','Content-Type':'application/json',...(token?{cookie:'__Host-rel_access='+token}:{})},body:body===undefined?undefined:JSON.stringify(body),
    }));
    assert.deepEqual(await(await request('/api/data')).json(),rankings);
    const application={displayName:'Test applicant',platform:'YouTube',profileUrl:'https://youtube.com/@fixture',software:'Blender',styles:[rankings.styles[0].name],examplesUrl:'https://example.test/showreel',notes:'Synthetic test'};
    assert.equal((await request('/api/applications',null,application)).status,201);
    assert.equal((await request('/api/applications',null,{...application,styles:[]})).status,400);
    assert.equal((await request('/api/applications',null,{...application,profileUrl:'https://evil.example.test'})).status,400);
    assert.equal((await request('/api/applications',null,{website:'honeypot'})).status,200);
    assert.equal((await service.db.query('select count(*)::int as n from public.editor_applications')).rows[0].n,1);
    const before=await(await request('/api/account/site','owner')).json();
    assert.equal((await request('/api/account/claim','stranger',{editorId:'editor2',message:'Please verify the listed account.'})).status,200);
    assert.equal((await request('/api/account/users','owner',{action:'approve_claim',userId:ids.stranger})).status,200);
    assert.equal((await(await request('/api/auth/session','stranger')).json()).account.editor_id,'editor2');
    assert.equal((await request('/api/account/users','owner',{action:'update',userId:ids.stranger,roles:['member','application_reviewer'],editorId:'editor2'})).status,200);
    assert.equal((await request('/api/applications/admin','stranger',{action:'list'})).status,200);
    assert.deepEqual(await(await request('/api/account/site','owner')).json(),before);
    const avatar=await request('/api/avatar','member',{editorId:'editor1',username:'fixture_editor'});
    assert.equal(avatar.status,200);
    assert.match((await avatar.json()).url,/editor-avatars\/avatars\/editor1\/[0-9a-f-]+/);
    assert.equal((await request('/api/account/users','owner',{action:'update',userId:ids.stranger,roles:['member'],editorId:'editor2'})).status,200);
    assert.equal((await request('/api/applications/admin','stranger',{action:'list'})).status,403);
  }finally{await service.close()}
});
