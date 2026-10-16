import { json } from "../../_lib.js";
import { requireAccount } from "../../_auth.js";
import { deliverApplicationEmails } from "../../_application-email.js";

export async function onRequestPost({ request, env }) {
  await requireAccount(request, env, "owner");
  return json(await deliverApplicationEmails(env, null, 5));
}
