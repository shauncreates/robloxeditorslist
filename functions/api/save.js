import { HttpError, json, readJson, validate } from "../_lib.js";
import { requireAccount, userRpc } from "../_auth.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env, "list_contributor");
  const body = await readJson(request, 550000);
  if (!validate(body.data) || typeof body.revision !== "string") throw new HttpError(400, "Invalid rankings or revision.");
  return json(await userRpc(env, token, "rel_save_site", { p_revision: body.revision, p_data: body.data }));
}
