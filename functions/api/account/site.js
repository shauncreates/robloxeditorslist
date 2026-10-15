import { json } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env);
  return json(await userRpc(env, token, "rel_site"));
}
