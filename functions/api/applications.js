import { json, supabaseRequest } from "../_lib.js";

const MAX_BODY = 16000;
const allowedPlatforms = new Set(["TikTok", "YouTube"]);
const allowedStyles = new Set([
  "Velocity",
  "Montages",
  "AMVs",
  "Motion graphics",
  "3D edits",
  "Short-form edits",
  "Transitions",
  "Other",
]);

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function profileMatchesPlatform(value, platform) {
  const url = safeHttpsUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (platform === "TikTok") return host === "tiktok.com" || host.endsWith(".tiktok.com");
  if (platform === "YouTube") {
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  }
  return false;
}

export async function onRequestPost({ request, env }) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json({ error: "Application is too large." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Please submit a valid application." }, 400);
  }

  // Honeypot: ordinary users never see or fill this field.
  if (typeof body?.website === "string" && body.website.trim()) {
    return json({ ok: true });
  }

  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const platform = typeof body?.platform === "string" ? body.platform : "";
  const profileUrl = typeof body?.profileUrl === "string" ? body.profileUrl.trim() : "";
  const software = typeof body?.software === "string" ? body.software.trim() : "";
  const examplesUrl = typeof body?.examplesUrl === "string" ? body.examplesUrl.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const styles = Array.isArray(body?.styles) ? [...new Set(body.styles)] : [];

  if (displayName.length < 2 || displayName.length > 50) {
    return json({ error: "Display name must be between 2 and 50 characters." }, 400);
  }
  if (!allowedPlatforms.has(platform) || !profileMatchesPlatform(profileUrl, platform)) {
    return json({ error: "Enter a valid HTTPS profile link for your selected platform." }, 400);
  }
  if (software.length < 2 || software.length > 120) {
    return json({ error: "Tell us which editing software you use (2–120 characters)." }, 400);
  }
  if (!styles.length || styles.length > 8 || !styles.every((style) => allowedStyles.has(style))) {
    return json({ error: "Choose between 1 and 8 editing styles." }, 400);
  }
  if (!safeHttpsUrl(examplesUrl)) {
    return json({ error: "Your examples link must be a valid HTTPS URL." }, 400);
  }
  if (notes.length > 1000) return json({ error: "Additional notes must be under 1,000 characters." }, 400);

  try {
    const response = await supabaseRequest(env, "editor_applications", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        display_name: displayName,
        platform,
        profile_url: profileUrl,
        software,
        styles,
        examples_url: examplesUrl,
        notes: notes || null,
        status: "pending",
      }),
    });
    if (!response.ok) {
      return json({ error: "We couldn't save your application right now. Please try again later." }, 500);
    }
    return json({ ok: true }, 201);
  } catch {
    return json({ error: "Applications are temporarily unavailable. Please try again later." }, 500);
  }
}
