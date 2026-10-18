# REL documentation

Use the root [README](../README.md) for the project overview and commands. These guides describe the current development workflow and the feature setup it depends on.

| Guide | Use it for |
| --- | --- |
| [Combined branch](COMBINED_BRANCH.md) | Integrated features, migration order and the shared working-branch policy |
| [Development and deployment](DEPLOY_AND_TEST.md) | Local fixture, actual Pages Functions, tests and releases |
| [Accounts and permissions](AUTH_SETUP.md) | Roles, verified editor links, sessions and database authorization |
| [Account layout and navigation](ACCOUNT_NAVIGATION.md) | Desktop/dashboard sizing and session-aware account buttons |
| [Applications](APPLICATIONS_STAGE_1.md) | Current submission/review behavior and unfinished notification work |
| [Application tracking and YouTube](APPLICATION_TRACKING_AND_YOUTUBE.md) | Account-owned status, decision emails, private archives, Google authorisation and release prerequisites |
| [Public profiles](PUBLIC_PROFILES.md) | Stable profile links, contributor account links and public fields |
| [Editor platforms](EDITOR_PLATFORMS.md) | TikTok/YouTube ranking links, picture fetching and YouTube API setup |
| [Connect TikTok](TIKTOK_CONNECTION.md) | Optional ownership confirmation, privacy, provider setup and cleanup |
| [Automatic editor links](AUTOMATIC_EDITOR_LINKS.md) | Verified TikTok matches, applicant-to-editor links and the required migration |
| [Popularity and YouTube](POPULARITY.md) | Ranked-editor audience lists, counts, Google setup and retention |
| [Google app verification](GOOGLE_APP_VERIFICATION.md) | Public homepage and privacy disclosures, domain ownership and review prerequisites |
| [Clans](CLANS.md) | Creator-set prefixes, invitation confirmation and member rankings |
| [Contributor tiers](CONTRIBUTOR_TIERS.md) | Owner editing and the required contributor migration |
| [Signup email](SIGNUP_EMAIL_SETUP.md) | Supabase confirmation templates and SMTP configuration reference |
| [Ranking preservation](RANKING_STORAGE.md) | Backups, revision history and approved hosting/data moves |
| [Security and privacy review](SECURITY_REVIEW.md) | Browser headers, avatar protection, policy pages and the request-limit release prerequisite |
| [Cloudflare migration record](CLOUDFLARE_MIGRATION.md) | Existing hosting setup and the Vercel cutover |

The [contribution guide](../CONTRIBUTING.md) covers branches and pull requests. SQL and email templates stay in [`supabase/`](../supabase/), at their existing paths.

## Historical records

[PROGRESS.md](history/PROGRESS.md) records earlier work and verification at the time it happened. Its old branch names, setup status and release notes are historical, rather than instructions for a new release. Interface review evidence remains in [`anti-slop/`](../anti-slop/).
