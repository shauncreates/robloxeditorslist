import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";
import { configured, getFlowCookie, flowCookie, hash } from "../../_tiktok.js";

export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env);
  if (!configured(env, request)) return json({ available: false });
  return json({
    available: true,
    ...(await userRpc(env, token, "rel_tiktok", { p_action: "status" })),
  });
}
export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env),
    body = await readJson(request, 1000);
  if (!["finish", "cancel", "disconnect"].includes(body.action))
    throw new HttpError(400, "Choose a TikTok connection action.");
  const proof = getFlowCookie(request, "finish");
  if (body.action === "finish" && !/^[A-Za-z0-9_-]{43}$/.test(proof))
    throw new HttpError(
      400,
      "This confirmation expired. Start again from My account.",
    );
  const result = await userRpc(env, token, "rel_tiktok", {
    p_action: body.action,
    ...(body.action === "finish" ? { p_finish_hash: await hash(proof) } : {}),
  });
  const response = json(result);
  response.headers.append("Set-Cookie", flowCookie(request, "finish"));
  response.headers.append("Set-Cookie", flowCookie(request, "state"));
  return response;
}
