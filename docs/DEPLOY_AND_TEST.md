# Development, testing and deployment

Run commands from the repository root. Use Node.js 22 or later; REL has been checked with Node.js 24. On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm`.

## Install and check

```sh
npm ci
npm test
npm run build
npm run check:cloudflare
```

Tests use PGlite with fictional accounts, sessions and rankings. The build copies static files to `dist/`, and the final command compiles the actual Pages Functions. These commands do not deploy, send email or contact the production database.

## Preview without credentials

```sh
npm run test:preview
```

The fixture listens on loopback port `8789`. Use its `/signin/` page with these invented accounts, all with password `test-password-123`:

| Account | Role |
| --- | --- |
| `owner@example.test` | Owner |
| `contributor@example.test` | List Contributor |
| `reviewer@example.test` | Application Reviewer |
| `member@example.test` | Member linked to an editor |
| `stranger@example.test` | Member without an editor link |

Sign out or use separate browser contexts when switching accounts. Stop with Ctrl+C. Restarting creates a fresh fixture and discards its edits. Signup produces an unconfirmed account and sends no email. Test confirmation/recovery email templates are available at `/test-email/signup/` and `/test-email/recovery/` in the fixture only.

Use it to check:

- A linked Member can change only their own editor details; rankings and other profiles stay unchanged.
- An unlinked Member can request an editor link without receiving edit access immediately.
- An Owner can review links, manage roles and contributors, and disable REL access; the last active Owner remains protected.
- A List Contributor can edit editors, styles and rankings, with stale saves rejected.
- An Application Reviewer can approve/reject a pending application with a required reason. A decided application remains locked, and approval alone leaves rankings unchanged.
- Public profiles show intended details without exposing private account or review fields.
- Signing out removes protected access.

The fixture does not verify production SMTP, real Storage uploads or Cloudflare's routing runtime.

## Run real Pages Functions

Use a separate Supabase test project for write tests. Review its schema setup in [AUTH_SETUP.md](AUTH_SETUP.md), the [public profiles guide](PUBLIC_PROFILES.md) and the [contributor guide](CONTRIBUTOR_TIERS.md). The SQL in [`supabase/`](../supabase/) includes a separate Auth setup file; do not assume running only the timestamped migration directory installs all prerequisites.

Copy [`.dev.vars.example`](../.dev.vars.example) into an ignored `.dev.vars` file and configure that test project's:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)

Keep credentials out of Git, chat and browser code. A local Wrangler server still uses the real database named by its URL. The existing production and former Preview configuration share a database, so neither is a disposable write-test target.

```sh
npm run build
npm run dev:cloudflare
```

Wrangler uses loopback port `8788`. Test Auth delivery only with an authorized recipient and a configured provider. See [SIGNUP_EMAIL_SETUP.md](SIGNUP_EMAIL_SETUP.md) for sender/template configuration and exact redirect requirements.

For read-only public checks plus protected-request rejection:

```sh
npm run test:smoke -- http://127.0.0.1:8788
```

The smoke script sends no credentials, creates no accounts, sends no emails and makes no authorized data edits.

## Browser regression runner

[`tests/browser-review.mjs`](../tests/browser-review.mjs) uses the fixture on port `8789` and Chromium's debugging endpoint on port `9223`. Start the fixture, then Chromium:

```sh
chromium --headless --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223 --user-data-dir=/tmp/rel-browser-review about:blank
node tests/browser-review.mjs
```

Use the platform's Chromium executable and a disposable profile directory. Chromium in a root-only container may need the container's supported sandbox configuration. The runner covers public pages, account/recovery flows and staff workflows at several viewport widths. Run it separately from other browser work against the same fixture so account edits do not interfere.

If Google Fonts cannot be reached, the runner accepts `REL_BROWSER_FONT_DIR` for genuine Red Hat Text Latin normal/italic variable WOFF2 files and `REL_BROWSER_SYMBOL_FONT` for the Material Symbols Rounded WOFF2 file. These test overrides do not change the shipped site or prove external font delivery.

## Current hosting and schema status

Cloudflare Pages project `robloxeditorslist` builds from `main` using `npm run build`, output `dist`, repository-root Functions source `functions/` and Node.js 24. Feature-branch preview deployments are disabled. The primary domain is `robloxeditors.com`; www redirects preserve paths and query strings.

On 15 October 2026, Cloudflare reported deployment `c62ad187-4e38-45c5-8a4a-d063ff2ac3ac` successful for `9610640`. Live account/list HTML and shared assets were checked against that source, with Cloudflare's injected analytics excluded from the HTML comparison. Production public-read and protected-request rejection checks passed. This is a release record, not a claim that future main commits are deployed.

Auth, public profiles and contributor account links are in use. The Contributor editor additionally requires [`20261015130000_rel_contributor_tiers.sql`](../supabase/migrations/20261015130000_rel_contributor_tiers.sql). Its live installation was not confirmed during this update; the latest inspected public contributor response still lacked tier fields. Follow [CONTRIBUTOR_TIERS.md](CONTRIBUTOR_TIERS.md) before assuming that editor is ready.

Database migration status and SMTP/provider settings must be checked separately from the website build. Do not rerun old migrations or imports to repair a newly missing function.

## Release an approved change

1. Start a new feature branch from freshly fetched `origin/main`, preserving local work. Follow [CONTRIBUTING.md](../CONTRIBUTING.md).
2. Run the relevant checks and review the diff. Preserve `data.js` and ranking data; exclude `.dev.vars`, `.wrangler/`, `dist/` and private backups.
3. Document database/configuration dependencies in the pull request. Obtain separate approval for production SQL, and apply approved prerequisites before releasing dependent features.
4. Obtain approval to merge and publish. Pushing or merging into `main` starts an automatic production build, including for documentation changes.
5. Verify the Cloudflare Pages check for the exact intended commit and confirm the live pages/assets. A Git push alone does not prove the deployment succeeded.
6. Check public list counts/order and the changed pages. Run:

   ```sh
   npm run test:smoke -- https://robloxeditors.com
   ```

7. Perform any authorized account checks with the intended account. Keep fictional write tests in the fixture or separate test project.

Website deployment does not initialize rankings or apply SQL. See [ranking preservation](RANKING_STORAGE.md) for backups and approved data moves, and [the Cloudflare migration record](CLOUDFLARE_MIGRATION.md) for the earlier hosting cutover.
