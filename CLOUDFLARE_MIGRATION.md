# Cloudflare Pages setup

The site uses Cloudflare Pages Functions and Supabase Auth/Postgres/Storage. Build command: `npm run build`; output: `dist`; Functions: `functions/`.

See [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md) for the current setup and rollout steps. The approved C428 import and Auth/roles migration were applied on 14 October 2026. The saved ranking JSON was verified unchanged by the migration; do not rerun it on the live project.

Cloudflare project `robloxeditorslist` deploys from `main` only, with feature-branch previews disabled. On 15 October 2026 the user authorized merging the tested feature branch into main and deploying the new account/application system. Pushing to main triggers the production deployment; see `PROGRESS.md` for verification and the current release status.

Both `robloxeditors.com` and `www.robloxeditors.com` are attached to Pages. Their web CNAMEs point to `robloxeditorslist.pages.dev`; a Cloudflare redirect sends www requests to the primary HTTPS domain with the path/query preserved. The old www CNAME pointed at Vercel and caused the paused/HTTP 402 page. Vercel hosting configuration and analytics scripts are removed. All 21 live editor pictures were copied and verified in Supabase Storage on 15 October 2026; the live data no longer references Vercel Blob. The user will delete the unused old store in Vercel.

Production has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NODE_VERSION=24`. Keep the service-role key secret. Supabase Auth is live; shared-password source and the obsolete `ADMIN_PASSWORD` deployment setting have been removed.

Before switching existing traffic, back up and verify authoritative live rankings. Do not replace `data.js`, initialize the live database from placeholders or overwrite saved rankings. Keep ranking snapshots/history and the private avatar-copy report even after retiring the old image store. The new admin blocks saving when live data is unavailable, and writes require a valid revision against an existing database row.

Use a separate test project and synthetic rankings for setup verification. Production migrations, data imports and deployments require explicit permission. Do not deploy the new account source against an unmigrated production database.
