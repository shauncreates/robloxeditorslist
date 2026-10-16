import { HttpError, supabaseRequest } from "./_lib.js";

export function audienceCount(value) {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function audienceRpc(env, name, args = {}) {
  const response = await supabaseRequest(env, "rpc/" + name, {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(
      503,
      "Popularity information is unavailable. Please try again shortly.",
    );
  return response.json();
}

export const stageAudience = (env, platform, stateHash, counts) =>
  audienceRpc(env, "rel_audience_stage", {
    p_platform: platform,
    p_state_hash: stateHash,
    p_counts: counts,
  });
