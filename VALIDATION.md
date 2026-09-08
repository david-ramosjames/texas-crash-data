# Migration verification

Verified locally on 2026-09-07:

- `npm test`: 14 passed, 1 skipped. The skipped check needs a native PostgreSQL/PostGIS server and is configured in GitHub Actions; it has not run here.
- `npm run typecheck`: passed.
- `npm run build`: production build passed.
- `npm audit --omit=dev`: zero reported vulnerabilities at the time checked.
- Production HTTP checks: health 200, login 200, unauthenticated bootstrap 401, workspace redirect 307 to login.
- Synthetic end-to-end import test uses the real Supabase SDK against a local Storage HTTP contract double plus in-process PostgreSQL. It verifies immutable originals, replay safety, queued-upload sealing, interrupted parsing and restart from 500 verified rows, activation of 600 distinct crashes, exact original download bytes, and corruption detection.
- Research regression runs every cohort/dimension on PostgreSQL; tests include revision precedence, equal-timestamp conflicts, transaction rollback, discovery/editorial preservation, job recovery and retries.
- Source/secret checks found no original CSVs, Excel files, database dumps, local environment files, or API tokens in tracked files.

Verified in GitHub Actions on 2026-09-08: native PostgreSQL/PostGIS migrations (including a second idempotent migration run), all automated tests, TypeScript, and the Linux production build passed. The native test verifies generated geographic points, radius queries, RLS configuration, and worker advisory locks. See the successful run linked below.

Not yet verified: real Supabase login/storage/project connectivity, Railway cloud deployment, full 2020–present corpus performance, or live OpenAI calls. These need your cloud configuration. Existing Sites data and editorial records have not been moved.

## GitHub handoff

Resolved on 2026-09-08: the owner signed in through GitHub CLI, and the migration was pushed successfully to `main` in `david-ramosjames/texas-crash-data`. Repository visibility remains public; original data and secrets are excluded. The first CI run is available at https://github.com/david-ramosjames/texas-crash-data/actions/runs/34258690295.

For a future machine that needs GitHub authentication:

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
```

Choose the GitHub account with write access to `david-ramosjames/texas-crash-data`. The workflow scope is for the included GitHub Actions workflow. Never paste the login code, access token, or password into a chat. After authentication, push from this checkout with:

```powershell
git -C "C:\Users\david\Documents\Codex\2026-09-01\rev\outputs\texas-crash-data" push -u origin main
```

Alternatively, grant the connected GitHub integration repository contents/workflow write access if those permissions are offered by its installation. App-level automatic-approval preferences are not a substitute for GitHub OAuth/installation permissions.
