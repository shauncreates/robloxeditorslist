# Contributor tiers

The tiered homepage and Owner-only editor are on `main` and deployed. Credits group into Owners, Developers, Reviewers and Rankers, with links to public profiles. The editor requires the separate database migration described below; publishing its HTML and Functions does not install that migration.

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

Apply [`20261015130000_rel_contributor_tiers.sql`](../supabase/migrations/20261015130000_rel_contributor_tiers.sql) once after the existing public-profiles migration, before using the editor. It adds tiers, visibility and a separate contributor revision, preserving account links, account permissions, ranking JSON and ranking revision tokens. It creates an Owner-checked `rel_contributors` operation and updates the existing public profile projections. The four original tier assignments are initialized only by this migration; later page loads respect saved settings.

Production application requires explicit approval and authenticated Supabase access. The established production workflow is the project's Supabase SQL Editor; no production credentials need to be added to the development environment. This migration has been tested in isolated local databases. A read-only public API check on 15 October 2026 now returns saved tier fields, indicating that the public tier setup is present. The agent did not apply production SQL or test authenticated Owner editing during this update.

### If the editor reports an unavailable account database

An earlier live public contributor response lacked the migration's tier fields when the editor error was reported; the later public response includes them. The Admin Contributors endpoint calls `rel_contributors`; if that function is missing, the API returns the generic "Account database is unavailable" message. An existing account link can still save through its older function while the new editor fails.

Have the project owner check whether the migration has already been installed. If absent, review and run the entire migration once in the intended Supabase project's SQL Editor, then select **Reload contributors** in Admin. Do not rerun the older Auth or public-profiles migrations. No website redeployment is needed for this database step. If SQL fails or the message persists, inspect the exact SQL error or server-side RPC error before making further changes; the public error alone can also represent other database failures.

Run `npm test`, `npm run build` and `npm run check:cloudflare`. The isolated UI fixture is available through `npm run test:preview`. Tests verify Owner enforcement, malformed/stale saves, visibility, multi-tier membership, existing account-link preservation, private audit attribution and unchanged rankings.
