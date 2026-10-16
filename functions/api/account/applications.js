import { json } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env);
  const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
  return json(await userRpc(env, token, "rel_my_applications", { p_offset:offset }));
}
