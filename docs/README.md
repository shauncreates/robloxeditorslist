# REL documentation

Use the root [README](../README.md) for the project overview and commands. These guides describe the current development workflow and the feature setup it depends on.

| Guide | Use it for |
| --- | --- |
| [Development and deployment](DEPLOY_AND_TEST.md) | Local fixture, actual Pages Functions, tests and releases |
| [Accounts and permissions](AUTH_SETUP.md) | Roles, verified editor links, sessions and database authorization |
| [Applications](APPLICATIONS_STAGE_1.md) | Current submission/review behavior and unfinished notification work |
| [Public profiles](PUBLIC_PROFILES.md) | Stable profile links, contributor account links and public fields |
| [Connect TikTok](TIKTOK_CONNECTION.md) | Optional ownership confirmation, privacy, provider setup and cleanup |
| [Popularity and YouTube](POPULARITY.md) | Ranked-editor audience lists, counts, Google setup and retention |
| [Clans](CLANS.md) | Creator-set prefixes, invitation confirmation and member rankings |
| [Contributor tiers](CONTRIBUTOR_TIERS.md) | Owner editing and the required contributor migration |
| [Signup email](SIGNUP_EMAIL_SETUP.md) | Supabase confirmation templates and SMTP configuration reference |
| [Ranking preservation](RANKING_STORAGE.md) | Backups, revision history and approved hosting/data moves |
| [Cloudflare migration record](CLOUDFLARE_MIGRATION.md) | Existing hosting setup and the Vercel cutover |

The [contribution guide](../CONTRIBUTING.md) covers branches and pull requests. SQL and email templates stay in [`supabase/`](../supabase/), at their existing paths.

## Historical records

[PROGRESS.md](history/PROGRESS.md) records earlier work and verification at the time it happened. Its old branch names, setup status and release notes are historical, rather than instructions for a new release. Interface review evidence remains in [`anti-slop/`](../anti-slop/).
