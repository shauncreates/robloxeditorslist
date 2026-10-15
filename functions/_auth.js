import { HttpError, json } from "./_lib.js";

export function authConfig(env) {
  const url = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(503, "Account sign-in is not configured.");
  return { url, key };
}

export async function authRequest(env, path, options = {}) {
  const { url, key } = authConfig(env);
  return fetch(`${url}/auth/v1/${path}`, {
    ...options, headers: { apikey: key, "Content-Type": "application/json", ...options.headers },
  });
}

function cookieNames(request) {
  const url = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new HttpError(400, "HTTPS is required.");
  const prefix = url.protocol === "https:" ? "__Host-rel_" : "rel_";
  return { access: prefix + "access", refresh: prefix + "refresh", secure: url.protocol === "https:" };
}

export function sessionCookies(request) {
  const names = cookieNames(request);
  const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(";").map(part => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
  return { access: cookies[names.access], refresh: cookies[names.refresh] };
}

export function sessionResponse(request, body, session = null, status = 200) {
  const response = json(body, status), names = cookieNames(request);
  for (const [name, value, age] of [
    [names.access, session?.access_token || "", session ? 86400 : 0],
    [names.refresh, session?.refresh_token || "", session ? 30 * 86400 : 0],
  ]) {
    // Never return tokens in response JSON or expose them to browser JavaScript.
    if (!/^[A-Za-z0-9_.-]*$/.test(value)) throw new HttpError(503, "Invalid session response.");
    response.headers.append("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${names.secure ? "; Secure" : ""}`);
  }
  return response;
}

export async function userRpc(env, token, name, args = {}) {
  const { url, key } = authConfig(env);
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errors = {
      "REL_UNAUTHENTICATED": [401, "Please sign in again."],
      "REL_FORBIDDEN": [403, "You do not have permission for this action."],
      "REL_CONFLICT": [409, "Rankings changed since you loaded them. Reload before saving."],
      "REL_MISSING_DATA": [409, "Live rankings are missing. Saving is blocked."],
      "REL_NOT_FOUND": [404, "Record not found."],
      "REL_LAST_OWNER": [409, "The last active Owner cannot be removed or disabled."],
      "REL_INVALID": [400, "Invalid request or profile link."],
      "REL_APPLICATION_LISTED": [409, "This application is already an editor profile. A List Contributor must manage that profile."],
      "REL_APPLICATION_LOCKED": [409, "This application has already been decided. The decision is locked."],
      "REL_APPLICATION_PENDING": [409, "You already have an application waiting for review."],
      "REL_APPLICATION_ARCHIVED": [409, "This application has been archived by an Owner."],
      "REL_REASON_REQUIRED": [400, "Enter a review reason of 1 to 1,000 characters."],
      "REL_INVALID_USERNAME": [400, "Use 3 to 40 letters, digits, underscores or hyphens for your username."],
      "REL_USERNAME_TAKEN": [409, "That username is already taken. Choose another."],
      "REL_USERNAME_COOLDOWN": [409, "You can change your username once every 7 days. Check your account for the next change date."],
    };
    const mapped = errors[data.message];
    if (mapped) throw new HttpError(...mapped);
    if (["22P02", "22023", "23505", "23514"].includes(data.code)) throw new HttpError(400, "Invalid request or profile link.");
    throw new HttpError(503, "Account database is unavailable. Check the approved setup.");
  }
  return data;
}

export function hasRole(account, role) {
  return account.roles.includes("owner") || account.roles.includes(role);
}

export async function verifyAccount(env, token, role) {
  if (!token) throw new HttpError(401, "Please sign in.");
  const verified = await authRequest(env, "user", { headers: { Authorization: `Bearer ${token}` } });
  if (!verified.ok) {
    if ([401, 403].includes(verified.status)) throw new HttpError(401, "Please sign in again.");
    throw new HttpError(503, "Sign-in service is unavailable.");
  }
  const user = await verified.json();
  if (!user.id || !user.email_confirmed_at || user.is_anonymous) throw new HttpError(401, "Confirm your email before signing in.");
  // Database checks the active session and current roles, never user_metadata.
  const account = await userRpc(env, token, "rel_context");
  if (account.id !== user.id || !Array.isArray(account.roles)) throw new HttpError(401, "Invalid account.");
  if (role && !hasRole(account, role)) throw new HttpError(403, "You do not have permission for this action.");
  return { token, account: { ...account, email: user.email } };
}

export async function requireAccount(request, env, role) {
  return verifyAccount(env, sessionCookies(request).access, role);
}
