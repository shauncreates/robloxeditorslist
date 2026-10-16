import { accountFetch } from "./account.js";

const root = document.querySelector("#clanResults"),
  notice = document.querySelector("#clanNotice");
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
  busy = false;

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
  return `<form class="clan-form" id="${clan ? "updateClan" : "createClan"}"><label for="clanName">Clan name</label><input id="clanName" name="name" minlength="3" maxlength="50" required value="${esc(clan?.name || "")}" autocomplete="off"><label for="clanPrefix">Four-character prefix</label><input id="clanPrefix" name="prefix" minlength="4" maxlength="4" pattern="[A-Za-z0-9]{4}" required value="${esc(clan?.prefix || "")}" aria-describedby="prefixHint" autocapitalize="characters" spellcheck="false" autocomplete="off"><p class="clan-help" id="prefixHint">Use exactly four letters or numbers. Members display as <output id="prefixPreview">[${esc(clan?.prefix || "ABCD")}]</output> name. Your clan membership and prefix are public.</p><button class="rel-action rel-action--account" type="submit">${clan ? "Save clan" : "Create clan"}</button></form>`;
}
function membership() {
  if (!signedIn)
    return `<section class="clan-panel"><h2>Your clan</h2><p>Sign in or create a confirmed REL account to create a clan or accept an invitation.</p><a class="rel-action rel-action--account" href="${signin(invite)}">Sign in / Sign up</a></section>`;
  if (!own)
    return invitation
      ? ""
      : `<section class="clan-panel"><h2>Create a clan</h2><p>You can belong to one clan at a time. Creating a clan makes you its first member and creator.</p>${form(null)}</section>`;
  return `<section class="clan-panel" id="myClan"><h2>Your clan</h2><a class="rel-text-link" href="${link(own)}">${tag(own)} ${esc(own.name)} ${icon("arrow")}</a>${own.is_creator ? `${form(own)}<div class="clan-actions"><button class="rel-action" type="button" data-action="invite">${own.invite_expires_at ? "Replace invite link" : "Create invite link"}</button>${own.invite_expires_at ? '<button class="rel-action" type="button" data-action="revoke_invite">Revoke invite link</button>' : ""}</div><p>Invite links last seven days. Replacing or revoking a link immediately stops the previous one from working. Joining always requires confirmation.</p>${newInviteUrl ? `<label for="clanInviteUrl">Private invitation link</label><textarea class="clan-link-field" id="clanInviteUrl" readonly spellcheck="false">${esc(newInviteUrl)}</textarea><div class="clan-actions"><button class="rel-action" data-action="copy" type="button">Copy invite link</button></div><p>Share this link only with people you want to invite. The full link is shown only in this session.</p>` : ""}<div class="clan-actions"><button class="rel-action" data-action="disband" type="button">Disband clan</button></div><p>As creator, disband the clan to leave. This removes the clan, its prefixes and all memberships.</p>` : '<div class="clan-actions"><button class="rel-action" data-action="leave" type="button">Leave clan</button></div>'}</section>`;
}
function renderInvitation() {
  return `<section class="clan-panel clan-invitation" aria-labelledby="invitationTitle"><h2 id="invitationTitle">Join ${tag(invitation)} ${esc(invitation.name)}?</h2><p>Your username, clan membership and prefix will be public. Joining does not change your rankings or permissions.</p><p>This invitation expires ${esc(new Date(invitation.expires_at).toLocaleDateString("en-GB"))}.</p><div class="clan-actions">${signedIn && !own ? '<button class="rel-action rel-action--account" type="button" data-action="join">Confirm join</button>' : signedIn ? `<p>${own.id === invitation.id ? "You already belong to this clan." : "Leave your current clan before accepting this invitation."}</p>` : `<a class="rel-action rel-action--account" href="${signin(invite)}">Sign in to review invitation</a>`}<button class="rel-action" type="button" data-action="cancel">Cancel</button></div></section>`;
}
function renderRankings(style = "main") {
  const target = root.querySelector("#clanRankings");
  if (!target) return;
  const members = new Set(
    current.members.map((member) => member.editor_id).filter(Boolean),
  );
  const editors = new Map(site.editors.map((editor) => [editor.id, editor]));
  const ranked = (site.lists[style] || [])
    .map((id, index) => ({ editor: editors.get(id), rank: index + 1 }))
    .filter((row) => row.editor && members.has(row.editor.id));
  target.innerHTML = ranked.length
    ? `<ol class="clan-ranking">${ranked.map((row) => `<li><a href="/profile/?editor=${encodeURIComponent(row.editor.id)}"><span class="clan-global-rank">#${row.rank}</span><span>${tag(current)} ${esc(row.editor.name)}</span>${icon("arrow")}</a></li>`).join("")}</ol>`
    : "<p>No clan members are ranked on this list yet.</p>";
}
function renderClan(clan) {
  return `<a class="clan-browse-link rel-text-link" href="/clans/">${icon("back")} All clans</a><section class="clan-panel"><h2>${tag(clan)} ${esc(clan.name)}</h2><p>${clan.members.length} ${clan.members.length === 1 ? "member" : "members"}</p><h3>Member rankings</h3><p>Rank numbers are the members’ existing REL placements. The order of the main list is unchanged.</p><label for="clanRankingStyle">Ranked list</label><select id="clanRankingStyle" class="clan-style"><option value="main">Overall</option>${site.styles.map((style) => `<option value="${esc(style.id)}">${esc(style.name)}</option>`).join("")}</select><div id="clanRankings"></div><h3>Members</h3><ul class="clan-member-list">${clan.members.map((member) => `<li><a href="/profile/?account=${encodeURIComponent(member.account_id)}">${tag(clan)} ${esc(member.username)}${member.is_creator ? "<small>Creator</small>" : ""}</a>${own?.is_creator && own.id === clan.id && !member.is_creator ? `<button class="rel-action" data-action="remove" data-member="${esc(member.account_id)}" type="button" aria-label="Remove ${esc(member.username)} from clan">Remove</button>` : ""}</li>`).join("")}</ul></section>`;
}
async function load() {
  root.setAttribute("aria-busy", "true");
  root.innerHTML = '<p role="status">Loading clans…</p>';
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
      root.innerHTML = renderInvitation() + membership();
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
      root.innerHTML = renderClan(current) + membership();
      renderRankings();
    } else {
      document.title = "Clans | Roblox Editors List";
      root.innerHTML =
        `<section class="clan-panel"><h2>The clans</h2>${data.clans.length ? `<ul class="clan-directory">${data.clans.map((clan) => `<li><a href="${link(clan)}"><span>${tag(clan)} ${esc(clan.name)}<small>${clan.members.length} ${clan.members.length === 1 ? "member" : "members"}</small></span>${icon("arrow")}</a></li>`).join("")}</ul>` : "<p>No clans yet. Create one below or sign in to start.</p>"}</section>` +
        membership();
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
  root.querySelectorAll("button,input").forEach((item) => {
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
    root.querySelectorAll("button,input").forEach((item) => {
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
  if (event.target.name !== "prefix") return;
  event.target.value = event.target.value.toUpperCase();
  root.querySelector("#prefixPreview").textContent =
    "[" + (event.target.value || "ABCD") + "]";
});
root.addEventListener("change", (event) => {
  if (event.target.id === "clanRankingStyle")
    renderRankings(event.target.value);
});
root.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action;
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
addEventListener("hashchange", () => void load());
await load();
