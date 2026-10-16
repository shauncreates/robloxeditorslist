import { json, readJson } from "../../../_lib.js";
import { requireAccount, userRpc } from "../../../_auth.js";
import {
  tiktokConfig,
  randomToken,
  hash,
  flowCookie,
  scopes,
} from "../../../_tiktok.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env);
  await readJson(request, 1000);
  const config = tiktokConfig(env, request),
    state = randomToken();
  await userRpc(env, token, "rel_tiktok", {
    p_action: "begin",
    p_state_hash: await hash(state),
  });
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: config.clientKey,
    response_type: "code",
    scope: scopes.join(","),
    redirect_uri: config.callback,
    state,
    disable_auto_auth: "1",
  }).toString();
  const response = json({ url: url.href });
  response.headers.append("Set-Cookie", flowCookie(request, "state", state));
  response.headers.append("Set-Cookie", flowCookie(request, "finish"));
  return response;
}
