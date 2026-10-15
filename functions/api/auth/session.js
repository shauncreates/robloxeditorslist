import { json } from "../../_lib.js";
import { requireAccount } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { account } = await requireAccount(request, env);
  return json({ account });
}
