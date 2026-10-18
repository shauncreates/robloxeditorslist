import { accountFetch } from "./account.js";

const root = document.querySelector("#clanResults"),
  notice = document.querySelector("#clanNotice"),
  pageHeading = document.querySelector("#clanPageHeading");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="rel-icon" aria-hidden="true"><use href="/media/action-icons.svg#${name}"/></svg>`;
const link = (clan) => `/clans/?id=${encodeURIComponent(clan.id)}`;
const tag = (clan) => `<span class="clan-tag">[${esc(clan.prefix)}]</span>`;
const signin = (invite) =>
  "/signin/" + (invite ? "#clan-invite=" + invite : "");
let own = null,
  signedIn = false,
  current = null,
  site = null,
  invite = "",
  invitation = null,
  newInviteUrl = "",
  busy = false,
  selectedView = "",
  directory = [],
  directoryQuery = "",
  directorySort = "name";

async function read(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Clans could not be loaded.");
  return body;
}
function flash(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle("error", error);
}
function form(clan) {
  return `<form class="clan-form" id="${clan ? "updateClan" : "createClan"}">
    <label for="clanName">Clan name</label>
    <input id="clanName" name="name" minlength="3" maxlength="50" required value="${esc(clan?.name || "")}" autocomplete="off">
    <label for="clanPrefix">Four-character prefix</label>
    <input id="clanPrefix" name="prefix" minlength="4" maxlength="4" pattern="[A-Za-z0-9]{4}" required value="${esc(clan?.prefix || "")}" aria-describedby="prefixHint" autocapitalize="characters" spellcheck="false" autocomplete="off">
    <p class="clan-help" id="prefixHint">Use four letters or numbers. Members display as <output id="prefixPreview">[${esc(clan?.prefix || "ABCD")}]</output> name. Membership and prefixes are public.</p>
    <button class="rel-action rel-action--account" type="submit">${icon(clan ? "save" : "add")}<span>${clan ? "Save clan" : "Create clan"}</span></button>
  </form>`;
}
function membership() {
  if (!signedIn)
    return `<section class="clan-panel clan-account-prompt"><h2>Your clan starts here</h2><p>Sign in to create a clan or confirm an invitation from another editor.</p><a class="rel-action rel-action--account" href="${signin(invite)}">${icon("account")}<span>Sign in / Sign up</span></a></section>`;
  if (!own)
    return invitation
      ? ""
      : `<section class="clan-panel"><div class="clan-section-heading"><div><h2>Create a clan</h2><p>Choose a name and prefix, then invite your editors.</p></div></div><p class="clan-form-note">You can belong to one clan at a time. Creating one makes you its first member and creator.</p>${form(null)}</section>`;
  const summary = current?.id === own.id ? "" : `<a class="rel-text-link clan-owned-link" href="${link(own)}">${tag(own)} ${esc(own.name)} ${icon("arrow")}</a>`;
  if (!own.is_creator)
    return `<section class="clan-panel" id="myClan"><h2>Your membership</h2>${summary}<p>Leaving removes this clan's prefix from your profile. Your editor profile and rankings stay the same.</p><div class="clan-actions"><button class="rel-action" type="button" data-action="leave">${icon("back")}<span>Leave clan</span></button></div></section>`;
  return `<section class="clan-panel" id="myClan">
    ${summary}
    <div class="clan-manage-grid">
      <section class="clan-manage-section"><h2>Clan details</h2><p>Update the name and prefix shown for your members.</p>${form(own)}</section>
      <section class="clan-manage-section"><h2>Invitations</h2><p>Invite links last seven days. Every new member confirms before joining.</p>
        <div class="clan-actions"><button class="rel-action" type="button" data-action="invite">${icon("link")}<span>${own.invite_expires_at ? "Replace invite link" : "Create invite link"}</span></button>${own.invite_expires_at ? `<button class="rel-action" type="button" data-action="revoke_invite">${icon("close")}<span>Revoke invite link</span></button>` : ""}</div>
        <p class="clan-help">Replacing or revoking an invitation stops the previous link from working. Existing members stay in the clan.</p>
        ${newInviteUrl ? `<div class="clan-invite-copy"><label for="clanInviteUrl">Private invitation link</label><textarea class="clan-link-field" id="clanInviteUrl" readonly spellcheck="false">${esc(newInviteUrl)}</textarea><button class="rel-action" data-action="copy" type="button">${icon("link")}<span>Copy invite link</span></button><p class="clan-help">Share only with people you want to invite. The full link is shown only in this session.</p></div>` : ""}
      </section>
    </div>
    <section class="clan-danger"><div><h3>Disband clan</h3><p>Remove the clan, its invitation links and every membership. As creator, disbanding is how you leave.</p></div><button class="rel-action" type="button" data-action="disband">${icon("delete")}<span>Disband clan</span></button></section>
  </section>`;
}
function renderInvitation() {
  return `<section class="clan-panel clan-invitation" aria-labelledby="invitationTitle"><h1 id="invitationTitle">Join ${tag(invitation)} ${esc(invitation.name)}?</h1><p>Your username, clan membership and prefix will be public. Joining does not change your rankings or permissions.</p><p>This invitation expires ${esc(new Date(invitation.expires_at).toLocaleDateString("en-GB"))}.</p><div class="clan-actions">${signedIn && !own ? '<button class="rel-action rel-action--account" type="button" data-action="join">Confirm join</button>' : signedIn ? `<p>${own.id === invitation.id ? "You already belong to this clan." : "Leave your current clan before accepting this invitation."}</p>` : `<a class="rel-action rel-action--account" href="${signin(invite)}">Sign in to review invitation</a>`}<button class="rel-action" type="button" data-action="cancel">Cancel</button></div></section>`;
}
function editorAvatar(editor) {
  let picture = "";
  if (editor.thumb) {
    try {
      const url = new URL(editor.thumb, location.origin);
      if (!url.username && !url.password && (url.protocol === "https:" || (url.origin === location.origin && /^\/(?:media\/|api\/youtube-avatar\?)/.test(url.pathname + url.search))))
        picture = url.href;
    } catch {}
  }
  const initial = Array.from(String(editor.name || "?").trim())[0] || "?";
  return `<span class="clan-avatar" aria-hidden="true"><span>${esc(initial.toUpperCase())}</span>${picture ? `<img src="${esc(picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>`;
}
function renderRankings(style = "main") {
  const target = root.querySelector("#clanRankings");
  if (!target) return;
  const members = new Set(
    current.members.map((member) => member.editor_id).filter(Boolean),
  );
  const editors = new Map(site.editors.map((editor) => [editor.id, editor]));
  const ranked = (site.lists[style] || [])
    .map((id) => editors.get(id))
    .filter((editor) => editor && members.has(editor.id));
  target.innerHTML = ranked.length
    ? `<div class="clan-ranking-head" aria-hidden="true"><span>Rank</span><span>Editor</span></div><ol class="clan-ranking" aria-label="Clan positions">${ranked.map((editor, index) => `<li><a href="/profile/?editor=${encodeURIComponent(editor.id)}"><span class="clan-rank" aria-label="Clan position ${index + 1}">#${index + 1}</span><span class="clan-ranked-editor">${editorAvatar(editor)}<span class="clan-editor-name">${esc(editor.name)}</span></span>${icon("arrow")}</a></li>`).join("")}</ol>`
    : '<div class="clan-empty"><h3>No ranked members on this list</h3><p>Choose another list or open Members to see everyone in the clan.</p></div>';
}
function renderViews(views, initial) {
  if (!views.some(view => view.id === selectedView)) selectedView = initial;
  return `<div class="clan-tabs" role="tablist" aria-label="Clan views">${views.map(view => `<button type="button" role="tab" id="clan-tab-${view.id}" data-clan-view="${view.id}" aria-controls="clan-view-${view.id}" aria-selected="${selectedView === view.id}" tabindex="${selectedView === view.id ? 0 : -1}">${view.label}</button>`).join("")}</div>${views.map(view => `<div role="tabpanel" id="clan-view-${view.id}" aria-labelledby="clan-tab-${view.id}" ${selectedView === view.id ? "" : "hidden"}>${view.html}</div>`).join("")}`;
}
function selectView(id, focus = false) {
  const selected = root.querySelector(`[data-clan-view="${id}"]`);
  if (!selected || busy) return;
  selectedView = id;
  for (const button of root.querySelectorAll("[data-clan-view]")) {
    const active = button === selected;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    root.querySelector("#" + button.getAttribute("aria-controls")).hidden = !active;
  }
  if (focus) selected.focus();
}
function managementLabel() {
  if (!signedIn) return "Your clan";
  if (!own) return "Create clan";
  if (own.id !== current?.id) return "Your clan";
  return own.is_creator ? "Manage clan" : "Membership";
}
function renderClan(clan) {
  const memberEditors = new Set(clan.members.map(member => member.editor_id).filter(Boolean));
  const rankedCount = site.lists.main.filter(id => memberEditors.has(id) && site.editors.some(editor => editor.id === id)).length;
  const members = `<section class="clan-panel"><div class="clan-section-heading"><div><h2>All members</h2><p>Ranked and unranked REL accounts in this clan.</p></div></div><ul class="clan-member-list">${clan.members.map(member => {
    const editor = site.editors.find(editor => editor.id === member.editor_id);
    return `<li><a href="/profile/?account=${encodeURIComponent(member.account_id)}">${editorAvatar({name: member.username, thumb: editor?.thumb})}<span class="clan-member-name">${esc(member.username)}${member.is_creator ? "<small>Creator</small>" : ""}</span>${icon("arrow")}</a>${own?.is_creator && own.id === clan.id && !member.is_creator ? `<button class="rel-action" data-action="remove" data-member="${esc(member.account_id)}" type="button" aria-label="Remove ${esc(member.username)} from clan">${icon("close")}<span>Remove</span></button>` : ""}</li>`;
  }).join("")}</ul></section>`;
  const rankings = `<section class="clan-panel"><div class="clan-section-heading"><div><h2>Member rankings</h2><p>Positions within this clan, following the selected REL list.</p></div><label class="clan-filter" for="clanRankingStyle"><span>Ranked list</span><select id="clanRankingStyle" class="clan-style"><option value="main">Overall</option>${site.styles.map(style => `<option value="${esc(style.id)}">${esc(style.name)}</option>`).join("")}</select></label></div><div id="clanRankings"></div></section>`;
  return `<a class="clan-browse-link rel-text-link" href="/clans/">${icon("back")} All clans</a><header class="clan-identity"><div class="clan-identity-main"><span class="clan-identity-prefix">[${esc(clan.prefix)}]</span><h1>${esc(clan.name)}</h1></div><dl class="clan-facts"><div><dt>Members</dt><dd>${clan.members.length}</dd></div><div><dt>Ranked editors</dt><dd>${rankedCount}</dd></div></dl></header>${renderViews([{id: "rankings", label: "Rankings", html: rankings}, {id: "members", label: `Members <span class="clan-tab-count">${clan.members.length}</span>`, html: members}, {id: "manage", label: managementLabel(), html: membership()}], "rankings")}`;
}
function renderDirectory() {
  const browse = `<section class="clan-panel"><div class="clan-directory-tools"><label class="clan-search" for="clanSearch"><span>Find a clan</span><input id="clanSearch" type="search" placeholder="Search name or prefix" value="${esc(directoryQuery)}" autocomplete="off"></label><label class="clan-filter" for="clanDirectorySort"><span>Sort by</span><select id="clanDirectorySort"><option value="name" ${directorySort === "name" ? "selected" : ""}>Name (A to Z)</option><option value="members" ${directorySort === "members" ? "selected" : ""}>Most members</option></select></label></div><p class="clan-directory-summary" id="clanDirectoryCount" role="status"></p><div id="clanDirectoryRows"></div></section>`;
  return renderViews([{id: "browse", label: "Browse clans", html: browse}, {id: "manage", label: managementLabel(), html: membership()}], "browse");
}
function renderDirectoryRows() {
  const target = root.querySelector("#clanDirectoryRows");
  if (!target) return;
  const query = directoryQuery.trim().toLowerCase();
  const clans = directory.filter(clan => `${clan.name} ${clan.prefix}`.toLowerCase().includes(query));
  clans.sort((a, b) => (directorySort === "members" ? b.members.length - a.members.length : 0) || a.name.localeCompare(b.name));
  root.querySelector("#clanDirectoryCount").textContent = `${clans.length}${query ? " matching" : ""} ${clans.length === 1 ? "clan" : "clans"}`;
  target.innerHTML = clans.length
    ? `<div class="clan-directory-head" aria-hidden="true"><span>Clan</span><span>Members</span></div><ul class="clan-directory">${clans.map(clan => `<li><a href="${link(clan)}"><span class="clan-directory-name"><span class="clan-directory-tag">${esc(clan.prefix)}</span><strong>${esc(clan.name)}</strong></span><span class="clan-directory-count">${clan.members.length}<span class="sr-only"> ${clan.members.length === 1 ? "member" : "members"}</span></span>${icon("arrow")}</a></li>`).join("")}</ul>`
    : `<div class="clan-empty"><h2>${query ? "No matching clans" : "No clans yet"}</h2><p>${query ? "Try a different name or four-character prefix." : "Create a clan and invite editors to get started."}</p>${query ? '<button class="rel-action" type="button" data-action="clear-search">Clear search</button>' : '<button class="rel-action" type="button" data-action="open-manage">Create a clan</button>'}</div>`;
}
async function load() {
  root.setAttribute("aria-busy", "true");
  root.innerHTML = '<p role="status">Loading clans…</p>';
  pageHeading.hidden = false;
  try {
    const accountResponse = await accountFetch("/api/account/clans");
    signedIn = accountResponse.ok;
    if (accountResponse.status !== 401 && !accountResponse.ok)
      await read(accountResponse);
    own = signedIn ? (await accountResponse.json()).clan : null;
    const hash = new URLSearchParams(location.hash.slice(1));
    invite = hash.get("invite") || "";
    invitation = null;
    if (hash.has("invite")) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(invite))
        throw new Error("This clan invitation is invalid.");
      invitation = await read(
        await fetch("/api/clans/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invite }),
          cache: "no-store",
        }),
      );
      root.innerHTML = renderInvitation() + (own ? `<a class="rel-text-link" href="${link(own)}">Open your clan ${icon("arrow")}</a>` : "");
      pageHeading.hidden = true;
      document.title = "Join " + invitation.name + " | Roblox Editors List";
      return;
    }
    const params = new URLSearchParams(location.search),
      id = params.get("id");
    const data = await read(
      await fetch("/api/clans" + (id ? "?id=" + encodeURIComponent(id) : ""), {
        cache: "no-store",
      }),
    );
    current = id ? data.clans[0] : null;
    if (current) {
      site = await read(await fetch("/api/data", { cache: "no-store" }));
      document.title =
        "[" + current.prefix + "] " + current.name + " | Roblox Editors List";
      root.innerHTML = renderClan(current);
      pageHeading.hidden = true;
      renderRankings();
    } else {
      document.title = "Clans | Roblox Editors List";
      directory = data.clans;
      root.innerHTML = renderDirectory();
      renderDirectoryRows();
    }
  } catch (error) {
    root.innerHTML = `<section class="clan-panel"><h2>Clans unavailable</h2><p class="clan-error" role="status">${esc(error.message)}</p><div class="clan-actions"><button class="rel-action" data-action="reload" type="button">Try again</button><a class="rel-text-link" href="/clans/">Browse clans${icon("arrow")}</a>${location.hash ? '<button class="rel-action" data-action="cancel" type="button">Cancel invitation</button>' : ""}</div></section>`;
  } finally {
    root.setAttribute("aria-busy", "false");
  }
}
async function mutate(body) {
  if (busy) return;
  busy = true;
  root.querySelectorAll("button,input,select,textarea").forEach((item) => {
    item.disabled = true;
  });
  try {
    const response = await accountFetch("/api/account/clans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      location.assign(signin(invite));
      return;
    }
    const result = await read(response);
    if (body.action === "create") selectedView = "manage";
    if (body.action === "join") selectedView = "rankings";
    if (body.action === "disband") selectedView = "browse";
    if (body.action === "invite") newInviteUrl = result.inviteUrl;
    if (["revoke_invite", "disband"].includes(body.action)) newInviteUrl = "";
    if (["create", "join"].includes(body.action))
      history.replaceState(null, "", link({ id: result.clan_id }));
    if (body.action === "disband") history.replaceState(null, "", "/clans/");
    flash(
      {
        create: "Clan created.",
        update: "Clan saved. The prefix now applies to all members.",
        invite:
          "New invite link created. The previous link is no longer valid.",
        revoke_invite: "Invite link revoked.",
        join: "You joined the clan.",
        leave: "You left the clan. Your prefix has been removed.",
        remove: "Member removed.",
        disband: "Clan disbanded. All members and prefixes have been removed.",
      }[body.action],
    );
    await load();
  } catch (error) {
    flash(error.message, true);
  } finally {
    busy = false;
    root.querySelectorAll("button,input,select,textarea").forEach((item) => {
      item.disabled = false;
    });
  }
}
root.addEventListener("submit", (event) => {
  if (!["createClan", "updateClan"].includes(event.target.id)) return;
  event.preventDefault();
  const form = event.target;
  void mutate({
    action: form.id === "createClan" ? "create" : "update",
    name: form.elements.name.value,
    prefix: form.elements.prefix.value,
    ...(own ? { clanId: own.id } : {}),
  });
});
root.addEventListener("input", (event) => {
  if (event.target.id === "clanSearch") {
    directoryQuery = event.target.value;
    renderDirectoryRows();
    return;
  }
  if (event.target.name !== "prefix") return;
  event.target.value = event.target.value.toUpperCase();
  root.querySelector("#prefixPreview").textContent =
    "[" + (event.target.value || "ABCD") + "]";
});
root.addEventListener("change", (event) => {
  if (event.target.id === "clanDirectorySort") {
    directorySort = event.target.value;
    renderDirectoryRows();
  }
  if (event.target.id === "clanRankingStyle")
    renderRankings(event.target.value);
});
root.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-clan-view]");
  if (tab) return selectView(tab.dataset.clanView);
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action;
  if (action === "open-manage") return selectView("manage", true);
  if (action === "clear-search") {
    directoryQuery = "";
    root.querySelector("#clanSearch").value = "";
    renderDirectoryRows();
    return root.querySelector("#clanSearch").focus();
  }
  if (action === "reload") return void load();
  if (action === "cancel") {
    invite = "";
    history.replaceState(null, "", "/clans/");
    flash("Invitation cancelled. Your membership is unchanged.");
    return void load();
  }
  if (action === "copy") {
    const fallback = () => {
      root.querySelector("#clanInviteUrl").select();
      flash("Select and copy the invitation link above.");
    };
    if (!navigator.clipboard?.writeText) return fallback();
    return void navigator.clipboard
      .writeText(newInviteUrl)
      .then(() => flash("Invite link copied."))
      .catch(fallback);
  }
  const messages = {
    leave: "Leave this clan and remove its prefix from your profile?",
    remove: "Remove this member from your clan?",
    disband:
      "Disband this clan? Its invitation, memberships and prefixes will be removed for everyone.",
    revoke_invite:
      "Revoke the invitation link? Existing members will stay in the clan.",
    invite: own?.invite_expires_at
      ? "Replace the existing invitation link? The previous link will stop working."
      : "",
  };
  if (messages[action] && !confirm(messages[action])) return;
  void mutate({
    action,
    ...(own ? { clanId: own.id } : {}),
    ...(action === "join" ? { invite } : {}),
    ...(action === "remove" ? { memberId: button.dataset.member } : {}),
  });
});
root.addEventListener("keydown", (event) => {
  const tab = event.target.closest("[data-clan-view]");
  if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...root.querySelectorAll("[data-clan-view]")];
  const index = tabs.indexOf(tab);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  selectView(tabs[next].dataset.clanView, true);
});
root.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.closest(".clan-avatar")) event.target.hidden = true;
}, true);
addEventListener("hashchange", () => void load());
await load();
