import { checkPassword, json, wait } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: "ADMIN_PASSWORD is not configured in Cloudflare Pages." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (await checkPassword(body?.password, env)) return json({ ok: true });
  await wait(600);
  return json({ error: "wrong password" }, 401);
}
