import crypto from "node:crypto";

// Constant-time password check against the ADMIN_PASSWORD environment variable.
export function checkPassword(pw) {
  const real = process.env.ADMIN_PASSWORD || "";
  if (!real || typeof pw !== "string") return false;
  const a = crypto.createHash("sha256").update(pw).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

// Reject anything that doesn't look like our data shape before it's saved.
export function validate(d) {
  const isStr = (x) => typeof x === "string";
  if (!d || typeof d !== "object") return false;
  if (!d.site || typeof d.site !== "object") return false;
  if (!Array.isArray(d.styles) || d.styles.length > 30) return false;
  if (!d.styles.every((s) => s && isStr(s.id) && isStr(s.name) && isStr(s.color))) return false;
  if (!Array.isArray(d.editors) || d.editors.length > 300) return false;
  if (!d.editors.every((e) => e && isStr(e.id) && isStr(e.name))) return false;
  if (!d.lists || typeof d.lists !== "object") return false;
  for (const k of Object.keys(d.lists)) {
    if (!Array.isArray(d.lists[k]) || !d.lists[k].every(isStr)) return false;
  }
  return JSON.stringify(d).length < 500000;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
