import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import vm from "node:vm";
import { rankings } from "./auth-fixture.mjs";
import {mainPlatform,primaryLink,avatarRequest} from "../assets/editor-platform.js";
const mockAutosave=()=>({change(){},flush:async()=>{},pause(){},reset(){return true},dirty:false,busy:false,blocked:false});

test("all browser scripts parse",async()=>{
  for(const file of ["admin/index.html","account/index.html","signin/index.html","reset-password/index.html","email-verified/index.html","apply/index.html","index.html","list/index.html"]){
    const html=await readFile(new URL('../'+file,import.meta.url),'utf8');
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
      const result=spawnSync(process.execPath,["--input-type=module","--check"],{input:match[1],encoding:"utf8"});
      assert.equal(result.status,0,file+": "+result.stderr);
    }
  }
});

test("Members leave admin for account while Owners retain management controls",async()=>{
  const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].trim())[1].replace(/^import .*;$/gm,'');
  for(const [roles,editor_id] of [[["member"],"editor1"],[["member"],null],[["member","owner"],null]]){
    let redirect;
    const elements=new Map();const element=selector=>{
      if(!elements.has(selector))elements.set(selector,{hidden:false,disabled:false,textContent:"",innerHTML:"",addEventListener(){}});
      return elements.get(selector);
    };
    const context=vm.createContext({
      document:{querySelector:element,addEventListener(){}},window:{addEventListener(){}},location:{protocol:"https:",replace:path=>{redirect=path}},sessionStorage:{removeItem(){}},
      createAutosave:mockAutosave,watchChanges(){},announceChange(){},animateDisclosures(){},
      mountContributorEditor(){},contributorEditsPending:()=>false,clearContributorDraft(){},
      mainPlatform,primaryLink,avatarRequest,
      getAccount:async()=>({email:"test@example.test",roles,editor_id}),
      accountFetch:async path=>({ok:true,json:async()=>path.includes('/pending')?{applications:[],total:0}:{data:structuredClone(rankings),revision:"test-revision"}}),accountApi:async()=>({ok:true,j:{users:[],total:0}}),signOut:async()=>{},
    });
    vm.runInContext(script,context);await new Promise(resolve=>setImmediate(resolve));
    const tabs=element('#tabs').innerHTML,app=element('#app').innerHTML;
    if(roles.includes('owner')){
      assert.match(tabs,/Users & roles/);assert.match(tabs,/Applications/);assert.match(tabs,/Rankings/);
      assert.match(app,/Add editor/);assert.equal(element('#dl').hidden,false);
    }else{
      assert.equal(redirect,'/account/');assert.equal(app,'');assert.equal(tabs,'');
    }
  }
});

test("admin blocks saving and exporting when live rankings fail, without reading data.js",async()=>{
  const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');
  assert.ok(!html.includes('src="../data.js"'));
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].trim())[1].replace(/^import .*;$/gm,'');
  const elements=new Map();const events=new Map();
  const element=selector=>{if(!elements.has(selector))elements.set(selector,{hidden:false,disabled:false,textContent:"",innerHTML:"",addEventListener:(name,fn)=>events.set(selector+":"+name,fn)});return elements.get(selector)};
  const context=vm.createContext({
    document:{querySelector:element,addEventListener(){}},window:{addEventListener(){},get SITE_DATA(){throw Error("Never load fallback ranking data")}},
    location:{protocol:"https:"},sessionStorage:{removeItem(){}},
    createAutosave:mockAutosave,watchChanges(){},announceChange(){},animateDisclosures(){},
    mountContributorEditor(){},contributorEditsPending:()=>false,clearContributorDraft(){},
    getAccount:async()=>({email:"owner@example.test",roles:["member","owner"],editor_id:null}),
    accountFetch:async()=>({ok:false,status:503}),accountApi:async()=>{throw Error("Saving must never be called")},signOut:async()=>{},
  });
  vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('#saveSite').hidden,true);assert.equal(element('#saveSite').disabled,true);assert.equal(element('#dl').hidden,true);
  assert.match(element('#banner').textContent,/Saving is blocked/);
  assert.equal(element('#bootNotice').textContent,"");
  await events.get('#saveSite:click')();
});

