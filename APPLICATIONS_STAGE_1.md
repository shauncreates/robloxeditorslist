# Editor applications

`/apply/` submits private applications through `POST /api/applications`. A confirmed, signed-in account is required. Reviews are integrated into the `/admin/` Applications tab; the former separate review page has been removed. New development starts from the latest main on a new feature branch.

Fields include display name, TikTok/YouTube profile, editing software, styles, examples, optional notes and status timestamps. Browser/server validation and a honeypot are implemented. Stronger launch abuse controls (rate limits/CAPTCHA) still require environment setup.

Applications start pending. Application Reviewers and Owners may approve or reject them with a reason. Decisions are locked, attributed and emailed to the verified applicant. Reviewed entries leave the pending panel; Owners can view reviewed entries and move them into a private archive. Approval never inserts an editor or changes rankings; Contributors explicitly convert approved entries. Archiving removes an entry from the conversion queue without changing existing ranked editors.

The table is private. Browser roles cannot read or write it directly. The submission Function uses the verified user's token and a checked RPC; account and recipient identity are determined in the database. No shared admin password is accepted. Legacy anonymous submissions have no verified recipient and do not receive guessed email notifications.

See [APPLICATION_NOTIFICATIONS.md](APPLICATION_NOTIFICATIONS.md) for the pending account-linked application migration, Resend integration, automatic retry Worker and Owner activity log. These new changes have not been deployed or applied to a live database. Perform write-based integration tests in an isolated database or fixture.
