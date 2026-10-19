# Contributing to REL

## Start a change

Fetch the latest repository state and continue on the existing development branch:

```sh
git fetch origin --prune
git switch fix/account-layout-navigation
```

Preserve existing local work before switching. Reuse this branch for further changes throughout the review cycle. Create a new branch from the latest `origin/main` only after the owner-approved commit, merge, push and deployment cycle is complete. Keep using that new branch until its release cycle is complete.

Read [AGENTS.md](AGENTS.md) when using a coding assistant. Follow the [development guide](docs/DEPLOY_AND_TEST.md), using the isolated fixture for account, application and ranking edits.

## Validate and open a pull request

Run the checks relevant to the change. Application changes normally require:

```sh
npm test
npm run build
npm run check:cloudflare
```

For interface changes, check keyboard access, narrow screens, error/empty states and the affected account roles in the fixture. For documentation-only changes, check relative links, command accuracy and the build.

Include README and public changelog updates with each new feature or user-visible behavior change. Explain what users can do, keep unreleased work clearly labelled, and use the actual release date when publishing. Put setup and migration requirements in the relevant developer guide. Public release notes must exclude credentials, private records and storage/access details. Routine documentation maintenance does not need its own changelog entry.

Commit and push the feature branch, then open a pull request into `main`. Explain the resulting behavior, relevant checks and any required database or environment setup. Keep generated `dist/`, `.wrangler/`, credentials and private backups out of the commit.

The project owner approves merges and releases. Pushing or merging into `main` triggers the production Cloudflare build, so a documentation merge also triggers that integration.

## Database and ranking changes

Keep existing migration paths and ordering. Test new SQL with fictional data before requesting approval to apply it to production. State the migration prerequisites in the pull request and apply approved schema changes before publishing dependent features.

Do not reset rankings, overwrite `data.js` or seed the live database from fixture/offline data. A production database change or data import needs separate approval. Review saved rankings before and after an approved operation; website deployment alone does not authorize database changes.

Use [`.dev.vars.example`](.dev.vars.example) only with the intended test project. Never commit real credentials or paste them into issues or pull requests.

## Remove completed branches

After merging, fetch and compare against the latest remote main:

```sh
git fetch origin --prune
git branch -r --merged origin/main
```

Delete only a named feature branch whose tip is already in `origin/main`, which has no open pull request and is not protected or in use. Keep `main`. Check for unique commits before deleting a squash-merged or rebased branch; its name or age is not proof that the work is merged. Preserve local stashes and branches used by another worktree.

Use `git branch -d <branch>` for a completed local branch. Remote deletion removes the branch reference, while merged commits remain in main's history.
