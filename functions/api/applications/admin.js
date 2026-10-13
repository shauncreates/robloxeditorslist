import { checkPassword, json, supabaseRequest, wait } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) return json({ error: "Admin login is not configured." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (!(await checkPassword(body?.password, env))) {
    await wait(600);
    return json({ error: "Incorrect admin password." }, 401);
  }

  const action = body?.action;
  try {
    if (action === "list") {
      const response = await supabaseRequest(
        env,
        "editor_applications?select=id,display_name,platform,profile_url,software,styles,examples_url,notes,status,created_at,reviewed_at&order=created_at.desc&limit=100",
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) return json({ error: "Could not load applications." }, 500);
      return json({ applications: await response.json() });
    }

    if (action === "update") {
      const id = typeof body?.id === "string" ? body.id : "";
      const status = body?.status;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return json({ error: "Invalid application ID." }, 400);
      }
      if (!["pending", "approved", "rejected"].includes(status)) {
        return json({ error: "Invalid application status." }, 400);
      }

      const response = await supabaseRequest(
        env,
        `editor_applications?id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status,
            reviewed_at: status === "pending" ? null : new Date().toISOString(),
          }),
        },
      );
      if (!response.ok) return json({ error: "Could not update this application." }, 500);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch {
    return json({ error: "Could not connect to the application database." }, 500);
  }
}
