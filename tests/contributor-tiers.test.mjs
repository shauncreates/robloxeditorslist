import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, ids } from "./auth-fixture.mjs";
import { mockService } from "./mock-service.mjs";

const payload = credits => credits.map(({id,name,contribution,tiers,hidden})=>({id,name,contribution,tiers,hidden}));
const origin="https://rel.example.test";
function request(path,user,body) {return new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(user?{Cookie:'__Host-rel_access='+user}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}

test("tier migration preserves existing identities, permissions and rankings",async()=>{
  const f=await fixture({profiles:true,tiers:false});
  try{
    await f.rpc(ids.owner,'rel_contributor_link',{p_user_id:ids.member,p_credit:'seeshaun'});
    const before=(await f.db.query('select data,revision from public.roblox_editor_site_data')).rows;
    const accounts=(await f.db.query('select * from rel_private.accounts order by id')).rows;
    await f.db.exec(await readFile(new URL('../supabase/migrations/20261015130000_rel_contributor_tiers.sql',import.meta.url),'utf8'));
    const result=await f.rpc(ids.owner,'rel_contributors',{p_action:'list'});
    assert.deepEqual(result.credits.map(c=>c.tiers),[['owners'],['developers'],['rankers'],['rankers']]);
    assert.equal(result.credits[0].account.id,ids.member);
    assert.deepEqual((await f.db.query('select data,revision from public.roblox_editor_site_data')).rows,before);
    assert.deepEqual((await f.db.query('select * from rel_private.accounts order by id')).rows,accounts);
    for(const id of [ids.member,ids.contributor,ids.reviewer])await assert.rejects(f.rpc(id,'rel_contributors',{p_action:'list'}),/REL_FORBIDDEN/);
  }finally{await f.db.close()}
});

test("Owners can publish tier edits while public responses hide archived credits and private fields",async()=>{
  const service=await mockService();
  try{
    const before=(await service.db.query('select data,revision from public.roblox_editor_site_data')).rows;
    const accounts=(await service.db.query('select * from rel_private.accounts order by id')).rows;
    let response=await service.handle(request('/api/account/contributors','owner'));assert.equal(response.status,200);
    const original=await response.json(),draft=payload(original.credits).reverse();
    draft.find(c=>c.id==='balloond').name='Renamed contributor';draft.find(c=>c.id==='balloond').tiers=['developers','reviewers'];
    draft.find(c=>c.id==='b-luff').hidden=true;
    draft.push({id:'new-reviewer',name:'<script>fixture</script>',contribution:'Fixture-only credit',tiers:['reviewers'],hidden:false});
    response=await service.handle(request('/api/account/contributors','owner',{revision:original.revision,credits:draft}));assert.equal(response.status,200);
    const saved=await response.json();assert.notEqual(saved.revision,original.revision);assert.equal(saved.credits[0].id,'maxx-vfxs');
    response=await service.handle(request('/api/contributors'));const visible=await response.json();
    assert.equal(visible.some(c=>c.id==='b-luff'),false);assert.deepEqual(visible.find(c=>c.id==='balloond').tiers,['developers','reviewers']);
    assert.equal(visible.find(c=>c.id==='new-reviewer').account,null);
    assert.doesNotMatch(JSON.stringify(visible),/hidden|position|revision|@example.test|roles|disabled/);
    assert.equal((await service.handle(request('/api/profiles?contributor=b-luff'))).status,404);
    response=await service.handle(request('/api/profiles?contributor=balloond'));assert.equal((await response.json()).credits[0].name,'Renamed contributor');
    assert.equal((await service.handle(request('/api/account/contributors','owner',{revision:original.revision,credits:payload(saved.credits)}))).status,409);
    const audit=(await service.db.query("select actor_id,details from rel_private.audit where action='save_contributors'")).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].actor_id,ids.owner);assert.equal(audit[0].details.actor_username,'owner');
    assert.deepEqual((await service.db.query('select data,revision from public.roblox_editor_site_data')).rows,before);
    assert.deepEqual((await service.db.query('select * from rel_private.accounts order by id')).rows,accounts);
    await service.rpc(ids.owner,'rel_contributor_link',{p_user_id:ids.member,p_credit:'balloond'});
    response=await service.handle(request('/api/account/contributors','owner',{revision:saved.revision,credits:payload(saved.credits)}));assert.equal(response.status,409);
    response=await service.handle(request('/api/account/contributors','owner'));const linked=await response.json();
    assert.equal(linked.credits.find(c=>c.id==='balloond').account.id,ids.member);
    response=await service.handle(request('/api/account/contributors','owner',{revision:linked.revision,credits:payload(linked.credits)}));assert.equal(response.status,200);
    response=await service.handle(request('/api/profiles?account='+ids.member));assert.equal((await response.json()).credits[0].id,'balloond');
  }finally{await service.close()}
});

test("contributor saves reject unauthorized, stale, malformed and destructive requests atomically",async()=>{
  const service=await mockService();
  try{
    const state=await service.rpc(ids.owner,'rel_contributors',{p_action:'list'}),base=payload(state.credits);
    for(const user of [undefined,'member','contributor','reviewer']){
      assert.equal((await service.handle(request('/api/account/contributors',user))).status,user?403:401);
      assert.equal((await service.handle(request('/api/account/contributors',user,{revision:state.revision,credits:base}))).status,user?403:401);
    }
    const invalid=[base.slice(1),[...base,base[0]],base.map((c,i)=>i?c:{...c,tiers:[]}),base.map((c,i)=>i?c:{...c,tiers:['owners','owners']}),base.map((c,i)=>i?c:{...c,tiers:['owner']}),base.map((c,i)=>i?c:{...c,name:''}),base.map((c,i)=>i?c:{...c,account_id:ids.member}),base.map((c,i)=>i?c:{...c,hidden:'false'})];
    for(const data of invalid){
      await assert.rejects(service.rpc(ids.owner,'rel_contributors',{p_action:'save',p_revision:state.revision,p_data:data}),/REL_INVALID/);
      assert.deepEqual(await service.rpc(ids.owner,'rel_contributors',{p_action:'list'}),state);
    }
    for(const role of ['anon','authenticated'])await assert.rejects(service.db.transaction(async tx=>{await tx.exec('set local role '+role);return tx.exec('select * from rel_private.contributor_settings')}),/permission denied/);
    const cross=request('/api/account/contributors','owner',{revision:state.revision,credits:base});cross.headers.set('Origin','https://untrusted.test');assert.equal((await service.handle(cross)).status,403);
    await service.db.query('delete from auth.sessions where user_id=$1',[ids.owner]);
    assert.equal((await service.handle(request('/api/account/contributors','owner',{revision:state.revision,credits:base}))).status,401);
  }finally{await service.close()}
});
