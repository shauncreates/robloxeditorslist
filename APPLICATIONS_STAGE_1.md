# Editor Applications — Stage 1

This stage is implemented on `feat/applications-stage-1` only. It does not modify `main` or automatically change rankings.

## What is included

- Public application form: `/apply/`
- Admin review page: `/admin/applications.html`
- Public submit endpoint: `POST /api/applications`
- Admin list/status endpoint: `POST /api/applications/admin`
- Private Supabase table: `public.editor_applications`

Applications include display name, main platform and profile URL, editing software, editing styles, examples URL, optional notes, status and timestamps. Status starts as `pending`; admin can mark it `approved`, `rejected` or back to `pending`. Approval does not add the editor to any ranking.

## Setup required before the form can submit

1. In the intended Supabase project, run `supabase/migrations/202610130002_editor_applications.sql` in the SQL Editor. Keep row-level security enabled and do not add public/anon policies for this table.
2. Ensure the Cloudflare Pages Preview environment has the server-side `ADMIN_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` variables configured. The service-role key must remain a server-side secret; never put it in browser code or a `VITE_*` variable.
3. In Codespaces, switch to `feat/applications-stage-1`, run `git pull` if needed, then run:
   ```bash
   npm run build
   python3 -m http.server 8000 --directory dist
   ```
   Open port 8000 to preview the static pages. The static server does not run Pages Functions, so API submission and admin review cannot work from this preview alone.
4. Deploy a Cloudflare Pages Preview for this branch to test the actual Functions and Supabase integration.

## Preview checklist

- [ ] `/apply/` renders on mobile and desktop.
- [ ] Empty required fields and zero selected styles are rejected by the browser.
- [ ] A valid application is saved with status `pending`.
- [ ] Public requests cannot read the application table.
- [ ] `/admin/applications.html` rejects an incorrect admin password.
- [ ] Correct admin password lists applications.
- [ ] Approve/reject/pending updates only the application status and never changes rankings.
- [ ] Invalid URLs, unsupported platform links, oversized fields and invalid status updates are rejected.
- [ ] Check mobile layout, links and screen-reader status messages.

## Security notes

The admin page sends the password only in requests and does not store it in local storage. Application data is returned only by the admin endpoint after password verification. This is a first stage: before public launch, add stronger abuse controls such as Cloudflare Turnstile and rate limiting, and test the workflow thoroughly. Do not put real credentials in commits or chat.
