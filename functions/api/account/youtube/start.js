import { json, readJson } from "../../../_lib.js";
import { requireAccount, userRpc } from "../../../_auth.js";
import {
  youtubeConfig,
  randomToken,
  hash,
  flowCookie,
  scope,
} from "../../../_youtube.js";
export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env);
  await readJson(request, 1000);
  const config = youtubeConfig(env, request),
    state = randomToken(),
    verifier = randomToken();
  await userRpc(env, token, "rel_youtube", {
    p_action: "begin",
    p_state_hash: await hash(state),
    p_verifier: verifier,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callback,
    response_type: "code",
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
  }).toString();
  const response = json({ url: url.href });
  response.headers.append("Set-Cookie", flowCookie(request, "state", state));
  response.headers.append("Set-Cookie", flowCookie(request, "finish"));
  return response;
}
