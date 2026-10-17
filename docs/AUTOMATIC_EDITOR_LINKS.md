# Automatic editor links

This change is prepared for review. It requires one new SQL migration before its website release:

[`20261017140000_rel_automatic_editor_links.sql`](../supabase/migrations/20261017140000_rel_automatic_editor_links.sql).

## Existing editors

Confirming TikTok compares the username returned by TikTok with the editor's stored TikTok username or canonical TikTok profile link. Matching ignores case and a leading `@`. REL account names, editor display names and general handles do not prove ownership.

One exact, unclaimed match links the REL account to that editor profile. The member can then edit their own profile. Their roles, editing-style membership and rank positions stay as they were. Existing confirmed connections are checked through an authenticated, same-origin POST when My account loads; another TikTok consent is unnecessary while the proof remains valid. Status GET requests do not create links.

Multiple matching editors, conflicting TikTok fields, another account's existing association, a rejected claim for that editor or a pending claim for a different editor keep the Owner-review route. Existing account links are never replaced automatically. Matching uses the current verified username against REL's stored profile data; legacy editors do not have a historical immutable TikTok ID to compare.

## Applications

Submission checks the applicant's current confirmed TikTok against the submitted TikTok profile. A private record stores only the check result and date. The applicant and authorised staff can see this result. No TikTok token, ID or extra username is copied into that evidence. A replay preserves the original result; legacy applications remain unchecked.

Approval and publication remain separate staff actions. When a List Contributor converts an approved application to an editor, REL retrieves the original applicant from its private contact record and checks the current TikTok proof again. A fresh matching connection links that applicant to the new editor in the same transaction. The contributor performing publication does not receive the editor association.

An absent, expired or different connection leaves profile linking for later verification or Owner review. Connecting the matching TikTok after publication can still link the account. Applications without TikTok ownership proof remain available for manual review. A canonical TikTok profile already present in the editor records cannot be converted into a duplicate editor.

Automatic links create a private `auto_link_editor` audit entry identifying the actor, target REL account, editor, method and application ID when relevant. Disconnecting or expiring TikTok removes its proof/count but retains the established REL editor association. An Owner can manage that association through the existing account controls.

## Release

1. Review the migration and confirm that the existing account, application tracking, TikTok, editor platform and integrated publication migrations are installed.
2. Obtain permission for production SQL. Apply this new migration once. It adds a private evidence table and function wrappers; it does not backfill account associations, rewrite rankings or replace existing records.
3. Obtain permission to merge and deploy the website. Deploy after the migration so the new `match` action is available.
4. Use an approved sandbox account to confirm an existing editor match, then exercise an approved application in a test database. Production application/ranking changes require their own approval.

Local tests cover OAuth confirmation, existing-connection matching, identity normalisation, ambiguous/claimed profiles, Owner decisions, application evidence and replays, publication, expired/changed proofs, private-function access, same-origin/session checks and preservation of existing migration data and rank order. No production credentials are needed for these tests.
