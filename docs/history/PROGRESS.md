# Historical development log

These entries describe work and verification at the time they were recorded.
Old branch names, pending setup steps and release statements are historical.
Use the [current project overview](../../README.md) and
[development guide](../DEPLOY_AND_TEST.md) for today's workflow. Paths inside
the original entries are repository-root paths unless stated otherwise.

## 15 October 2026: favicon consistency

Added the existing homepage `media/icon.svg` favicon to application, admin, account, sign-in, password reset, email confirmation and changelog pages. Homepage and rankings already used this asset. All nine website documents now reference the same original SVG, retaining its light/dark browser-theme styling. No icon redesign, dependencies, email-template changes, database operations or deployment.

Verification: `npm.cmd run build` and `git diff --check` passed. Checked all nine built HTML documents have exactly one SVG favicon link, resolve to the copied original asset and retain its exact bytes. Hashes confirmed `data.js` and the original REL logo unchanged.

## 15 October 2026: retired live Vercel Blob picture dependencies

The user authorized removing old Vercel Blob pictures. Copied all 21 live pictures to the existing `editor-avatars` Supabase Storage bucket and verified each public copy against the original bytes and MIME type. Only then replaced their `thumb` URLs in a single revision-checked transaction. The transaction also asserts that all JSON except `thumb` fields is unchanged, preserves the original full JSON in data history and records the maintenance action without impersonating an account.

Read-only verification confirmed 21 editors, four styles, zero Vercel Blob references in the live data and exact equality of every non-picture field/list. New revision: `d3569a9f-9d2a-4867-8920-25d49d0e9e09`. No account, role, application, ranking order, schema, original SVG or `data.js` changes. The private snapshot, verified copy report and checked SQL are under ignored `private-backups/avatar-retirement/`; no credentials or these backups are committed. Historical snapshots remain faithful to their originals; the old/new URL mapping is preserved both in the private report and a private database audit manifest so it survives a change of computer.

Added a Contributor-only Replace Vercel pictures control for any legacy URLs introduced later. It uses the existing checked Cloudflare avatar/save APIs, retains failed pictures, stops on save conflicts, prevents concurrent fetches and preserves a picture edited while a fetch is pending. The normal missing-picture action remains available. Added a maintenance copy utility with a 5 MB limit, restricted hosts/types, no redirects, separate upload credentials and public byte verification; it does not update rankings on its own.

Automatic approval review briefly blocked external checks due to a usage limit. After the reset, the same review path succeeded and confirmed production deployment `5be9d846-dfb3-41f4-9b5d-573423aa74bb` for `6a9ef1d`. No approval check was bypassed. The user chose to delete the now-unused store in Vercel; the agent has no Vercel connection/token and did not delete that store or its files. Cleanup instructions are supplied in chat.

Verification: 40 tests passed, including streamed size/type/host checks, byte verification, save-conflict rollback, picture races and exact preservation of non-picture data. After adding the durable manifest, its three targeted tests also passed. Static build passed. Chrome checked the new control and successful replacement at 320/390/768/1440px, plus the existing account, application, ranking and recovery regression flows. Production smoke checks passed, and the public data endpoint serves all 21 Supabase picture URLs. UI evidence: `anti-slop/review-007-2026-10-15.md`.

## 15 October 2026: authorized production release and Vercel cleanup

The user explicitly authorized merging into main and deploying this work. Read-only Supabase checks confirmed the Auth/roles, application-review, review-lock/profile-link and signup-username/cooldown prerequisites are already installed. No migration was executed by the agent. The live data has 21 editors and four styles; its pre-release fingerprint is `550362c84587bbf015f8c200f90f02a1`, revision `c0587d34-e371-40f2-aa4d-6e261e6338ec`.

- Removed `vercel.json` and the two Vercel analytics script tags. The admin's indexing protection remains in its HTML and now also in the Cloudflare response header. Existing Blob image URLs and all editor/ranking data are preserved.
- Found and corrected the stale www CNAME, which pointed to `f521553ce88354df.vercel-dns-017.com` and returned Vercel HTTP 402. Added www to the Pages project, pointed its proxied CNAME at `robloxeditorslist.pages.dev`, and added an exact-host Cloudflare 308 redirect to the primary HTTPS domain. Live checks passed for home, application, admin and confirmation paths, with query strings preserved. Mail/DKIM/SPF records were not changed.
- Dated the public changelog for the approved 15 October release. Existing visual design is unchanged; no additional UI assets or dependencies were introduced.

