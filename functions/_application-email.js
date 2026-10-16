import { supabaseRequest } from "./_lib.js";

function branded(message) {
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  return {
    ...message,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(message.subject)}</title></head><body style="margin:0;padding:24px 12px;background:#050706;color:#eef5ef;font:16px/1.6 Arial,sans-serif"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse"><tr><td style="padding:24px;background:#0b100c;border:1px solid #68796b"><img src="https://robloxeditors.com/media/logo.svg" width="120" alt="Roblox Editors List"><h1 style="font-size:25px;line-height:1.25;margin:28px 0 20px">${esc(message.subject)}</h1><p style="white-space:pre-wrap">${esc(message.text).replaceAll("\n", "<br>")}</p><p style="margin:28px 0"><a href="https://robloxeditors.com/account/#myApplications" style="display:inline-block;padding:12px 18px;background:#7af500;color:#061109;font-weight:bold;text-decoration:none;border-radius:6px">View your application</a></p><p style="color:#b5c2b8;font-size:13px">This update concerns your REL application. Private staff notes are not included.</p></td></tr></table></body></html>`,
  };
}

export function applicationMessage(kind, reason) {
  if (kind === "submitted")
    return branded({
      subject: "Your Roblox Editors List application has been received",
      text: "Your application to the Roblox Editors list has been sent. Your request will be reviewed shortly.",
    });
  if (
    !["approved", "rejected"].includes(kind) ||
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    throw new Error("Invalid application notification.");
  }
  return branded({
    subject: `Your Roblox Editors List application has been ${kind === "approved" ? "approved" : "denied"}`,
    text:
      `Your application to the Roblox Editors List has been ${kind === "approved" ? "approved" : "denied"}.\n\nReason: ${reason}\n\n` +
      (kind === "approved"
        ? "A List Contributor will decide when to add your profile. Approval does not automatically change the rankings."
        : "Thank you for sharing your work with us."),
  });
}

async function emailWork(env, args) {
  const response = await supabaseRequest(env, "rpc/rel_email_work", {
    method: "POST",
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Email queue unavailable.");
  return response.json();
}

export async function deliverApplicationEmails(
  env,
  applicationId = null,
  limit = 2,
) {
  if (!env.RESEND_API_KEY || !env.REL_EMAIL_FROM)
    return { sent: 0, status: "unconfigured" };
  let sent = 0;
  try {
    for (let i = 0; i < limit; i++) {
      const work = await emailWork(env, {
        p_action: "claim",
        p_application_id: applicationId,
      });
      if (!work) break;
      let delivered = false,
        failure = "provider_unavailable";
      try {
        const message = applicationMessage(work.kind, work.reason);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `rel-application/${work.id}`,
          },
          body: JSON.stringify({
            from: env.REL_EMAIL_FROM,
            to: [work.recipient],
            ...message,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const receipt = await response.json().catch(() => ({}));
          delivered = typeof receipt.id === "string" && receipt.id.length > 0;
        } else
          failure =
            response.status >= 500 || response.status === 429
              ? "provider_unavailable"
              : "provider_rejected";
      } catch {
        /* The durable queue retains the notification for a later attempt. */
      }
      const result = await emailWork(env, {
        p_action: delivered ? "sent" : "failed",
        p_id: work.id,
        p_lease: work.lease,
        ...(delivered ? {} : { p_error: failure }),
      });
      if (!result.ok || !delivered) return { sent, status: "pending" };
      sent++;
    }
    return { sent, status: "processed" };
  } catch {
    // Database commits must not be reported as failed because email delivery failed.
    return { sent, status: "pending" };
  }
}
