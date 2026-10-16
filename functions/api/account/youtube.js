import { json, readJson, HttpError } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";
import {
  youtubeConfig,
  getFlowCookie,
  hash,
  flowCookie,
  tokenRpc,
  revokeToken,
} from "../../_youtube.js";
export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env);
  let available = true;
  try {
    youtubeConfig(env, request);
  } catch {
    available = false;
  }
  if (!available) return json({ available: false });
  return json({
    ...(await userRpc(env, token, "rel_youtube", { p_action: "status" })),
    available,
    audience: await userRpc(env, token, "rel_audience_status", {
      p_platform: "youtube",
    }),
  });
}
export async function onRequestPost({ request, env }) {
  const { token, account } = await requireAccount(request, env),
    body = await readJson(request, 2000);
  if (!["finish", "disconnect"].includes(body.action))
    throw new HttpError(400, "Choose a YouTube connection action.");
  const cookie = getFlowCookie(request, "finish");
  if (body.action === "finish" && !/^[A-Za-z0-9_-]{43}$/.test(cookie))
    throw new HttpError(
      400,
      "Start the YouTube connection again from My account.",
    );
  if (body.action === "disconnect") {
    const work = await tokenRpc(env, {
      p_action: "get",
      p_user_id: account.id,
    });
    for (const ciphertext of new Set(
      [work?.token_ciphertext, work?.pending_ciphertext].filter(Boolean),
    ))
      await revokeToken(env, ciphertext);
  }
  const result = await userRpc(env, token, "rel_youtube", {
    p_action: body.action,
    p_channel_id: body.channelId || null,
    p_finish_hash: body.action === "finish" ? await hash(cookie) : null,
  });
  const response = json(result);
  response.headers.append("Set-Cookie", flowCookie(request, "finish"));
  return response;
}
