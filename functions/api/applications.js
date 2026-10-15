import { HttpError, json, readJson } from "../_lib.js";
import { requireAccount, userRpc } from "../_auth.js";
import { deliverApplicationEmails } from "../_application-email.js";

import { readSite } from "../_site.js";

const MAX_BODY = 16000;
const allowedPlatforms = new Set(["TikTok", "YouTube"]);

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
  const { token } = await requireAccount(request, env);
  const body = await readJson(request, MAX_BODY);

  // Honeypot: ordinary users never see or fill this field.
  if (typeof body?.website === "string" && body.website.trim()) {
    return json({ ok: true });
  }
  if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
    throw new HttpError(400, "Reload the application form before submitting.");
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
  const site = await readSite(env);
  const allowedStyles = new Set(site.styles.map(style => style.name));
  const validStyles = styles.length > 0 && styles.length <= 31 && styles.every((style) =>
    typeof style === "string" &&
    (allowedStyles.has(style) || (/^Other: .{1,80}$/.test(style) && style.slice(7).trim().length > 0))
  );
  if (!validStyles) {
    return json({ error: "Choose at least one listed style, and enter a name for any other style." }, 400);
  }
  if (!safeHttpsUrl(examplesUrl)) {
    return json({ error: "Your examples link must be a valid HTTPS URL." }, 400);
  }
  if (notes.length > 1000) return json({ error: "Additional notes must be under 1,000 characters." }, 400);

  const result = await userRpc(env, token, "rel_submit_application", {
    p_request_id: body.requestId,
    p_data: {
      display_name: displayName,
      platform,
      profile_url: profileUrl,
      software,
      styles,
      examples_url: examplesUrl,
      notes: notes || null,
    },
  });
  const notification = await deliverApplicationEmails(env, result.id);
  return json({ ...result, notification }, result.replayed ? 200 : 201);
}
