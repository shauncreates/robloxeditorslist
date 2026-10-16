import { accountFetch } from "./account.js";

const selector =
  'header a.rel-action--account[href="/account/"],header a.rel-action--account[href="/signin/"],.admin-actions a.rel-action--account[href="/account/"],header a[data-icon="account"][href="/account/"],a[data-account-nav]';
let state = "checking",
  pending,
  rerun = false,
  version = 0,
  started = false;

function apply(link) {
  link.dataset.accountNav = "";
  const signedIn = state === "signed-in";
  const label =
    state === "checking" || state === "unavailable"
      ? "Account"
      : signedIn
        ? "My account"
        : "Sign in / Sign up";
  const span = link.querySelector(":scope > span:not(.rel-sr)");
  let changed = false;
  if (span && span.textContent !== label) {
    span.textContent = label;
    changed = true;
  }
  link.setAttribute("aria-label", label);
  link.setAttribute(
    "href",
    signedIn || state === "checking" || state === "unavailable"
      ? "/account/"
      : "/signin/",
  );
  link.dataset.accountState = state;
  if (state === "checking") link.setAttribute("aria-busy", "true");
  else link.removeAttribute("aria-busy");
  return changed;
}
function render() {
  let changed = false;
  document.querySelectorAll(selector).forEach((link) => {
    changed = apply(link) || changed;
  });
  if (changed) window.dispatchEvent(new Event("rel-navigation-change"));
}
async function refresh(force = false) {
  if (force) version++;
  if (pending) {
    if (force) rerun = true;
    return;
  }
  if (document.hidden) return;
  const current = version;
  pending = (async () => {
    let next;
    try {
      const response = await accountFetch("/api/auth/session");
      if (response.status === 401) next = "signed-out";
      else if (!response.ok) next = "unavailable";
      else
        next = (await response.json()).account?.id ? "signed-in" : "signed-out";
    } catch {
      next = "unavailable";
    }
    if (current === version) {
      state = next;
      render();
    }
  })();
  try {
    await pending;
  } finally {
    pending = null;
    if (rerun) {
      rerun = false;
      void refresh();
    }
  }
}
export function syncAccountNavigation(root) {
  const links = [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];
  links.forEach(apply);
  if (!links.length || started) return;
  started = true;
  window.addEventListener("pageshow", () => void refresh());
  window.addEventListener("focus", () => void refresh(true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh(true);
  });
  window.addEventListener("rel-session-changed", () => void refresh(true));
  if (typeof BroadcastChannel === "function") {
    const channel = new BroadcastChannel("rel-auth");
    channel.onmessage = (event) => {
      if (event.data === "changed") void refresh(true);
    };
  }
  void refresh();
}
