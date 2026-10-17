import { accountApi, accountFetch, getAccount, signOut } from "./account.js";
import { createAutosave, watchChanges, announceChange } from "./autosave.js";
import { animateDisclosures } from "./disclosure.js";
import { mainPlatform, avatarRequest } from "./editor-platform.js";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const links = ["youtube", "instagram", "twitter", "discord"];
let account, site, revision, usernameSaving = false;
function updateUsernameAvailability() {
  const nextChange = Date.parse(account.username_next_change_at);
  const locked = Number.isFinite(nextChange) && nextChange > Date.now();
  $("#usernameAvailability").textContent = locked
    ? "You can change your username again on " + new Date(nextChange).toLocaleString() + "."
    : "You can change your username now. After saving a change, wait 7 days before changing it again.";
  $("#usernameForm button").disabled = usernameSaving || locked;
  $("#accountUsername").readOnly = locked;
}
function status(message, error = false) { $("#status").textContent = message; $("#status").className = error ? "bad" : ""; }
const autosave = createAutosave({
  async write() {
    const form = $("#profileForm");
    if (!revision || !form) throw new Error("Load your linked profile before saving.");
    if (!form.reportValidity()) throw new Error("Check the highlighted profile fields.");
    const profile = Object.fromEntries([...form.querySelectorAll("[data-field]")].map(input => [input.dataset.field, input.value]));
    const original = site.editors.find(editor => editor.id === account.editor_id);
    profile.links = { ...original.links, ...Object.fromEntries([...form.querySelectorAll("[data-link]")].map(input => [input.dataset.link,input.value])) };
    const {ok,status:code,j} = await accountApi("/api/account/profile", {profile,revision});
    if (!ok) throw Object.assign(new Error(j.error || "Could not save your profile."), {status:code});
    revision = j.revision;
    site.editors = site.editors.map(editor => editor.id === account.editor_id ? {...editor,...profile} : editor);
    announceChange();
  },
  onState(state, error) {
    if (state === "error") status(error.message + (error.status === 409 ? " Your edits are kept here; reload when ready." : " Use Save now to retry."), true);
    else status({dirty:"Changes will save automatically…",saving:"Saving your profile…",saved:"Profile saved."}[state]);
    if ($("#saveNow")) $("#saveNow").disabled = state === "saving" || autosave.blocked;
  },
});

function render() {
  $("#identity").textContent = account.username || "Member";
  $("#publicProfileLink").href = "/profile/?account=" + encodeURIComponent(account.id);
  $("#publicProfileLink").hidden = false;
  $("#usernameForm").hidden = false;
  if(document.activeElement!==$("#accountUsername") && !$("#usernameForm").dataset.dirty) $("#accountUsername").value=account.username||"";
  updateUsernameAvailability();
  $("#manage").hidden = !account.roles.some(role => ["owner","list_contributor","application_reviewer"].includes(role));
  $("#signout").hidden = false;
  const editor = site.editors.find(editor => editor.id === account.editor_id);
  if (editor) {
    const input = (field,label,type="text",maximum=120) => `<div><label for="profile-${field}">${label}</label><input id="profile-${field}" data-field="${field}" type="${type}" maxlength="${maximum}" ${field==="name"?'required':''} value="${esc(editor[field])}"></div>`;
    $("#profile").innerHTML = `<p class="hint">Edit your own profile. Changes save automatically; rankings and style membership are managed by List Contributors.</p>
      <details class="card profile-card" open><summary>${esc(editor.name)}</summary><div class="profile-body"><form id="profileForm">
      <div class="two">${input("name","Name")}${input("handle","Handle")}${input("tiktok","TikTok username (without @)")}${input("software","Editing software")}</div>
      <div class="two editor-platform-fields"><div><label for="profile-main_platform">Main platform</label><select id="profile-main_platform" data-field="main_platform">${["TikTok","YouTube"].map(p=>`<option ${mainPlatform(editor)===p?'selected':''}>${p}</option>`).join("")}</select></div>
      <div><label for="link-youtube">YouTube channel URL</label><input id="link-youtube" data-link="youtube" type="url" maxlength="2000" value="${esc(editor.links?.youtube)}" placeholder="https://www.youtube.com/@yourchannel"></div></div>
      <p class="hint">The main platform sets your ranking link and picture source. Fetch a picture after changing it. Both social links are kept.</p>
      ${input("thumb","Profile picture URL","url",2000)}<button type="button" id="fetchPic">Fetch picture from ${mainPlatform(editor)}</button>
      <p id="pictureNotice" class="hint" role="status"></p>
      ${input("video","Showcase YouTube URL","url",2000)}
      <label for="profile-note">About</label><textarea id="profile-note" data-field="note" maxlength="2000">${esc(editor.note)}</textarea>
      <div class="two">${links.filter(link=>link!=="youtube").map(link=>`<div><label for="link-${link}">${link[0].toUpperCase()+link.slice(1)} URL</label><input id="link-${link}" data-link="${link}" type="url" maxlength="2000" value="${esc(editor.links?.[link])}"></div>`).join("")}</div>
      <button id="saveNow" type="submit" class="pri">Save now</button></form></div></details>`;
    $("#profileForm").addEventListener("input", () => autosave.change());
    $("#profileForm").addEventListener("submit", event => {event.preventDefault();void autosave.flush()});
    const pictureSource=()=>avatarRequest({id:account.editor_id,main_platform:$("#profile-main_platform").value,tiktok:$("#profile-tiktok").value,links:{youtube:$("#link-youtube").value,tiktok:editor.links?.tiktok}});
    $("#profile-main_platform").addEventListener("change",()=>{$("#fetchPic").textContent="Fetch picture from "+$("#profile-main_platform").value});
    $("#fetchPic").addEventListener("click", async event => {
      const button = event.currentTarget;button.disabled = true;
      const form=$("#profileForm"),notice=$("#pictureNotice");
      const source=pictureSource(),previous=$("#profile-thumb").value;
      notice.textContent="Fetching picture from "+source.platform+"…";
      try {
        const {ok,j} = await accountApi("/api/avatar", source);
        if (!ok) throw new Error(j.error || "Could not fetch the picture.");
        if($("#profileForm")!==form)return;
        if(JSON.stringify(pictureSource())!==JSON.stringify(source)||$("#profile-thumb").value!==previous)throw new Error("Your profile changed during the fetch. Your current picture is kept; fetch again when ready.");
        $("#profile-thumb").value = j.url;autosave.change();
        notice.textContent="Picture fetched. Changes save automatically.";
      } catch(error) {notice.textContent=error.message} finally {button.disabled=false}
    });
    animateDisclosures($("#profile"));
  } else {
    $("#profile").innerHTML = `<h2>Link your editor profile</h2><p class="hint">Connect TikTok to link an unclaimed editor profile with the same TikTok username automatically. If REL cannot match it, choose your profile below and request Owner review.</p>${account.claim_status?`<p class="hint">Last request: ${esc(account.claim_status)}.</p>`:""}
      <form id="claimForm"><label for="claimEditor">Your editor profile</label><select id="claimEditor" required><option value="">Choose your profile</option>${site.editors.map(editor=>`<option value="${esc(editor.id)}">${esc(editor.name)}</option>`).join("")}</select>
      <label for="claimMessage">Verification details</label><textarea id="claimMessage" required maxlength="1000"></textarea><button class="pri" data-icon="link">Request profile link</button></form><p id="claimNotice" role="status">${account.claim_status==="pending"?"Request sent. An Owner will verify your profile before linking it.":""}</p>`;
    $("#claimForm").addEventListener("submit",async event=>{
      event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;
      try {
        const {ok,j}=await accountApi("/api/account/claim",{editorId:$("#claimEditor").value,message:$("#claimMessage").value});
        if(!ok)throw new Error(j.error||"Could not request the link.");
        $("#claimNotice").textContent="Request sent. An Owner will verify your profile before linking it.";announceChange();
      }catch(error){$("#claimNotice").textContent=error.message}finally{button.disabled=false}
    });
  }
}

