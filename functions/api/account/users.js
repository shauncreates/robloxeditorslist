import { json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env, "owner");
  const body = await readJson(request);
  return json(await userRpc(env, token, "rel_users", {
    p_action: body.action, p_user_id: body.userId || null, p_roles: body.roles || null,
    p_editor_id: body.editorId || null, p_disabled: body.disabled ?? false, p_offset: body.offset ?? 0,
  }));
}
