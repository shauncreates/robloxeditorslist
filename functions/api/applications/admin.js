import { json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";
import { HttpError } from "../../_lib.js";
import { deliverApplicationEmails } from "../../_application-email.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env, "application_reviewer");
  const body = await readJson(request);
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) {
    throw new HttpError(400, "Review reasons must be 1,000 characters or fewer.");
  }
  if (body.action === "update" && (!["approved","rejected"].includes(body.status) || !body.reason?.trim())) {
    throw new HttpError(400, "Choose approve or reject and enter a review reason.");
  }
  if (body.message !== undefined && (typeof body.message !== "string" || body.message.length>1000)) throw new HttpError(400,"Applicant messages must be 1,000 characters or fewer.");
  const result = await userRpc(env, token, "rel_applications", {
    p_action: body.action, p_id: body.id || null, p_status: body.status || null, p_offset: body.offset ?? 0, p_reason: body.reason?.trim() || null,
    p_message:body.message?.trim() || null,
  });
  if(body.action === "update") result.notification = result.notification_expected
    ? await deliverApplicationEmails(env,body.id) : {sent:0,status:"no_recipient"};
  return json(result);
}
