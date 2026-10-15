import { HttpError, readJson } from "../../_lib.js";
import { authRequest, verifyAccount, sessionResponse } from "../../_auth.js";
import { validEmail, validPassword, passwordRequirement } from "../../_password.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 4000);
  if (!validEmail(body.email) || typeof body.code !== "string" || !/^[0-9]{6}$/.test(body.code)) {
    throw new HttpError(400, "Enter your email and the six-digit recovery code.");
  }
  if (!validPassword(body.password)) throw new HttpError(400, passwordRequirement);
  if (body.password !== body.confirmPassword) throw new HttpError(400, "The passwords do not match.");
  const verified = await authRequest(env, "verify", {
    method: "POST", body: JSON.stringify({ email: body.email.trim(), token: body.code, type: "recovery" }),
  });
  if (!verified.ok) throw new HttpError(verified.status === 429 ? 429 : verified.status >= 500 ? 503 : 400,
    verified.status === 429 ? "Too many attempts. Try again later." : verified.status >= 500 ? "Password recovery is unavailable. Try again later." : "The code is invalid or expired. Request another code.");
  const session = await verified.json();
  if (!session.access_token) throw new HttpError(400, "Request another recovery code.");
  const { account } = await verifyAccount(env, session.access_token);
  if (account.email.toLowerCase() !== body.email.trim().toLowerCase()) throw new HttpError(400, "Request another recovery code.");
  const headers = { Authorization: `Bearer ${session.access_token}` };
  const updated = await authRequest(env, "user", {
    method: "PUT", headers, body: JSON.stringify({ password: body.password }),
  });
  if (!updated.ok) throw new HttpError(updated.status === 429 ? 429 : 400,
    "The password could not be changed. Check the password requirements and request another code.");
  // Recovery tokens stay server-side; revoke sessions before returning to sign-in.
  const signedOut = await authRequest(env, "logout?scope=global", { method: "POST", headers });
  if (!signedOut.ok) throw new HttpError(503, "Your password changed, but sign-out could not finish. Sign in with your new password.");
  return sessionResponse(request, { message: "Password changed. Sign in with your new password." });
}
