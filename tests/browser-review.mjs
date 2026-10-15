// Runs only against the isolated fixture, never a production URL or database.
import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";

const port=Number(process.env.REL_PREVIEW_PORT||8789);
assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
const base = "http://127.0.0.1:"+port;
const data = await (await fetch(base + "/api/data")).json();
assert.deepEqual(data.editors.map(editor => editor.name).sort(), ["One", "Two"]);
const version = await (await fetch("http://127.0.0.1:9223/json/version")).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {socket.addEventListener("open", resolve);socket.addEventListener("error", reject)});
let nextId = 0;
const pending = new Map(), exceptions = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if(message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
  if(!message.id) return;
  const callback = pending.get(message.id);pending.delete(message.id);
  if(message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;pending.set(id, {resolve,reject});
    socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
  });
}
async function newPage() {
  const {browserContextId} = await send("Target.createBrowserContext");
  const {targetId} = await send("Target.createTarget", {url:"about:blank",browserContextId});
  const {sessionId} = await send("Target.attachToTarget", {targetId,flatten:true});
  await send("Page.enable",{},sessionId);await send("Runtime.enable",{},sessionId);
  return {sessionId,browserContextId};
}
async function evaluate(page, expression) {
  const result = await send("Runtime.evaluate", {expression,returnByValue:true,awaitPromise:true},page.sessionId);
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(page, expression) {
  for(let tries=0;tries<200;tries++) {if(await evaluate(page,expression))return;await delay(100)}
  throw new Error("Timed out: " + expression);
}
async function navigate(page, path) {
  await send("Page.navigate",{url:base + path},page.sessionId);
  await waitFor(page, `location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'`);
  await evaluate(page,"document.fonts.ready.then(() => true)");
}
async function click(page, selector) {
  await evaluate(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function fill(page, selector, value) {
  await evaluate(page, `(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
}
async function key(page, key, code, windowsVirtualKeyCode) {
  for(const type of ["keyDown","keyUp"])await send("Input.dispatchKeyEvent",{type,key,code,windowsVirtualKeyCode},page.sessionId);
}
async function screenshot(page, name) {
  const {data} = await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},page.sessionId);
  await writeFile(new URL(`../.wrangler/ui-review/${name}.png`,import.meta.url),Buffer.from(data,"base64"));
}
async function checkLayout(page, name, widths = [1440,768,390,320]) {
  for(const width of widths) {
    await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<500},page.sessionId);
    await delay(100);
    const state = await evaluate(page, `(()=>({
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      fonts:[...document.querySelectorAll('body,button,input,select,textarea,h1,h2,h3,nav,table,a')].filter(e=>e.getClientRects().length).filter(e=>!getComputedStyle(e).fontFamily.includes('Red Hat Text')).map(e=>e.tagName+':'+getComputedStyle(e).fontFamily),
      loaded:[...document.fonts].some(font=>font.family.includes('Red Hat Text')&&font.status==='loaded')
    }))()`);
    assert.ok(state.scrollWidth <= state.width, `${name} overflow at ${width}: ${JSON.stringify(state)}`);
    assert.deepEqual(state.fonts,[],`${name} font mismatch`);
    assert.equal(state.loaded,true,`${name} Google font did not load`);
    if(width===1440||width===390||width===320)await screenshot(page,`${name}-${width}`);
  }
  console.log(`PASS ${name}: fonts and layout at ${widths.join(', ')}px`);
}
async function signIn(page, name) {
  await navigate(page,"/signin/");
  await fill(page,"#email",name+"@example.test");await fill(page,"#password","test-password-123");
  await click(page,"#submit");
  const member=name==='member'||name==='stranger';
  await waitFor(page,member?"location.pathname==='/account/' && document.querySelector('#profile').textContent.length>0":"location.pathname==='/admin/' && document.querySelector('#ui') && !document.querySelector('#ui').hidden");
}

await mkdir(new URL("../.wrangler/ui-review/",import.meta.url),{recursive:true});
const contexts = [];
try {
  const publicPage = await newPage();contexts.push(publicPage);
  await navigate(publicPage,"/changelog/");await checkLayout(publicPage,"changelog");
  assert.equal(await evaluate(publicPage,"document.querySelector('article').textContent.includes('Released')"),true);
  const slashless=await fetch(base+'/apply',{redirect:'manual'});assert.equal(slashless.status,301);assert.equal(slashless.headers.get('location'),'/apply/');
  await navigate(publicPage,"/");await checkLayout(publicPage,"home");
  assert.equal(await evaluate(publicPage,"document.querySelector('a[href=\"/apply/\"]').textContent"),"Apply to Be on the List");
  await click(publicPage,'a[href="/apply/"]');await waitFor(publicPage,"location.pathname==='/apply/'");
  await checkLayout(publicPage,"application");
  await waitFor(publicPage,"document.querySelector('#styleOptions input')!==null");
  assert.equal(await evaluate(publicPage,"document.querySelector('#styleOptions input').value"),"Test style");
  for(const [field,value] of Object.entries({displayName:"Browser fixture applicant",platform:"TikTok",profileUrl:"https://www.tiktok.com/@fixture_applicant",software:"CapCut",examplesUrl:"https://www.youtube.com/watch?v=abcdefghijk"}))await fill(publicPage,'[name="'+field+'"]',value);
  await click(publicPage,"#consent");
  await click(publicPage,"#submitButton");
  assert.match(await evaluate(publicPage,"document.querySelector('#message').textContent"),/Choose at least one/);
  await click(publicPage,"#otherStyleCheckbox");await fill(publicPage,"#otherStyle","Browser fixture style");
  await click(publicPage,"#styleOptions input");
  await click(publicPage,"#submitButton");await waitFor(publicPage,"document.querySelector('#message').classList.contains('ok')");
  assert.equal(await evaluate(publicPage,"document.querySelector('#otherStyleField').hidden"),true);
  await navigate(publicPage,"/list/");await waitFor(publicPage,"document.querySelector('[data-profile]')!==null");
  await checkLayout(publicPage,"rankings");
  assert.equal(await evaluate(publicPage,"document.querySelector('#cta').getAttribute('href')"),"/apply/");
  assert.equal(await evaluate(publicPage,"document.querySelector('#cta').textContent.trim()"),"Apply to Be on the List");
  await click(publicPage,"#cta");await waitFor(publicPage,"location.pathname==='/apply/'");
  await navigate(publicPage,"/signin/");await checkLayout(publicPage,"signin");
  await key(publicPage,"Tab","Tab",9);
  assert.equal(await evaluate(publicPage,"document.activeElement.classList.contains('rel-brand')"),true);
  await key(publicPage,"Tab","Tab",9);
  assert.equal(await evaluate(publicPage,"document.activeElement.id"),"email");
  assert.notEqual(await evaluate(publicPage,"getComputedStyle(document.activeElement).outlineStyle"),"none");
  await click(publicPage,"#switch");await checkLayout(publicPage,"signup");
  await fill(publicPage,"#email","browser-fixture@example.test");await fill(publicPage,"#password","SignupTest123");
  await click(publicPage,"#submit");
  assert.equal(await evaluate(publicPage,"document.querySelector('#signupUsername').validity.valueMissing"),true);
  await fill(publicPage,"#signupUsername","Browser_Member");
  await click(publicPage,"#submit");await waitFor(publicPage,"document.querySelector('#message').textContent.includes('confirm') && !document.querySelector('#submit').disabled");
  await navigate(publicPage,"/test-email/signup/");await checkLayout(publicPage,"signup-email");
  assert.equal(await evaluate(publicPage,"document.querySelector('img').naturalWidth>0"),true);
  await click(publicPage,'a[href*="/email-verified/"]');
  await waitFor(publicPage,"document.querySelector('#title')?.textContent==='Email verified'");
  assert.equal(await evaluate(publicPage,"location.hash"),"");
  assert.equal(await evaluate(publicPage,"document.cookie.includes('rel_access')"),false);
  await checkLayout(publicPage,"email-verified");
  await click(publicPage,'a[href="/signin/"]');await waitFor(publicPage,"location.pathname==='/signin/'");
  await navigate(publicPage,"/email-verified/");
  await waitFor(publicPage,"document.querySelector('#confirmation').getAttribute('aria-busy')==='false'");
  assert.equal(await evaluate(publicPage,"document.querySelector('#title').textContent"),"Email confirmation");
  await send("Page.navigate",{url:base+"/email-verified/#error=access_denied&error_code=otp_expired"},publicPage.sessionId);
  await waitFor(publicPage,"document.querySelector('#message')?.textContent.includes('invalid or expired')");
  assert.equal(await evaluate(publicPage,"location.hash"),"");
  await checkLayout(publicPage,"email-confirmation-error");
  await navigate(publicPage,"/test-email/recovery/");await checkLayout(publicPage,"recovery-email");
  assert.equal(await evaluate(publicPage,"document.querySelector('img').naturalWidth>0"),true);
  await click(publicPage,'a[href*="/reset-password/"]');await waitFor(publicPage,"location.pathname==='/reset-password/'");

  const owner = await newPage();contexts.push(owner);await signIn(owner,"owner");
  await checkLayout(owner,"owner-profile");
  await click(owner,'[data-act="tab"][data-v="users"]');await waitFor(owner,"document.querySelector('form[data-user]')!==null");
  assert.equal(await evaluate(owner,"document.querySelector('[data-act=previousUsers]').disabled && document.querySelector('[data-act=nextUsers]').disabled"),true);
  await evaluate(owner, `(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(args[0]==='/api/account/users' && response.ok){const data=await response.clone().json();if(data.users){if(window.relReviewCase==='error')return new Response(JSON.stringify({error:'Fixture list unavailable.'}),{status:503});if(window.relReviewCase==='empty'){data.users=[];data.total=0}else data.users[0].username='very-long-fixture-username-'.repeat(8);return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})}}return response}})()`);
  await click(owner,'[data-act="refreshUsers"]');await waitFor(owner,"document.querySelector('#usersList').textContent.includes('very-long-fixture')");
  await checkLayout(owner,"owner-users");
  assert.equal(await evaluate(owner,"[...document.querySelectorAll('select[name=editorId]')].every(e=>e.labels.length===1)"),true);
  await evaluate(owner,"document.querySelector('select[name=editorId]').focus()");
  assert.notEqual(await evaluate(owner,"getComputedStyle(document.activeElement).outlineStyle"),"none");
  await evaluate(owner,"window.relReviewCase='empty'");await click(owner,'[data-act="refreshUsers"]');
  await waitFor(owner,"document.querySelector('#usersList').textContent.includes('No accounts')");
  assert.equal(await evaluate(owner,"document.querySelector('[data-act=previousUsers]').disabled && document.querySelector('[data-act=nextUsers]').disabled"),true);
  await evaluate(owner,"window.relReviewCase='error'");await click(owner,'[data-act="refreshUsers"]');
  await waitFor(owner,"document.querySelector('#usersNotice').textContent.includes('Use Refresh users to retry')");
  assert.equal(await evaluate(owner,"document.querySelector('#usersList').textContent"),"");
  await evaluate(owner,"window.relReviewCase='normal'");await click(owner,'[data-act="refreshUsers"]');
  await waitFor(owner,"document.querySelector('form[data-user]')!==null");

  const member = await newPage();contexts.push(member);await signIn(member,"member");
  assert.equal(await evaluate(member,"document.querySelector('#manage').hidden"),true);
  await fill(member,"#accountUsername","owner");await click(member,"#usernameForm button");
  await waitFor(member,"document.querySelector('#usernameNotice').textContent.includes('already taken')");
  await fill(member,"#accountUsername","Member_Editor");await click(member,"#usernameForm button");
  await waitFor(member,"document.querySelector('#usernameNotice').textContent==='Username saved.'");
  assert.equal(await evaluate(member,"document.querySelector('#identity').textContent"),"member_editor");
  assert.equal(await evaluate(member,"document.querySelector('#accountUsername').readOnly && document.querySelector('#usernameForm button').disabled"),true);
  assert.match(await evaluate(member,"document.querySelector('#usernameAvailability').textContent"),/again on/);
  await checkLayout(member,"username-cooldown");
  await click(member,"details summary");await delay(300);assert.equal(await evaluate(member,"document.querySelector('details').open"),false);
  await click(member,"details summary");assert.equal(await evaluate(member,"document.getAnimations().length>0"),true);await delay(300);
  await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]},member.sessionId);
  await click(member,"details summary");assert.equal(await evaluate(member,"document.querySelector('details').open"),false);
  await click(member,"details summary");assert.equal(await evaluate(member,"document.querySelector('.profile-body').inert"),false);
  await fill(member,'#profile-software',"Browser fixture CapCut");
  await waitFor(member,"document.querySelector('#status').textContent==='Profile saved.'");
  assert.equal(await evaluate(member,"document.querySelector('#profile-software').labels.length"),1);
  await checkLayout(member,"member-profile");
  await navigate(publicPage,"/list/");await waitFor(publicPage,"document.querySelector('[data-profile=editor1]')!==null");
  await click(publicPage,'[data-profile="editor1"]');await waitFor(publicPage,"document.querySelector('#drawer').open");
  assert.match(await evaluate(publicPage,"document.querySelector('#drawer').textContent"),/Browser fixture CapCut/);
  await checkLayout(publicPage,"public-profile");
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27},publicPage.sessionId);
  await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27},publicPage.sessionId);
  await waitFor(publicPage,"!document.querySelector('#drawer').open");

  const stranger = await newPage();contexts.push(stranger);await signIn(stranger,"stranger");
  await checkLayout(stranger,"profile-link");
  await fill(stranger,"#claimEditor","editor2");await fill(stranger,"#claimMessage","Browser fixture verification");
  await click(stranger,"#claimForm button");await waitFor(stranger,"document.querySelector('#claimNotice').textContent.includes('Request sent')");
  await click(owner,'[data-act="tab"][data-v="links"]');await waitFor(owner,"document.querySelector('[data-act=approveClaim]')!==null");
  await checkLayout(owner,"profile-link-queue");
  await click(owner,'[data-act="approveClaim"]');
  await waitFor(owner,"document.querySelector('#linksList').textContent.includes('No profile link requests')");
  await fill(owner,"#linkFilter","approved");await waitFor(owner,"document.querySelector('#linksList').textContent.includes('Reviewed by owner')");
  await click(owner,'[data-act="tab"][data-v="users"]');await waitFor(owner,"document.querySelector('form[data-user]')!==null");
  const strangerForm='form[data-user="00000000-0000-4000-8000-000000000005"]';
  await click(owner,strangerForm+' input[value="application_reviewer"]');await click(owner,strangerForm+' button');
  await waitFor(owner,"document.querySelector('#status').textContent==='Account permissions updated.'");
  await send("Page.reload",{},stranger.sessionId);await waitFor(stranger,"document.querySelector('#manage') && !document.querySelector('#manage').hidden && document.querySelector('#profileForm')");
  assert.equal(await evaluate(stranger,"document.querySelector('#profile-name').value"),"Two");
  await waitFor(owner,"document.querySelector('form[data-user]')!==null");
  await click(owner,strangerForm+' input[value="application_reviewer"]');await click(owner,strangerForm+' button');
  await send("Page.reload",{},stranger.sessionId);await waitFor(stranger,"document.querySelector('#profileForm') && document.querySelector('#manage').hidden");
  const contributor = await newPage();contexts.push(contributor);await signIn(contributor,"contributor");
  assert.equal(await evaluate(contributor,"document.querySelector('#tabs').textContent.includes('Users & roles')"),false);
  await click(contributor,'[data-act="tab"][data-v="rank"]');await waitFor(contributor,"document.querySelector('#rankList')!==null");
  await checkLayout(contributor,"contributor");
  await click(contributor,'[data-act="up"][data-id="editor1"]');await waitFor(contributor,"document.querySelector('#status').textContent==='Saved. Live on the site.'");
  await navigate(publicPage,"/list/");await waitFor(publicPage,"document.querySelector('[data-profile]')!==null");
  await click(contributor,'[data-act="down"][data-id="editor1"]');await waitFor(contributor,"document.querySelector('#status').textContent==='Saved. Live on the site.'");
  await send('Page.bringToFront',{},publicPage.sessionId);
  await waitFor(publicPage,"document.querySelector('.row .nm').textContent==='Two'");
  const optionsPage=await newPage();contexts.push(optionsPage);await navigate(optionsPage,'/apply/');
  await waitFor(optionsPage,"document.querySelector('#styleOptions input')!==null");
  await fill(optionsPage,'#displayName','Draft kept during style updates');await click(optionsPage,'#styleOptions input');
  await click(contributor,'[data-act="tab"][data-v="styles"]');await click(contributor,'[data-act="addStyle"]');
  await fill(contributor,'[data-t="s"][data-i="1"][data-f="name"]','New browser style');
  await waitFor(contributor,"document.querySelector('#status').textContent==='Saved. Live on the site.'");
  await send('Page.bringToFront',{},optionsPage.sessionId);
  await waitFor(optionsPage,"[...document.querySelectorAll('#styleOptions input')].some(input=>input.value==='New browser style')");
  assert.equal(await evaluate(optionsPage,"document.querySelector('#displayName').value"),'Draft kept during style updates');
  assert.equal(await evaluate(optionsPage,"document.querySelector('#styleOptions input').checked"),true);
  await checkLayout(optionsPage,'live-style-options');
  await click(contributor,'[data-act="tab"][data-v="editors"]');await waitFor(contributor,"document.querySelector('#pendingTitle').textContent==='Pending - (0)'");
  assert.equal(await evaluate(publicPage,`fetch('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Rejected browser applicant',platform:'YouTube',profileUrl:'https://youtube.com/@rejected',software:'CapCut',styles:['Test style'],examplesUrl:'https://example.test'})}).then(response=>response.status)`),201);
  const reviewer = await newPage();contexts.push(reviewer);await signIn(reviewer,"reviewer");
  await evaluate(reviewer,'window.confirm=()=>true');
  assert.equal(await evaluate(reviewer,"document.querySelector('#tabs').textContent.includes('Profile link requests')"),false);
  await click(reviewer,'[data-act="tab"][data-v="applications"]');
  await waitFor(reviewer,"document.querySelector('[data-act=applicationStatus]')!==null");
  const rejectedId=await evaluate(reviewer,"[...document.querySelectorAll('[data-application]')].find(card=>card.querySelector('h3').textContent==='Rejected browser applicant').dataset.application");
  await click(reviewer,`[data-act="applicationStatus"][data-id="${rejectedId}"][data-status="rejected"]`);
  assert.match(await evaluate(reviewer,"document.querySelector('#status').textContent"),/Enter a reason/);
  await fill(reviewer,'#review-reason-'+rejectedId,'Private rejection reason');
  await click(reviewer,`[data-act="applicationStatus"][data-id="${rejectedId}"][data-status="rejected"]`);
  await waitFor(reviewer,`document.querySelector('[data-application="${rejectedId}"] .app-status.rejected')!==null`);
  assert.equal(await evaluate(reviewer,`document.querySelectorAll('[data-application="${rejectedId}"] [data-act=applicationStatus]').length`),0);
  assert.equal(await evaluate(reviewer,`document.querySelector('#review-reason-${rejectedId}').readOnly`),true);
  const approvedId=await evaluate(reviewer,"document.querySelector('.app-status.pending').closest('[data-application]').dataset.application");
  await fill(reviewer,'#review-reason-'+approvedId,'Private approval reason');
  await click(reviewer,`[data-act="applicationStatus"][data-id="${approvedId}"][data-status="approved"]`);
  await send('Page.bringToFront',{},contributor.sessionId);
  await waitFor(reviewer,`document.querySelector('[data-application="${approvedId}"]').textContent.includes('Approved by reviewer')`);
  assert.equal(await evaluate(reviewer,`document.querySelectorAll('[data-application="${approvedId}"] [data-act=applicationStatus]').length`),0);
  assert.equal(await evaluate(reviewer,"document.body.textContent.includes('@example.test')"),false);
  await checkLayout(reviewer,"reviewer");
  await waitFor(contributor,"document.querySelector('#pendingTitle').textContent==='Pending - (1)'");
  assert.equal(await evaluate(publicPage,"document.body.textContent.includes('Browser fixture applicant')"),false);
  await click(contributor,"#pendingQueue summary");await delay(300);await checkLayout(contributor,"approved-queue");
  const beforeConversion = await (await fetch(base+"/api/data")).json();
  await evaluate(contributor,'window.confirm=()=>true');
  await click(contributor,'[data-act="convertApplication"]');
  await waitFor(contributor,"document.querySelector('#pendingTitle').textContent==='Pending - (0)'");
  await send('Page.bringToFront',{},publicPage.sessionId);
  await waitFor(publicPage,"document.querySelector('#list').textContent.includes('Browser fixture applicant')");
  const after = await (await fetch(base+"/api/data")).json();
  assert.deepEqual(after.lists.main.slice(0,-1),beforeConversion.lists.main);
  assert.equal(after.editors.at(-1).name,'Browser fixture applicant');assert.ok(!JSON.stringify(after).includes('Private approval reason'));
  for(const page of [member,stranger,reviewer,contributor,owner]) {
    await click(page,"#signout");await waitFor(page,"location.pathname==='/signin/'");
    await send("Page.navigate",{url:base+"/admin/"},page.sessionId);await waitFor(page,"location.pathname==='/signin/'");
  }
  await signIn(member,"member");
  assert.equal(await evaluate(member,"document.querySelector('#manage').hidden"),true);
  const recoveryPage=await newPage();contexts.push(recoveryPage);
  await navigate(recoveryPage,"/signin/");await click(recoveryPage,"#forgotPassword");
  await waitFor(recoveryPage,"location.pathname==='/reset-password/' && document.querySelector('#haveCode')!==null");
  await checkLayout(recoveryPage,"recovery-request");
  await fill(recoveryPage,"#email","reviewer@example.test");
  await click(recoveryPage,"#haveCode");
  assert.equal(await evaluate(recoveryPage,"document.querySelector('#recoveryFields').hidden"),false);
  await click(recoveryPage,"#changeEmail");
  assert.equal(await evaluate(recoveryPage,"document.querySelector('#email').readOnly"),false);
  await click(recoveryPage,"#submit");
  await waitFor(recoveryPage,"!document.querySelector('#recoveryFields').hidden && !document.querySelector('#submit').disabled");
  await checkLayout(recoveryPage,"recovery-code");
  assert.equal(await evaluate(recoveryPage,"document.activeElement.id"),"code");
  await fill(recoveryPage,"#code","000000");
  await fill(recoveryPage,"#password","Abcdef12");await fill(recoveryPage,"#confirmPassword","Different123");
  await click(recoveryPage,"#submit");
  assert.match(await evaluate(recoveryPage,"document.querySelector('#message').textContent"),/do not match/);
  await fill(recoveryPage,"#confirmPassword","Abcdef12");await click(recoveryPage,"#submit");
  await waitFor(recoveryPage,"document.querySelector('#message').textContent.includes('invalid or expired')");
  await fill(recoveryPage,"#password","");await fill(recoveryPage,"#confirmPassword","");
  await click(recoveryPage,"#resend");
  await waitFor(recoveryPage,"document.querySelector('#message').textContent.includes('on its way') && !document.querySelector('#submit').disabled");
  await fill(recoveryPage,"#code","123456");
  await fill(recoveryPage,"#password","abcdefgh1");await fill(recoveryPage,"#confirmPassword","abcdefgh1");
  assert.equal(await evaluate(recoveryPage,"document.querySelector('#password').checkValidity()"),false);
  await fill(recoveryPage,"#password","Abcdef12");await fill(recoveryPage,"#confirmPassword","Abcdef12");
  await click(recoveryPage,"#submit");
  await waitFor(recoveryPage,"document.querySelector('#message').textContent.includes('Password changed')");
  await checkLayout(recoveryPage,"recovery-success");
  assert.equal(await evaluate(recoveryPage,"document.querySelector('#resetForm').hidden"),true);
  assert.equal(await evaluate(recoveryPage,"document.querySelector('#password').value"),"");
  await click(recoveryPage,'a[href="/signin/"]');await waitFor(recoveryPage,"location.pathname==='/signin/'");
  await fill(recoveryPage,"#email","reviewer@example.test");await fill(recoveryPage,"#password","Abcdef12");
  await click(recoveryPage,"#submit");await waitFor(recoveryPage,"location.pathname==='/admin/' && document.querySelector('#signout')!==null");
  await click(recoveryPage,"#signout");await waitFor(recoveryPage,"location.pathname==='/signin/'");
  assert.deepEqual(exceptions,[]);
  console.log("PASS password recovery: request, existing code, change email, mismatch, invalid code, resend without a password, password policy, reset and fresh sign-in; desktop/mobile layouts.");
  console.log("PASS branded signup/recovery emails and verified/expired/missing confirmation states; verified state returns to sign-in without creating login cookies.");
  console.log("PASS autosave/live rank refresh, private approvals/conversion, Member account separation, animated/reduced-motion disclosure, sessions and both application URLs; conversion preserved existing rank order.");
} finally {
  for(const context of contexts)await send("Target.disposeBrowserContext",{browserContextId:context.browserContextId});
  socket.close();
}
