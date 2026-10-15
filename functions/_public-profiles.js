import { HttpError, supabaseRequest } from "./_lib.js";

export async function publicProfileRpc(env, name, args = {}) {
  const response = await supabaseRequest(env, "rpc/" + name, { method: "POST", body: JSON.stringify(args) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (body.message === "REL_NOT_FOUND") throw new HttpError(404, "Profile not found.");
    throw new HttpError(503, "Public profiles are unavailable. Please try again shortly.");
  }
  return body;
}
