import { HttpError } from "../../_lib.js";
import { authRequest, sessionCookies, sessionResponse } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const cookies = sessionCookies(request);
  let token = cookies.access;
  // Refresh first so sign-out also revokes the session after access-token expiry.
  if (cookies.refresh) {
    const refresh = await authRequest(env, "token?grant_type=refresh_token", {
      method: "POST", body: JSON.stringify({ refresh_token: cookies.refresh }),
    });
    if (refresh.ok) token = (await refresh.json()).access_token;
    else if (![400,401,403].includes(refresh.status)) throw new HttpError(503, "Could not sign out. Please retry.");
  }
  if (token) {
    const response = await authRequest(env, "logout?scope=local", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok && ![401, 403, 404].includes(response.status)) throw new HttpError(503, "Could not sign out. Please retry.");
  }
  return sessionResponse(request, { ok: true });
}
