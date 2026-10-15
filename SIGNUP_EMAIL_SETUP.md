# Signup confirmation from support@robloxeditors.com

Requested flow: public email/password signup, then email confirmation before
sign-in. No second emailed code is required at each login. New accounts remain
Members; confirming email grants no elevated permissions or editor ownership.

Follow [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md) for the complete sequence. The
first Owner/test recipient is `shaun@seeshaun.xyz`; registration is still needed.

The domain is active in Cloudflare. No email service has been configured by this
implementation. The sender address is an Auth email setting, not an editor-data
field or a value that browser code can configure.

## Sending configuration for review

Supabase supports [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
Cloudflare's [Email Sending SMTP endpoint](https://developers.cloudflare.com/email-service/api/send-emails/smtp/)
can supply it, after the account/domain is onboarded for Email Sending (currently
documented as Beta). Availability and plan limits must be checked before enabling.
Email Routing is for incoming mail and is separate from outgoing Email Sending.

| Supabase Custom SMTP setting | Proposed value |
| --- | --- |
| Sender email | support@robloxeditors.com |
| Sender name | Roblox Editors List |
| Host | smtp.mx.cloudflare.net |
| Port | 465 (implicit TLS) |
| Username | api_token |
| Password | Scoped Cloudflare API token with Email Sending: Edit, stored only in Supabase SMTP settings |

Onboard `robloxeditors.com` in Cloudflare Email Sending and verify its required
SPF/DKIM/DMARC/bounce DNS records. Review existing records first. Do not replace
mailbox MX records or create conflicting SPF records. The SMTP credential stays
out of `.dev.vars`, browser code, Git and chat. The site uses Supabase's signup
endpoint; Supabase generates/validates the confirmation token and sends the email.
If Email Sending is unavailable, choose another SMTP provider and verify the same
sender domain there; the site code does not need a different mail-sending API.

In Supabase Auth, enable email/password, public signup, Confirm email and minimum
password length 8 with uppercase, lowercase and digits. Set the approved site URL and exact preview/production
`/email-verified/` and `/reset-password/` redirects. Keep older sign-in redirects for previously issued emails. The confirmation template
is `supabase/email-templates/confirm-signup.html`; set its subject to
**Confirm your Roblox Editors List account** in the Auth Email Templates settings.

The template uses Supabase's `ConfirmationURL`. New confirmation links return to
`/email-verified/`, where fragment tokens are removed and Supabase verifies the
confirmed user before the success message appears. The user then follows the
sign-in link and enters their password. Existing server/database checks reject
unconfirmed users. The recovery template uses `Token` and `RedirectTo` instead.

## Verification before launch

After configuration is approved, use an explicitly authorized recipient address
to test signup delivery, visible From name/address, spam placement, confirmation,
expired/reused links and sign-in rejection before confirmation. Configure Auth
rate limits and signup abuse controls. Never send unrequested test emails.

Receiving replies at `support@robloxeditors.com` requires a mailbox or a separate
Email Routing destination. Outgoing sender verification alone does not provide
a support inbox. Confirm the destination before adding forwarding rules.

No DNS, SMTP, Auth configuration or deployment changes have been executed, and
no email has been sent. The SMTP credential and an approved test recipient are
still needed for live setup/testing.
