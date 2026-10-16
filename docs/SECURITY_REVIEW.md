# Security and privacy review

Reviewed on 16 October 2026 against `main` at `4ad2c76`, with the changes on `fix/security-review`. This records code inspection and isolated tests. It does not certify the live Supabase or Cloudflare configuration.

## Changes in this branch

- Browser security headers apply to static pages and Functions responses. Inline scripts use hashes generated from their exact contents; scripts do not require `unsafe-inline` or `unsafe-eval`. Existing Google Fonts, profile images, Cloudflare Web Analytics and optional YouTube players remain supported.
- TikTok avatar fetching follows only HTTPS TikTok page redirects, refuses image redirects and unexpected image hosts, limits streamed response sizes, and applies upstream timeouts. Storage uploads accept matching PNG, JPEG or WebP signatures and MIME types. This checks signatures, not full image decoding. Existing account ownership checks and unique storage paths remain in place.
- Sensitive requests use persistent, per-network limits before additional Auth calls, application writes or avatar downloads. The required database migration is described below.
- Privacy, Cookies and Terms pages describe REL's current features, UK operation and owner-approved public contact, `shaun@seeshaun.xyz`. Links are visible beside signup and application forms and in public page navigation. The application permission checkbox remains required.
- Showcase players on public profiles and ranking drawers load only after an explicit visitor choice. The notice loads no YouTube image or player. The choice is per player and is not persisted. Closing a ranking drawer removes its player, including on Escape.
- Admin editor and site fields have associated labels; style name and colour fields have accessible names. The new video controls work with keyboard input and keep their labels visible.

## Required release order

**Do not merge or deploy this branch before its database prerequisite is applied with the owner's separate approval.**

1. Review and approve [`20261015230000_rel_request_limits.sql`](../supabase/migrations/20261015230000_rel_request_limits.sql) for the intended Supabase project. It requires the existing `rel_private` account schema. Apply only this new migration through the authorised database workflow; do not re-import rankings or rerun older setup scripts.
2. Verify `public.rel_take_rate_limit(text,text)` exists, only `service_role` can execute it, and `rel_private.request_limits` has RLS enabled and no client grants. Test limiting against a separate test project before release. The local tests exercise these permissions using PostgreSQL roles in PGlite.
3. Confirm the existing server-only `SUPABASE_SERVICE_ROLE_KEY` remains available to Pages Functions. This feature adds no secret or browser credential. It trusts Cloudflare's request metadata and connecting-IP header, not `X-Forwarded-For`.
4. Review the public notices against actual provider regions, email sender, retention practices and operator details. The source describes known behaviour and does not invent a fixed deletion schedule. Decide and document retention periods for accounts, applications, audit records and backups. The site currently attracts a Roblox community audience; assess any additional duties concerning children's information against how the service is actually operated.
5. Obtain approval to merge and deploy. After release, check static and authenticated response headers, real signup/recovery delivery, ordinary application submission, avatars and both video views. Any live write test needs permission and an intended test account. Existing ranking order must remain unchanged.

If the limiter function is missing or unavailable, the affected endpoints return **503** and do not continue to Auth, application writes or avatar fetching. A valid counter that exceeds its budget returns **429** with `Retry-After`. This failure behaviour prevents an outage from bypassing the limit, but means a missing migration interrupts those flows.

## Request limits

Limits apply per action and network address; people on the same public address share a budget. Windows start with the first request in that window. They are not per-account lockouts.

| Action | Requests | Window |
| --- | ---: | --- |
| Sign in | 30 | 1 minute |
| Create account | 5 | 10 minutes |
| Request recovery email | 5 | 10 minutes |
| Submit password reset | 10 | 10 minutes |
| Submit application | 10 | 10 minutes |
| Fetch avatar | 60 | 10 minutes |

The database stores an action, SHA-256 hash of the address, count and expiry. The raw address is not sent to the counter RPC. Hashing is pseudonymisation, not anonymisation. Expired rows are removed in batches during future requests, so expiry is not a guaranteed deletion deadline. No new session cookie or consent preference is used for the limiter.

These limits add one database request per eligible attempt and do not stop distributed traffic, rotating addresses or volumetric attacks before they reach Functions. Use provider rate controls and billing limits for that separate layer. Shared-address limits may need adjustment based on real usage, especially for bulk avatar fetching.

## Checklist findings

