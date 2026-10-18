# Google app verification

REL uses Google authorisation to confirm YouTube channel control and read public subscriber counts. Its only requested Google OAuth scope is `https://www.googleapis.com/auth/youtube.readonly`. Google branding and scope verification are separate from TikTok's app review.

## Public pages

- Homepage: `https://robloxeditors.com/`
- Main privacy notice: `https://robloxeditors.com/privacy/`
- YouTube connection details: `https://robloxeditors.com/youtube-privacy/`
- Terms: `https://robloxeditors.com/terms/`

The homepage introduces the directory in static HTML, with one short note below its main buttons about YouTube ownership confirmation and subscriber counts. Its “YouTube privacy” link opens the public YouTube privacy notice. Detailed explanations stay in My account and the privacy notices. The main privacy notice describes the Google data accessed, its purpose, public fields, service providers, credential protection, retention and removal. The supplementary notice adds connection details. These public pages do not require a REL login; account actions do.

`build.mjs` publishes these pages as static files. Its Pages Functions routes include only `/api/*` and `/admin` paths. There is no homepage or policy-page authentication gate in the repository. Keep the public explanation available even if a visitor declines cookies, disables JavaScript or cannot load the contributors API.

## Domain ownership

1. Use the Google account managing REL's OAuth application to open [Search Console](https://search.google.com/search-console).
2. Add a **Domain** property for `robloxeditors.com`.
3. Add the verification TXT record Google supplies to Cloudflare DNS. Preserve existing DNS records, including email verification records.
4. Complete Google's ownership check. The rejection message requests a 24-hour wait after verification before retrying branding review.

Search Console verification does not require publishing an OAuth client secret. Do not commit credentials or put secrets in website HTML.

## Public access checks

Test the four URLs in a private browser window while signed out. They should display their content without redirecting to sign-in. Check a fresh request with JavaScript disabled as well.

If Google's reviewer reports a login wall, inspect Cloudflare Security Events and any Access applications, WAF rules or bot challenges affecting these public URLs. A failed automated request alone does not identify the cause. Request failures can also originate in the testing environment. Confirm the matching event before changing protection; preserve authentication for admin and account APIs. Cloudflare dashboard configuration is not controlled by these HTML changes.

## Before resubmitting

- Deploy the reviewed page changes with the owner's approval. A branch push alone does not update the production pages Google checks.
- In Google Auth Platform, use the public homepage and main privacy URLs above, and check the displayed app name is Roblox Editors List.
- Confirm the authorised domain is `robloxeditors.com` and domain ownership is verified for an appropriate project owner.
- Confirm Data Access requests only the scope actually used by the code. Do not add upload, posting or other scopes for this feature.
- Check that published privacy statements still match the implementation and operating practices, including the Google API Services User Data Policy and Limited Use commitments.
- If requested, provide a demo of the real YouTube connection: REL sign-in, Google consent, channel confirmation, the connected account and disconnect. Keep credentials and callback query strings out of review recordings.
- After the ownership wait and public-page checks, select **I have fixed the issues** in Google's branding review dialog and request another review. Respond to any separate sensitive-scope verification requirements Google presents.

These changes and checks do not guarantee approval. Google decides the outcome of its review. Publishing the OAuth app alone does not complete verification or remove the unverified-app warning.
