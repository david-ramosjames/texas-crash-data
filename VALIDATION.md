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

Not yet verified: real Supabase login/storage/PostGIS connectivity, Railway cloud deployment, full 2020–present corpus performance, or live OpenAI calls. These need your cloud configuration. Existing Sites data and editorial records have not been moved.

## GitHub handoff blocker

The destination was confirmed empty and public. Local Git had no usable credentials. The connected GitHub integration could read repository metadata but its attempted initial file write was rejected with HTTP 403, `Resource not accessible by integration`. No remote content was created by that attempt. The migration is committed in this local checkout.

To authorize a normal Git push, sign in from your own terminal:

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
```

Choose the GitHub account with write access to `david-ramosjames/texas-crash-data`. The workflow scope is for the included GitHub Actions workflow. Never paste the login code, access token, or password into a chat. After authentication, Codex can complete the push and inspect CI, or you can run:

```powershell
git -C "C:\Users\david\Documents\Codex\2026-09-01\rev\outputs\texas-crash-data" push -u origin main
```

Alternatively, grant the connected GitHub integration repository contents/workflow write access if those permissions are offered by its installation. App-level automatic-approval preferences are not a substitute for GitHub OAuth/installation permissions.
