import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env, "owner");
  const body = await readJson(request, 2000);
  if (typeof body.userId !== "string" || !(body.credit === null || typeof body.credit === "string")) throw new HttpError(400, "Choose a contributor credit and account.");
  return json(await userRpc(env, token, "rel_contributor_link", { p_user_id: body.userId, p_credit: body.credit }));
}
