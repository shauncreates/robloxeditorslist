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

export function validate(data) {
  const isString = (value) => typeof value === "string";
  if (!data || typeof data !== "object") return false;
  if (!data.site || typeof data.site !== "object") return false;
  if (!Array.isArray(data.styles) || data.styles.length > 30) return false;
  if (!data.styles.every((style) => style && isString(style.id) && isString(style.name) && isString(style.color))) return false;
  if (!Array.isArray(data.editors) || data.editors.length > 300) return false;
  if (!data.editors.every((editor) => editor && isString(editor.id) && isString(editor.name) &&
    (!Object.hasOwn(editor,"main_platform") || ["TikTok","YouTube"].includes(editor.main_platform)))) return false;
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

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Enforce bytes actually received, including requests without Content-Length.
export async function readJson(request, limit = 16000) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send application/json.");
  }
  if (!request.body) throw new HttpError(400, "Invalid request.");
  const reader = request.body.getReader();
  let length = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, "Request is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, "Invalid request."); }
}