$("#usernameForm").addEventListener("input",()=>{$("#usernameForm").dataset.dirty="true"});
$("#usernameForm").addEventListener("submit",async event=>{
  event.preventDefault();usernameSaving=true;updateUsernameAvailability();
  $("#usernameNotice").textContent="Saving username…";
  try{
    const {ok,j}=await accountApi("/api/account/username",{username:$("#accountUsername").value});
    if(!ok)throw new Error(j.error||"Could not save your username.");
    account.username=j.username;$("#identity").textContent=j.username;$("#accountUsername").value=j.username;
    account.username_next_change_at=j.username_next_change_at;
    delete $("#usernameForm").dataset.dirty;$("#usernameNotice").textContent="Username saved.";announceChange();
  }catch(error){$("#usernameNotice").textContent=error.message}finally{usernameSaving=false;updateUsernameAvailability()}
});

$("#signout").addEventListener("click",async()=>{
  if(autosave.busy||usernameSaving){status("Wait for your save to finish before signing out.");return}
  if((autosave.dirty||$("#usernameForm").dataset.dirty)&&!confirm("Sign out and discard unsaved changes?"))return;
  autosave.pause();
  try{await signOut();delete $("#usernameForm").dataset.dirty;autosave.reset();location.replace("/signin/")}catch(error){status(error.message,true)}
});
window.addEventListener("beforeunload",event=>{if(autosave.dirty||$("#usernameForm").dataset.dirty){event.preventDefault();event.returnValue=""}});
async function refresh() {
  const nextAccount=await getAccount();if(!nextAccount)return;
  if (!usernameSaving && account) {
    account.username_next_change_at=nextAccount.username_next_change_at;
    updateUsernameAvailability();
  }
  const response=await accountFetch("/api/account/site");
  if(!response.ok)throw new Error("Could not load your profile. Saving is unavailable.");
  const next=await response.json();
  if(!next.revision||!Array.isArray(next.data?.editors))throw new Error("Your live profile did not load.");
  const changed=revision!==next.revision||JSON.stringify(account)!==JSON.stringify(nextAccount);
  if(autosave.dirty||autosave.busy)return;
  const claimForm=$("#claimForm");
  if(claimForm&&!nextAccount.editor_id&&($("#claimEditor").value||$("#claimMessage").value)){
    account=nextAccount;$("#manage").hidden=!account.roles.some(role=>["owner","list_contributor","application_reviewer"].includes(role));return;
  }
  if(revision && $("#profile").contains(document.activeElement))return;
  if(changed){account=nextAccount;site=next.data;revision=next.revision;render();status("Changes save automatically.")}
}
window.addEventListener("rel-profile-linked",()=>{void refresh().catch(error=>status(error.message,true))});
try{await refresh()}catch(error){status(error.message,true)}
watchChanges(refresh);
