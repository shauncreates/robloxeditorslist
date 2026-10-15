# Roblox Editors List (REL)

Roblox Editors List is a community website for finding Roblox video editors and browsing rankings by editing style. Editors have public profiles with their work, software and list placements. REL accounts let verified editors manage their own details, while staff review applications and maintain the rankings.

[Visit the website](https://robloxeditors.com) · [Browse rankings](https://robloxeditors.com/list/) · [Read the documentation](docs/README.md)

## Features

- Overall and style-specific rankings with search, filters and expandable editor details.
- Shareable profiles for ranked editors, REL accounts and credited contributors, including people who have not created an account.
- Email/password signup, email confirmation, sign-in and password recovery through Supabase Auth.
- Owner-verified account links so members can edit their own editor details without changing rankings or other profiles.
- Separate Member, List Contributor, Application Reviewer and Owner permissions, checked by the API and database.
- Applications with example links, private review reasons and recorded reviewer attribution. Decisions are locked after approval or rejection; adding an approved applicant to the list is a separate staff action.
- Homepage contributor groups for Owners, Developers, Reviewers and Rankers, with an Owner editor for names, descriptions, tiers and visibility once its database migration is installed.
- Ranking revision checks, private pre-save history and audit records to protect against stale or unauthorized saves.

## Stack and architecture

| Layer | Technology and responsibility |
| --- | --- |
| Frontend | HTML, CSS and JavaScript; static pages and shared browser modules |
| API | Cloudflare Pages Functions; input validation, sessions and authorization |
| Database | Supabase Postgres; rankings, account links, application decisions and checked database functions |
| Identity and pictures | Supabase Auth and Storage |
| Development | Node.js, npm, Wrangler and PGlite for isolated PostgreSQL tests |
| Hosting | Cloudflare Pages, built from `main` |

The browser calls same-origin `/api/` endpoints. Functions verify the current account before protected operations, and database functions check roles and ownership again. Session tokens use HttpOnly cookies. Public profile responses exclude account emails, permissions and private review records.

Hosted rankings come from the existing database through the API. Building or publishing the website does not seed or replace rankings.

## Run locally

Use Node.js 22 or later; the project is checked with Node.js 24.

```sh
npm ci
npm test
npm run build
npm run test:preview
```

The last command starts an isolated preview with fictional accounts and rankings. It needs no Supabase credentials and sends no emails. Stop it with Ctrl+C; restarting discards fixture edits.

| Fixture account | Access |
| --- | --- |
| `owner@example.test` | Owner |
| `contributor@example.test` | List Contributor |
| `reviewer@example.test` | Application Reviewer |
| `member@example.test` | Member linked to an editor |
| `stranger@example.test` | Member without an editor link |

All fixture accounts use `test-password-123`. Fixture signup creates an unconfirmed test account and sends no confirmation email.

See the [development and deployment guide](docs/DEPLOY_AND_TEST.md) for real Pages Functions, separate Supabase test projects, browser checks and release verification. A plain static file server cannot test authentication or API writes.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the locked dependencies |
| `npm test` | Run isolated database, authorization, endpoint and UI-script tests |
| `npm run build` | Copy the website to `dist/` and generate Pages routes |
| `npm run test:preview` | Start the fictional development fixture |
| `npm run check:cloudflare` | Compile Pages Functions without deploying |
| `npm run dev:cloudflare` | Run real Pages Functions locally against the configured Supabase project |
| `npm run test:smoke -- <website-url>` | Check public reads and rejection of unauthenticated protected requests |

The real Functions workflow needs the server-side fields in [`.dev.vars.example`](.dev.vars.example). Use a separate test project for write tests; a local server still accesses whichever database its URL identifies. Keep credentials out of Git and browser code.

## Repository map

| Path | Contents |
| --- | --- |
| `index.html`, `list/`, `profile/`, `changelog/` | Public pages |
| `signin/`, `account/`, `reset-password/`, `email-verified/` | Account and recovery pages |
| `apply/`, `admin/` | Application submission and staff tools |
| `assets/`, `media/` | Shared scripts, styles, icons and images |
| `functions/` | Pages Functions and API helpers |
| `supabase/` | SQL setup, migrations and Auth email templates |
| `tests/` | Isolated fixtures, automated tests and browser runner |
| `scripts/` | Smoke checks and reviewed maintenance utilities |
| `docs/` | Setup, feature guides and historical development notes |
| `anti-slop/` | Recorded interface and copy reviews |
| `data.js` | Existing offline preview data; not the production ranking source |

## Release status and remaining work

The account, public profile and staff interface changes are on `main` and deployed. Production deploys from `main` only, and feature-branch previews are disabled.

- The Contributor editor requires [the contributor tiers migration](supabase/migrations/20261015130000_rel_contributor_tiers.sql). Its production installation was not confirmed during this documentation update. If the editor reports an unavailable account database, follow the [contributor setup guide](docs/CONTRIBUTOR_TIERS.md).
- Account-required applications, transactional submission/decision emails and Owner application archiving remain separate work on `feat/application-notifications-audit`. They are not part of the current `main` application flow. Resend configuration and end-to-end email verification still need a separate rollout.
- Real SMTP delivery, provider settings and launch abuse controls need verification in the intended environment; local fixture tests do not prove them.

## Contributing

Start each change on a new branch from freshly fetched `origin/main`. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks, database changes, pull requests and branch cleanup.

Preserve editor rankings and `data.js`. Production migrations, ranking imports, merges and deployments need the project owner's approval. The build and automated tests do not perform those operations.
