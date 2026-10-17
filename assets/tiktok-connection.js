import { accountApi, accountFetch } from "./account.js";
import { countText, publicationNotice } from "./social-audience.js";

const root = document.querySelector("#tiktokConnection");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const date = (value) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const params = new URLSearchParams(location.search),
  outcome = params.get("tiktok");
if (outcome) {
  params.delete("tiktok");
  history.replaceState(
    null,
    "",
    location.pathname + (params.size ? "?" + params : "") + location.hash,
  );
}
let notice =
  outcome === "cancelled"
    ? "TikTok authorisation was cancelled. Your existing connection is kept."
    : outcome === "failed"
      ? "TikTok verification could not finish. No new connection was saved. Try again from here. You can remove any remaining REL permission in TikTok’s app settings."
      : "";
const channel = (username) =>
  "https://www.tiktok.com/@" + encodeURIComponent(username);
const icon = (name) =>
  `<svg class="rel-icon" aria-hidden="true"><use href="/media/action-icons.svg#${name}"/></svg>`;
const channelLink = (username) =>
  `<a class="tiktok-channel" href="${channel(username)}" target="_blank" rel="noopener noreferrer" aria-label="Open @${esc(username)} on TikTok in a new tab">@${esc(username)} ${icon("external")}</a>`;

