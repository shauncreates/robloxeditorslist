import { HttpError, supabaseRequest } from "./_lib.js";
import { audienceCount } from "./_audience.js";

export const scopes = ["user.info.basic", "user.info.profile"];
export const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function hash(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function tiktokConfig(env, request) {
  try {
    const callback = new URL(env.REL_TIKTOK_REDIRECT_URI),
      origin = new URL(request.url);
    const local =
      callback.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(callback.hostname);
    if (
      !env.REL_TIKTOK_CLIENT_KEY ||
      !env.REL_TIKTOK_CLIENT_SECRET ||
      callback.origin !== origin.origin ||
      callback.pathname !== "/api/account/tiktok/callback" ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      (callback.protocol !== "https:" && !local)
    )
      throw new Error();
    return {
      clientKey: env.REL_TIKTOK_CLIENT_KEY,
      clientSecret: env.REL_TIKTOK_CLIENT_SECRET,
      callback: callback.href,
    };
  } catch {
    throw new HttpError(
      503,
      "TikTok authorisation is not configured yet. Owner-reviewed editor linking is still available.",
    );
  }
}
export function configured(env, request) {
  try {
    tiktokConfig(env, request);
    return true;
  } catch {
    return false;
  }
}
export function flowCookie(request, kind, value = "") {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-" : ""}rel_tiktok_${kind}=${value}; Path=/; HttpOnly; SameSite=${kind === "state" ? "Lax" : "Strict"}; Max-Age=${value ? 600 : 0}${secure ? "; Secure" : ""}`;
}
export function getFlowCookie(request, kind) {
  const name =
    (new URL(request.url).protocol === "https:" ? "__Host-" : "") +
    "rel_tiktok_" +
    kind;
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
const providerCodes = new Set([
  "invalid_client", "invalid_grant", "invalid_scope", "invalid_request",
  "unauthorized_client", "access_denied", "unsupported_grant_type",
  "invalid_token", "access_token_invalid", "access_token_expired",
  "scope_not_authorized", "scope_permission_missed", "rate_limit_exceeded",
  "internal_error", "server_error", "invalid_params", "permission_denied",
  "client_key_invalid", "client_secret_invalid",
]);
const failureReasons = new Set([
  "invalid_state", "missing_code", "invalid_token_response", "missing_permissions",
  "invalid_identity", "provider_http_error", "provider_api_error",
  "provider_invalid_json", "provider_invalid_response", "provider_empty_response",
  "provider_response_too_large", "provider_timeout", "provider_request_failed",
]);
const failureStages = new Set([
  "configuration", "state", "claim", "authorization_response", "provider",
  "token_exchange", "token_response", "profile_lookup", "profile_response",
  "revocation", "proof_storage", "audience_storage",
]);
const errorKinds = new Set(["Error", "HttpError", "TypeError", "SyntaxError", "TimeoutError", "AbortError"]);
const failure = (reason, message = "TikTok verification failed.") =>
  Object.assign(new HttpError(502, message), {callbackReason: reason});
export function tiktokCallbackDiagnostic(stage, error) {
  const validStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;
  return {
    event: "rel_tiktok_callback_failed",
    stage: failureStages.has(error?.callbackStage) ? error.callbackStage : failureStages.has(stage) ? stage : "unknown",
    reason: failureReasons.has(error?.callbackReason) ? error.callbackReason : "unexpected_failure",
    ...(errorKinds.has(error?.name) ? {error_kind: error.name} : {}),
    ...(providerCodes.has(error?.providerCode) ? {provider_code: error.providerCode} : {}),
    ...(validStatus(error?.providerStatus) ? {provider_status: error.providerStatus} : {}),
    ...(validStatus(error?.serviceStatus) ? {service_status: error.serviceStatus} : {}),
  };
}
export async function exchangeRpc(env, args) {
  const response = await supabaseRequest(env, "rpc/rel_tiktok_exchange", {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    if (failure.message === "REL_TIKTOK_EXPIRED")
      throw Object.assign(new HttpError(
        400,
        "This TikTok authorisation expired or was already used. Start again from My account.",
      ), {serviceStatus: response.status});
    throw Object.assign(new HttpError(
      503,
      "TikTok connection storage is unavailable. Check the approved setup.",
    ), {serviceStatus: response.status});
  }
  return response.json();
}
export async function providerJson(url, options = {}, allowEmpty = false) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw Object.assign(error, {callbackReason:
      ["TimeoutError", "AbortError"].includes(error?.name) ? "provider_timeout" : "provider_request_failed"});
  }
  let data;
  try {
    data = await readProviderJson(response, allowEmpty);
  } catch (error) {
    if (response.ok) throw Object.assign(error, {providerStatus: response.status});
  }
  const code = typeof data?.error === "string" ? data.error : data?.error?.code;
  if (!response.ok || (data?.error && code !== "ok"))
    throw Object.assign(failure(response.ok ? "provider_api_error" : "provider_http_error",
      "TikTok could not complete verification. Please try again."), {
      providerStatus: response.status,
      ...(providerCodes.has(code) ? {providerCode: code} : {}),
    });
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Object.assign(failure("provider_invalid_response"), {providerStatus: response.status});
  return data;
}
async function readProviderJson(response, allowEmpty) {
  const reader = response.body?.getReader();
  if (!reader && allowEmpty) return {};
  if (!reader) throw failure("provider_empty_response", "TikTok returned an empty response.");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw failure("provider_response_too_large", "TikTok returned an unexpected response.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const body = text + decoder.decode();
  if (!body.trim() && allowEmpty) return {};
  try { return JSON.parse(body); }
  catch (error) { throw Object.assign(error, {callbackReason: "provider_invalid_json"}); }
}
export async function revokeAccess(config, accessToken) {
  await providerJson(
    "https://open.tiktokapis.com/v2/oauth/revoke/",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        token: accessToken,
      }).toString(),
    },
    true,
  );
}
export async function proveAccount(config, code) {
  let accessToken, stage = "token_exchange";
  try {
    const token = await providerJson(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: config.clientKey,
          client_secret: config.clientSecret,
          redirect_uri: config.callback,
          grant_type: "authorization_code",
          code,
        }).toString(),
      },
    );
    stage = "token_response";
    if (
      typeof token.access_token !== "string" ||
      !/^[A-Za-z0-9._~+/-]{1,4096}$/.test(token.access_token)
    )
      throw failure("invalid_token_response");
    accessToken = token.access_token;
    if (
      String(token.token_type).toLowerCase() !== "bearer" ||
      !scopes.every((scope) =>
        String(token.scope)
          .split(",")
          .map((value) => value.trim())
          .includes(scope),
      ) ||
      typeof token.open_id !== "string" ||
      !token.open_id ||
      token.open_id.length > 200
    )
      throw failure("missing_permissions");
    const hasStats = String(token.scope).split(",").map(value => value.trim()).includes("user.info.stats");
    stage = "profile_lookup";
    const data = await providerJson(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name" + (hasStats ? ",follower_count" : ""),
      { headers: { Authorization: "Bearer " + accessToken } },
    );
    stage = "profile_response";
    const user = data.data?.user;
    if (
      user?.open_id !== token.open_id ||
      typeof user.username !== "string" ||
      !/^[A-Za-z0-9._]{1,40}$/.test(user.username) ||
      typeof user.display_name !== "string" ||
      !user.display_name.trim() ||
      user.display_name.length > 150
    )
      throw failure("invalid_identity");
    return {
      open_id: user.open_id,
      username: user.username,
      display_name: user.display_name,
      followers: hasStats ? audienceCount(user.follower_count) : null,
    };
  } catch (error) {
    throw Object.assign(error, {callbackStage: stage});
  } finally {
    // Proof is accepted only after temporary TikTok access has been revoked.
    if (accessToken) {
      try { await revokeAccess(config, accessToken); }
      catch (error) { throw Object.assign(error, {callbackStage: "revocation"}); }
    }
  }
}
