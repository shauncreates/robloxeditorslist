import {
  youtubeConfig,
  getFlowCookie,
  flowCookie,
  hash,
  randomToken,
  exchangeRpc,
  providerJson,
  scope,
  encryptToken,
  youtubeCallbackDiagnostic,
} from "../../../_youtube.js";
import { audienceCount, stageAudience } from "../../../_audience.js";

export async function onRequestGet({ request, env }) {
  let finish = "",
    status = "failed",
    stage = "configuration";
  const failure = (reason) => Object.assign(new Error("YouTube callback failed."), { callbackReason: reason });
  try {
    const config = youtubeConfig(env, request),
      params = new URL(request.url).searchParams,
      state = params.get("state"),
      cookie = getFlowCookie(request, "state");
    stage = "state";
    if (!/^[A-Za-z0-9_-]{43}$/.test(state || "") || state !== cookie)
      throw failure("invalid_state");
    stage = "claim";
    const proof = await exchangeRpc(env, {
      p_action: "claim",
      p_state_hash: await hash(state),
    });
    if (params.has("error")) {
      status = "cancelled";
      throw new Error();
    }
    const code = params.get("code");
    if (!code || code.length > 2048) throw failure("missing_code");
    stage = "token_exchange";
    const result = await providerJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callback,
        grant_type: "authorization_code",
        code_verifier: proof.verifier,
      }).toString(),
    });
    stage = "token_response";
    if (typeof result.scope !== "string" || !result.scope.split(" ").includes(scope))
      throw failure("missing_scope");
    if (typeof result.refresh_token !== "string" || !result.refresh_token || result.refresh_token.length > 2048)
      throw failure("missing_refresh_token");
    if (
      typeof result.access_token !== "string" ||
      !/^[A-Za-z0-9._~+/-]{1,4096}$/.test(result.access_token) ||
      String(result.token_type).toLowerCase() !== "bearer"
    )
      throw failure("invalid_token_response");
    stage = "channel_lookup";
    const data = await providerJson(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true&maxResults=50&fields=items(id,snippet(title),statistics(subscriberCount,hiddenSubscriberCount)),nextPageToken",
      { headers: { Authorization: "Bearer " + result.access_token } },
    );
    stage = "channel_response";
    if (!Array.isArray(data.items)) throw failure("invalid_channels");
    if (!data.items.length) throw failure("no_channels");
    if (data.nextPageToken) throw failure("too_many_channels");
    const channels = data.items.map((item) => ({
      id: item.id,
      title: item.snippet?.title,
    }));
    if (
      channels.some(
        (item) =>
          !/^UC[A-Za-z0-9_-]{22}$/.test(item.id || "") ||
          typeof item.title !== "string" ||
          !item.title.trim() ||
          item.title.length > 150,
      )
    )
      throw failure("invalid_channels");
    finish = randomToken();
    stage = "encryption";
    const ciphertext = await encryptToken(env, result.refresh_token);
    stage = "proof_storage";
    await exchangeRpc(env, {
      p_action: "proof",
      p_state_hash: await hash(state),
      p_finish_hash: await hash(finish),
      p_channels: channels,
      p_token_ciphertext: ciphertext,
    });
    stage = "audience_storage";
    await stageAudience(
      env,
      "youtube",
      await hash(state),
      Object.fromEntries(
        data.items.map((item) => [
          item.id,
          item.statistics?.hiddenSubscriberCount === false
            ? audienceCount(item.statistics.subscriberCount)
            : null,
        ]),
      ),
    );
    status = "ready";
  } catch (error) {
    finish = "";
    if (status === "failed") console.error(JSON.stringify(youtubeCallbackDiagnostic(stage, error)));
  }
  const response = new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/account/?youtube=" + status, request.url).href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
  response.headers.append("Set-Cookie", flowCookie(request, "state"));
  response.headers.append("Set-Cookie", flowCookie(request, "finish", finish));
  return response;
}
