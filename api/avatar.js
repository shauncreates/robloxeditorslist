import { put } from "@vercel/blob";
import { checkPassword, wait } from "./_lib.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Only ever download images from TikTok's own image servers.
const okHost = (h) => /(tiktokcdn[a-z-]*\.com|ibyteimg\.com|byteimg\.com)$/i.test(h);

// Admin-only. Looks up a TikTok profile picture, copies it into your Blob storage
// (TikTok's own picture links expire), and returns the permanent link.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "ADMIN_PASSWORD is not set in Vercel" });

  const { password, username } = req.body || {};
  if (!checkPassword(password)) {
    await wait(600);
    return res.status(401).json({ error: "wrong password" });
  }

  const user = String(username || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._]{1,40}$/.test(user)) return res.status(400).json({ error: "that doesn't look like a TikTok username" });

  try {
    const page = await fetch(`https://www.tiktok.com/@${user}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9", Accept: "text/html" },
      redirect: "follow",
    });
    if (!page.ok) return res.status(502).json({ error: `TikTok answered ${page.status} for @${user}` });
    const html = await page.text();

    const m =
      html.match(/"avatarLarger":"([^"]+)"/) ||
      html.match(/"avatarMedium":"([^"]+)"/) ||
      html.match(/<meta property="og:image" content="([^"]+)"/);
    if (!m) return res.status(404).json({ error: "couldn't find a picture on that page (TikTok may be blocking the request)" });

    let imgUrl;
    try { imgUrl = m[0].startsWith("<meta") ? m[1].replace(/&amp;/g, "&") : JSON.parse('"' + m[1] + '"'); }
    catch (e) { return res.status(502).json({ error: "couldn't read the picture link" }); }

    const u = new URL(imgUrl);
    if (u.protocol !== "https:" || !okHost(u.hostname)) return res.status(502).json({ error: "picture came from an unexpected place" });

    const img = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" } });
    if (!img.ok) return res.status(502).json({ error: `picture download failed (${img.status})` });
    const type = img.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return res.status(502).json({ error: "that wasn't an image" });
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return res.status(502).json({ error: "picture is too big" });

    const blob = await put(`avatars/${user.toLowerCase()}`, buf, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: type,
    });
    return res.status(200).json({ ok: true, url: blob.url + "?v=" + Date.now() });
  } catch (e) {
    return res.status(500).json({ error: "something went wrong fetching that picture" });
  }
}
