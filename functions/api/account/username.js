import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env);
  const body = await readJson(request, 2000);
  if (typeof body.username !== "string" || body.username.trim().length > 40) throw new HttpError(400, "Enter a username of 3 to 40 characters.");
  return json(await userRpc(env, token, "rel_username", { p_username: body.username }));
}
