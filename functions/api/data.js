import { json, supabaseRequest } from "../_lib.js";

export async function onRequestGet({ env }) {
  try {
    const response = await supabaseRequest(
      env,
      "roblox_editor_site_data?select=data&id=eq.site-data&limit=1",
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return json({ error: "unavailable" }, 500);
    const rows = await response.json();
    if (!rows.length) return json({ error: "nothing saved yet" }, 404);
    return json(rows[0].data);
  } catch {
    return json({ error: "unavailable" }, 500);
  }
}
