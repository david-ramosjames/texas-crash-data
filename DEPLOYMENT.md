# Deployment: Supabase + Railway

This repository is the migrated application, not an already-provisioned cloud deployment. Create your Supabase project and two Railway services, enter the variables below, and run the verification checklist. Keep the existing Sites app available until you have verified this replacement. No DNS, existing Sites data, or account settings are changed by this repository.

## 1. Supabase

1. Create a project in a region close to your Railway services. Save the database password in your password manager.
2. From **Connect**, copy the PostgreSQL **session pooler** connection string (port **5432**), or the direct connection if your Railway network supports its IP family. Replace the password placeholder with a URL-encoded password. Do **not** use transaction pooling on port 6543: the worker uses session advisory locks.
3. Get your project URL, publishable key (legacy anon key also works), and server-side service-role/secret key from the project's API settings. The privileged storage key stays on the server; never place it in a `NEXT_PUBLIC_*` variable.
4. In Authentication, disable new user sign-ups. Create your own user with an email and password through the admin dashboard and mark the email confirmed. Add exactly that email to `STUDIO_ALLOWED_EMAILS`. Additional allowed editors share the same workspace and data.
5. In Authentication URL configuration, set the Site URL to your eventual Railway/custom HTTPS origin. Login uses email/password, not an email redirect callback. Use Supabase's admin controls to reset passwords when needed.
6. Keep `studio` out of the schemas exposed by the Supabase Data API. The migration creates the private schema, RLS-protected tables, indexes, and PostGIS. Database access runs server-side, using the database account in `DATABASE_URL` (the project owner connection works).
7. Run `npm run storage:setup` once with your environment configured, or create a **private** bucket named `txdot-originals` in the Storage dashboard. Do not add anonymous upload/read policies. The app stores originals in immutable 8 MiB chunks, so the bucket's per-object limit must be at least 8 MiB (the setup script uses 10 MiB).

Supabase database backups do not include Storage object contents. Arrange a separate backup of original files, and keep your downloaded TxDOT history locally. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).

## 2. Environment variables

In Railway, use shared variables referenced by both services where indicated. For local work, copy `.env.example` to ignored `.env.local`. Do not paste secrets into a chat or commit them to GitHub.

| Variable | Where | Value |
|---|---|---|
| `DATABASE_URL` | Web + worker | Supabase direct/session-pooler PostgreSQL URI, with URL-encoded database password. |
| `SUPABASE_URL` | Web + worker | Your project's `https://…supabase.co` URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Web + worker | Server-side Supabase service-role key or secret key, used only for private Storage. |
| `SUPABASE_STORAGE_BUCKET` | Web + worker | `txdot-originals` unless you choose another private bucket. |
| `SUPABASE_PUBLISHABLE_KEY` | Web | Project publishable key or legacy anon key, for login. |
| `STUDIO_ALLOWED_EMAILS` | Web | Your actual email; multiple editors separated by commas. Empty means nobody can access the studio. |
| `APP_URL` | Web | Exact public origin, e.g. `https://your-studio.up.railway.app`. No path. It protects writes against cross-site requests. Update if your domain changes. |
| `OPENAI_API_KEY` | Web + worker, optional | OpenAI project API key. Needed for AI interpretation, proposed research angles, and rewrites. |
| `OPENAI_MODEL` | Web + worker, optional | A model your API project can access that supports Responses API structured outputs. Set explicitly; the app does not silently choose a paid model. |
| `DB_POOL_MAX` | Web + worker, optional | Default `5` per process. Minimum `2`; account for both services against your Supabase connection limit. |
| `DATABASE_CA_CERT` | Web + worker, optional | Supabase root PEM certificate if needed by your connection. Escaped `\n` works. Certificate verification is never disabled. |

Railway supplies `PORT`; do not hard-code it. The app uses Node 22 and does not need build-time credentials or public Supabase variables. Both AI variables must be set together; leaving both blank retains deterministic discovery, research filters, and template drafting. OpenAI API usage is billed to your API project separately from your ChatGPT subscription.

Validate variable shapes without printing their contents:

```sh
npm run check:env
npm run check:env -- --worker
```

## 3. Railway: two services from this same repository

1. Connect `david-ramosjames/texas-crash-data` to a new Railway project.
2. Create the **web** service from the repository. Set its config file path to `/railway.web.toml` in service settings. It uses the Dockerfile, runs database migrations before deployment, starts the web server, and health-checks `/api/health`.
3. Create a second service from the same repository named **worker**. Set its config path to `/railway.worker.toml`. It runs the same image with `npm run worker`. Do not give it a public domain or HTTP health check. Leave serverless sleeping disabled for this always-on worker.
4. Add the appropriate variables above to each service. Both pre-deploy migration commands are safe: a separate advisory lock serializes them and migration checksums prevent accidental rewrites.
5. Create a public Railway domain for the web service, set `APP_URL` to that exact HTTPS origin, and redeploy. The sign-in screen can be publicly reachable; all data APIs require a verified allowed user.
6. Run `npm run storage:setup` locally with `.env.local`, or from a Railway shell with the service variables. Do this before uploading files.
7. Enable **Wait for CI** for GitHub auto-deploys. The included GitHub workflow checks both in-process PostgreSQL and native PostgreSQL/PostGIS, migration idempotency, TypeScript, and production compilation.

