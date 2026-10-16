# Editor applications

## Earlier main behavior

The public `/apply/` form submits through `POST /api/applications`. It accepts a display name, TikTok/YouTube profile, software, styles, example link and optional notes. Browser/server validation and a honeypot are implemented. Submission currently does not require an REL account and does not send a transactional receipt email.

Reviews live in Admin's Applications tab. Application Reviewers and Owners can approve or reject a pending application with a required private reason. The database locks decided applications and records the reviewer's ID and username; users cannot return a decision to pending. Listing is paginated. Approval changes application status without inserting an editor or moving rankings.

List Contributors can separately convert an approved application into an editor through the existing staff workflow. That operation is distinct from the review decision.

Application rows and review reasons are private. Browser roles cannot read or write the table directly. Protected review calls require a verified account and checked database permissions; the public submission Function validates its payload before using server-only access.

## Tracking, notifications and archives

`feat/application-tracking` reconciles the earlier notification work with current main and adds account-owned status, separate applicant messages/private notes, transactional emails and Owner archives. See [the implementation and release guide](APPLICATION_TRACKING_AND_YOUTUBE.md). Production activation remains separate from this branch's implementation.

The older `feat/application-notifications-audit` branch still has commits outside main. Its migration must not be applied alongside the replacement tracking migration without a reviewed compatibility plan. Do not delete it as fully merged based only on similar features appearing in another branch.

Resend integration must be reviewed and configured for a separate release, with real delivery tested using an approved recipient. Supabase signup confirmation and password-recovery emails are separate Auth flows. Rate limits/CAPTCHA also require environment setup and verification.

## Development and rollout

Use the [isolated fixture](DEPLOY_AND_TEST.md) for fictional submissions and decisions. See [AUTH_SETUP.md](AUTH_SETUP.md) for roles, session checks and ranking protection. Production SQL, provider changes and deployment require the owner's approval; a website build alone does not apply them.
