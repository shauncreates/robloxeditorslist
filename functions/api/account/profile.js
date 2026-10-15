import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const { token, account } = await requireAccount(request, env);
  if (!account.editor_id) throw new HttpError(403, "An Owner must link your editor profile first.");
  const body = await readJson(request, 20000);
  if (!body.profile || typeof body.revision !== "string") throw new HttpError(400, "Invalid profile or revision.");
  return json(await userRpc(env, token, "rel_save_site", { p_revision: body.revision, p_data: null, p_profile: body.profile }));
}