Pre-release checks: all 34 tests, static build, Functions compilation and whitespace checks passed. `data.js` and the original REL SVG are unchanged. Cleanup was committed as `02dd0ef`; production merge `8be8e50` deployed successfully as Cloudflare deployment `358586f3-4927-4b19-becc-4cab5068d5d2` on 15 October 2026.

Production checks passed for all eight public pages, the required signup username field, released changelog, both application URLs, www redirects, anonymous admin redirect and protected account/application/ranking APIs. Cross-origin saves return 403; invalid signup returns 400 before contacting Auth. No email or account was created during these checks. The ranking fingerprint/revision/counts exactly match the pre-release values. Removed `ADMIN_PASSWORD` from Cloudflare Production and Preview after the new Auth release was verified; Supabase bindings remain configured. The final record/configuration cutover is committed with the same tested application code. Future feature work remains on `feat/applications-stage-1` unless the user requests another branch.

## 15 October 2026: mandatory signup usernames and seven-day changes

- Signup now requires a unique username of 3 to 40 letters, digits, underscores or hyphens, starting with a letter or digit. Names are normalized to lowercase. The Cloudflare API forwards only this validated display name, email and password; caller-supplied roles, editor links and arbitrary metadata remain ignored.
- Prepared `supabase/migrations/20261015001034_rel_signup_usernames.sql`. It requires the review-lock/username migration. New Auth users must supply a string username even when bypassing the REL signup form; the existing unique constraint rejects competing signups atomically. A server-only availability RPC exposes only a boolean and improves duplicate-name feedback. Missing migration/setup blocks signup rather than silently using generated names.
- New users wait seven days from choosing their signup name before changing it. Existing accounts retain their usernames and can make their first change immediately. A checked RPC then enforces 168 hours between actual changes for all roles, including Owners. Same-name saves and rejected attempts do not restart the timer or add audit entries. Updating Supabase user metadata cannot rename the REL account or reset the timer.
- `/account/` displays the next available change date in the user's local time and makes the username read-only while locked. Signup alone requires the username field; ordinary email/password sign-in, confirmation, recovery, profile linking and role controls are preserved.
- Added the user's standing preference to `AGENTS.md`: test, commit and push completed file changes on the feature branch after each request, excluding credentials and generated/private files. Main merges, deployments and live migrations still require explicit permission.

Verification: 34 automated tests passed, static build passed and Cloudflare Functions compiled. Isolated Chrome checks passed at 320/390/768/1440px, including empty signup usernames, duplicate usernames, successful changes and the locked date display. Database tests cover signup races, exact seven-day eligibility, simultaneous changes, forged metadata, permissions and preservation of existing accounts/submissions/ranks. Hint/input contrast and representative screenshots were checked; the input border meets the 3:1 non-text requirement. No live database/schema/configuration changes, email sends, merge or deployment occurred. `data.js` and the original SVG are unchanged. The new migration remains for manual application after reviewing its prerequisites. AntiSlop evidence: `anti-slop/review-006-2026-10-15.md`.

## 15 October 2026: GitHub checkpoint and Cloud handoff

The user authorized committing and pushing the development work on `feat/applications-stage-1`. This checkpoint includes the Auth/roles implementation, application workflows, review locks, usernames, profile-link queue, UI refinements, changelog, migrations, email templates and isolated tests. Installed AntiSlop skills and project instructions are included so another checkout can use the same review rules.

Credentials in `.dev.vars`, private ranking backups, dependencies and generated output are excluded from Git. `data.js` and the original REL SVG are unchanged. A fresh checkout can run `npm ci`, `npm test` and `npm run build` without production credentials; the automated tests use isolated fixtures. Real Supabase integration requires separately configured credentials and can affect the database identified by `SUPABASE_URL`.

Continue on this feature branch. Do not edit actual editor/ranking data, overwrite `data.js`, execute live migrations, merge into main or deploy without explicit permission. Cloudflare production uses main. The user has manually performed setup and reports successful testing; before rerunning any migration, verify which migrations were already applied. The newest review-lock/username migration was tested locally and was not executed remotely by the agent. Earlier sections record the state at the time of each change, not a current dashboard inventory.

