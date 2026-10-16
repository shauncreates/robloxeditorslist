# Website screenshots

`application-tracking.png`, `youtube-confirmation.png` and `application-approved-email.png` were captured on 16 October 2026 against fictional local records. Provider responses are simulated, and the email capture shows generated HTML rather than a real delivery. These documentation assets are excluded from the website build.

The `account-dashboard-desktop.png`, `account-dashboard-mobile.png` and `account-nav-signed-out.png` captures show the 16 October 2026 account-layout/navigation fix in the isolated fixture. They use fictional accounts and ranking data with locally loaded Red Hat Text. See [account navigation](../ACCOUNT_NAVIGATION.md). They contain no production account records or credentials.

The `popularity-tiktok.png`, `popularity-youtube-mobile.png`, `clan-members.png` and `clan-invitation-mobile.png` previews were captured on 16 October 2026 from this development branch's actual local UI. They use fictional accounts, audience counts and a test clan from the isolated fixture, rather than production memberships or real social statistics. Red Hat Text was loaded locally. No production request or private production data was used. See the [Popularity](../POPULARITY.md) and [Clans](../CLANS.md) guides for setup and limits.

Captured on 15 October 2026 from the REL source used by this documentation PR. The images are WebP screenshots from Chromium, using the site's existing Red Hat Text and Material Symbols fonts. They are not generated illustrations or redesigned mockups.

| Image | Source |
| --- | --- |
| `rankings.webp`, `rankings-mobile.webp` | Ranking page at desktop and phone viewport sizes |
| `homepage.webp` | Homepage and saved public contributor tiers |
| `profile.webp` | A ranked editor's public profile |
| `signin.webp` | Empty sign-in form in the local development fixture |
| `contributors-admin.webp` | Contributor editor with a fictional Owner account in the fixture |

The public pages were served from the local source with a read-only snapshot of the production public data/profile/contributor endpoints. Public editor pictures were fetched unchanged through the available HTTPS route. Font files were loaded locally to avoid external font delivery affecting the capture. No public names, rankings or text were invented for the pictures, and no production write requests were made.

The staff image shows the isolated fixture's account and seeded credits, not private production records. The screenshot does not demonstrate that production Owner editing or email delivery has been tested. Counts, placements and credits are a snapshot and can change on the website.

To refresh the images, capture the relevant pages after data, fonts and pictures load. Keep the phone view at a phone viewport rather than shrinking a desktop image, and use fictional accounts for protected screens. Verify that account details, tokens, messages and private applications are absent before committing new images. Keep these documentation assets under `docs/images/`; the website build excludes `docs/`.
