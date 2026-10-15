import { HttpError, readJson } from "../../_lib.js";
import { authRequest, verifyAccount, sessionResponse } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 4000);
  if (typeof body.email !== "string" || body.email.length > 254 || typeof body.password !== "string" || body.password.length > 1024) {
    throw new HttpError(400, "Enter your email and password.");
  }
  const response = await authRequest(env, "token?grant_type=password", {
    method: "POST", body: JSON.stringify({ email: body.email.trim(), password: body.password }),
  });
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 401,
    response.status === 429 ? "Too many attempts. Try again later." : "Sign-in failed. Check your credentials and email confirmation.");
  const session = await response.json();
  if (!session.access_token || !session.refresh_token) throw new HttpError(401, "Sign-in failed.");
  const { account } = await verifyAccount(env, session.access_token);
  return sessionResponse(request, { account }, session);
}
