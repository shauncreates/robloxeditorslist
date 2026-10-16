import {
  tiktokConfig,
  getFlowCookie,
  flowCookie,
  hash,
  randomToken,
  exchangeRpc,
  proveAccount,
} from "../../../_tiktok.js";
import { stageAudience } from "../../../_audience.js";

export async function onRequestGet({ request, env }) {
  let finish = "",
    status = "failed",
    matched = false,
    claimed = false,
    state;
  try {
    const config = tiktokConfig(env, request),
      params = new URL(request.url).searchParams;
    state = params.get("state");
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(state || "") ||
      state !== getFlowCookie(request, "state")
    )
      throw new Error();
    matched = true;
    await exchangeRpc(env, {
      p_action: "claim",
      p_state_hash: await hash(state),
    });
    claimed = true;
    if (params.has("error")) {
      status = "cancelled";
      throw new Error();
    }
    const code = params.get("code");
    if (!code || code.length > 2048) throw new Error();
    const proof = await proveAccount(config, code);
    finish = randomToken();
    await exchangeRpc(env, {
      p_action: "proof",
      p_state_hash: await hash(state),
      p_finish_hash: await hash(finish),
      p_proof: proof,
    });
    await stageAudience(env, "tiktok", await hash(state), { followers: proof.followers });
    status = "ready";
  } catch {
    finish = "";
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
