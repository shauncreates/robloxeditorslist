# Contributor tiers

Prepared on `feat/contributor-tiers`, starting from the latest fetched `origin/main` at `53a4bf7`. It groups the current public credits into Owners, Developers, Reviewers and Rankers, with compact links to their existing profiles and an Owner-only editor. This branch has not been merged or deployed.

The user confirmed these placements:

| Tier | Credits |
| --- | --- |
| Owners | @seeshaun |
| Developers | @balloond |
| Reviewers | No reviewers listed yet |
| Rankers | @b.luff, @maxx.vfxs |

The homepage loads saved credits from `/api/contributors`. Existing credit IDs and profile links are preserved, including for people who have not registered an account. On an older public-profiles setup, the existing four credits still group into these original tiers until the new migration is applied. Hosted pages show a retry state if credits cannot be fetched; they do not restore hard-coded credits that an Owner has hidden.

## Editing flow

Open **Admin → Contributors** as an Owner:

- Add or rename a contributor credit and edit its description.
- Select one or more of the four public tiers for that credit.
- Use Move up / Move down to reorder contributors, or hide credits that should no longer appear. Hidden credits remain available to the Owner and can be restored.
- Save any contributor edits, then use **Manage account links** to open the existing Users & roles controls and link a verified account once that person signs up.
- Review the changes and press **Save contributors** to publish them.

Names, descriptions, tier membership and ordering publish together when **Save contributors** succeeds. Unsaved drafts survive switching admin tabs, and leaving the page warns about unsaved work. A person can appear in more than one tier. Tier headings stay in the requested order; member ordering follows the saved credit order in each tier. Existing public profile pages show the saved names and descriptions. Hidden credit URLs return not found and hidden credits are omitted from linked account profiles.

Public tier membership and account access permissions are managed separately, with permissions continuing through Users & roles. The server and database enforce Owner access and record who changed the credits. The editor detects stale saves, including account-link changes in another tab; reload before retrying a conflicting save. Existing account links are preserved by credit edits.

## Migration and release

Apply `supabase/migrations/20261015130000_rel_contributor_tiers.sql` once after the existing public-profiles migration, before merging/deploying this branch. It adds tiers, visibility and a separate contributor revision, preserving account links, account permissions, ranking JSON and ranking revision tokens. It creates an Owner-checked `rel_contributors` operation and updates the existing public profile projections. The four original tier assignments are initialized only by this migration; later page loads respect saved settings.

Production application requires explicit approval and authenticated Supabase access. This environment currently has no authenticated Supabase SQL connection; the previously used production workflow is the project's Supabase SQL Editor. No production credentials need to be added to this cloud environment. This migration has only been applied to isolated local test databases here.

Run `npm test`, `npm run build` and `npm run check:cloudflare`. The isolated UI fixture is available through `npm run test:preview`. Tests verify Owner enforcement, malformed/stale saves, visibility, multi-tier membership, existing account-link preservation, private audit attribution and unchanged rankings.
