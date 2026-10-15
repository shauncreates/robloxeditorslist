import {test} from "node:test";
import assert from "node:assert/strict";
import {mockService} from "./mock-service.mjs";
import {ids} from "./auth-fixture.mjs";

test("email confirmation checks Supabase without signing in or changing roles and rankings",async()=>{
  const service=await mockService();
  const request=(body,origin="https://rel.example.test")=>service.handle(new Request("https://rel.example.test/api/auth/confirmation",{
    method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body),
  }));
  try{
    const site=await service.rpc(ids.owner,"rel_site"),account=await service.rpc(ids.member,"rel_context");
    for(const body of [{},{accessToken:"invalid"},{accessToken:"member\r\nInjected: 1"},{accessToken:"a".repeat(4097)}])assert.equal((await request(body)).status,400);
    service.sessions.set("unconfirmed",{id:ids.member,email:"member@example.test",email_confirmed_at:null});
    service.sessions.set("anonymous",{id:ids.member,email_confirmed_at:"2026-10-14",is_anonymous:true});
    assert.equal((await request({accessToken:"unconfirmed"})).status,400);
    assert.equal((await request({accessToken:"anonymous"})).status,400);
    assert.equal((await request({accessToken:"member"},"https://evil.example.test")).status,403);
    const response=await request({accessToken:"member",roles:["owner"]});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{verified:true});
    assert.equal(response.headers.getSetCookie().length,0);
    assert.deepEqual(await service.rpc(ids.owner,"rel_site"),site);
    assert.deepEqual(await service.rpc(ids.member,"rel_context"),account);
  }finally{await service.close()}
});
