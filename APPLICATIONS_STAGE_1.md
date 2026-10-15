# Editor applications

On `feat/applications-stage-1`, `/apply/` submits private applications through `POST /api/applications`. Reviews are integrated into the `/admin/` Applications tab; the former separate review page has been removed.

Fields include display name, TikTok/YouTube profile, editing software, styles, examples, optional notes and status timestamps. Browser/server validation and a honeypot are implemented. Stronger launch abuse controls (rate limits/CAPTCHA) still require environment setup.

Applications start pending. Application Reviewers and Owners may approve, reject or return them to pending. Review operations are authorized in Cloudflare and in checked database RPCs, with reviewer audit entries. Listing is paginated. Approval changes only application status and never inserts editors or changes rankings.

The table is private. Browser roles cannot read or write it directly. The public submission Function uses a server-only secret after validating its payload. No shared admin password is accepted.

The approved Auth/roles SQL is now applied to the live database. See [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md) for local fixture tests, SMTP/Owner setup and main-only rollout. Feature-branch previews are disabled. No new source has been deployed; perform write-based integration tests in an isolated database or the fixture.
