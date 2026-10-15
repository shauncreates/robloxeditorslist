# Rankings survive hosting changes

The authoritative document lives in Supabase
`public.roblox_editor_site_data`, row `id = 'site-data'`. Cloudflare/Vercel hosting
serves the site and API; it does not own or initialize that document. Switching
hosts must keep the same Supabase project and existing database row.

Both public pages now fetch saved data through `/api/data` when hosted. An empty
or wrong project produces an unavailable state instead of showing bundled
placeholder rankings. `data.js` remains unchanged and is used only for local
file previews. The admin never uses it to initialize or overwrite the database.

The Auth setup adds revision checks, private pre-save history and audits. It does
not replace saved ranking JSON. The save API updates only an existing row after
authorization and a matching revision, and archives the previous document.
Application approval and profile linking never change ranking positions.

## C428 backup inspected on 14 October 2026

Source: the user-provided `Downloads/data (1).js`. It contains 21 editors,
four styles and these list sizes:

| List | Entries |
| --- | ---: |
| Overall | 21 |
| Nate | 7 |
| Block Glitch | 9 |
| Transition/3D | 8 |
| Hypic | 12 |

No duplicate ranking entries or missing editor references were found. This only
verifies the provided snapshot, not whether it is the latest authoritative list.

After explicit approval, C428 was imported into `robloxeditorslist-stage1`
(`coapqgqnmdlgwhftuiub`) on 14 October 2026. Its complete saved JSON was verified
equal to the backup, including every list order. Equality was verified again
after the approved Auth migration. Both Cloudflare environments use this project.

Prepared artifacts are in the ignored, non-public `private-backups/c428/`:

- `source-data.js`: unchanged source copy.
- `rankings.json`: parsed data, with all IDs, fields and array ordering preserved.
- `manifest.json`: source/data SHA-256 fingerprints and exact list orders.
- `import-empty-database.sql`: approved import, executed and verified in that project.

The private manifest records the import and verification. Do not rerun imports
as part of deployment. See [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md).

Source SHA-256:
`f41fd767fdb9bd92a0a59c8f6655b24fb4ba1df9a3ecd6f94db1187b28b9e933`

Canonical data SHA-256:
`685f13eef22acfda4baff15f45ac645ffe115286925006810a1de241a546f39e`

## Safe import and future moves

1. Confirm the intended Supabase project and that this backup is authoritative.
   Export/compare any existing database record before deciding on a restoration.
2. Review the prepared SQL and get explicit permission to execute it in that
   project. It inserts only into an empty table, does nothing for identical data,
   and raises an error for different saved rankings. It never overwrites them.
3. After an approved import, read back the document and compare it to
   `rankings.json`, including every list order. Revision/timestamp metadata may
   differ; editor data must match exactly. Keep the source and manifest privately.
4. Configure the new host to the same Supabase project. Do not reset/delete its
   database or run automatic seed/import scripts during a build or deployment.
   Verify `/api/data` and every list before switching traffic.

Prepare future backups using:

```powershell
npm run backup:prepare -- "C:/path/to/downloaded-data.js" new-snapshot-name
```

The parser accepts data object literals without executing JavaScript. It validates
references, preserves order, keeps backups outside the published build and refuses
to reuse an existing backup folder. Downloaded JSON backups are accepted too.
The command creates review files only; it has no network/database write capability.

If the database itself ever changes projects, export and restore it deliberately,
including REL accounts/roles/history and required Storage objects. A website host
move needs no ranking import once Supabase contains the authoritative document.
