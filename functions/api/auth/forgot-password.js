import { HttpError, json, readJson } from "../../_lib.js";
import { authRequest } from "../../_auth.js";
import { validEmail } from "../../_password.js";
import { enforceRateLimit } from "../../_rate-limit.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 4000);
  if (!validEmail(body.email)) throw new HttpError(400, "Enter a valid email address.");
  await enforceRateLimit(request, env, "recover");
  const redirect = new URL("/reset-password/", request.url).href;
  const response = await authRequest(env, `recover?redirect_to=${encodeURIComponent(redirect)}`, {
    method: "POST", body: JSON.stringify({ email: body.email.trim() }),
  });
  if (response.status === 429) throw new HttpError(429, "Too many requests. Wait before requesting another code.");
  if (!response.ok && ![400, 404, 422].includes(response.status)) {
    throw new HttpError(503, "Recovery email is unavailable. Try again later.");
  }
  // Keep the response the same whether or not the account exists.
  return json({ message: "If an account exists for that email, a recovery code is on its way. Check your inbox and spam folder." });
}
