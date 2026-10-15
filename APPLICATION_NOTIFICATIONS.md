# Account-linked applications, notifications and activity

This feature branch is prepared for review. No production migration, email configuration or deployment was performed by this change.

## Behaviour

- Applicants sign in to a confirmed REL account. Existing accounts work; new users register and confirm through the existing Supabase Auth flow.
- `/apply/` links to sign-in and returns there after successful sign-in. Unauthenticated API submissions are rejected even if someone bypasses the page.
- The database derives the applicant and recipient from the verified account. Browser-supplied email addresses, account IDs and status values do not choose the recipient or grant permissions.
- Each account can have one unarchived pending application. A stable request ID makes a retried submission return its existing application rather than create another or queue another receipt.
- Submission and review transactions queue email records. The receipt says: “Your application to the Roblox Editors list has been sent. Your request will be reviewed shortly.” Approval and denial emails include the recorded reason. Approval still needs explicit Contributor conversion to add a ranked profile.
- Reviewed applications leave the default pending review queue immediately. Owners can inspect Reviewed and Private archive views. Delete from panel privately archives an application, retaining its details, decision and audit trail. Archiving removes an approved application from the Contributor queue; it never removes an editor already converted or changes rankings.
- Owners have an Activity log for ranking movements, editor/list saves, application submissions, decisions, conversions and archiving. New events capture the account ID, username at the time and timestamp. Rank-change entries include old/new positions, editor names/IDs, list IDs and revisions. Existing audit entries remain available; names and detailed historic movements are not invented for older entries.

## Prerequisites to review before release

1. Verify that all existing REL migrations, including signup usernames, are already applied in the intended database. Do not rerun historical SQL based on old header comments.
2. Review `supabase/migrations/20261015090000_rel_application_accounts_and_audit.sql`. Apply to a disposable test project first. It creates private contact/archive/outbox tables and checked RPCs, adds audit actor snapshots and a ranking-change trigger, and changes application listing to pending by default. It does not rewrite existing application fields, ranking JSON, revisions or history, and it does not seed rankings.
3. Existing anonymous applications have no verified account/email. They can still be reviewed, converted or archived, but no recipient is guessed and no notification is sent for them.
4. Configure a Resend account and verified sender domain only after approval. Use a dedicated sending key and approved From address. Never put real keys in Git, chat, browser code or this cloud environment. Supabase's existing Auth SMTP settings do not supply this application's Resend integration.
5. The Pages server needs the existing Supabase server bindings plus `RESEND_API_KEY` and `REL_EMAIL_FROM`, such as `Roblox Editors List <support@your-verified-domain>`. These belong only in the approved deployment's server settings. This task adds examples, not credentials or runtime bindings.
6. Review the separate retry Worker in `workers/application-email-retry.js` and `wrangler.email-retry.jsonc`. Pages Functions have no scheduled handler. When separately approved and deployed, this Worker retries up to ten notifications every five minutes. It needs the intended `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `REL_EMAIL_FROM` server bindings. Configure its values securely for the intended environment; the config contains no credentials, routes or public workers.dev URL. Do not deploy it against production as part of local testing.
7. Get approval for the migration and both deployments before releasing. Main-branch merges can trigger the Pages deployment. Deploying the Pages source does not deploy this scheduled Worker.

No new production secret or credential is requested in the cloud-environment draft. A domain verification step and actual test-message recipient must be explicitly authorized before a real email test.

## Delivery and retry limits

Functions attempt delivery after submission and review. A provider failure does not roll back a committed application or decision. An unavailable provider/configuration leaves the message queued; the UI does not claim it was sent. Owners can inspect aggregate queue counts and retry eligible messages from Activity log. The scheduled Worker supplies automatic retries after it is configured and deployed separately.

The queue claims messages under a five-minute lease and backs off after failures. Decision mail waits until the receipt has been accepted. Retried provider calls reuse a stable Resend idempotency key. Provider idempotency is time-limited; a delivery accepted by Resend followed by a prolonged database acknowledgement failure can eventually produce a duplicate. This is durable, retryable delivery, not an exactly-once inbox guarantee.

“Sent” in the application means accepted by the email provider, not confirmed inbox delivery. Bounce/delivery webhooks, recipient suppression handling and a retention policy are not added here. Provider errors are stored as categories, without response bodies, tokens or email addresses in the activity view. Notifications are plain text so a review reason cannot inject email HTML.

The original Auth confirmation email remains separate. The applicant must finish account confirmation and submit the application before receiving an application receipt.

## Isolated verification

```bash
npm ci
npm test
npm run build
npm run check:cloudflare
npm run test:preview
```

The fixture uses fictional accounts, PGlite and a mocked Resend transport. It makes no external email request and needs no production credentials. Tests cover account requirements, recipient spoofing, submission replay, private archives, checked permissions, decision locks, preservation of rankings/history, provider failures/retries and actor-attributed rank changes. The browser review exercises the local fixture only.

The browser review normally loads the site's Google Fonts. Where those domains are blocked, `REL_BROWSER_FONT_DIR` can point to genuine Red Hat Text Latin variable WOFF2 files named `red-hat-text-latin-wght-normal.woff2` and `red-hat-text-latin-wght-italic.woff2`; `REL_BROWSER_SYMBOL_FONT` can point to a genuine Material Symbols Rounded variable WOFF2 file. The test injects these local fonts into its isolated browser contexts and still checks actual font loading, family and layout. This does not test Google Fonts delivery. No application font source is changed.

For an authorized real integration test, use a disposable Supabase project with invented rankings, a dedicated sender configuration and explicitly approved test inboxes. Verify receipt and both decision emails, pending-queue removal, private archiving, automatic retries and activity attribution. Leave the live REL project and `data.js` untouched.