## 15 October 2026: locked decisions, usernames, link queue and changelog

- Approval/rejection requires a reason and is final for Reviewers and Owners. A checked database function records the reviewer account ID, username at the time, reason and timestamp in the application, private decision journal and audit log. A database trigger also protects decided submissions against status/content/reason edits and deletion. Contributor conversion remains allowed and revision-checked.
- Accounts receive generated usernames without deriving them from email. Users can choose a unique, normalized username on `/account/`; this changes only their own display identity and never their roles or editor link. Existing sign-in remains email/password. Admin banners, user lists and decision labels use usernames; the Owner user-list RPC no longer returns account emails. Historical decision usernames remain unchanged after a rename or account deletion.
- Added an Owner-only Profile link requests tab with pending/approved/rejected/all views, pagination, refresh and existing verified-link approval/rejection. Its query lists claims independently of account pagination, so older users' requests are visible. Members and Reviewers cannot manage profile links.
- Prepared `supabase/migrations/20261014232150_rel_review_locks_and_usernames.sql` with pinned temporary CLI tooling. Tested only in isolated fixtures. **Not applied to the shared live project.** It preserves ranking JSON/revisions, existing application fields/statuses, roles and editor links. Existing decided applications stay locked; missing historical reviewer/reason information is not invented.
- Added the previously requested public `/changelog/` page and homepage footer link. The entry is marked Unreleased; private applications and review records are not exposed there. It reuses the original SVG/font/account palette.
- Refined the changed review UI: accessible lime links/focus, required reason guidance, read-only decisions, confirmation before a final decision, refreshed stored reasons after stale decisions, cleared validation messages after success, and a mobile filter that shows its full selected label.
- Test files run sequentially to keep PGlite fixtures within this machine's memory limits. A parallel rerun ran out of memory while the preview/browser were open; those helpers were closed before the sequential verification.

Verification: 30 automated tests passed, static build and actual Cloudflare Functions compilation passed. Chrome exercised username uniqueness, required reasons, locked approval/rejection, private contributor conversion, the Owner link queue/filter/approval and the public changelog, with font/layout checks at 320/390/768/1440px. Race tests produced one decision/journal/audit record; preservation tests left prior ranks/applications/links intact. Account deletion kept recorded reviewer names. Existing signup, recovery, sessions, account roles, profile autosaves and ranking tests passed. `data.js` and the original SVG remain unchanged.

Read-only inspection confirmed the intended account is an Owner and the shared database had zero pending link requests at inspection. No live schema/record/configuration changes, push, merge or deployment occurred. Remaining setup: manually apply only the new migration once, rebuild/restart the real local server, choose usernames and test the new views. Changelog release dating remains for the approved deployment. Instructions are supplied in chat. AntiSlop evidence is in `anti-slop/review-005-2026-10-15.md`.

## 14 October 2026: email branding and verified landing page

- Signup/recovery email templates reference the existing `https://robloxeditors.com/media/logo.svg`, with accessible alternative text and proportional sizing. Both use the homepage's Red Hat Text family, weights and fallback stack. Email clients may ignore web fonts or block SVG images; no replacement logo asset was created.
- New signup requests redirect to `/email-verified/`. The page clears fragment tokens, checks the confirmed user through a server-side Supabase request and offers Go back to sign in. It sets no REL login cookies. Missing tokens, invalid/expired links and service errors do not show success. A new link opened in the same tab reloads the check.
- Older sign-in confirmation redirects remain usable without an unverified success claim. Added the landing page to the static build and its slash redirect to routing.
- Added isolated email previews and confirmed/unconfirmed/anonymous/token/origin tests. Real Supabase email templates still need replacement in the dashboard, and production/local `/email-verified/` redirect URLs must be allowed. Setup instructions are supplied in chat.

Verification: 25 tests, static build and actual Cloudflare Functions compilation passed. Chrome checked both email previews and confirmation success/error states at 320/390/768/1440px; the original SVG loaded and fonts/layout passed. Existing account, application and ranking checks remain in the browser suite. No live email was sent, no Supabase records/configuration were changed, and no deployment occurred. `data.js` and the original SVG are unchanged. Review evidence is in `anti-slop/review-004-2026-10-14.md`.

