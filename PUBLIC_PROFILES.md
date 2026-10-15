# Public profiles and contributor links

Prepared on `feat/public-profiles-contributors` from `origin/main` at `3544416`. The application/email feature remains on its separate branch. Nothing here has been applied to a hosted database or deployed.

## Public pages

- `/profile/?account=<account UUID>` shows a confirmed, active account's username, contributor credits and any Owner-verified editor profile.
- `/profile/?editor=<editor ID>` shows the existing public editor details, software, placements, styles, links and YouTube video. It also shows the account if an Owner has linked it.
- `/profile/?contributor=<credit ID>` opens from the homepage. It shows the credited name and contribution before account verification, then includes that person's account and linked editor details after verification.

Account IDs and editor IDs keep links stable when names change. The account page has a **View public profile** link. The rankings drawer has a **View full profile** link. Direct loads and reloads use the static `profile/index.html`; `/profile` redirects to `/profile/` with its query string.

Unranked accounts have a public username page with an explicit message that no ranked profile is linked. This change does not add a public account directory, account biography editor or avatar upload for unranked accounts. Existing linked editor editing remains in My account.

## Privacy and permissions

Public reads go through `/api/profiles` and `/api/contributors`. Their database wrappers are callable only by the server's existing service role. Public account responses allow only `id` and `username`; emails, roles, sessions, claims, applications, review reasons and audit records are excluded. Disabled, banned, anonymous, unconfirmed and deleted accounts do not resolve publicly. Already-public ranked editor details and historical contributor credits remain visible independently of an account's status.

The private credits table retains the four existing homepage credits. Its account links start empty. Signing up with a matching username never claims a credit. In **Manage REL → Users & roles**, an Owner verifies the person's identity, chooses the homepage contributor credit on that account and presses **Save contributor link**. An account can hold one credit. Selecting another account for a credit replaces its previous mapping after confirmation. Select **No contributor credit** to unlink the current account.

The server and SQL both enforce Owner access. SQL validates the current Auth session and database roles, serializes with permission changes and records the actor, previous credit and displaced account in the private audit table. Contributor credit never grants permissions or links a ranked editor; the existing Owner profile-link verification still controls that.

## Database review and rollout

`supabase/migrations/20261015110000_rel_public_profiles.sql` is additive and requires the existing Auth/roles and signup username migrations. It does not write ranking JSON, revisions, `data.js`, existing roles or verified editor links. It is independent of the separate application/email migration and can coexist with it.

1. Review and apply the migration to a disposable test project after the existing prerequisites. Production application requires the project owner's explicit permission.
2. Test public profile reads and Owner mapping with test accounts. Verify that unconfirmed/disabled accounts remain hidden and emails never appear publicly.
3. Review the feature branch. Merging and deployment each require the user's approval. No new secret or external provider is needed.
4. After an approved rollout, an Owner can verify and link the real contributor accounts through Users & roles. No real account identities were guessed or seeded here.

Deploy the schema before the corresponding website/Functions change. If profiles are unavailable, public pages show a retry state and existing Owner permission management still loads independently of contributor-link availability.

AREDL reference: its public `AREDL` repository's `aredl-revamp` branch links `UserNameDisplay.vue` to a profile by user ID and loads contributor identities in `ListStaff.vue`. REL follows that stable-identity pattern using its existing stack and visual design; no AREDL source or assets were copied.

## Local verification

Run `npm test`, `npm run build` and `npm run check:cloudflare`. `npm run test:preview` starts an isolated PostgreSQL/Auth fixture with fictional accounts and rankings, without production access. `node tests/browser-review.mjs` exercises it through Chromium's local debugging port `9223`.

Where external Google Fonts is blocked, the browser runner accepts `REL_BROWSER_FONT_DIR` pointing to genuine local Red Hat Text Latin normal/italic variable WOFF2 files and `REL_BROWSER_SYMBOL_FONT` pointing to a local Material Symbols Rounded WOFF2 file. These are test-only overrides; they do not change the shipped site's fonts or verify external font delivery.
