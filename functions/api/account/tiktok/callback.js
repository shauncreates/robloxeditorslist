import {
  tiktokConfig,
  getFlowCookie,
  flowCookie,
  hash,
  randomToken,
  exchangeRpc,
  proveAccount,
  tiktokCallbackDiagnostic,
} from "../../../_tiktok.js";
import { stageAudience } from "../../../_audience.js";

export async function onRequestGet({ request, env }) {
  let finish = "",
    status = "failed",
    matched = false,
    claimed = false,
    state,
    stage = "configuration";
  try {
    const config = tiktokConfig(env, request),
      params = new URL(request.url).searchParams;
    state = params.get("state");
    stage = "state";
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(state || "") ||
      state !== getFlowCookie(request, "state")
    )
      throw Object.assign(new Error(), {callbackReason: "invalid_state"});
    matched = true;
    stage = "claim";
    await exchangeRpc(env, {
      p_action: "claim",
      p_state_hash: await hash(state),
    });
    claimed = true;
    stage = "authorization_response";
    if (params.has("error")) {
      status = "cancelled";
      throw new Error();
    }
    const code = params.get("code");
    if (!code || code.length > 2048) throw Object.assign(new Error(), {callbackReason: "missing_code"});
    stage = "provider";
    const proof = await proveAccount(config, code);
    finish = randomToken();
    stage = "proof_storage";
    await exchangeRpc(env, {
      p_action: "proof",
      p_state_hash: await hash(state),
      p_finish_hash: await hash(finish),
      p_proof: proof,
    });
    stage = "audience_storage";
    await stageAudience(env, "tiktok", await hash(state), { followers: proof.followers });
    status = "ready";
  } catch (error) {
    finish = "";
    if (status === "failed") console.error(JSON.stringify(tiktokCallbackDiagnostic(stage, error)));
    if (claimed)
      await exchangeRpc(env, {
        p_action: "abort",
        p_state_hash: await hash(state),
      }).catch(() => {});
  }
  const response = new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/account/?tiktok=" + status, request.url).href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
  if (matched) {
    response.headers.append("Set-Cookie", flowCookie(request, "state"));
    response.headers.append(
      "Set-Cookie",
      flowCookie(request, "finish", finish),
    );
  }
  return response;
}
