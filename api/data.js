import { list } from "@vercel/blob";

// Public: returns the saved list data. The site calls this on every load.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { blobs } = await list({ prefix: "site-data.json" });
    const blob = blobs.find((b) => b.pathname === "site-data.json");
    if (!blob) return res.status(404).json({ error: "nothing saved yet" });
    const r = await fetch(blob.url + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("blob fetch failed");
    return res.status(200).json(await r.json());
  } catch (e) {
    return res.status(500).json({ error: "unavailable" });
  }
}
