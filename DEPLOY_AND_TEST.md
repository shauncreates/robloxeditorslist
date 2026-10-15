# REL: setup, testing and main-only deployment

## Already completed on 14 October 2026

- C428 imported into `robloxeditorslist-stage1` (`coapqgqnmdlgwhftuiub`):
  21 editors, four styles, five lists; every field and position verified exactly.
- Auth migration `20261014172313_rel_auth_roles` applied to that project.
  Ranking JSON verified unchanged after the migration. **Do not run it again.**
- Cloudflare project `robloxeditorslist` uses production branch `main`.
  Feature-branch preview deployments are disabled. Automatic deployment on
  commits to `main` remains enabled.
- Production has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_PUBLISHABLE_KEY` and `NODE_VERSION=24` configured.
- Static build, automated local tests and the actual Pages Functions compilation
  have passed. Real local workerd routing/authentication rejection was checked.
- Source is still on `feat/applications-stage-1`; it has not been merged, pushed
  or deployed. Cloudflare's currently served code is still the earlier release.

Production and the former Preview environment point at the **same database**.
Changing a local server's URL to that project also uses its real data. Test
ranking/profile writes in the isolated fixture, or in a separate test database.

## 1. Run automated checks

Open a VS Code PowerShell terminal in this repository. Use `.cmd` because this
computer's PowerShell execution policy blocks the npm PowerShell launcher.

```powershell
node --version
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run check:cloudflare
```

Use Node 22 or later (this setup was checked with Node 24). Expect all test groups
to pass, the static files to be copied to `dist`, and Wrangler to report that the
Worker compiled. None of these commands deploys or calls the real database.

## 2. Try every role safely in your browser

```powershell
npm.cmd run test:preview
```

Open `http://127.0.0.1:8789/signin/`. These are invented accounts only:

| Account | Role | Password |
| --- | --- | --- |
| owner@example.test | Owner | test-password-123 |
| contributor@example.test | List Contributor | test-password-123 |
| reviewer@example.test | Application Reviewer | test-password-123 |
| member@example.test | Member linked to One | test-password-123 |
| stranger@example.test | Member with no linked profile | test-password-123 |

Sign out between accounts. Use a second browser/private window when testing two
accounts simultaneously. Restart the fixture to discard all its test edits.
Fixture signup creates an unconfirmed account only in the isolated test database.
It sends no email, so that account cannot sign in. Real confirmation is tested in
later steps.

Perform these checks in the fixture:

1. **Member:** sign in as `member`; edit software on One and save. Open `/list/`
   and its profile to see it. Two, rankings and flares must stay unchanged.
   There must be no Rankings, Styles, Applications or Users tabs.
2. **Unlinked Member:** sign in as `stranger`; request a link to Two and provide
   verification details. Confirm no profile-edit access is granted immediately.
3. **Owner linking:** sign in as `owner`, open Users & roles, approve that link.
   Sign in again as `stranger`; only Two should now be editable. Try rejecting a
   fresh request after restarting the fixture too.
4. **Contributor:** sign in as `contributor`; add/edit a fictional editor,
   reorder ranks using arrows and drag/drop, edit a style, then save. Public
   `/list/` must reflect it. Site settings and Users must remain unavailable.
5. **Applications:** submit a fictional application at `/apply/`. Test missing
   styles and an incorrect platform URL; these must fail. Submit a valid one.
6. **Reviewer:** sign in as `reviewer`; approve, reject and return the application
   to pending. Rankings must not change. Test status filtering and refresh.
7. **Owner roles:** grant Reviewer to `stranger`; that account should gain
   Applications access. Revoke it and refresh/sign in again; access must vanish.
   Disable the account; it must lose access. The last Owner cannot be disabled
   or demoted. Site settings and ranking backup download are Owner-accessible.
8. **Stale save:** open Contributor in two browser windows. Load both, save in
   one, then attempt a different save in the other. The second must fail with a
   conflict message. Discard/reload before trying again.
