import {test} from "node:test";
import assert from "node:assert/strict";
import {mockService} from "./mock-service.mjs";
import {ids} from "./auth-fixture.mjs";

const request=(service,path,body,origin="https://rel.example.test",token)=>service.handle(new Request("https://rel.example.test/api/auth/"+path,{
  method:"POST",headers:{origin,"Content-Type":"application/json",...(token?{cookie:"__Host-rel_access="+token}:{})},body:JSON.stringify(body),
}));

test("signup enforces eight characters and all required character types server-side",async()=>{
  const service=await mockService();
  try{
    for(const password of ["Short1A","abcdefgh1","ABCDEFGH1","Abcdefgh",null,"Aa1"+"a".repeat(1022)]){
      service.clearLog();
      assert.equal((await request(service,"signup",{email:"new@example.test",password,username:"new_member"})).status,400);
      assert.equal(service.log().length,0);
    }
    for(const [index,password] of ["Abcdef12","Abcdef12!","A much longer password 123"].entries()){
      assert.equal((await request(service,"signup",{email:`new${index}@example.test`,password,username:`new_member${index}`})).status,201);
    }
  }finally{await service.close()}
});

test("password recovery verifies an email code, preserves roles and rankings, and revokes sessions",async()=>{
  const service=await mockService();
  try{
    const before=await service.rpc(ids.owner,"rel_site"),account=await service.rpc(ids.owner,"rel_context");
    const known=await request(service,"forgot-password",{email:"owner@example.test",redirectTo:"https://evil.example.test"});
    const unknown=await request(service,"forgot-password",{email:"missing@example.test"});
    assert.equal(known.status,200);assert.equal(unknown.status,200);
    assert.deepEqual(await known.json(),await unknown.json());
    const recovery=service.log().find(entry=>entry.path==="/auth/v1/recover");
    assert.deepEqual(recovery.body,{email:"owner@example.test"});
    assert.equal((await request(service,"forgot-password",{email:"bad"})).status,400);
    assert.equal((await request(service,"forgot-password",{email:"owner@example.test"},"https://evil.example.test")).status,403);
    const body={email:"owner@example.test",code:"123456",password:"Abcdef12",confirmPassword:"Abcdef12",roles:["member"],type:"signup",access_token:"member"};
    for(const invalid of [{code:"000000"},{code:"12345"},{password:"abcdefgh1",confirmPassword:"abcdefgh1"},{confirmPassword:"Different123"},{email:"member@example.test"}]){
      assert.equal((await request(service,"reset-password",{...body,...invalid},undefined,"owner")).status,400);
    }
    assert.equal((await request(service,"reset-password",body,"https://evil.example.test")).status,403);
    service.recoveryCodes.get(body.email).expires=0;
    assert.equal((await request(service,"reset-password",body)).status,400);
    await request(service,"forgot-password",{email:body.email});
    service.clearLog();
    const reset=await request(service,"reset-password",body);
    assert.equal(reset.status,200);
    assert.deepEqual(await reset.json(),{message:"Password changed. Sign in with your new password."});
    assert.equal(reset.headers.getSetCookie().length,2);
    assert.ok(reset.headers.getSetCookie().every(cookie=>cookie.includes("HttpOnly; SameSite=Strict; Max-Age=0; Secure")));
    assert.deepEqual(service.log().find(entry=>entry.path==="/auth/v1/verify").body,{email:body.email,token:body.code,type:"recovery"});
    assert.deepEqual(service.log().find(entry=>entry.path==="/auth/v1/user"&&entry.body).body,{password:body.password});
    assert.equal(service.sessions.has("owner"),false);
    assert.equal((await request(service,"reset-password",body)).status,400);
    assert.equal((await request(service,"signin",{email:body.email,password:"test-password-123"})).status,401);
    const login=await request(service,"signin",{email:body.email,password:body.password});
    assert.equal(login.status,200);assert.deepEqual((await login.json()).account.roles,account.roles);
    assert.deepEqual(await service.rpc(ids.owner,"rel_site"),before);
    assert.equal((await service.db.query("select count(*)::int as n from rel_private.audit")).rows[0].n,0);
  }finally{await service.close()}
});

test("recovery retains rate limits, rejects disabled accounts, and reports provider failures",async()=>{
  const service=await mockService();
  try{
    const body={email:"owner@example.test",code:"123456",password:"Abcdef12",confirmPassword:"Abcdef12"};
    service.failures.recover=429;
    assert.equal((await request(service,"forgot-password",{email:body.email})).status,429);
    service.failures.recover=500;
    assert.equal((await request(service,"forgot-password",{email:body.email})).status,503);
    delete service.failures.recover;
    await request(service,"forgot-password",{email:body.email});
    service.failures.verify=429;
    assert.equal((await request(service,"reset-password",body)).status,429);
    delete service.failures.verify;
    service.failures.update=400;
    assert.equal((await request(service,"reset-password",body)).status,400);
    delete service.failures.update;
    await request(service,"forgot-password",{email:"member@example.test"});
    await service.db.query("update rel_private.accounts set disabled=true where id=$1",[ids.member]);
    assert.equal((await request(service,"reset-password",{...body,email:"member@example.test"})).status,403);
    await request(service,"forgot-password",{email:body.email});
    service.failures.logout=503;
    const partial=await request(service,"reset-password",body);
    assert.equal(partial.status,503);assert.match((await partial.json()).error,/Your password changed/);
  }finally{await service.close()}
});