## 14 October 2026: password policy and recovery

- Signup and password reset require at least eight characters with uppercase, lowercase and digits. Both the Cloudflare endpoint and signup/reset forms enforce the rule. Existing sign-in accepts existing passwords; symbols are allowed without being required.
- Added Forgot password navigation and `/reset-password/`, reusing the homepage font, original SVG and account styles. Recovery supports email-code requests, an existing code, resending, changing email, password confirmation and fresh sign-in after success.
- Supabase verifies recovery codes server-side. Recovery tokens never enter response JSON, browser storage or normal login cookies. Password changes use only the verified user's token, then globally sign out and clear REL cookies. Generic email-request responses avoid disclosing account existence; API origin checks and Supabase rate limits remain enforced.
- Added a recovery email template using `{{ .Token }}` and `{{ .RedirectTo }}`. It still needs manual installation in Supabase's Reset password template, with production/local reset URLs allowed and the matching eight-character Auth policy. Instructions are provided in chat. No migration or extra secret is needed for this feature.

Verification: 24 tests, static build and Cloudflare Functions compilation passed. Headless Chrome checked recovery request/code/success layouts at 320/390/768/1440px, invalid codes, mismatched passwords, resend with empty password fields, and sign-in with the new password. The existing application, account and ranking browser checks also passed. No live email, database mutation, deployment or edit to `.dev.vars` or `data.js` occurred. Real delivery/reset testing remains for the user's configured account. AntiSlop checks are recorded in `anti-slop/review-003-2026-10-14.md`.

## 14 October 2026: application migration compatibility fix

- A failed manual migration exposed a live schema difference missed by the original fixture: `main_platform`, `main_platform_url` and `editing_styles`, with no `notes`, `reviewed_at` or styles-count constraint. Read-only inspection confirmed none of the review migration's new columns persisted.
- Updated the pending review migration to rename the legacy columns while preserving their values, add the missing nullable fields and tolerate an absent styles constraint. Ambiguous old/new columns stop the transaction rather than guessing which data to retain.
- Added a fixture matching the inspected live table and regression tests covering existing submissions/rankings, checked review/conversion, private access, styles limits and rollback on ambiguity.

Verification: all 21 tests and `npm run build` passed. No remote SQL writes, deployment or changes to `data.js`. The corrected SQL must still be copied from the local migration file and applied manually; the previous SQL Editor copy is outdated. Changelog work remains pending while setup is being completed.

## 14 October 2026: account separation and application workflow

- `/apply` redirects to `/apply/`; `/account` redirects to `/account/`, in both the fixture and actual Pages runtime.
- Members sign in to `/account/` for their linked profile or profile-link request. The admin HTML route verifies live Supabase accounts/roles on the server; Members are redirected to account and unauthenticated visitors to sign-in. Contributors/Reviewers/Owners retain the admin controls for their roles.
- Rank/profile edits autosave after an 800ms pause. Saves are serialized, later edits are retained, and stale-revision conflicts block further autosaves until resolved. Manual Save now and unsaved-change warnings remain.
- Visible pages check for updates every ten seconds and on focus. Separate tabs receive change notifications; a page ignores its own notification. Form/review drafts are retained. Public rankings, style options, account links/permissions and private application views update automatically.
- Application checkboxes and server validation now use the live data's style names, plus Other. No bundled ranking fallback is used on hosted pages. Added styles appear without a redeploy and selected choices/text drafts are preserved.
- Editing profile cards now have a rotating chevron and a short height animation; keyboard operation and reduced-motion preferences are preserved.
- Reviewers can record an optional approval/rejection reason. Approved applications remain private in a `Pending - (N)` dropdown at the bottom of Contributors' Editors view. Contributor conversion is explicit, role-checked and revision-checked, adds the editor to the bottom of overall/matching style lists, and records history. Submission notes and review reasons are never copied to the public editor. Converted applications cannot be re-reviewed or converted twice.
- Prepared `supabase/migrations/20261014201617_rel_application_reviews.sql` using pinned temporary Supabase CLI tooling. Applied only to isolated in-memory test databases. **Not applied to the shared live project.** It requires the existing Auth/roles setup and preserves the legacy review RPC signature during cutover. No project dependency was added.

