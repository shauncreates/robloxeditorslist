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
export async function exchangeRpc(env, args) {
  const response = await supabaseRequest(env, "rpc/rel_tiktok_exchange", {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    if (failure.message === "REL_TIKTOK_EXPIRED")
      throw new HttpError(
        400,
        "This TikTok authorisation expired or was already used. Start again from My account.",
      );
    throw new HttpError(
      503,
      "TikTok connection storage is unavailable. Check the approved setup.",
    );
  }
  return response.json();
}
export async function providerJson(url, options = {}, allowEmpty = false) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      "TikTok could not complete verification. Please try again.",
    );
  const reader = response.body?.getReader();
  if (!reader && allowEmpty) return {};
  if (!reader) throw new HttpError(502, "TikTok returned an empty response.");
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
        throw new HttpError(502, "TikTok returned an unexpected response.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const body = text + decoder.decode();
  if (!body.trim() && allowEmpty) return {};
  const data = JSON.parse(body);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data.error && data.error.code !== "ok")
  )
    throw new HttpError(
      502,
      "TikTok could not complete verification. Please try again.",
    );
  return data;
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
  let accessToken;
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
    if (
      typeof token.access_token !== "string" ||
      !/^[A-Za-z0-9._~+/-]{1,4096}$/.test(token.access_token)
    )
      throw new Error("Invalid TikTok access token");
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
      throw new Error("Missing TikTok permissions");
    const hasStats = String(token.scope).split(",").map(value => value.trim()).includes("user.info.stats");
    const data = await providerJson(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name" + (hasStats ? ",follower_count" : ""),
      { headers: { Authorization: "Bearer " + accessToken } },
    );
    const user = data.data?.user;
    if (
      user?.open_id !== token.open_id ||
      typeof user.username !== "string" ||
      !/^[A-Za-z0-9._]{1,40}$/.test(user.username) ||
      typeof user.display_name !== "string" ||
      !user.display_name.trim() ||
      user.display_name.length > 150
    )
      throw new Error("Invalid TikTok profile proof");
    return {
      open_id: user.open_id,
      username: user.username,
      display_name: user.display_name,
      followers: hasStats ? audienceCount(user.follower_count) : null,
    };
  } finally {
    // Proof is accepted only after temporary TikTok access has been revoked.
    if (accessToken) await revokeAccess(config, accessToken);
  }
}
