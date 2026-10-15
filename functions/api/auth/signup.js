import { HttpError, json, readJson } from "../../_lib.js";
import { authRequest } from "../../_auth.js";
import { validEmail, validPassword, passwordRequirement } from "../../_password.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 4000);
  if (!validEmail(body.email)) throw new HttpError(400, "Enter a valid email address.");
  if (!validPassword(body.password)) throw new HttpError(400, passwordRequirement);
  const redirect = new URL("/email-verified/", request.url).href;
  const response = await authRequest(env, `signup?redirect_to=${encodeURIComponent(redirect)}`, {
    method: "POST", body: JSON.stringify({ email: body.email.trim(), password: body.password }),
  });
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 400,
    response.status === 429 ? "Too many requests. Try again later." : "Could not create the account. Check your details or try signing in.");
  // Never accept roles, an editor ID or user metadata from sign-up.
  return json({ ok: true, message: "Check your email to confirm your account, then sign in." }, 201);
}