test("hosted public pages reject missing database data instead of displaying placeholder rankings",async()=>{
  const list=await readFile(new URL('../list/index.html',import.meta.url),'utf8');
  const start=list.indexOf('async function loadData()'),end=list.indexOf('async function init()',start);
  const context=vm.createContext({location:{protocol:'https:'},window:{get SITE_DATA(){throw Error('Placeholder data must not be read')}},
    fetch:async()=>({status:404,ok:false}),valid:()=>true});
  vm.runInContext(list.slice(start,end)+'\nglobalThis.loadDataTest=loadData;',context);
  await assert.rejects(context.loadDataTest(),/status 404/);

  const homepage=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const script=[...homepage.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].includes('var site;'))[1];
  const elements=new Map();
  const homepageContext=vm.createContext({location:{protocol:'https:'},window:{get SITE_DATA(){throw Error('Homepage must not read placeholder data')}},
    document:{querySelector:selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:''});return elements.get(selector)}},
    fetch:async()=>({status:404,ok:false})});
  await vm.runInContext(script,homepageContext);
  assert.match(elements.get('#footNote').textContent,/temporarily unavailable/);
});

test("signup mode stays fixed while a request is pending and recovers after an error",async()=>{
  const html=await readFile(new URL('../signin/index.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].trim())[1];
  const elements=new Map(),events=new Map();
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{
      disabled:false,value:"",textContent:"",attributes:new Map(),
      setAttribute(name,value){this.attributes.set(name,value)},
      removeAttribute(name){this.attributes.delete(name)},
      addEventListener(name,fn){events.set(selector+":"+name,fn)},
    });
    return elements.get(selector);
  };
  let finish,requested,requestBody;
  const context=vm.createContext({document:{querySelector:element},location:{hash:"",search:"",assign(){throw Error("Signup must not redirect to admin")}},
    sessionStorage:{removeItem(){}},URLSearchParams,
    fetch:async (url,options)=>{requested=url;requestBody=JSON.parse(options.body);return new Promise(resolve=>{finish=resolve})},
  });
  vm.runInContext(script,context);
  events.get('#switch:click')();
  assert.equal(element('#password').minLength,8);
  assert.match(element('#password').attributes.get('pattern'),/A-Z/);
  assert.equal(element('#forgotPassword').hidden,true);
  assert.equal(element('#signupUsername').required,true);
  assert.equal(element('#signupUsername').disabled,false);
  assert.equal(element('#signupUsernameField').hidden,false);
  element('#signupUsername').value='New_Member';
  element('#email').value='signup@example.test';element('#password').value='SignupTest123';
  const pending=events.get('#authForm:submit')({preventDefault(){}});
  assert.equal(requested,'/api/auth/signup');
  assert.equal(requestBody.username,'New_Member');
  assert.equal(element('#switch').disabled,true);assert.equal(element('#submit').disabled,true);
  assert.equal(element('#authForm').attributes.get('aria-busy'),'true');
  // Even a programmatic mode change cannot change how the pending response is handled.
  events.get('#switch:click')();
  assert.equal(element('#password').minLength,1);
  assert.equal(element('#password').attributes.has('pattern'),false);
  assert.equal(element('#forgotPassword').hidden,false);
  assert.equal(element('#signupUsername').required,false);
  assert.equal(element('#signupUsername').disabled,true);
  assert.equal(element('#signupUsernameField').hidden,true);
  finish({ok:true,json:async()=>({message:'Confirm your email.'})});await pending;
  assert.equal(element('#message').textContent,'Confirm your email.');
  assert.equal(element('#password').value,'');assert.equal(element('#switch').disabled,false);
  assert.equal(element('#authForm').attributes.has('aria-busy'),false);
  const failed=events.get('#authForm:submit')({preventDefault(){}});
  assert.equal(requestBody.username,undefined);
  finish({ok:false,json:async()=>({error:'Please retry.'})});await failed;
  assert.equal(element('#message').textContent,'Please retry.');
  assert.equal(element('#submit').disabled,false);assert.equal(element('#switch').disabled,false);
});

test("account pagination reflects first, middle, last and loading states",async()=>{
  const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].trim())[1];
  const start=script.indexOf('function updatePagination('),end=script.indexOf('let applicationsCache',start);
  const buttons=new Map();
  const context=vm.createContext({$:selector=>{
    if(!buttons.has(selector))buttons.set(selector,{disabled:false});return buttons.get(selector);
  }});
  vm.runInContext(script.slice(start,end),context);
  for(const kind of ['Users','Applications','Links']){
    const previous=()=>buttons.get('[data-act="previous'+kind+'"]'),next=()=>buttons.get('[data-act="next'+kind+'"]');
    context.updatePagination(kind,0,0);assert.equal(previous().disabled,true);assert.equal(next().disabled,true);
    context.updatePagination(kind,0,120);assert.equal(previous().disabled,true);assert.equal(next().disabled,false);
    context.updatePagination(kind,50,120);assert.equal(previous().disabled,false);assert.equal(next().disabled,false);
    context.updatePagination(kind,100,120);assert.equal(previous().disabled,false);assert.equal(next().disabled,true);
    context.updatePagination(kind,50,120,true);assert.equal(previous().disabled,true);assert.equal(next().disabled,true);
  }
});
