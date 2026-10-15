import { json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env);
  const body = await readJson(request);
  return json(await userRpc(env, token, "rel_claim", { p_editor_id: body.editorId, p_message: body.message }));
}
