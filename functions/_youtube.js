import { HttpError, supabaseRequest } from "./_lib.js";

export const scope = "https://www.googleapis.com/auth/youtube.readonly";
export const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
async function encryptionKey(env) {
  const bytes = decode(env.REL_GOOGLE_TOKEN_KEY || "");
  if (bytes.length !== 32)
    throw new HttpError(503, "YouTube token protection is not configured.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptToken(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(env),
      new TextEncoder().encode(value),
    );
  return "v1." + encode(iv) + "." + encode(new Uint8Array(encrypted));
}
export async function decryptToken(env, value) {
  const [version, iv, encrypted] = value.split(".");
  if (version !== "v1") throw new Error("Invalid token storage");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(iv) },
      await encryptionKey(env),
      decode(encrypted),
    ),
  );
}
export async function hash(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function youtubeConfig(env, request) {
  try {
    const callback = new URL(env.REL_YOUTUBE_REDIRECT_URI);
    if (
      !env.REL_GOOGLE_CLIENT_ID ||
      !env.REL_GOOGLE_CLIENT_SECRET ||
      decode(env.REL_GOOGLE_TOKEN_KEY || "").length !== 32 ||
      callback.origin !== new URL(request.url).origin ||
      callback.pathname !== "/api/account/youtube/callback" ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      !(
        callback.protocol === "https:" ||
        (callback.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(callback.hostname))
      )
    )
      throw new Error();
    return {
      clientId: env.REL_GOOGLE_CLIENT_ID,
      clientSecret: env.REL_GOOGLE_CLIENT_SECRET,
      callback: callback.href,
    };
  } catch {
    throw new HttpError(
      503,
      "YouTube connection is not configured. Owner-reviewed profile linking is still available.",
    );
  }
}
export function flowCookie(request, kind, value = "") {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-" : ""}rel_youtube_${kind}=${value}; Path=/; HttpOnly; SameSite=${kind === "state" ? "Lax" : "Strict"}; Max-Age=${value ? 600 : 0}${secure ? "; Secure" : ""}`;
}
export function getFlowCookie(request, kind) {
  const name =
    (new URL(request.url).protocol === "https:" ? "__Host-" : "") +
    "rel_youtube_" +
    kind;
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export async function exchangeRpc(env, args) {
  const response = await supabaseRequest(env, "rpc/rel_youtube_exchange", {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw Object.assign(
      new HttpError(
        400,
        "This YouTube authorisation has expired or was already used. Start again from My account.",
      ),
      { serviceStatus: response.status },
    );
  return response.json();
}
const googleErrorCodes = new Set([
  "invalid_client", "invalid_grant", "invalid_scope", "unauthorized_client",
  "access_denied", "temporarily_unavailable", "server_error",
  "accessNotConfigured", "insufficientPermissions", "youtubeSignupRequired",
  "quotaExceeded", "dailyLimitExceeded", "keyInvalid", "ipRefererBlocked",
  "SERVICE_DISABLED", "API_KEY_INVALID", "PERMISSION_DENIED", "UNAUTHENTICATED",
]);
const callbackReasons = new Set([
  "invalid_state", "missing_code", "missing_scope", "missing_refresh_token",
  "invalid_token_response", "no_channels", "too_many_channels", "invalid_channels",
]);
export function youtubeCallbackDiagnostic(stage, error) {
  const status = (value) => Number.isInteger(value) && value >= 100 && value <= 599;
  return {
    event: "rel_youtube_callback_failed",
    stage,
    reason: callbackReasons.has(error?.callbackReason) ? error.callbackReason : "unexpected_failure",
    ...(googleErrorCodes.has(error?.providerCode) ? { provider_code: error.providerCode } : {}),
    ...(status(error?.providerStatus) ? { provider_status: error.providerStatus } : {}),
    ...(status(error?.serviceStatus) ? { service_status: error.serviceStatus } : {}),
  };
}
export async function providerJson(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = Object.assign(
      new HttpError(
        502,
        "Google could not complete the YouTube connection. Start again from My account.",
      ),
      { providerStatus: response.status },
    );
    try {
      const data = await readProviderJson(response);
      const codes = [data?.error, data?.error?.status, data?.error?.errors?.[0]?.reason, data?.error?.details?.[0]?.reason];
      const code = codes.find((value) => googleErrorCodes.has(value));
      if (code) error.providerCode = code;
    } catch {}
    throw error;
  }
  return readProviderJson(response);
}
async function readProviderJson(response) {
  const reader = response.body.getReader();
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
        throw new HttpError(502, "Google returned an unexpected response.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text + decoder.decode());
}

export async function tokenRpc(env, args) {
  const response = await supabaseRequest(env, "rpc/rel_youtube_tokens", {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(503, "YouTube connection storage is unavailable.");
  return response.json();
}
export async function revokeToken(env, ciphertext) {
  const token = await decryptToken(env, ciphertext);
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const alreadyRevoked =
    response.status === 400 &&
    (await response.json().catch(() => ({}))).error === "invalid_token";
  if (!response.ok && !alreadyRevoked)
    throw new HttpError(
      503,
      "Google access could not be revoked. Please retry disconnecting.",
    );
}
export async function maintainYoutube(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const due = await tokenRpc(env, { p_action: "due" });
  if (
    !env.REL_GOOGLE_CLIENT_ID ||
    !env.REL_GOOGLE_CLIENT_SECRET ||
    !env.REL_GOOGLE_TOKEN_KEY
  )
    return;
  for (const item of due) {
    try {
      if (item.active === false) {
        await revokeToken(env, item.token_ciphertext);
        await tokenRpc(env, {
          p_action: "delete",
          p_user_id: item.user_id,
          p_channel_id: item.channel_id,
          p_ciphertext: item.token_ciphertext,
        });
        continue;
      }
      const refreshToken = await decryptToken(env, item.token_ciphertext);
      const token = await providerJson("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: env.REL_GOOGLE_CLIENT_ID,
          client_secret: env.REL_GOOGLE_CLIENT_SECRET,
        }).toString(),
      });
      if (
        typeof token.access_token !== "string" ||
        !/^[A-Za-z0-9._~+/-]{1,4096}$/.test(token.access_token) ||
        String(token.token_type).toLowerCase() !== "bearer"
      )
        throw new Error();
      const data = await providerJson(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50&fields=items(id,snippet(title))",
        { headers: { Authorization: "Bearer " + token.access_token } },
      );
      const channel = data.items?.find(
        (channel) => channel.id === item.channel_id,
      );
      if (!channel) {
        await tokenRpc(env, {
          p_action: "delete",
          p_user_id: item.user_id,
          p_channel_id: item.channel_id,
          p_ciphertext: item.token_ciphertext,
        });
        continue;
      }
      await tokenRpc(env, {
        p_action: "refresh",
        p_user_id: item.user_id,
        p_channel_id: item.channel_id,
        p_title: channel.snippet?.title,
        p_ciphertext: item.token_ciphertext,
      });
    } catch (error) {
      if (error.providerStatus === 400 || error.providerStatus === 401)
        await tokenRpc(env, {
          p_action: "delete",
          p_user_id: item.user_id,
          p_channel_id: item.channel_id,
          p_ciphertext: item.token_ciphertext,
        });
    }
  }
}
