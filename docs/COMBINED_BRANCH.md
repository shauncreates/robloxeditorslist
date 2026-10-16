# Combined development branch

Continue development and review on `fix/account-layout-navigation`. The 16 October 2026 integration includes every fetched remote branch head. Main remains at `4ad2c76`; this integration does not authorize a production release.

| Work | Integrated behaviour |
| --- | --- |
| Security and privacy | Request validation, security headers, rate limits, legal pages and click-to-load YouTube videos |
| Applications | Account-required submissions, applicant status/messages, Resend email queue, locked decisions, private Owner archives and attributed activity |
| Editor main platform | TikTok/YouTube redirects, platform-aware picture fetching and linked-editor controls |
| Social connections | TikTok ownership confirmation and Google-authorised YouTube connections; manual Owner linking remains available |
| Popularity and clans | Ranked-editor audience lists, clan invitations, four-character prefixes and member rankings |
| Account/navigation fixes | Wider desktop dashboard, stacked mobile layout and session-aware account button labels |
| Existing work | Visual README, contributor tiers and missing page favicons |

The TikTok, popularity/clan and contributor commits were verified with matching Git patch IDs before their original branch histories were recorded. The earlier application-notifications branch is superseded by the newer application-tracking implementation. The sign-in-actions branch has no net change after its revert. All original histories are retained without restoring obsolete layouts or undoing newer fixes.

## Database prerequisites

No live SQL was applied during integration. Review the feature guides and take the established private backup before any separately approved migration. For an environment already at the current main prerequisites, apply these migrations in filename order:

1. `20261015230000_rel_request_limits.sql`
2. `20261016120000_rel_application_tracking.sql`
3. `20261016130000_rel_youtube_connections.sql`
4. `20261016160000_rel_editor_main_platform.sql`
5. `20261016180000_rel_tiktok_connections.sql`
6. `20261016190000_rel_editor_popularity.sql`
7. `20261016200000_rel_clans.sql`
8. `20261016210000_rel_integrated_pending_editors.sql`

The last migration preserves archive exclusion and conversion blocking alongside platform-aware conversion. It changes functions and privileges, without rewriting the ranking document. The private conversion helper is inaccessible to authenticated callers; the authorised public flow checks account permissions and the ranking revision.

Coordinate the application maintenance window described in [application tracking](APPLICATION_TRACKING_AND_YOUTUBE.md). Review provider setup in the [platform](EDITOR_PLATFORMS.md), [TikTok](TIKTOK_CONNECTION.md), [Popularity](POPULARITY.md), [clan](CLANS.md) and [security](SECURITY_REVIEW.md) guides. Keep production credentials out of Git and the cloud workspace.

Application email retries use `wrangler.email-retry.jsonc`. Social maintenance uses `wrangler.social-maintenance.jsonc`. The email worker only retries emails; the hourly social worker owns YouTube access checks, TikTok cleanup and audience expiry. This avoids duplicate YouTube maintenance schedules. Pages does not deploy either worker automatically. Provider consent, actual email delivery, live migrations and cron execution remain release checks.

## Development and review

Run `npm test`, `npm run build` and `npm run check:cloudflare`. Use the isolated fixture for application decisions, account connections, clan actions and ranking edits. Browser suites use fictional provider responses and cannot prove live provider setup.

Keep using this branch for requested changes. Create another branch only after the owner-approved commit, merge, push and deployment cycle is complete. Main merges, deployments and production SQL each require the owner's permission.

## Integration validation, 16 October 2026

- `npm test`: all 21 test files pass, including combined platform conversion and archive/helper permissions.
- `npm run build` and `npm run check:cloudflare`: pass, with Wrangler logs directed to a temporary writable path.
- `tests/browser-review.mjs`: passes account signup/recovery, applications, review/conversion, archives/activity, email previews, public profiles, Google connection and video consent at desktop/mobile widths.
- Account-navigation, editor-platform, popularity and clan browser suites pass. Coverage includes keyboard actions, reduced motion, 200% text, platform redirects and avatars, fictional provider callbacks, audience counts, invitation confirmation, prefix links and preservation of global ranks.
- `data.js` matches main, and every fetched remote branch head is an ancestor of the combined branch. Main and production were not modified.