9. **Session:** reload a signed-in page and confirm it stays signed in. Sign out,
   then revisit `/admin/`; sign-in must be required. Automated tests separately
   cover refresh, revoked sessions and forbidden forged requests.
10. **Pictures:** the fixture can fetch a simulated image for TikTok username
    `fixture_editor`. It proves the flow without calling TikTok. A real image
    download/storage check belongs in an isolated real test project.

## 3. Configure signup email sending

Your chosen first Owner email is `shaun@seeshaun.xyz`. No account exists for it
yet in the live project. Do not share its password or any API credentials.

In Cloudflare, open Email Service > Email Sending for your account. Check that
the Beta service is available and review its displayed plan/limits. Onboard
`robloxeditors.com`, follow its SPF/DKIM/DMARC/bounce-record instructions and wait
for verification. Preserve any existing email DNS records. Create an API token
scoped to the account with **Email Sending: Edit** and keep it private.

In the [Supabase project](https://supabase.com/dashboard/project/coapqgqnmdlgwhftuiub),
open Authentication's Custom SMTP settings and enter:

| Setting | Value |
| --- | --- |
| Sender email | support@robloxeditors.com |
| Sender name | Roblox Editors List |
| SMTP host | smtp.mx.cloudflare.net |
| Port | 465, implicit TLS |
| SMTP user | api_token |
| SMTP password | Your private Cloudflare Email Sending token |

Save the credential directly in Supabase. It is not needed in `.dev.vars` or
Cloudflare Pages. If Cloudflare Email Sending is unavailable, use another verified
SMTP provider for the same domain. See [SIGNUP_EMAIL_SETUP.md](SIGNUP_EMAIL_SETUP.md).
Receiving support replies requires a mailbox or separately configured forwarding;
outgoing SMTP alone does not create an inbox.

## 4. Set Supabase Auth and the confirmation template

In Supabase Authentication settings:

1. Enable email/password and public signup; keep **Confirm email** enabled.
2. Set minimum password length to 8, require uppercase, lowercase and digits, and review Auth rate limits/CAPTCHA settings.
3. Set Site URL to `https://robloxeditors.com`.
4. Add redirect URLs `https://robloxeditors.com/signin/`,
   `https://robloxeditors.com/signin/?confirmed=1`,
   `http://127.0.0.1:8788/signin/` and
   `http://127.0.0.1:8788/signin/?confirmed=1` for older emails. Also allow exact
   `/email-verified/` and `/reset-password/` URLs on the production domain and
   `http://127.0.0.1:8788` for current confirmation/recovery flows.
   Use exact URLs, not an unrestricted wildcard.
5. Under Email Templates > Confirm signup, set subject to
   **Confirm your Roblox Editors List account**, and paste the contents of
   `supabase/email-templates/confirm-signup.html`. Keep `{{ .ConfirmationURL }}`.

Do not disable confirmation to work around email delivery problems.

## 5. Run real Pages Functions locally

Get the project URL and publishable key from Supabase's Connect/API Keys area.
The server-only legacy `service_role` key is in API Keys > Legacy keys. Add the
three fields shown in `.dev.vars.example` to your ignored `.dev.vars` file.
Remove the obsolete local `ADMIN_PASSWORD` field. Do not paste keys in chat or Git.

```powershell
npm.cmd run build
npm.cmd run dev:cloudflare
```

Open `http://127.0.0.1:8788/signin/`. This runs the actual Functions, not the
fixture. If you point it at `coapqgqnmdlgwhftuiub`, it uses the live rankings.
Use it for your real first-account signup, confirmation and read-only checks;
continue to use the fixture for fictional profile/ranking changes.

In another terminal, after keys are configured:

```powershell
npm.cmd run test:smoke -- http://127.0.0.1:8788
```

The smoke script reads public data, then verifies unauthenticated protected
requests and cross-origin saves are denied. It creates no accounts, sends no
emails and has no credentials/cookies. It should report 21 editors/four styles
for the live project and success for every denial check.

## 6. Create and bootstrap your Owner account

1. On the real local sign-in page choose Create an account.
2. Use `shaun@seeshaun.xyz` and your own strong password.
3. Before confirming email, verify sign-in is rejected.
4. Check the email From address/name, delivery and spam folder. Click its
   confirmation link; return to sign-in and enter your password.
5. Your account starts as Member. In Supabase SQL Editor, run the prepared
   private `private-backups/c428/bootstrap-owner.sql` once, or ask Codex to run it
   after you confirm registration is complete. It requires that exact email to
   be confirmed, adds Owner and leaves all ranking data untouched.
6. Sign out/in or reload `/admin/`; Users & roles and all management tabs should
   now be available. Link your account to Shaun only after verifying ownership.

The bootstrap query is a database-administrator action, never a public endpoint.
After bootstrap, grant/revoke other users' roles through Users & roles. All public
signups continue to default to Member.

## 7. If you want real write/integration tests before rollout

Use a separate Supabase test project/local Supabase instance. Create it yourself
after reviewing any cost. Apply the existing two setup SQL files followed by
`supabase/auth-roles.sql` **there only**; the live project is already migrated.
Insert invented test rankings, sign up accounts for inboxes you control, confirm
them and bootstrap a test Owner. Point `.dev.vars` at that project and repeat the
Step 2 role checks using real Functions and real Auth.

That environment is where to verify real avatar uploads, email confirmations,
multi-account role changes and database history. Do not point those write tests
at the live C428 database. Restore `.dev.vars` to the intended project afterward.

## 8. Publish from main when setup and tests are complete

1. Review the working-tree changes and run Step 1 again. Keep `data.js` unchanged.
   Keep `.dev.vars`, `.wrangler`, `dist` and `private-backups` out of Git.
2. Commit the implementation on `feat/applications-stage-1`, push that branch and
   open a PR into **main**. Feature pushes do not deploy now. Include the new
   files and `package-lock.json`, not just files already tracked by Git.
3. Review the PR. Merging/pushing to **main starts an automatic production
   deployment**, so do it only when you intend to publish.
4. In Cloudflare Pages, confirm build command `npm run build`, output `dist`,
   root repository directory, Node 24 and the production Supabase variables.
   Functions are deployed from the repository's `functions/` directory.
5. Merge into main and watch its production deployment finish. Confirm the
   deployment is for the intended new commit, not an earlier main commit.
6. Open `https://robloxeditors.com/list/`, check all list counts/positions, then
   `/signin/` and `/admin/`. Test your Owner sign-in and sign-out. Run:

   ```powershell
   npm.cmd run test:smoke -- https://robloxeditors.com
   ```

7. Remove obsolete `ADMIN_PASSWORD` from Cloudflare's production variables for
   future builds after confirming the new source is live. It is not read by the
   new code. Do not restore the shared-password release as a routine rollback.

All 21 live avatars were copied from Vercel Blob into Supabase Storage on
15 October 2026. Each public copy was verified against the original bytes before
the picture URLs were replaced. Rank order and all non-picture fields were
verified unchanged. The unused old Blob store can now be retired; the user chose
to delete it in Vercel. Keep the private copy report and ranking history.

## Verification record and remaining setup

Record real email delivery, confirmation, first Owner bootstrap and production
smoke-test results when completed. The security advisor currently reports only
informational RLS-with-no-policy notices: direct table access is intentionally
denied and authorized operations go through checked RPCs. See
[Supabase's notice explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Local tests and compilation do not prove real SMTP delivery or browser appearance.

Current remaining items: SMTP/domain setup, Auth dashboard settings, your confirmed
Owner registration/bootstrap, real integration checks, and merging/deploying main.
