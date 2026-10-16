import { HttpError, json, readJson, supabaseConfig } from "../_lib.js";
import { hasRole, requireAccount } from "../_auth.js";
import { boundedBytes, rasterMime, tiktokPage } from "../_remote-image.js";
import { enforceRateLimit } from "../_rate-limit.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const allowedHost = (host) => /^(?:[a-z0-9-]+\.)*(?:tiktokcdn[a-z-]*\.com|ibyteimg\.com|byteimg\.com)$/i.test(host);

export async function onRequestPost({ request, env }) {
  const { account } = await requireAccount(request, env);
  const body = await readJson(request);
  if (!hasRole(account, "list_contributor") && (!account.editor_id || account.editor_id !== body.editorId)) {
    throw new HttpError(403, "You can fetch pictures only for your linked profile.");
  }
  if (typeof body.editorId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.editorId)) throw new HttpError(400, "Invalid editor ID.");

  const username = String(body?.username || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._]{1,40}$/.test(username)) {
    return json({ error: "that doesn't look like a TikTok username" }, 400);
  }
  await enforceRateLimit(request, env, "avatar");

  try {
    const html = await tiktokPage(username, {
      "User-Agent": USER_AGENT, "Accept-Language": "en-GB,en;q=0.9", Accept: "text/html",
    });
    const match =
      html.match(/"avatarLarger":"([^"]+)"/) ||
      html.match(/"avatarMedium":"([^"]+)"/) ||
      html.match(/<meta property="og:image" content="([^"]+)"/);
    if (!match) return json({ error: "couldn't find a picture on that page (TikTok may be blocking the request)" }, 404);

    let imageUrl;
    try {
      imageUrl = match[0].startsWith("<meta")
        ? match[1].replace(/&amp;/g, "&")
        : JSON.parse('"' + match[1] + '"');
    } catch {
      return json({ error: "couldn't read the picture link" }, 502);
    }

    const source = new URL(imageUrl);
    if (source.protocol !== "https:" || !allowedHost(source.hostname) || source.username || source.password ||
        (source.port && source.port !== "443")) {
      return json({ error: "picture came from an unexpected place" }, 502);
    }

    const image = await fetch(source, {
      headers: { "User-Agent": USER_AGENT, Referer: "https://www.tiktok.com/" },
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!image.ok) return json({ error: `picture download failed (${image.status})` }, 502);

    const contentType = image.headers.get("content-type") || "";
    const bytes = await boundedBytes(image, 5 * 1024 * 1024);
    const mime = rasterMime(bytes, contentType);

    const { url, key } = supabaseConfig(env);
    // Unique objects prevent a Member overwriting another editor's picture.
    const path = `avatars/${body.editorId}/${crypto.randomUUID()}`;
    const upload = await fetch(`${url}/storage/v1/object/editor-avatars/${path}`, {
      method: "POST",
      redirect: "error", signal: AbortSignal.timeout(10000),
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": mime,
        "Cache-Control": "3600",
      },
      body: bytes,
    });
    if (!upload.ok) return json({ error: "couldn't save the picture to Supabase Storage" }, 502);

    return json({
      ok: true,
      url: `${url}/storage/v1/object/public/editor-avatars/${path}?v=${Date.now()}`,
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ error:error.message }, error.status);
    return json({ error: "something went wrong fetching that picture" }, 500);
  }
}
