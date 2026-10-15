import { supabaseRequest } from "./_lib.js";

export function applicationMessage(kind, reason) {
  if (kind === "submitted") return {
    subject: "Your Roblox Editors List application has been received",
    text: "Your application to the Roblox Editors list has been sent. Your request will be reviewed shortly.",
  };
  if (!["approved", "rejected"].includes(kind) || typeof reason !== "string" || !reason.trim()) {
    throw new Error("Invalid application notification.");
  }
  return {
    subject: `Your Roblox Editors List application has been ${kind === "approved" ? "approved" : "denied"}`,
    text: `Your application to the Roblox Editors List has been ${kind === "approved" ? "approved" : "denied"}.\n\nReason: ${reason}\n\n` +
      (kind === "approved" ? "A List Contributor will decide when to add your profile. Approval does not automatically change the rankings." : "Thank you for sharing your work with us."),
  };
}

async function emailWork(env, args) {
  const response = await supabaseRequest(env, "rpc/rel_email_work", { method: "POST", body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Email queue unavailable.");
  return response.json();
}

export async function deliverApplicationEmails(env, applicationId = null, limit = 2) {
  if (!env.RESEND_API_KEY || !env.REL_EMAIL_FROM) return { sent: 0, status: "unconfigured" };
  let sent = 0;
  try {
    for (let i = 0; i < limit; i++) {
      const work = await emailWork(env, { p_action: "claim", p_application_id: applicationId });
      if (!work) break;
      let delivered = false, failure = "provider_unavailable";
      try {
        const message = applicationMessage(work.kind, work.reason);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `rel-application/${work.id}` },
          body: JSON.stringify({ from: env.REL_EMAIL_FROM, to: [work.recipient], ...message }),
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const receipt = await response.json().catch(() => ({}));
          delivered = typeof receipt.id === "string" && receipt.id.length > 0;
        } else failure = response.status >= 500 || response.status === 429 ? "provider_unavailable" : "provider_rejected";
      } catch { /* The durable queue retains the notification for a later attempt. */ }
      const result = await emailWork(env, { p_action: delivered ? "sent" : "failed", p_id: work.id, p_lease: work.lease, ...(delivered ? {} : { p_error: failure }) });
      if (!result.ok || !delivered) return { sent, status: "pending" };
      sent++;
    }
    return { sent, status: "processed" };
  } catch {
    // Database commits must not be reported as failed because email delivery failed.
    return { sent, status: "pending" };
  }
}
