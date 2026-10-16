import { HttpError, supabaseRequest } from "./_lib.js";

export async function clanRpc(env, name, args = {}) {
  const response = await supabaseRequest(env, "rpc/" + name, {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (body.message === "REL_NOT_FOUND")
      throw new HttpError(
        404,
        "This clan or invitation is unavailable. The link may have expired or been revoked.",
      );
    throw new HttpError(
      503,
      "Clans could not be loaded. Please try again shortly.",
    );
  }
  return response.json();
}
export const validUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
