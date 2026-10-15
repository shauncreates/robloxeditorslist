import { HttpError, supabaseRequest, validate } from "./_lib.js";

export async function readSite(env) {
  const response = await supabaseRequest(env, "roblox_editor_site_data?select=data&id=eq.site-data&limit=1");
  if (!response.ok) throw new HttpError(503, "Live list information is unavailable.");
  const rows = await response.json();
  if (!rows.length || !validate(rows[0].data)) throw new HttpError(503, "Live list information is unavailable.");
  return rows[0].data;
}