| Area | Evidence and remaining limits |
| --- | --- |
| API keys | Database service credentials are used in Functions, not shipped to browsers. The build copies an explicit website allowlist. No production credentials were added to this environment. |
| Environment variables | Required bindings are named in the existing setup documentation; local tests use fictional credentials. Production bindings were not changed or authenticated here. |
| Git history | Gitleaks 8.30.1 scanned reachable local Git history with full redaction. Its six matches were fictional fixture passwords in three test files, verified against their source context. No production credential was identified by that scan; this is not proof that every possible secret pattern or remote record is covered. |
| Admin routes | Server middleware checks verified account access and staff roles before returning Admin HTML. Anonymous access redirects to sign-in. Members use My account. |
| Authentication | Existing tests cover confirmed email, active sessions, disabled/banned users, expired/revoked sessions and fresh sign-in after recovery. Live provider settings and email delivery still need dashboard verification. |
| Permissions | Server and SQL checks enforce roles and editor ownership. Metadata does not grant roles. Member profile edits cannot change rankings; last-owner protections remain tested. |
| Input validation | APIs bound request bytes and validate fields/URLs. Avatar downloads now have streamed limits, host/redirect checks, timeouts and raster signature validation. |
| XSS | Existing escaped rendering and URL checks reject unsafe profile content. Chromium tests retain malicious text as text and reject a newly injected inline script under CSP. CSP adds defence in depth; it does not replace escaping. |
| SQL injection | Production RPC calls use structured arguments and static SQL. Security-definer routines pin their search path. No new interpolated SQL is introduced. |
| Database rules | Local tests exercise private RLS and RPC permissions, including the new counter. The live database inventory and grants were not inspected with production SQL credentials. |
| Rate limits | New persistent counters cover the six actions above; tests exercise denied writes/Auth calls, isolation, expiry and an unavailable counter. Edge limits remain a separate provider setting. |
| Spend controls | Cloudflare/Supabase budgets, alerts and hard limits require an authorised dashboard check; they were not changed or claimed as configured. |
| Uploads | Avatar fetching remains authenticated and ownership-checked; unique paths prevent another profile's object being overwritten. New checks reject SVG, wrong signatures, oversize content and image redirects. External user-entered picture URLs still depend on their hosts. |
| CSRF | Mutation middleware checks same-origin requests and rejects cross-site Fetch metadata. Session cookies use SameSite=Strict. Tests reject a cross-origin application request. |
| CORS | API code does not enable credentialed wildcard CORS. Public static asset CORS is separate from permission to make authenticated API requests. |
| HTTPS | Production-domain HTTP redirects to HTTPS were observed read-only during review. New HSTS uses one year without preloading or changing subdomain policy. |
| Headers | The build writes static `_headers`; root Functions middleware covers API/admin responses. Actual local Wrangler requests verified CSP, nosniff, frame denial and HSTS on public, API and redirect responses. |
| Cookies | Existing HTTPS cookies use the `__Host-` prefix, Secure, HttpOnly, SameSite=Strict and Path=/. Access/refresh tokens are not returned to page scripts. New notices describe actual browser lifetimes. |
| Debug output | Client errors remain generic for unexpected backend failures. Build output excludes docs, tests, environment files and private backups. No debug endpoint was added. |
| Production settings | Functions compile and the static build pass locally. Deployment, live SQL, provider security/billing settings, SMTP and region/retention choices remain separate release checks. |

## Privacy checklist decisions

The reference videos were used as checklists, not instructions to add every suggested feature. REL has no checkout or paid subscriptions, so this branch adds no refund policy. It adds no fake business address, testimonials, certification or compliance claims.

Cloudflare Web Analytics was observed on the live homepage and its documented cookieless behaviour is described on the Cookies page. The new player choice prevents YouTube requests for showcases until the visitor loads that player. Google Fonts and remote profile pictures remain automatic third-party connections and are disclosed. No blanket cookie banner was added for necessary sign-in cookies. If advertising, other analytics, embeds or security features change, reassess their storage and consent requirements before enabling them.

The source does not implement automatic erasure or application retention. Privacy requests use the published email; handling them requires the operator's review of the relevant records and lawful retention needs. Form permission notices are not claimed as a durable consent journal. UK operation and the contact email were supplied by the owner.

## Validation

- `npm test`: all 15 test files passed, including six focused security tests. Tests use fictional data in isolated PGlite instances; they do not connect to production Supabase.
- `npm run build` and `npm run check:cloudflare`: passed. Wrangler parsed the generated header rule and compiled the worker.
- `tests/browser-review.mjs`: passed against the local fixture, including existing account, recovery, application, role, profile, autosave and ranking checks. New checks cover policy links, associated labels, CSP rejection, player choice and Escape cleanup. Layouts were checked at 320, 390, 768 and 1440px. Genuine local font fixtures were used; Google Fonts network delivery and real YouTube playback were not tested.
- Actual local Wrangler responses: public pages/assets return 200, an unauthenticated session returns 401 and Admin redirects to sign-in; all retain the intended security headers. Inline script hashes matched the HTML returned by that runtime.
- `npm audit`: no reported dependency vulnerabilities at the time of review.
- Gitleaks scan of the staged changes: no findings. Documentation links resolve, the generated header line stays below Pages' size limit and the build excludes server source, tests, SQL and private configuration.

No production rankings, `data.js`, Supabase records or provider settings were changed. This branch has not been merged or deployed as part of the review.
