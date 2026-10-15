# Roblox Editors List

A static HTML/CSS/JavaScript ranking site hosted on Cloudflare Pages, using Pages Functions and Supabase Postgres, Auth and Storage.

- `index.html`, `list/`: public homepage and rankings.
- `apply/`: account-required application form with private submissions.
- `signin/`, `assets/`: public email/password signup and sign-in, with session helpers.
- `admin/`: role-aware profile, ranking, application and Owner user management.
- `data.js`: bundled data for offline file previews only. Hosted pages load Supabase data. Do not overwrite it or use it to initialize live rankings without an approved verified import.
- `functions/`: Cloudflare API and server-side authorization.
- `supabase/`: existing migrations, applied Auth/permissions setup reference and signup email template.
- `tests/`: isolated PostgreSQL, endpoint and browser-script tests using invented data.

See [AUTH_SETUP.md](AUTH_SETUP.md) for roles, local testing, profile linking, approved database setup and production cutover. Accounts default to Member. Owner-verified links allow Members to edit their own profiles and software; elevated roles are assigned only by Owners.

This feature branch adds application receipt/decision emails, Owner archiving and an activity log. See [APPLICATION_NOTIFICATIONS.md](APPLICATION_NOTIFICATIONS.md) for the migration, Resend setup and separate scheduled retry Worker. These changes have not been applied to production. Cloudflare deploys from main only; merging and deployment require approval.

Run `npm ci`, `npm test`, and `npm run build`. Cloudflare's build output is `dist`; its Functions source is `functions/`. No deployment is part of these commands.

Use `npm run test:preview` for an isolated UI fixture. A static file server alone cannot exercise authentication or API writes.

See [RANKING_STORAGE.md](RANKING_STORAGE.md) for preserving rankings across hosting changes and preparing a safe backup import. See [SIGNUP_EMAIL_SETUP.md](SIGNUP_EMAIL_SETUP.md) for the proposed signup email sender and SMTP configuration.
