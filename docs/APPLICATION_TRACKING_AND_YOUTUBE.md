# Application tracking and Connect YouTube

This branch prepares account-owned application tracking, transactional notifications, private Owner archives and Google-authorised YouTube connections. It starts from `main` at `4ad2c76` and reconciles the earlier application notification work with current profiles, contributors and navigation. It has not been deployed or applied to production Supabase.

TikTok verification, public daily ranking snapshots, share cards and clans remain separate later phases. Existing Owner-reviewed editor linking remains available. Connecting YouTube does not sign someone into REL, grant roles, claim a ranked editor automatically or change rankings.

## Applications

Applicants must sign into a confirmed REL account before submitting. The submission uses the account identity and confirmed email rather than a supplied recipient or user ID. A request UUID prevents a retry of the same submission creating another application or receipt. One unarchived pending application is allowed per account.

My account shows only that account's applications, with Pending review, Approved, Denied or Archived and the applicant-facing message. The projection excludes staff notes, reviewer identifiers, recipients and private outbox/audit records. It remains available when email delivery is delayed. Anonymous legacy applications are not assigned to an account by guessing names or social URLs.

Reviewers enter two separate fields: a message that will be shared with the applicant, and a private staff note. Decisions remain locked. Old private reasons are not copied into the new applicant message. Decided applications leave the active review queue. Owners can view reviewed records and privately archive applications; this removes them from staff queues and prevents further review/conversion without deleting their history. Applicants retain their own record.

Approval still does not publish or rank the editor. A List Contributor separately converts an approved, unarchived application. Existing revision checks, previous-document history and ranking protection remain intact. New activity records include the actor's username at the time, application decisions and exact private placement changes; they do not backfill invented actors or historical movements.

### Notifications

The receipt text is:

> Your application to the Roblox Editors list has been sent. Your request will be reviewed shortly.

Decision emails say approved or denied and include only the applicant-facing message. Plain text and escaped branded HTML are sent together. The account link opens My account; it does not grant access or embed a login token. Remote email images use the existing public REL logo.

A private database outbox records receipt and decision notifications. Delivery attempts use leases and a stable provider idempotency key. A provider failure never turns a committed application or decision into a reported failed save. Failed attempts back off, and the receipt is processed before a later decision. Provider acceptance is not a guarantee of delivery to the inbox. Provider idempotency has its own retention window, so this is not an unlimited exactly-once-delivery guarantee.

Owners can retry queued emails from Activity log. The scheduled worker also retries them. Email is optional at configuration time: without Resend settings the application/status workflow still works and the queue remains pending. Do not describe notifications as live until an approved recipient has received and checked them.

## Google-authorised YouTube ownership

1. Sign into REL and choose Connect YouTube through Google.
2. Google asks for the read-only YouTube scope. REL requests neither a Google email identity nor upload/post permissions.
3. A server callback exchanges the code using PKCE and reads the authorised user's channels with `channels.list(mine=true)`. A Google sign-in by itself, a display name, public search result or supplied channel ID is not proof of channel ownership.
4. My account shows the returned channel choices. The user explicitly confirms one channel in the same REL session that started the flow.
5. The public account profile can show the connected channel. Existing ranked-editor ownership still uses the current manual review flow.

State is random, single use and stored as a hash. The challenge expires after ten minutes and is bound to the initiating account/session. A temporary HttpOnly SameSite=Lax state cookie permits the cross-site callback; REL's session cookies remain SameSite=Strict. The callback stages proof rather than creating a connection. A separate HttpOnly SameSite=Strict confirmation cookie and authenticated POST finalise it. Callback URLs return only a fixed status to My account, not Google tokens, codes or state values.

A channel cannot be silently transferred to another REL account. Conflicts require Owner review. Starts are limited to five per account per hour and a short restart cooldown. Unexpected/missing scopes, expired or replayed state, revoked REL sessions, missing channels and provider failures create no verified connection. Up to 50 returned channels are supported; an unexpected additional page fails safely.

### Stored credentials, rechecks and disconnect

YouTube's policies require stored API data to be refreshed or removed, and the client must support revocation. REL therefore stores only an AES-256-GCM-encrypted refresh credential in private server-side storage. Access tokens are temporary. No token, encryption key or OAuth client secret is returned in public/account APIs, staff activity logs or browser storage.

The scheduled worker checks a small batch of due connections approximately daily, refreshing the title and verifying the channel remains accessible. Failed batches have a retry delay so one broken record cannot block every other connection. Disabled accounts are not refreshed as normal active connections. A public connection is hidden after two days without a successful check. Revoked/no-longer-accessible connections are removed when detected, and connections are purged after 29 days without a successful check. Expired pending challenges are also removed. These retention operations depend on the maintenance worker actually running.