Verification: 19 automated tests passed, static build passed, actual Pages Functions compiled. Headless Chrome exercised account separation, autosaves, live rank/style updates, draft retention, review reasons, private queue and conversion at 320/390/768/1440px. Actual local Pages HTTP checks returned `/apply` 301, `/apply/` 200, `/account` 301 and unauthenticated `/admin/` 302 to sign-in. Migration tests on an already populated fixture preserved every existing application field, ranking JSON and revision, and retained the old review RPC. Existing editor/list prefixes were verified unchanged by conversion in isolated tests. `data.js` and `media/logo.svg` unchanged.

Remaining: explicit approval to apply the new application-review migration to the shared stage-1/live database, real SMTP/domain signup checks, first Owner setup and an approved deployment from main. Cloudflare Email Sending requires the user's paid plan; Resend's documented free-tier SMTP is an alternative. Provider setup instructions are supplied in chat, not added to another Markdown walkthrough.

## 14 October 2026: approved targeted refinement completed

All seven AntiSlop findings were approved in chat and implemented on `feat/applications-stage-1`. Existing uncommitted work was preserved; no commit, push, merge or deployment occurred.

- Shared homepage typography across all five website documents, including public profile drawers and native controls: Red Hat Text, normal/italic 300–700, original fallback stack. Material Symbols unchanged.
- Original REL SVG reused in admin, application and sign-in home branding, with shared proportions and accessible labels.
- Homepage application link and rankings header link now say “Apply to Be on the List” and navigate to `/apply/`, including mobile. Footer contact and ranking navigation preserved.
- Refined only identifiable new account/permissions controls: associated labels, keyboard focus, announced feedback, long-text wrapping, adequate targets, explicit user-list states and accurate pagination.
- Prevented signup/sign-in mode changes from altering an in-flight request; added regression checks.
- Corrected the previously created local fixture's session simulation so sign-out revokes old tokens while a later password sign-in can create a fresh session. Production Auth code unchanged.
- Simplified new account copy and removed the redundant sign-in eyebrow. Kept security comments and unrelated legacy components.

## Verification

- `npm.cmd run build`: passed.
- `npm.cmd test`: 12 tests passed, including role enforcement, linked-profile ownership, stale-save protection, missing-live-data save blocking, application status isolation, signup request state and pagination boundaries.
- `npm.cmd run check:cloudflare`: local Worker compilation passed.
- `node tests/browser-review.mjs`: passed in an isolated headless Chrome context using invented fixture accounts/data. Checked 12 page/view states at 1440, 768, 390 and 320px; actual Red Hat Text loading, computed fonts and horizontal overflow checks passed. Both application links navigated correctly.
- Browser flows passed: form validation/submission/reset, approval/rejection/pending, Member software save/public profile display, Owner profile-link approval/role grant and revoke, Contributor controls, keyboard focus, modal Escape, reload/session persistence and sign-out with protected-page redirects. Re-sign-in and old-token rejection are included in the final verification.
- User-list loading/empty/error/retry states passed. Test ranking order stayed unchanged.
- Representative screenshots visually inspected; temporary evidence is under ignored `.wrangler/ui-review/`.
- `git diff --check`: passed. `data.js` unchanged, SHA256 `969F2BD1AB4E4399124618B929C35F2C47CBFA0294900F6372F7862FD978EB86`. Original SVG unchanged.

## Remaining setup

The earlier approved ranking import and Auth/roles migration were already applied to the shared stage-1/live project before this refinement. Do not rerun them as part of website setup. This review did not access or mutate production records.

Still to verify: outgoing email/domain configuration, Supabase Auth dashboard settings, real signup confirmation, first Owner bootstrap, isolated real integration tests and an explicitly approved main-branch rollout. Legacy avatar URLs remain unchanged. The obsolete Cloudflare `ADMIN_PASSWORD` secret should be removed during the new Auth release cutover after that release is verified; new source has no shared-password bypass.

The user requested setup instructions directly in chat. This file is a progress/test record, not the deployment walkthrough. Detailed scope and approval evidence are recorded in `anti-slop/audit-001-2026-10-14.md`.
