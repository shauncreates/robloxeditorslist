import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env, "owner");
  return json(await userRpc(env, token, "rel_contributors", { p_action:"list" }));
}
export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env, "owner");
  const body = await readJson(request, 80000);
  if (typeof body.revision !== "string" || !Array.isArray(body.credits)) throw new HttpError(400, "Load contributor credits before saving.");
  return json(await userRpc(env, token, "rel_contributors", { p_action:"save", p_revision:body.revision, p_data:body.credits }));
}
