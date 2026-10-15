import { accountFetch, accountApi } from "./account.js";
import { announceChange } from "./autosave.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const tiers = {owners:"Owners",developers:"Developers",reviewers:"Reviewers",rankers:"Rankers"};
let credits = [], revision, dirty = false, busy = false, blocked = false, root, manageLinks;
let message = "", error = false;
export const contributorEditsPending = () => dirty;
export function clearContributorDraft() { credits=[];revision=undefined;dirty=false;busy=false;blocked=false; }
function notice(text, bad = false) { message=text;error=bad;const target=root?.querySelector("#creditsNotice");if(target){target.textContent=text;target.className=bad?"status bad":"hint";} }
function controls() {
  if (!root?.isConnected) return;
  root.querySelector("#saveContributors")?.toggleAttribute("disabled", busy || !dirty || blocked);
  root.querySelector("#manageContributorLinks")?.toggleAttribute("disabled", busy || dirty);
}
function render() {
  if (!root?.isConnected) return;
  root.innerHTML = `<section class="account-panel"><h2>Contributors</h2><p class="hint">Manage the names and tiers shown on the homepage. People can be credited before they create an account. Changes publish when you save.</p>
    <p id="creditsNotice" class="${error?'status bad':'hint'}" role="status">${esc(message)}</p>
    <div class="inline"><button type="button" id="reloadContributors" ${busy?'disabled':''}>Reload contributors</button><button type="button" id="manageContributorLinks" ${busy||dirty?'disabled':''}>Manage account links</button></div>
    ${revision ? `<form id="contributorForm"><fieldset class="credit-fields" ${busy?'disabled':''}><div id="creditRows">${credits.map((c,index)=>`<article class="card" data-credit="${esc(c.id)}">
      <h3>${esc(c.name || 'New contributor')}${c.hidden?' (hidden)':''}</h3>
      <label for="credit-name-${esc(c.id)}">Display name</label><input type="text" id="credit-name-${esc(c.id)}" data-field="name" maxlength="60" required value="${esc(c.name)}">
      <label for="credit-description-${esc(c.id)}">Contribution</label><input type="text" id="credit-description-${esc(c.id)}" data-field="contribution" maxlength="200" value="${esc(c.contribution)}">
      <fieldset class="credit-tiers"><legend>Public tiers</legend><div class="flarepick">${Object.entries(tiers).map(([id,label])=>`<label><input type="checkbox" data-tier="${id}" ${c.tiers.includes(id)?'checked':''}>${label}</label>`).join('')}</div></fieldset>
      <label class="credit-hide"><input type="checkbox" data-field="hidden" ${c.hidden?'checked':''}>Hide this credit from public pages</label>
      <p class="hint">${c.account?'Linked account: '+esc(c.account.username):'No account linked.'}</p>
      <div class="inline"><button type="button" data-move="-1" aria-label="Move ${esc(c.name||'new contributor')} up" ${index===0?'disabled':''}>Move up</button><button type="button" data-move="1" aria-label="Move ${esc(c.name||'new contributor')} down" ${index===credits.length-1?'disabled':''}>Move down</button>${!c.newRecord&&!c.hidden?`<a class="public-profile-link rel-text-link" href="/profile/?contributor=${encodeURIComponent(c.id)}">View profile</a>`:''}</div>
      </article>`).join('') || '<p class="hint">No contributor credits yet. Add a contributor to begin.</p>'}</div>
      <button type="button" id="addContributor" ${credits.length>=100?'disabled':''}>Add contributor</button><button type="submit" class="pri" id="saveContributors" ${busy||!dirty||blocked?'disabled':''}>${busy?'Saving contributors…':'Save contributors'}</button></fieldset></form>` : ''}</section>`;
  root.querySelector("#reloadContributors").addEventListener("click",()=>{if(!dirty||confirm("Reload contributors and discard these unsaved credit edits?"))void load()});
  root.querySelector("#manageContributorLinks").addEventListener("click",()=>manageLinks());
  root.querySelector("#addContributor")?.addEventListener("click",()=>{
    const c={id:"credit-"+crypto.randomUUID(),name:"",contribution:"",tiers:["rankers"],hidden:false,account:null,newRecord:true};
    credits.push(c);dirty=true;notice("New contributor added to your draft. Enter a name, choose tiers and save to publish.");render();root.querySelector('#credit-name-'+c.id).focus();
  });
  root.querySelector("#contributorForm")?.addEventListener("input",event=>{
    const target=event.target,c=credits.find(c=>c.id===target.closest('[data-credit]')?.dataset.credit);if(!c)return;
    if(target.dataset.tier){c.tiers=c.tiers.filter(t=>t!==target.dataset.tier);if(target.checked)c.tiers.push(target.dataset.tier);}
    else if(target.dataset.field)c[target.dataset.field]=target.dataset.field==='hidden'?target.checked:target.value;
    dirty=true;notice(blocked?"These credits changed elsewhere. Your draft is kept here; reload before saving.":"Unsaved contributor changes. Save contributors to publish.");controls();
  });
  root.querySelector("#contributorForm")?.addEventListener("click",event=>{
    const button=event.target.closest('[data-move]');if(!button)return;
    const id=button.closest('[data-credit]').dataset.credit,index=credits.findIndex(c=>c.id===id),next=index+Number(button.dataset.move);
    if(next<0||next>=credits.length)return;
    [credits[index],credits[next]]=[credits[next],credits[index]];dirty=true;notice("Contributor order changed. Save contributors to publish.");render();
    const preferred=root.querySelector(`[data-credit="${id}"] [data-move="${button.dataset.move}"]`);
    (preferred.disabled?root.querySelector(`[data-credit="${id}"] [data-move="${-Number(button.dataset.move)}"]`):preferred).focus();
  });
  root.querySelector("#contributorForm")?.addEventListener("submit",async event=>{
    event.preventDefault();if(busy||blocked||!dirty)return;
    if(credits.some(c=>!c.name.trim())){notice("Enter a display name for every contributor.",true);return;}
    if(credits.some(c=>!c.tiers.length)){notice("Choose at least one public tier for each contributor.",true);return;}
    busy=true;notice("Saving contributors…");render();
    try{
      const payload=credits.map(({id,name,contribution,tiers,hidden})=>({id,name,contribution,tiers,hidden}));
      const {ok,status,j}=await accountApi('/api/account/contributors',{revision,credits:payload});
      if(!ok){blocked=status===409;throw Error(j.error||"Could not save contributors.");}
      credits=j.credits;revision=j.revision;dirty=false;notice("Contributors saved. The homepage will update shortly.");announceChange();
    }catch(e){notice(e.message+" Your edits are kept here.",true)}finally{busy=false;render()}
  });
}
async function load() {
  if(busy)return;busy=true;notice("Loading contributors…");render();
  try{
    const response=await accountFetch('/api/account/contributors'),data=await response.json();
    if(!response.ok)throw Error(data.error||"Could not load contributors.");
    if(!data.revision||!Array.isArray(data.credits))throw Error("Contributor credits did not load.");
    credits=data.credits;revision=data.revision;dirty=false;blocked=false;notice("Choose tiers and edit credits, then save to publish.");
  }catch(e){notice(e.message+" Use Reload contributors to retry.",true)}finally{busy=false;render()}
}
export function mountContributorEditor(target, onManageLinks) {
  root=target;manageLinks=onManageLinks;render();if(!dirty&&!busy)void load();
}
