import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyPicture,legacyPicture,replacementSQL} from '../scripts/copy-legacy-avatars.mjs';
import {fixture} from './auth-fixture.mjs';

const editor={id:'editor1',thumb:'https://old.public.blob.vercel-storage.com/avatar.png'};
const config={url:'https://example.supabase.co',key:'fixture-server-key'};
const bytes=new Uint8Array([137,80,78,71]);
const picture=value=>new Response(value,{headers:{'Content-Type':'image/png'}});
test('avatar copy verifies bytes and keeps server credentials confined to the upload',async()=>{
  const requests=[];
  const result=await copyPicture(editor,{...config,fetchImpl:async(url,options)=>{
    requests.push({url,options});return options?.method==='POST'?new Response('{}'):picture(bytes);
  }});
  assert.equal(result.old_url,editor.thumb);assert.match(result.new_url,/example\.supabase\.co\/storage\/v1\/object\/public\/editor-avatars\/avatars\/editor1\//);
  assert.equal(result.bytes,4);assert.equal(result.sha256.length,64);
  assert.equal(requests[0].options.headers,undefined);assert.equal(requests[2].options.headers,undefined);
  assert.equal(requests[1].options.headers.Authorization,'Bearer fixture-server-key');
  assert.ok(requests.every(request=>request.options.redirect==='error'));
});
test('avatar copy rejects unsafe sources, upload failures and mismatched pictures',async()=>{
  assert.equal(legacyPicture('https://old.public.blob.vercel-storage.com.attacker.test/avatar'),false);
  assert.equal(legacyPicture('http://old.public.blob.vercel-storage.com/avatar'),false);
  await assert.rejects(copyPicture({...editor,id:'../other'},config),/Invalid/);
  await assert.rejects(copyPicture(editor,{...config,url:'https://attacker.test',fetchImpl:()=>{throw Error('Must not fetch')}}),/approved/);
  await assert.rejects(copyPicture(editor,{...config,fetchImpl:async(_,options)=>options?.method==='POST'?new Response('{}',{status:403}):picture(bytes)}),/upload failed/);
  await assert.rejects(copyPicture(editor,{...config,fetchImpl:async url=>url===editor.thumb?picture(bytes):url.includes('/object/public/')?picture(new Uint8Array([0])):new Response('{}')}),/does not match/);
  await assert.rejects(copyPicture(editor,{...config,fetchImpl:async()=>new Response('not an image',{headers:{'Content-Type':'text/html'}})}),/Unsupported/);
  await assert.rejects(copyPicture(editor,{...config,fetchImpl:async()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'Content-Type':'image/png'}})}),/exceeds/);
});

test('approved avatar URL retirement changes only thumbs, records history and rejects stale data',async()=>{
  const {db}=await fixture();
  try{
    await db.query("update public.roblox_editor_site_data set data=jsonb_set(data,'{editors,0,thumb}',to_jsonb($1::text)) where id='site-data'",[editor.thumb]);
    const before=(await db.query("select revision,data,md5(data::text) as fingerprint from public.roblox_editor_site_data where id='site-data'")).rows[0];
    const change={editor_id:'editor1',old_url:editor.thumb,new_url:config.url+'/storage/v1/object/public/editor-avatars/avatars/editor1/new',sha256:'a'.repeat(64)};
    const report={...before,changes:[change],failures:[]};
    const stale=replacementSQL({...report,fingerprint:'0'.repeat(32)},config.url);
    await assert.rejects(db.exec(stale),/REL_CONFLICT/);await db.exec('rollback');
    assert.deepEqual((await db.query("select data from public.roblox_editor_site_data where id='site-data'")).rows[0].data,before.data);
    await db.exec(replacementSQL(report,config.url));
    const after=(await db.query("select revision,data from public.roblox_editor_site_data where id='site-data'")).rows[0];
    const expected=structuredClone(before.data);expected.editors[0].thumb=change.new_url;
    assert.deepEqual(after.data,expected);assert.notEqual(after.revision,before.revision);
    assert.deepEqual((await db.query('select data from rel_private.data_history where revision=$1',[before.revision])).rows[0].data,before.data);
    assert.equal((await db.query("select count(*)::int as n from rel_private.audit where action='retire_legacy_avatar_urls'")).rows[0].n,1);
    assert.deepEqual((await db.query("select details->'pictures' as pictures from rel_private.audit where action='legacy_avatar_copy_manifest'")).rows[0].pictures,[change]);
    assert.throws(()=>replacementSQL({...report,changes:[{...change,new_url:'https://attacker.test/image'}]},config.url),/Invalid/);
  }finally{await db.close()}
});
