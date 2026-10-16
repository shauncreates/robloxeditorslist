import { HttpError, json, readJson, supabaseRequest } from "../../_lib.js";
import { authRequest } from "../../_auth.js";
import { validEmail, validPassword, passwordRequirement } from "../../_password.js";
import { normalizeUsername, usernameRequirement } from "../../_username.js";
import { enforceRateLimit } from "../../_rate-limit.js";

async function usernameAvailable(env, username) {
  const response = await supabaseRequest(env, "rpc/rel_signup_username_available", {
    method: "POST", body: JSON.stringify({ p_username: username }),
  });
  const available = await response.json().catch(() => null);
  if (!response.ok || typeof available !== "boolean") throw new HttpError(503, "Account signup is unavailable. Please try again later.");
  return available;
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 4000);
  if (!validEmail(body.email)) throw new HttpError(400, "Enter a valid email address.");
  if (!validPassword(body.password)) throw new HttpError(400, passwordRequirement);
  const username = normalizeUsername(body.username);
  if (!username) throw new HttpError(400, usernameRequirement);
  await enforceRateLimit(request, env, "signup");
  if (!await usernameAvailable(env, username)) throw new HttpError(409, "That username is already taken. Choose another.");
  const redirect = new URL("/email-verified/", request.url).href;
  const response = await authRequest(env, `signup?redirect_to=${encodeURIComponent(redirect)}`, {
    method: "POST", body: JSON.stringify({ email: body.email.trim(), password: body.password, data: { username } }),
  });
  // The unique constraint decides races; Supabase may mask a trigger failure.
  if (!response.ok && response.status !== 429 && !await usernameAvailable(env, username)) {
    throw new HttpError(409, "That username is already taken. Choose another.");
  }
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 400,
    response.status === 429 ? "Too many requests. Try again later." : "Could not create the account. Check your details or try signing in.");
  // Caller-supplied roles, editor IDs and arbitrary metadata are never forwarded.
  return json({ ok: true, message: "Check your email to confirm your account, then sign in." }, 201);
}
