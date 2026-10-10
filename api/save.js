import { put } from "@vercel/blob";
import { checkPassword, validate, wait } from "./_lib.js";

// Saves the list data. Requires the admin password on every request,
// so nobody but you can change the site.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "ADMIN_PASSWORD is not set in Vercel" });

  const { password, data } = req.body || {};
  if (!checkPassword(password)) {
    await wait(600);
    return res.status(401).json({ error: "wrong password" });
  }
  if (!validate(data)) return res.status(400).json({ error: "data looks invalid" });

  try {
    await put("site-data.json", JSON.stringify(data), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "couldn't save (is the Blob store connected? it must be a Public store)" });
  }
}
