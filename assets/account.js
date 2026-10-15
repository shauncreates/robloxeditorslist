// Tokens remain in HttpOnly cookies. A refresh is shared within this page.
let refreshing;
export async function accountFetch(path, options = {}) {
  const send = () => fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  let response = await send();
  if (response.status === 401) {
    if (!refreshing) refreshing = fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).finally(() => { refreshing = null; });
    const refreshed = await refreshing;
    if (refreshed.ok) response = await send();
  }
  return response;
}
export async function accountApi(path, body) {
  const response = await accountFetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await response.json().catch(() => ({}));
  if (response.status === 401) location.assign("/signin/");
  return { ok: response.ok, status: response.status, j };
}
export async function getAccount() {
  const response = await accountFetch("/api/auth/session");
  if (response.status === 401) { location.replace("/signin/"); return null; }
  const j = await response.json();
  if (!response.ok) throw new Error(j.error || "Could not load your account.");
  return j.account;
}
export async function signOut() {
  const response = await accountFetch("/api/auth/signout", { method: "POST" });
  if (!response.ok) throw new Error("Could not sign out. Please retry.");
}
