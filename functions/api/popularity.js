import { HttpError, json } from "../_lib.js";
import { audienceRpc } from "../_audience.js";
import { clanRpc } from "../_clans.js";

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const platform = params.get("platform") || "tiktok";
  if (
    params.size > 1 ||
    [...params.keys()].some((key) => key !== "platform") ||
    !["tiktok", "youtube"].includes(platform)
  ) {
    throw new HttpError(400, "Choose TikTok or YouTube.");
  }
  const rows = await audienceRpc(env, "rel_public_popularity", {
    p_platform: platform,
  });
  const { prefixes } = await clanRpc(env, "rel_clan_prefixes");
  return json({
    platform,
    editors: rows.map((row) => ({
      ...row,
      clan: prefixes[row.editor_id] || null,
    })),
  });
}
