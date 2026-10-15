import { watchChanges } from "./autosave.js";

const root = document.querySelector("#contributors");
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const tiers = [
  {id:"owners",name:"Owners",icon:"owner"}, {id:"developers",name:"Developers",icon:"code"},
  {id:"reviewers",name:"Reviewers",icon:"review"}, {id:"rankers",name:"Rankers",icon:"rankings"},
];
const originalTiers = {seeshaun:["owners"],balloond:["developers"],"b-luff":["rankers"],"maxx-vfxs":["rankers"]};
let busy = false, snapshot;
async function load() {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch("/api/contributors", {cache:"no-store"});
    const credits = await response.json();
    if (!response.ok || !Array.isArray(credits) || !credits.every(c => typeof c.id === "string" && typeof c.name === "string" && typeof c.contribution === "string")) throw new Error();
    const next = JSON.stringify(credits);
    if (snapshot === next) return;
    root.innerHTML = tiers.map(tier => {
      // Older profile setups already have these credits, before tier editing is enabled.
      const members = credits.filter(c => (Array.isArray(c.tiers) ? c.tiers : Object.hasOwn(originalTiers,c.id) ? originalTiers[c.id] : []).includes(tier.id));
      const links = members.map(c => `<a class="contributor" href="/profile/?contributor=${encodeURIComponent(c.id)}" aria-label="${esc(c.name + ': ' + c.contribution + ' View profile.')}"><span class="person-name">${esc(c.name)}</span><svg class="rel-icon" aria-hidden="true"><use href="/media/action-icons.svg#arrow"/></svg></a>`).join("");
      return `<section class="contributor-tier tier-${tier.id}" aria-labelledby="tier-${tier.id}"><h3 class="tier-heading" id="tier-${tier.id}"><svg class="rel-icon" aria-hidden="true"><use href="/media/action-icons.svg#${tier.icon}"/></svg>${tier.name}</h3><div class="tier-members">${links || `<p class="tier-empty">No ${tier.name.toLowerCase()} listed yet.</p>`}</div></section>`;
    }).join("");
    snapshot = next;
  } catch {
    snapshot = undefined;
    root.innerHTML = '<p class="tier-empty" role="status">Contributors could not be loaded.</p><button type="button" class="rel-action" id="retryContributors">Try again</button>';
    root.querySelector("#retryContributors").addEventListener("click", () => { root.innerHTML = '<p class="tier-empty" role="status">Loading contributors…</p>'; void load(); });
  } finally { busy = false; }
}
await load();
watchChanges(load);
