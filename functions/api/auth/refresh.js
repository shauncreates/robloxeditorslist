import { HttpError } from "../../_lib.js";
import { authRequest, verifyAccount, sessionCookies, sessionResponse } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const token = sessionCookies(request).refresh;
  if (!token) return sessionResponse(request, { error: "Please sign in." }, null, 401);
  const response = await authRequest(env, "token?grant_type=refresh_token", {
    method: "POST", body: JSON.stringify({ refresh_token: token }),
  });
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) return sessionResponse(request, { error: "Please sign in again." }, null, 401);
    throw new HttpError(503, "Session refresh is temporarily unavailable.");
  }
  const session = await response.json();
  if (!session.access_token || !session.refresh_token) throw new HttpError(503, "Invalid session response.");
  const { account } = await verifyAccount(env, session.access_token);
  return sessionResponse(request, { account }, session);
}
