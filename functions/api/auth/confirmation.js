import { HttpError, json, readJson } from "../../_lib.js";
import { authRequest } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 6000);
  if (typeof body.accessToken !== "string" || !/^[A-Za-z0-9_.-]{1,4096}$/.test(body.accessToken)) {
    throw new HttpError(400, "Use the confirmation link in your signup email.");
  }
  const response = await authRequest(env, "user", { headers: { Authorization: `Bearer ${body.accessToken}` } });
  if (!response.ok) throw new HttpError(response.status >= 500 ? 503 : 400,
    response.status >= 500 ? "Could not check your email confirmation. Try signing in." : "The confirmation could not be checked. Try signing in, or use your latest email link.");
  const user = await response.json();
  if (!user.id || !user.email_confirmed_at || user.is_anonymous) {
    throw new HttpError(400, "Your email has not been confirmed. Use the link in your signup email.");
  }
  // Check Supabase's verified user without creating REL login cookies.
  return json({ verified: true });
}
