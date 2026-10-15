# Cloudflare Pages setup

The site uses Cloudflare Pages Functions and Supabase Auth/Postgres/Storage. Build command: `npm run build`; output: `dist`; Functions: `functions/`.

See [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md) for the current setup and rollout steps. The approved C428 import and Auth/roles migration were applied on 14 October 2026. The saved ranking JSON was verified unchanged by the migration; do not rerun it on the live project.

Cloudflare project `robloxeditorslist` now deploys from `main` only, with feature-branch previews disabled. The implementation remains locally on `feat/applications-stage-1` and has not been merged/pushed/deployed. Pushing to main will trigger a production deployment.

Production already has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NODE_VERSION=24`. Keep the service-role key secret. The shared-password authentication has been removed from this source. Remove its obsolete deployment secret after the new source is live.

Before switching existing traffic, back up and verify authoritative live rankings. Do not replace `data.js`, initialize the live database from placeholders, overwrite the saved rankings or delete the former Vercel/Blob data as part of setup. The new admin blocks saving when live data is unavailable, and writes require a valid revision against an existing database row.

Use a separate test project and synthetic rankings for setup verification. Production migrations, data imports and deployments require explicit permission. Do not deploy the new account source against an unmigrated production database.
