import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {mainPlatform,primaryLink,avatarRequest} from "../assets/editor-platform.js";

const blob="https://old.public.blob.vercel-storage.com/picture.png";
const replacement="https://example.supabase.co/storage/v1/object/public/editor-avatars/replacement";
async function pictureFixture({api,flush,can=()=>true}={}){
  const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].trim())[1];
  const start=script.indexOf('let pictureFetchRunning'),end=script.indexOf('const autosave =',start);
  const S={editors:[{id:'legacy',name:'Legacy',tiktok:'fixture_editor',thumb:blob},{id:'current',name:'Current',tiktok:'current_editor',thumb:replacement},{id:'nohandle',name:'No handle',tiktok:'',thumb:blob},{id:'missing',name:'Missing',tiktok:'missing_editor',thumb:''}],lists:{main:['missing','legacy','current','nohandle'],style:['nohandle','legacy']}};
  const calls=[],messages=[],alerts=[],autosave={dirty:false,blocked:false,flush:async()=>{if(flush)await flush(autosave);else autosave.dirty=false}};
  const context=vm.createContext({S,URL,ONLINE:true,can,autosave,document:{addEventListener(){},querySelectorAll(){return[]}},view(){},setTimeout:fn=>{fn()},setStatus:message=>messages.push(message),alert:message=>alerts.push(message),save:()=>{autosave.dirty=true},
    mainPlatform,primaryLink,avatarRequest,
    api:async(path,body)=>{calls.push({path,body});return api?api(S,body):{ok:true,j:{url:replacement}}},
  });
  vm.runInContext(script.slice(start,end)+'\nglobalThis.replacePictures=()=>runFetch(null,true);globalThis.missingPictures=()=>runFetch(null);globalThis.detectBlob=isLegacyBlobPicture;',context);
  return{context,S,calls,messages,alerts,autosave};
}

test('legacy picture replacement targets Blob hosts, preserves ranks and keeps failed pictures',async()=>{
  const f=await pictureFixture(),lists=structuredClone(f.S.lists);
  for(const url of ['',null,replacement,'https://old.public.blob.vercel-storage.com.attacker.test/x','https://attacker.test/old.public.blob.vercel-storage.com','http://old.public.blob.vercel-storage.com/x'])assert.equal(f.context.detectBlob(url),false);
  assert.equal(f.context.detectBlob(blob),true);
  await f.context.replacePictures();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/avatar');assert.equal(f.calls[0].body.editorId,'legacy');
  assert.equal(f.S.editors[0].thumb,replacement);assert.equal(f.S.editors[1].thumb,replacement);
  assert.equal(f.S.editors[2].thumb,blob);assert.equal(f.S.editors[3].thumb,'');
  assert.deepEqual(f.S.lists,lists);assert.match(f.alerts[0],/no TikTok username/);
  assert.equal(f.autosave.dirty,false);
  const failed=await pictureFixture({api:async()=>({ok:false,status:502,j:{error:'TikTok blocked the request'}})});
  await failed.context.replacePictures();assert.equal(failed.S.editors[0].thumb,blob);
  assert.match(failed.alerts[0],/Existing pictures are kept/);
});

test('replacement stops on a save conflict, without clearing old URLs or fetching more',async()=>{
  const f=await pictureFixture({flush:async a=>{if(a.dirty)a.blocked=true}});
  f.S.editors[2].tiktok='another_editor';
  await f.context.replacePictures();
  assert.equal(f.calls.length,1);assert.equal(f.S.editors[0].thumb,blob);assert.equal(f.S.editors[2].thumb,blob);
  assert.match(f.messages.at(-1),/stopped/);assert.match(f.alerts[0],/could not be saved/);
  const draft=await pictureFixture({flush:async a=>{a.dirty=true}});
  await draft.context.replacePictures();assert.equal(draft.calls.length,0);
  const forbidden=await pictureFixture({can:()=>false});
  await forbidden.context.replacePictures();assert.equal(forbidden.calls.length,0);
});

test('concurrent fetches and edits do not overwrite a newer picture',async()=>{
  let finish;
  const f=await pictureFixture({api:()=>new Promise(resolve=>{finish=resolve})});
  const first=f.context.replacePictures();await new Promise(resolve=>setImmediate(resolve));
  await f.context.replacePictures();assert.equal(f.calls.length,1);
  f.S.editors[0].thumb='https://example.test/manually-chosen.png';
  finish({ok:true,j:{url:replacement}});await first;
  assert.equal(f.S.editors[0].thumb,'https://example.test/manually-chosen.png');
  assert.match(f.alerts[0],/profile changed/);
  const missing=await pictureFixture();await missing.context.missingPictures();
  assert.equal(missing.calls.length,1);assert.equal(missing.calls[0].body.editorId,'missing');
  assert.equal(missing.S.editors[0].thumb,blob);
});

test('bulk replacement uses YouTube for selected editors and discards results after a platform switch',async()=>{
  const f=await pictureFixture();
  Object.assign(f.S.editors[0],{main_platform:'YouTube',links:{youtube:'https://www.youtube.com/@fixture_editor'}});
  await f.context.replacePictures();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.platform,'YouTube');
  assert.equal(f.calls[0].body.channelUrl,'https://www.youtube.com/@fixture_editor');
  let finish;
  const pending=await pictureFixture({api:()=>new Promise(resolve=>{finish=resolve})});
  const run=pending.context.replacePictures();await new Promise(resolve=>setImmediate(resolve));
  pending.S.editors[0].main_platform='YouTube';pending.S.editors[0].links={youtube:'https://www.youtube.com/@fixture_editor'};
  finish({ok:true,j:{url:replacement}});await run;
  assert.equal(pending.S.editors[0].thumb,blob);assert.match(pending.alerts[0],/profile changed/);
});
