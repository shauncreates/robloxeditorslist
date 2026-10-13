import { checkPassword, json, supabaseRequest, validate, wait } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: "ADMIN_PASSWORD is not configured in Cloudflare Pages." }, 500);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 550000) return json({ error: "Request is too large." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!(await checkPassword(body?.password, env))) {
    await wait(600);
    return json({ error: "wrong password" }, 401);
  }
  if (!validate(body?.data)) return json({ error: "data looks invalid" }, 400);

  try {
    const response = await supabaseRequest(
      env,
      "roblox_editor_site_data?on_conflict=id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: "site-data", data: body.data, updated_at: new Date().toISOString() }),
      },
    );
    if (!response.ok) return json({ error: "couldn't save the list to Supabase" }, 500);
    return json({ ok: true });
  } catch {
    return json({ error: "couldn't connect to Supabase; check the Cloudflare secrets" }, 500);
  }
}
