# Editor applications

## Current main behavior

The public `/apply/` form submits through `POST /api/applications`. It accepts a display name, TikTok/YouTube profile, software, styles, example link and optional notes. Browser/server validation and a honeypot are implemented. Submission currently does not require an REL account and does not send a transactional receipt email.

Reviews live in Admin's Applications tab. Application Reviewers and Owners can approve or reject a pending application with a required private reason. The database locks decided applications and records the reviewer's ID and username; users cannot return a decision to pending. Listing is paginated. Approval changes application status without inserting an editor or moving rankings.

List Contributors can separately convert an approved application into an editor through the existing staff workflow. That operation is distinct from the review decision.

Application rows and review reasons are private. Browser roles cannot read or write the table directly. Protected review calls require a verified account and checked database permissions; the public submission Function validates its payload before using server-only access.

## Separate notification and archive work

`feat/application-notifications-audit` contains work toward account-required applications, transactional submission/decision emails and Owner-managed private application archives. That branch has commits outside `main`. Do not describe those capabilities as released or delete that branch as merged.

Resend integration must be reviewed and configured for a separate release, with real delivery tested using an approved recipient. Supabase signup confirmation and password-recovery emails are separate Auth flows. Rate limits/CAPTCHA also require environment setup and verification.

## Development and rollout

Use the [isolated fixture](DEPLOY_AND_TEST.md) for fictional submissions and decisions. See [AUTH_SETUP.md](AUTH_SETUP.md) for roles, session checks and ranking protection. Production SQL, provider changes and deployment require the owner's approval; a website build alone does not apply them.