Disconnect calls Google's revocation endpoint, then removes the connection, pending proof and stored credential. A temporary revocation failure is shown as retryable instead of claiming that revocation succeeded. Cancel and disconnect removes a pending authorisation as well as any current YouTube link. Users can also revoke permission through [Google's security settings](https://security.google.com/settings/security/permissions); scheduled rechecks detect external revocation. Audit entries retain the REL actor/action without retaining the removed YouTube channel metadata or tokens.

See the public [connection privacy page](../youtube-privacy/index.html). Review it alongside the broader REL notices before public activation. Google documentation: [server-side OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps), [channel lookup](https://developers.google.com/youtube/v3/docs/channels/list), [developer policies](https://developers.google.com/youtube/terms/developer-policies).

## Required configuration

No production secret has been added to this cloud environment. `.dev.vars.example` contains empty optional fields only. Configure values securely in the intended Cloudflare environment after approval.

| Binding | Where it is needed |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Existing Functions and maintenance worker |
| `SUPABASE_PUBLISHABLE_KEY` | Existing account Functions |
| `RESEND_API_KEY`, `REL_EMAIL_FROM` | Functions and maintenance worker for application emails |
| `REL_GOOGLE_CLIENT_ID`, `REL_GOOGLE_CLIENT_SECRET` | Functions and maintenance worker for YouTube |
| `REL_GOOGLE_TOKEN_KEY` | The same base64-encoded 32-random-byte encryption key in Functions and maintenance worker |
| `REL_YOUTUBE_REDIRECT_URI` | Functions; exact authorised callback URL |

Use a separately configured test project/client for functional testing. Production callback: `https://robloxeditors.com/api/account/youtube/callback`. Loopback HTTP callbacks are permitted only for localhost/127.0.0.1 testing. Other origins must use HTTPS, and the request origin must match the configured callback origin. Preview deployments cannot borrow the production callback.

Create a Google Cloud OAuth **Web application**, enable YouTube Data API v3, and request only `https://www.googleapis.com/auth/youtube.readonly`. Configure the exact callback, consent branding, domain, support contact and privacy/terms links. Start in Testing with explicitly enrolled test users. Public use may require Google's sensitive-scope verification; a testing-mode refresh token can expire after seven days. This implementation does not configure or approve the provider app. Google sign-in is not being enabled as an alternative Supabase/REL login.

Generate the token encryption key securely outside chat and store it in the deployment secret manager. Do not commit it, paste it into chat or add a production key to this cloud workspace. Losing or rotating it requires a planned reconnection/revocation process; changing it does not decrypt existing records. Bind the identical key to the maintenance worker before enabling connections on Pages.

For Resend, verify an existing owned sender domain and choose an appropriate From address. The Free plan currently allows 100 emails/day and 3,000/month, shared with other use of that Resend account. Quota failures leave notifications queued. Auth confirmation/recovery emails are separate workflows. [Resend limits](https://resend.com/docs/knowledge-base/resend-sending-limits)

The maintenance worker uses the existing Cloudflare Workers Free allowance and a five-minute cron, processing at most five emails and five due YouTube connections per invocation. Pages deployment does not deploy this worker automatically. Google and Supabase quotas also apply. No paid upgrade or scraping service is required or automatically enabled.

## Release order and production boundaries

1. Obtain separate approval for production SQL. Inspect the intended database schema and backups without resetting rankings. If the old unmerged `20261015090000_rel_application_accounts_and_audit.sql` was already applied, stop and prepare a reviewed compatibility migration; do not run this branch's create-table migration over it or drop its records.
2. Review and apply only the new prerequisites in order: [`20261016120000_rel_application_tracking.sql`](../supabase/migrations/20261016120000_rel_application_tracking.sql), then [`20261016130000_rel_youtube_connections.sql`](../supabase/migrations/20261016130000_rel_youtube_connections.sql). They add private tables/functions and the new applicant-message column; existing applications, decisions, rankings and history are preserved. Both scripts are transactional.
3. Coordinate a short application-maintenance window: the tracking migration removes the old anonymous insertion grant and replaces the review RPC contract. The old website's submit/review requests will be unavailable between that migration and the approved website release. Do not apply it casually while expecting the old flow to continue working.
4. Configure an approved sender/provider and Google test app. Review the general REL privacy/terms pages and this feature notice for the actual deployment. The separate security/privacy PR #4 is not silently included in this branch.
5. Obtain approval to deploy the maintenance worker described by [`wrangler.email-retry.jsonc`](../wrangler.email-retry.jsonc). Bind the existing database credentials, sender settings and Google/key settings there. Verify cron execution and retention/revocation handling in the intended environment before enabling Google connections publicly. Its HTTP handler always returns 404; it is not a public email-sending endpoint.
6. Obtain approval to merge/deploy the website. Configure Google settings on Pages only when the maintenance worker is ready. Missing Google settings produce an explicit unavailable state and retain manual linking; missing SQL produces an error rather than pretending no records exist. Missing Resend settings retain the outbox.
7. With separately authorised test accounts/recipients, verify actual Google consent/channel selection/revocation, real email delivery and the correct deployment commit. Then compare existing ranking counts/order and protected-request rejection. No such live writes or emails were performed during development.

Application archives, audit records, contact snapshots, delivered outbox entries and database backups still need an operator retention policy. Do not interpret the YouTube-specific purge as a general account/application erasure feature.

## Local verification

`npm test` runs the existing suite plus notification/privacy and OAuth tests against isolated PGlite databases. `npm run build` creates the allowlisted static output, and `npm run check:cloudflare` compiles Functions without deployment. The scheduled worker can be compiled without deploying:

```sh
WRANGLER_LOG_PATH=/tmp/rel-worker-check.log npx wrangler deploy --dry-run --config wrangler.email-retry.jsonc --outdir .wrangler/maintenance-check
```

For a local fixture with simulated Google token/channel responses:

```sh
REL_FIXTURE_YOUTUBE=1 npm run test:preview
```

This flag affects only `tests/preview.mjs`; it does not configure production Google access. `tests/browser-review.mjs` intercepts the provider navigation with a labelled local authorisation fixture. It exercises real callback cookies, same-session final confirmation, private review fields, archives, activity, disconnect and email previews at desktop/mobile sizes. Provider approval, live Google delivery and email inbox rendering are not established by these fixtures.
