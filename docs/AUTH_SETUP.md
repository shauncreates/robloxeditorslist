# REL accounts and permissions

See [RANKING_STORAGE.md](RANKING_STORAGE.md) for the prepared C428 import and
hosting moves, and [SIGNUP_EMAIL_SETUP.md](SIGNUP_EMAIL_SETUP.md) for signup
confirmation from `support@robloxeditors.com`.

The account system is on `main` and deployed. On 14 October 2026, the approved
C428 import and Auth/roles migration were applied to `robloxeditorslist-stage1`.
Ranking JSON was verified against the backup and unchanged by that migration.
New development starts from the latest `origin/main`, rather than stage-1.
Start with [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md) for current step-by-step setup.

## Access model

| Role | Access |
| --- | --- |
| Member (every account) | Request a profile link; edit only their Owner-linked profile, including editing software |
| List Contributor | Manage editors, styles and rankings |
| Application Reviewer | Read applications and approve/reject pending submissions with a reason; decisions are locked |
| Owner / Super Admin | All access, site settings, user roles, editor/contributor links, contributor credits and disabling REL access |

Elevated roles can be combined. Member edits exclude editor IDs, flares, style
membership, rankings, site settings and other profiles. An Owner must verify a
profile claim through the social account already listed, then approve the request
or link the account manually. One profile links to one account; unlink it before
deleting that editor. Software is optional free text on the profile and appears
on its public detail view. Application approval never changes rankings.

## Local tests

Requires Node 22 or later. Run `npm ci`, `npm test`, then `npm run build`.
Tests use PGlite (local PostgreSQL), invented Auth sessions and ranking fixtures;
they never connect to Supabase or read real ranking data.

`npm run test:preview` opens a fixture server at
`http://127.0.0.1:8789/signin/`. Accounts are `owner@example.test`,
`contributor@example.test`, `reviewer@example.test`, `member@example.test`
(linked), and `stranger@example.test` (unlinked). Fixture password:
`test-password-123`. Signup is stubbed and sends no email. Restart the server to
reset it. This does not verify Cloudflare routing or real Supabase Auth/email.

## Approved test environment setup

The current live project has already received migration `20261014172313_rel_auth_roles`;
do not rerun the setup there. The instructions below apply to a fresh test project.
Get explicit approval for the intended database project before executing SQL.
Use a separate Supabase test project with invented rankings and accounts first.

1. Review the existing migrations and `supabase/auth-roles.sql`. The latter is a
   one-time transactional setup script. Before using a new migration workflow, create the formal file
   with `supabase migration new rel_auth_roles` and put the reviewed SQL there.
   It adds private accounts, claims, history, audits, an Auth signup trigger and
   checked RPCs. It adds ranking revision metadata and restricts direct table
   access, without seeding/replacing ranking JSON or modifying storage contents.
2. Enable email/password Auth, public signup and **Confirm email**, with minimum
   password length 8 and require uppercase, lowercase and digits. Configure email delivery, Auth rate limits and any CAPTCHA
   separately. Signup cannot choose roles or an editor profile.
3. Allow the approved preview's exact `/email-verified/` and `/reset-password/`
   redirect URLs in Supabase. Review the confirmation email template's use of
   `RedirectTo`/`ConfirmationURL`. Add production URLs only after approval.
4. Configure server-side `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or legacy
   `SUPABASE_ANON_KEY`) and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service key
   secret. Account RPCs forward the verified user's JWT with the public key;
   service-role access is limited in code to public ranking reads, validated
   application submissions and avatar uploads.
5. Sign up and confirm the first Owner. A database administrator must bootstrap
   that verified Auth UUID once:

   ```sql
   update rel_private.accounts
   set roles = array['member','owner']::text[]
   where id = '<verified-auth-user-uuid>'::uuid;
   ```

   Verify exactly one intended row changed. There is no public bootstrap endpoint
   or shared-password override. Existing Auth users in a shared project get REL
   Member records only; their app metadata is untouched.
6. Test real signup/confirmation, sign-in, refresh, sign-out, every role, link
   requests and approvals, software changes, direct REST/RPC denial, immediate
   revocation and disabled accounts. Run Supabase advisors and inspect actual
   RLS/grants/function exposure. Keep `rel_private` outside exposed Data API schemas.

The local suite checks the SQL against a synthetic Auth schema. The live Auth
schema and grants were also checked during the earlier rollout. Verify actual
email delivery and authenticated browser behavior separately in the intended
environment; the fixture does not prove provider configuration.

## Ranking preservation and production cutover

Before an approved production migration, identify and export the authoritative
saved rankings. Record editor/style counts and list ordering and verify a private
backup. Bundled `data.js` is not an authoritative production backup.

Compare saved ranking JSON before and after setup; only revision metadata should
change. The admin never loads `data.js`. Failed/missing live data blocks saving,
and the save RPC never creates a missing rankings row. A missing database needs
a separately reviewed and explicitly approved import of verified ranking data.

Every successful save checks its revision under a row lock, archives the previous
document in `rel_private.data_history` and writes an audit entry atomically. Stale
saves return 409. History is private; restoration requires a reviewed, separately
authorized operation. The last active Owner cannot be demoted or disabled.

Do not deploy against an unmigrated production database: account operations fail
closed until setup is complete. Keep a known-good release for an approved
rollout/rollback. Production migrations, data imports and deployment require
separate permission. Remove obsolete `ADMIN_PASSWORD` deployment secrets during
the approved cutover; local `.dev.vars` was not edited. Shared-password source and
obsolete Vercel functions have been removed from this branch.

## Sessions

Tokens stay in HttpOnly, SameSite=Strict cookies, with Secure and `__Host-` names
on HTTPS. Plain HTTP is allowed only on loopback. Tokens/passwords are never
returned to browser scripts or stored in browser storage. Old stored shared
password entries are cleared. Confirmation returns to sign-in and fragment tokens
are discarded; the user explicitly signs in after confirming email.

Mutations require an exact same-origin Origin header. Protected Functions verify
the user with Supabase Auth. Database RPCs independently check `auth.uid()`, the
active Auth session, confirmed email, account status and current REL roles.
Revoked sessions are rejected even before JWT expiry. Sign-out refreshes an
expired token where possible, revokes the current session and clears cookies.
User-editable metadata is never used for authorization.
