import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const {token} = await requireAccount(request,env,"list_contributor");
  return json(await userRpc(env,token,"rel_pending_editors",{p_action:"list",p_id:null,p_revision:null}));
}

export async function onRequestPost({ request, env }) {
  const {token} = await requireAccount(request,env,"list_contributor");
  const body = await readJson(request);
  if(typeof body.id!=="string" || typeof body.revision!=="string")throw new HttpError(400,"Choose an approved application and load the latest list first.");
  return json(await userRpc(env,token,"rel_pending_editors",{p_action:"convert",p_id:body.id,p_revision:body.revision}));
}
