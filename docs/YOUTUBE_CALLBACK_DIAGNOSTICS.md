# YouTube callback diagnostics

The callback retains its existing failure redirect and connection checks. A failed attempt now emits one server-side JSON log with event `rel_youtube_callback_failed`.

Only the internal stage, a fixed reason, an allowlisted Google error code and numeric upstream HTTP statuses are logged. OAuth codes, state/cookies, tokens, encryption/client secrets, URLs, provider descriptions, raw exceptions and database response bodies are excluded. Logs are not returned through the public API. Successful connections and intentional cancellation emit no failure diagnostic.

| Diagnostic | Investigation |
| --- | --- |
| `state` / `invalid_state` | Missing or mismatched callback cookie; start a fresh connection from the canonical REL origin |
| `claim` with `service_status` | Check the exchange RPC, schema permissions and active/expired session; do not rerun migrations blindly |
| `token_exchange` / `invalid_client` | Check that Pages uses the secret belonging to the configured OAuth client ID |
| `token_exchange` / `invalid_grant` | Inspect redirect registration, PKCE and expired/replayed authorisation; do not reuse the callback URL |
| `token_response` / `missing_scope` | Verify consent to the read-only YouTube scope |
| `token_response` / `missing_refresh_token` | Investigate Google's offline-access response and existing consent |
| `channel_lookup` / `accessNotConfigured` or `SERVICE_DISABLED` | Verify YouTube Data API v3 in the OAuth client's Google project |
| `channel_response` / `no_channels` | Check that the selected Google identity has a YouTube channel |
| `encryption` | Check the deployed encryption-key format; preserve any existing key used by connections |
| `proof_storage` or `audience_storage` | Check the corresponding private feature RPC and schema permissions |

After an approved Pages release, inspect only this event in Cloudflare logs while the account owner performs one fresh attempt. Report only its stage/reason, allowlisted provider code and HTTP statuses. Avoid copying raw request logs, which can include the sensitive callback URL. This log identifies the failed boundary; it does not by itself prove the underlying cause.

No production configuration, SQL, rankings or credentials are changed by this patch. Local regression tests cover sanitisation, unknown/oversized provider responses, stage identification, fail-closed behaviour, cancellation and a successful fixture authorisation.