Start with one web instance and one worker. Jobs are deliberately serialized across workers to keep revisions and discovery consistent. Additional worker replicas provide standby capacity, not parallel ingest throughput. Measure the complete corpus before changing memory, database size, or concurrency; this is not a benchmarked unlimited-scale import service.

## 4. Smoke test before the historical load

- `GET /api/health` returns 200. This is process liveness, not proof of database/storage access.
- Incognito access to `/` redirects to sign-in; `/api/bootstrap` returns 401.
- Sign in as your allowed editor; an unlisted account must not gain access.
- Data library shows **Worker online**. If it does not, inspect worker deployment logs, database connectivity, and the session-pooler URL.
- Upload one small complete nine-file batch. Keep the tab open only until all original files are transferred. Close it while the worker processes, then reopen to verify completion and discovery.
- Download originals from **View files** and compare SHA-256 with local files.
- Re-select that batch: it must not duplicate crash counts. Interrupt/restart the worker during a second test import; it must resume without double counting.
- Run a truck intersection question and an exact-coordinate radius query. Check counts and sources. Do not describe reported street pairs as verified intersection geometry.
- Create a draft, edit, approve, and export. Unapproved drafts must not export. Open the static package locally and check canonical domain/slug before publishing.
- Set both OpenAI variables, then test one interpretation and one rewrite. Check the model's API permissions, billing, and spending limits. Model-generated text remains unapproved until a person reviews it.

## 5. Historical load and cutover

Upload the full history from your original files. The current importer supports original CSVs up to 2,000,000,000 bytes per file; select multiple complete batches together. It does not read `.xlsx` or nested ZIP files. Month coverage depends on the intervals actually supplied. Missing dates are not inferred from the filename of another batch.

The new database starts empty. **Existing Sites database records, drafts, approvals, and publication settings are not automatically copied.** Re-import the original data and export/save any editorial work you need from the old studio before retiring it. Do not retire the old app until counts, originals, editorial content, login, and exports have been checked. This repository does not shut it down.

Once verified, bookmark the Railway URL or attach your custom studio domain. Public content sites are separate: publish only approved exports to their intended domains. Reusing the same article across many domains is not a substitute for useful, differentiated content.

## 6. OpenAI Developers plugin (optional setup helper)

1. Open the **Plugins** tab in the desktop app.
2. Search for **OpenAI Developers**, open it, and select the install/plus button.
3. Complete the OpenAI Platform connection prompts.
4. Start a new chat/task after installation, then ask: `@OpenAI Developers Create an OpenAI API key for my Texas crash studio project.` Review the proposed project and secret destination before approving.
5. Configure that project's key as `OPENAI_API_KEY` in Railway and set `OPENAI_MODEL` on both services. Installing a plugin does not automatically configure Railway variables.

If the plugin is not offered to your account, create a project API key directly in [OpenAI Platform](https://platform.openai.com/api-keys). The deployed app uses the API directly and does not depend on Codex or a plugin being open.

Official instructions: [OpenAI Developers plugin](https://developers.openai.com/learn/developers-codex-plugin), [plugin installation](https://learn.chatgpt.com/docs/plugins), [Railway config as code](https://docs.railway.com/reference/config-as-code), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Operations

- Import recovery: use **Resume import** on an incomplete Source batch or in its **View files** panel. Fully stored originals are queued without another upload; failed jobs retain verified checkpoints when retried. An unfinished upload prompts for the same nine original CSV files, then **Resume selected batch**. Running/queued jobs are never restarted by this action. File details refresh every 10 seconds. The separate legacy `chatgpt.site` preview is not updated by this GitHub repository and its data is not automatically copied to Railway.
- Failed jobs retry with backoff up to five attempts. Fix resource/configuration/data issues, then use **Retry job** in the private Activity inbox. Retrying does not discard verified row checkpoints or original objects.
- A malformed batch remains inactive. Preserve it for audit and get corrected original files/newer extraction from TxDOT. There is deliberately no one-click destructive purge.
- Check Supabase storage/database quotas and OpenAI spend regularly. Do not run automatic discovery without an intentional API spending limit.
- Back up PostgreSQL and private Storage separately. Test restoration into staging. GitHub contains source code, not your data backup.
- Rotate any exposed credentials in their owning service and update both Railway services. Keep staging and production projects/keys separate.
- Roll back code through Railway/GitHub if needed. Database migrations are forward-only; do not delete migrations or run destructive rollback SQL against production.
- The repository is public as requested at the supplied destination; the app data stays private. Never commit source data or `.env.local`, even if you later change repository visibility.
