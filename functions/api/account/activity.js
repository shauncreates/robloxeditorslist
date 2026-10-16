import { json } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env, "owner");
  const params = new URL(request.url).searchParams;
  return json(await userRpc(env, token, "rel_activity", { p_kind: params.get("kind") || "all", p_offset: Number(params.get("offset") || 0) }));
}