async function load() {
  root.setAttribute("aria-busy", "true");
  try {
    const response = await accountFetch("/api/account/tiktok"),
      data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Your TikTok connection could not be loaded.",
      );
    const audience = data.audience,
      connection = data.connection,
      pending = data.pending;
    let editorLink = null, matchingNotice = "";
    if (data.available && connection && !pending) {
      try {
        const {ok,j} = await accountApi("/api/account/tiktok",{action:"match"});
        if (!ok) throw new Error();
        editorLink = j.editor_link;
        if (editorLink?.status === "linked") window.dispatchEvent(new Event("rel-profile-linked"));
        matchingNotice = {
          no_match: "No editor profile matches your verified TikTok yet. If you apply with this profile, REL will link your account when the approved editor is added.",
          review_required: "REL could not safely match one unclaimed editor profile. Request Owner review below.",
        }[editorLink?.status] || "";
      } catch {
        matchingNotice = "Your TikTok is connected, but editor matching could not finish. Reload this page to retry or request Owner review below.";
      }
    }
    root.innerHTML = `<h2 id="tiktokTitle">Connect TikTok</h2><p>Confirm that your TikTok account belongs to you, without adding a code to your bio.</p>
      ${
        !data.available
          ? '<p class="tiktok-help">TikTok authorisation is not configured yet. Owner-reviewed editor linking is still available below.</p>'
          : `
      ${connection ? `<div class="tiktok-card"><p class="tiktok-label">Connected account</p><h3>${esc(connection.display_name)}</h3>${channelLink(connection.username)}<p class="tiktok-help">Confirmed through TikTok on ${esc(date(connection.verified_at))}. Reconnect by ${esc(date(connection.expires_at))} to renew this dated confirmation.</p><button id="disconnectTikTok" type="button">Disconnect TikTok</button></div>` : "<p>No TikTok account is connected.</p>"}
      ${pending ? `<form id="confirmTikTok" class="tiktok-card"><p class="tiktok-label">Ready to confirm</p><h3>${esc(pending.display_name)}</h3>${channelLink(pending.username)}<p>This account was returned by TikTok. Confirm to show this dated ownership check on your REL public profile.</p><div class="tiktok-actions"><button class="pri" type="submit">Confirm TikTok link</button><button id="cancelTikTok" type="button">Cancel</button></div><p class="tiktok-help">Confirming also links one unclaimed editor profile with this TikTok username. Existing links and ambiguous matches stay with Owner review.</p></form>` : `<button class="pri" id="connectTikTok" type="button">${connection ? "Reconnect" : "Connect"} TikTok</button>`}
      ${editorLink?.editor_id ? `<p class="tiktok-help">Your REL account has a linked editor profile. <a class="rel-text-link" href="/profile/?editor=${encodeURIComponent(editorLink.editor_id)}">View your editor profile ${icon("arrow")}</a></p>` : matchingNotice ? `<p class="tiktok-help" role="status">${esc(matchingNotice)}</p>` : ""}
      <p class="tiktok-help">REL reads your TikTok account ID, username and display name. The optional statistics permission adds your follower count to Popularity after you confirm. You can decline statistics and still connect. We revoke temporary access and keep the dated confirmation for 29 days.</p>`
      }
      <p class="tiktok-help"><a class="tiktok-privacy-link" href="/tiktok-privacy/">TikTok connection privacy ${icon("arrow")}</a></p><p id="tiktokNotice" role="status">${esc(notice)}</p>`;
    if (pending) {
      const paragraph = document.createElement("p");
      paragraph.className = "tiktok-help";
      paragraph.textContent = countText(audience?.pending?.followers, "tiktok") + " " + publicationNotice;
      root.querySelector("#confirmTikTok .tiktok-actions").before(paragraph);
    }
    if (connection) {
      const paragraph = document.createElement("p");
      paragraph.className = "tiktok-help";
      paragraph.textContent = countText(audience?.connection?.count, "tiktok") + (audience?.connection?.observed_at ? " Last updated " + date(audience.connection.observed_at) + ". Reconnect to update your count." : " Reconnect and allow statistics to add a count.");
      root.querySelector(".tiktok-card button").before(paragraph);
    }
  } catch (error) {
    root.innerHTML = `<h2 id="tiktokTitle">Connect TikTok</h2><p class="tiktok-error" role="status">${esc(error.message)}</p><button id="retryTikTok" type="button">Reload TikTok connection</button>`;
  } finally {
    root.setAttribute("aria-busy", "false");
  }
}
async function run(button, action) {
  const buttons = [...root.querySelectorAll("button")];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await action();
  } catch (error) {
    const notice = root.querySelector("#tiktokNotice");
    if (notice) notice.textContent = error.message;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
root.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.id === "retryTikTok") return void load();
  if (button.id === "connectTikTok")
    void run(button, async () => {
      root.querySelector("#tiktokNotice").textContent =
        "Opening TikTok authorisation…";
      const { ok, j } = await accountApi("/api/account/tiktok/start", {});
      if (!ok)
        throw new Error(j.error || "Could not start TikTok authorisation.");
      const url = new URL(j.url);
      if (
        url.origin !== "https://www.tiktok.com" ||
        url.pathname !== "/v2/auth/authorize/"
      )
        throw new Error("Unexpected TikTok authorisation address.");
      location.assign(url.href);
    });
  if (["cancelTikTok", "disconnectTikTok"].includes(button.id)) {
    const disconnect = button.id === "disconnectTikTok";
    if (
      disconnect &&
      !confirm(
        "Remove the TikTok connection from your REL account and public profile?",
      )
    )
      return;
    void run(button, async () => {
      const { ok, j } = await accountApi("/api/account/tiktok", {
        action: disconnect ? "disconnect" : "cancel",
      });
      if (!ok) throw new Error(j.error || "Could not update the connection.");
      notice = disconnect
        ? "TikTok disconnected. Your REL editor link and rankings are unchanged."
        : "TikTok link cancelled. Your existing connection is kept.";
      await load();
    });
  }
});
root.addEventListener("submit", (event) => {
  if (event.target.id !== "confirmTikTok") return;
  event.preventDefault();
  void run(event.target.querySelector("button"), async () => {
    const { ok, j } = await accountApi("/api/account/tiktok", {
      action: "finish",
    });
    if (!ok) throw new Error(j.error || "Could not confirm TikTok.");
    notice =
      "TikTok ownership confirmed. The connection is shown on your REL public profile.";
    if (j.editor_link?.status === "linked") window.dispatchEvent(new Event("rel-profile-linked"));
    await load();
  });
});
await load();
