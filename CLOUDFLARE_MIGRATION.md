# Cloudflare Pages migration

This branch replaces the Vercel Blob-backed API with Cloudflare Pages Functions and Supabase Storage/Postgres. The live `main` branch is unchanged.

## Cloudflare Pages build settings

- Production branch: `cloudflare-migration` while testing; change to `main` only after the migration is approved.
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root
- Functions are in `functions/` and are deployed by Pages alongside the static output.

The `build.mjs` script copies only the public site files into `dist`, avoiding accidental publication of repository files.

## Required Cloudflare Pages environment variables

Configure these as secrets/variables for Preview first:

- `ADMIN_PASSWORD`: a new strong admin password.
- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key. Store it as a secret. Never add it to GitHub, `data.js`, or any `VITE_*` variable.

The existing Seeshaun Hub Supabase project can be reused if desired; this migration adds a separate table and storage bucket. If using a different project, apply the migration to that project and set the corresponding URL/key.

## Supabase setup

1. Open the intended Supabase project.
2. Run `supabase/migrations/202610130001_roblox_editors.sql` in the SQL Editor.
3. Ensure the `editor-avatars` bucket is public for image reads. Uploads are made only by the server using the service-role secret.
4. Set the Cloudflare variables above on the Preview environment.

## Data migration

Before switching traffic, open the current Vercel admin page and use **Download data.js** to create a backup. Keep that backup private because it contains your full list data.

After the Cloudflare Preview deployment is ready, visit its `/admin` page, sign in using the Cloudflare `ADMIN_PASSWORD`, and save the backed-up list through the admin interface. The first save creates the database row.

## Verification checklist

- [ ] Public homepage loads and reads saved data.
- [ ] `/list/` loads the ranked lists.
- [ ] `/admin` login succeeds with the configured password.
- [ ] A harmless test edit can be saved and appears publicly.
- [ ] Wrong password cannot save changes.
- [ ] TikTok avatar fetch stores an image in Supabase Storage (TikTok may block automated requests).
- [ ] Manually entered avatar URLs still work.
- [ ] Restore the backup if needed before changing the production domain.
- [ ] Only after all checks pass, connect the existing custom domain to Cloudflare Pages.

## Important

Do not delete the Vercel project or Blob data until the Cloudflare version has been verified and the backup has been tested. This branch has not yet been built or tested locally.
