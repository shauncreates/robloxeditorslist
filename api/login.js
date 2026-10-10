import { checkPassword, wait } from "./_lib.js";

// Checks the admin password. Only used so /admin can show its login screen.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "ADMIN_PASSWORD is not set in Vercel" });
  if (checkPassword(req.body && req.body.password)) return res.status(200).json({ ok: true });
  await wait(600); // slow down guessing
  return res.status(401).json({ error: "wrong password" });
}
