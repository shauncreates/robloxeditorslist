import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";
import { normalizeUsername, usernameRequirement } from "../../_username.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env);
  const body = await readJson(request, 2000);
  const username = normalizeUsername(body.username);
  if (!username) throw new HttpError(400, usernameRequirement);
  return json(await userRpc(env, token, "rel_username", { p_username: username }));
}
