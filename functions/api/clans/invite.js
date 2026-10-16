import { HttpError, json, readJson } from "../../_lib.js";
import { clanRpc } from "../../_clans.js";
import { hash } from "../../_tiktok.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 1000);
  if (
    typeof body.invite !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.invite)
  )
    throw new HttpError(400, "Invalid clan invitation.");
  return json(
    await clanRpc(env, "rel_clan_invitation", {
      p_hash: await hash(body.invite),
    }),
  );
}
