# Clans and member prefixes

Clans are public groups of REL accounts. Any active, confirmed member can create one; accounts can belong to **one clan at a time**. Ranked and unranked accounts can join. Clans do not claim editor profiles, grant permissions or change rankings.

## Workflow

1. Open **Clans** from rankings, the homepage or My account. **Browse clans** supports name/prefix search and sorting by name or member count. The public directory and profiles do not require sign-in.
2. Sign in with a confirmed REL account and open **Create clan**. Choose a name of 3–50 characters and exactly **four letters or numbers** for the prefix. Letters are stored uppercase. Names are unique without regard to case; prefixes are unique. Members display as **`[ABCD] name`** on public profiles, ranked editor tiles and Popularity rows. Each clan profile shows its prefix in the header. Ranking JSON names are not rewritten.
3. The creator edits the name/prefix in **Manage clan**. Membership resolves to its current prefix on new page/API loads, applying changes to all members without editing their account records. Already-open pages may need reloading.
4. **Create invite link** returns a private, reusable seven-day invitation. Replacing invalidates the previous link; revoking stops it immediately. The 32-byte random token appears in the creator's current page and shared URL fragment (`#invite=…`). Only its SHA-256 hash is stored. Tokens are absent from API URLs, the directory and audit details.
5. Opening the link previews the clan without joining. Recipients **Cancel**, or sign in and then **Confirm join**. Sign-in returns to this fixed REL route and still requires confirmation. New users confirm their email and reopen the invitation. Arbitrary external redirects are not accepted.
6. Members leave through **Membership**. Creators remove people from **Members** and manage invitations or disband in **Manage clan**. The creator cannot remove themselves or leave an ownerless clan; they must disband. Disbanding deletes the clan, invites and memberships, removing all prefixes. Ownership transfer is outside this first version.

Confirmation states that membership, username and prefix are public. Each member links to their REL account profile. Disabled, anonymous, unconfirmed or banned accounts are hidden. Clans with inactive creators are hidden and cannot accept invitations; existing members can still leave through **Your clan** on the directory. Private email and staff roles are not published.

## Clan rankings

Clan pages default to Overall and number their linked ranked editors **#1, #2, #3 within the clan**, following the overall list's order. For example, members at #4, #12 and #27 overall appear as #1, #2 and #3 in their clan. Selecting an existing style list follows that style's order and starts the clan positions at #1 again. Overall and style rank numbers are not displayed in the clan ranking rows or written back to the saved lists. Unranked accounts remain in the member list. An account needs an editor link, through verified matching or Owner review, to appear in member rankings.

Popularity keeps audience ordering and snapshot dates; the clan prefix is only a label. Clan changes preserve `data.js`, saved ranks and permissions.

## Layout

The directory uses aligned clan-name and member-count rows. Each public clan profile has its name, four-character prefix and actual member/ranked-editor counts, followed by **Rankings**, **Members** and the account's relevant membership/management tab. Forms and private invitations stay out of the default public rankings view. Ranked rows use the editor's stored picture when available, with initials for absent, invalid or failed images. Unranked accounts remain available in Members.

Tabs support arrow keys, Home/End, selected-state announcements and a single visible panel. The directory's search and sorting operate locally on the existing public response, without changing stored clan or ranking data. Management keeps the existing creator-only actions, seven-day invitation links and explicit confirmations. Creating a clan opens its management view; joining opens its rankings. The mobile header uses the existing labelled navigation icons, and forms stack into one column.

The layout takes structural inspiration from [AREDL's clan leaderboard](https://aredl.net/leaderboard?type=clans) and public clan profiles, with the separation of profile and management reflected in its [public clan model](https://github.com/All-Rated-Extreme-Demon-List/aredl-backend-v2/blob/main/src/clans/model.rs). REL keeps its own black/green palette, typography and four-character prefixes. No AREDL points, records, clan ranks or role model are imported. The current public AREDL UI was inspected alongside the public backend; its repository's older frontend branch is an archived implementation.

## Protection

[`20261016200000_rel_clans.sql`](../supabase/migrations/20261016200000_rel_clans.sql) adds private clan, membership and invitation-hash tables with RLS and no direct browser grants. Mutations require a live confirmed REL session, same-origin POST and database checks. A single-membership primary key and existing advisory lock protect competing creates/joins.

Only the creator updates a clan, issues invites, removes members or disbands. Staff do not automatically become another clan's creator. Service-only public projections include names, usernames, public account profile IDs, linked editor IDs and prefixes, excluding emails, staff roles, provider secrets and invite hashes. Preview uses POST to keep raw tokens out of endpoint URLs.

Creation is limited to three/account/day; links to ten/account/hour. Invites are reusable while valid. Audit records actor, time, action, clan ID and removed-member ID where applicable, without invitation tokens/hashes. Disbanding retains minimal audit entries.

## Setup and checks

The migration requires existing accounts/usernames and public profiles. On this combined branch, review missing social migrations in [Popularity setup](POPULARITY.md), then apply the clan migration last. Do not rerun installed migrations or reset data. Production SQL, merging and deployment need separate Owner approval; none were performed here.

No bot, paid dependency, new credential or scheduled clan service is required. Existing Cloudflare/Supabase free allowances apply. Creator support/moderation, ownership transfer and history exports can be considered separately.

```sh
npm test
npm run build
npm run check:cloudflare
REL_FIXTURE_TIKTOK=1 REL_FIXTURE_YOUTUBE=1 npm run test:preview
```

`tests/clans.test.mjs` covers validation, explicit joining, expired/revoked/replaced links, creator permissions, single membership, leave/removal/disband, private access, CSRF, revoked sessions and ranking/account/audit preservation.

With local Chromium DevTools on port 9223, run `tests/popularity-browser-review.mjs` then `tests/clans-browser-review.mjs` on the same fresh fixture. The latter uses the former's fictional count for the Popularity prefix check. Run the existing browser regression separately on a fresh fixture because it edits fictional passwords/rankings. Font variables follow the existing browser guide. Fixture tests do not establish provider approval or live configuration.

Earlier local screenshots below use fictional accounts and a **Motion Studio** test clan, not production memberships. They predate the tab layout and clan-local numbering described above:

![Earlier local clan page before the tab layout and clan-local numbering](images/clan-members.png)

<img src="images/clan-invitation-mobile.png" width="320" alt="Local clan invitation with public membership notice and separate confirm and cancel buttons">
