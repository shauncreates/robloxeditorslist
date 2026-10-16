import { accountApi, accountFetch } from "./account.js";
const root = document.querySelector("#youtubeConnection"),
  esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const outcome = new URLSearchParams(location.search).get("youtube");
if (outcome) {
  history.replaceState(null, "", location.pathname + location.hash);
}
let notice =
  outcome === "failed"
    ? "Google could not complete the connection. Try again or use Owner-reviewed editor linking below."
    : outcome === "cancelled"
      ? "YouTube authorisation was cancelled. Your existing account is unchanged."
      : "";
async function load() {
  try {
    const response = await accountFetch("/api/account/youtube"),
      data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Your YouTube connection could not be loaded.",
      );
    const connection = data.connection,
      channels = data.channels || [];
    root.innerHTML = `<h2 id="youtubeConnectionTitle">YouTube connection</h2><p class="hint">Authorise through Google to confirm control of a YouTube channel. Your REL sign-in and permissions stay the same.</p>
      ${connection ? `<div class="application-card"><h3>${esc(connection.title)}</h3><p class="hint">${connection.fresh ? "Channel ownership confirmed through Google." : "This connection needs to be checked again; it is hidden from your public profile until refreshed."}</p><a class="account-inline-link" href="https://www.youtube.com/channel/${esc(connection.channel_id)}" target="_blank" rel="noopener noreferrer">View YouTube channel</a><button id="disconnectYouTube" type="button">Disconnect YouTube</button></div>` : "<p>No YouTube channel is connected.</p>"}
      ${channels.length ? `<form id="confirmYouTube"><label for="youtubeChannel">Choose the channel to link publicly to your REL account</label><select id="youtubeChannel">${channels.map((channel) => `<option value="${esc(channel.id)}">${esc(channel.title)}</option>`).join("")}</select><button class="pri" type="submit">Confirm channel link</button><button id="cancelYouTube" type="button">Cancel and disconnect YouTube</button><p class="hint">This confirms the channel connection. An existing ranked editor profile still needs an exact trusted match or Owner review.</p></form>` : data.available ? `<button class="pri" id="connectYouTube" type="button">${connection ? "Reconnect" : "Connect"} YouTube through Google</button>` : '<p class="hint">Google authorisation is not configured yet. Owner-reviewed editor linking remains available below.</p>'}
      <p class="hint">REL requests read-only YouTube access, stores an encrypted refresh credential and periodically checks the channel. No bio code, uploading or posting is required. Disconnect revokes access and removes stored channel data. Read the <a href="/youtube-privacy/">YouTube connection privacy notice</a> or <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer">manage Google's permissions</a>.</p><p id="youtubeNotice" role="status">${esc(notice)}</p>`;
  } catch (error) {
    root.innerHTML = `<h2 id="youtubeConnectionTitle">YouTube connection</h2><p role="status" class="account-feature-error">${esc(error.message)}</p><button id="retryYouTube" type="button">Reload YouTube connection</button>`;
  }
}
async function run(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    const status = root.querySelector("#youtubeNotice");
    if (status) status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
root.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "retryYouTube") return void load();
  if (button.id === "connectYouTube")
    void run(button, async () => {
      const { ok, j } = await accountApi("/api/account/youtube/start", {});
      if (!ok) throw new Error(j.error || "Could not start the connection.");
      const url = new URL(j.url);
      if (
        url.origin !== "https://accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth"
      )
        throw new Error("Google returned an unexpected authorisation link.");
      location.assign(url.href);
    });
  if (
    ["disconnectYouTube", "cancelYouTube"].includes(button.id) &&
    confirm(
      "Revoke Google's permission and disconnect YouTube from your REL account?",
    )
  )
    void run(button, async () => {
      const { ok, j } = await accountApi("/api/account/youtube", {
        action: "disconnect",
      });
      if (!ok) throw new Error(j.error || "Could not disconnect.");
      notice =
        "YouTube disconnected. Your REL editor link and rankings are unchanged.";
      await load();
    });
});
root.addEventListener("submit", (event) => {
  if (event.target.id !== "confirmYouTube") return;
  event.preventDefault();
  void run(event.target.querySelector("button"), async () => {
    const { ok, j } = await accountApi("/api/account/youtube", {
      action: "finish",
      channelId: root.querySelector("#youtubeChannel").value,
    });
    if (!ok) throw new Error(j.error || "Could not confirm the channel.");
    notice = "YouTube channel connected.";
    await load();
  });
});
await load();
