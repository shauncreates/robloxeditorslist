const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export { json };

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkPassword(password, env) {
  const real = env.ADMIN_PASSWORD || "";
  if (!real || typeof password !== "string") return false;

  const encoder = new TextEncoder();
  const [providedHash, realHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(password)),
    crypto.subtle.digest("SHA-256", encoder.encode(real)),
  ]);
  const a = new Uint8Array(providedHash);
  const b = new Uint8Array(realHash);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function validate(data) {
  const isString = (value) => typeof value === "string";
  if (!data || typeof data !== "object") return false;
  if (!data.site || typeof data.site !== "object") return false;
  if (!Array.isArray(data.styles) || data.styles.length > 30) return false;
  if (!data.styles.every((style) => style && isString(style.id) && isString(style.name) && isString(style.color))) return false;
  if (!Array.isArray(data.editors) || data.editors.length > 300) return false;
  if (!data.editors.every((editor) => editor && isString(editor.id) && isString(editor.name))) return false;
  if (!data.lists || typeof data.lists !== "object") return false;
  for (const key of Object.keys(data.lists)) {
    if (!Array.isArray(data.lists[key]) || !data.lists[key].every(isString)) return false;
  }
  return JSON.stringify(data).length < 500000;
}

export function supabaseConfig(env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return { url, key };
}

export async function supabaseRequest(env, path, options = {}) {
  const { url, key } = supabaseConfig(env);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return response;
}
