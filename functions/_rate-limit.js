import { HttpError, supabaseRequest } from "./_lib.js";

export async function enforceRateLimit(request, env, action) {
  const host = new URL(request.url).hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const ip = request.cf && request.headers.get("CF-Connecting-IP");
  const subject = typeof ip === "string" && /^[0-9a-f:.]{3,64}$/i.test(ip)
    ? ip.toLowerCase() : local ? "loopback" : null;
  if (!subject) throw new HttpError(503, "Request checks are unavailable. Please try again later.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rel:" + subject));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  let result;
  try {
    const response = await supabaseRequest(env, "rpc/rel_take_rate_limit", {
      method:"POST", body:JSON.stringify({ p_action:action, p_subject_hash:hash }),
    });
    if (!response.ok) throw new Error();
    result = await response.json();
    if (typeof result.allowed !== "boolean" || !Number.isInteger(result.retry_after) ||
        result.retry_after < 1 || result.retry_after > 600) throw new Error();
  } catch { throw new HttpError(503, "Request checks are unavailable. Please try again later."); }
  if (!result.allowed) throw new HttpError(429, "Too many requests. Please wait before trying again.", {
    "Retry-After":String(result.retry_after),
  });
}
