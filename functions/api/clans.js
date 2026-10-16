import { HttpError, json } from "../_lib.js";
import { clanRpc, validUuid } from "../_clans.js";

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  if (
    params.size > 1 ||
    [...params.keys()].some((key) => !["id", "prefixes"].includes(key))
  )
    throw new HttpError(400, "Choose a clan.");
  if (params.has("prefixes")) {
    if (params.get("prefixes") !== "1")
      throw new HttpError(400, "Choose a clan.");
    return json(await clanRpc(env, "rel_clan_prefixes"));
  }
  if (params.has("id") && !validUuid(params.get("id")))
    throw new HttpError(400, "Invalid clan link.");
  return json(
    await clanRpc(
      env,
      "rel_public_clans",
      params.has("id") ? { p_id: params.get("id") } : {},
    ),
  );
}
