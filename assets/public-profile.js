const main = document.querySelector("#publicProfile");
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function videoId(value) {
  try {
    const url = new URL(safeUrl(value)), host = url.hostname.replace(/^www\./, "");
    const id = host === "youtu.be" ? url.pathname.slice(1) : ["youtube.com","m.youtube.com"].includes(host)
      ? url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] : "";
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : "";
  } catch { return ""; }
}
function section(title, content) { return `<section class="profile-section"><h2>${title}</h2>${content}</section>`; }
function icon(name) { return `<svg class="rel-icon" aria-hidden="true"><use href="/media/action-icons.svg#${name}"/></svg>`; }
function render(profile) {
  const {account, editor, credits, placements, styles} = profile;
  const name = account?.username || editor?.name || credits[0]?.name;
  if (!name) throw new Error("This profile has no public information.");
  document.title = name + " | Roblox Editors List";
  const picture = safeUrl(editor?.thumb);
  const placeholder = `<span class="portrait-placeholder" aria-hidden="true">${esc(name.replace(/^@/, "").slice(0, 1).toUpperCase())}</span>`;
  const portrait = picture ? `<img class="portrait" src="${esc(picture)}" alt="" referrerpolicy="no-referrer">${placeholder}` : placeholder;
  const subtitle = editor ? editor.name + (editor.handle ? " · " + editor.handle : "") : account ? "REL member" : "REL contributor";
  const links = Object.entries(editor?.links || {}).map(([label, value]) => ({label, url:safeUrl(value)}));
  if (editor?.tiktok && /^[A-Za-z0-9._]{1,64}$/.test(editor.tiktok.replace(/^@/, ""))) links.unshift({label:"TikTok",url:"https://www.tiktok.com/@" + editor.tiktok.replace(/^@/, "")});
  const external = [...new Map(links.filter(link => link.url).map(link => [link.url, link])).values()];
  const vid = videoId(editor?.video);
  const about = editor?.note ? section("About", `<p>${esc(editor.note)}</p>`) : "";
  const contribution = credits.length ? section("Contributions", `<ul class="credits">${credits.map(credit => `<li><strong>${esc(credit.name)}</strong><span>${esc(credit.contribution)}</span></li>`).join("")}</ul>`) : "";
  const ranking = section("Placements", placements.length ? `<ul class="placements">${placements.map(place => `<li><a href="/list/#${encodeURIComponent(place.key)}"><span>${esc(place.name)}</span><span class="placement-result"><strong>#${esc(place.rank)}</strong>${icon("arrow")}</span></a></li>`).join("")}</ul>` : `<p class="hint">${editor ? "This editor is not placed on a list." : account ? "No ranked editor profile is linked to this account." : "No ranked editor profile is linked to this contributor."}</p>`);
  const software = editor?.software ? section("Editing software", `<p>${esc(editor.software)}</p>`) : "";
  const showcase = vid ? section("Showcase", `<iframe class="showcase" src="https://www.youtube-nocookie.com/embed/${vid}" title="Showcase edit by ${esc(editor.name)}" loading="lazy" allowfullscreen></iframe>`) : "";
  const details = contribution + about + showcase + (external.length ? section("Links", `<div class="profile-links">${external.map(link => `<a class="rel-action rel-action--reveal" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(link.label)} (opens in a new tab)">${icon("external")}<span>${esc(link.label)}</span></a>`).join("")}</div>`) : "");
  main.innerHTML = `<div class="profile-identity">${portrait}<div><h1>${esc(name)}</h1><p class="profile-subtitle">${esc(subtitle)}</p>${styles.length ? `<div class="styles">${styles.map(style => `<span>${esc(style.name)}</span>`).join("")}</div>` : ""}</div></div>
    ${!account && credits.length ? '<p class="hint">An account has not been linked to this contributor credit.</p>' : ""}
    <div class="profile-columns${details ? '' : ' simple-profile'}">${details ? `<div>${details}</div>` : ''}<div>${ranking}${software}${account ? section("REL account", `<a class="account-profile-link rel-action rel-action--reveal" href="/profile/?account=${encodeURIComponent(account.id)}">${icon("account")}<span>${esc(account.username)}</span></a>`) : ""}</div></div>`;
  const image = main.querySelector("img.portrait");
  if (image) {
    const fallback = image.nextElementSibling;
    const update = () => { const loaded = image.complete && image.naturalWidth > 0; image.hidden = !loaded; fallback.hidden = loaded; };
    image.addEventListener("load", update);image.addEventListener("error", update);update();
  }
}
async function load() {
  main.setAttribute("aria-busy", "true");
  main.innerHTML = '<h1>Profile</h1><p role="status">Loading profile…</p>';
  try {
    const response = await fetch("/api/profiles" + location.search, {cache:"no-store"});
    const profile = await response.json();
    if (!response.ok) throw Object.assign(new Error(profile.error || "Could not load this profile."), {status:response.status});
    render(profile);
  } catch (error) {
    const missing = [400,404].includes(error.status);
    document.title = (missing ? "Profile not found" : "Profile unavailable") + " | Roblox Editors List";
    main.innerHTML = `<h1>${missing ? "Profile not found" : "Profile unavailable"}</h1><p class="profile-error" role="status">${esc(error.message)}</p>${missing ? `<p><a class="account-profile-link rel-action rel-action--reveal" href="/list/">${icon("rankings")}<span>View the editor rankings</span></a></p>` : '<button class="rel-action" id="retryProfile" type="button">Try again</button>'}`;
    main.querySelector("#retryProfile")?.addEventListener("click", load);
  } finally { main.setAttribute("aria-busy", "false"); }
}
await load();
