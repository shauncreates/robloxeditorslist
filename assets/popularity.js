const root = document.querySelector("#popularityResults");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const icon = (name) =>
  `<svg class="rel-icon" aria-hidden="true"><use href="/media/action-icons.svg#${name}"/></svg>`;
const labels = { tiktok: "TikTok followers", youtube: "YouTube subscribers" };
let platform,
  generation = 0;
const safeImage = (value) => {
  if (!value) return "";
  try {
    const url = new URL(value, location.origin);
    return url.protocol === "https:" ||
      (url.origin === location.origin && url.pathname.startsWith("/media/"))
      ? url.href
      : "";
  } catch {
    return "";
  }
};
async function load() {
  const current = ++generation;
  platform =
    new URLSearchParams(location.search).get("platform") === "youtube"
      ? "youtube"
      : "tiktok";
  document.title = labels[platform] + " | Roblox Editors List";
  for (const link of document.querySelectorAll("[data-platform]")) {
    if (link.dataset.platform === platform)
      link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  root.setAttribute("aria-busy", "true");
  const heading = `<h2 id="resultsTitle">${labels[platform]}</h2>`;
  root.innerHTML = heading + '<p role="status">Loading Popularity…</p>';
  try {
    const response = await fetch("/api/popularity?platform=" + platform, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Popularity could not be loaded.");
    if (current !== generation) return;
    const editors = data.editors;
    root.innerHTML =
      heading +
      `<p class="pop-summary" role="status">${editors.length} ranked ${editors.length === 1 ? "editor" : "editors"} · Highest count first</p>` +
      (editors.length
        ? `<ol class="pop-list" aria-label="${labels[platform]}">${editors
            .map((editor) => {
              const avatar = safeImage(editor.avatar),
                observed = new Date(editor.observed_at);
              return `<li class="pop-row"><span class="pop-place" aria-label="Place ${editor.place}">#${editor.place}</span><div class="pop-editor">${avatar ? `<img class="pop-avatar" src="${esc(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span class="pop-initial" aria-hidden="true" ${avatar ? "hidden" : ""}>${esc(editor.name?.slice(0, 1) || "?")}</span><div class="pop-editor-info"><a class="pop-name" href="/profile/?editor=${encodeURIComponent(editor.editor_id)}">${esc(editor.name)}${icon("arrow")}</a><a class="pop-channel" href="${esc(editor.channel_url)}" target="_blank" rel="noopener noreferrer">${platform === "youtube" ? "YouTube channel" : "TikTok profile"}${icon("external")}<span class="sr-only"> (opens in a new tab)</span></a></div></div><div class="pop-audience"><span class="pop-count">${new Intl.NumberFormat("en-GB").format(editor.audience_count)}</span><p class="pop-date">Last updated <time datetime="${esc(observed.toISOString())}" title="${esc(observed.toLocaleString("en-GB"))}">${esc(observed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}</time></p></div></li>`;
            })
            .join("")}</ol>`
        : `<div class="pop-empty"><h3>No ${platform === "tiktok" ? "follower" : "subscriber"} counts yet</h3><p>Ranked editors can connect their ${platform === "tiktok" ? "TikTok account" : "YouTube channel"} from My account. A public count appears here after the connection is confirmed.</p><a class="rel-text-link" href="/account/">Connect your channel${icon("arrow")}</a></div>`);
    root.querySelectorAll('.pop-editor-info').forEach((element,index)=>{
      const clan=editors[index].clan;
      if(!clan)return;
      const anchor=document.createElement('a');anchor.className='rel-clan-prefix';anchor.href='/clans/?id='+encodeURIComponent(clan.id);anchor.textContent='['+clan.prefix+']';anchor.setAttribute('aria-label','View clan '+clan.name);element.prepend(anchor);
    });
    for (const image of root.querySelectorAll(".pop-avatar")) {
      const fallback = () => {
        image.hidden = true;
        image.nextElementSibling.hidden = false;
      };
      image.addEventListener("error", fallback);
      if (image.complete && !image.naturalWidth) fallback();
    }
  } catch (error) {
    if (current !== generation) return;
    root.innerHTML =
      heading +
      `<div class="pop-empty"><p class="pop-error" role="status">${esc(error.message)}</p><button id="retryPopularity" class="rel-action" type="button">Try again</button></div>`;
    root.querySelector("#retryPopularity").addEventListener("click", load);
  } finally {
    if (current === generation) root.setAttribute("aria-busy", "false");
  }
}
document.querySelector(".pop-platforms").addEventListener("click", (event) => {
  const link = event.target.closest("[data-platform]");
  if (
    !link ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button > 0
  )
    return;
  event.preventDefault();
  history.pushState(null, "", link.href);
  void load();
});
addEventListener("popstate", load);
await load();
