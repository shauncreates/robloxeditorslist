import { json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";
import { HttpError } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env, "application_reviewer");
  const body = await readJson(request);
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) {
    throw new HttpError(400, "Review reasons must be 1,000 characters or fewer.");
  }
  if (body.action === "update" && (!["approved","rejected"].includes(body.status) || !body.reason?.trim())) {
    throw new HttpError(400, "Choose approve or reject and enter a review reason.");
  }
  return json(await userRpc(env, token, "rel_applications", {
    p_action: body.action, p_id: body.id || null, p_status: body.status || null, p_offset: body.offset ?? 0, p_reason: body.reason?.trim() || null,
  }));
}
