# Texas Crash Intelligence

A private research and editorial studio for TxDOT public crash extracts. Upload original files, discover evidence-backed story ideas, ask research questions, approve drafts, and export branded pages, newsletters, or social copy.

**Stack:** Next.js / React on Railway, PostgreSQL + PostGIS / Auth / private Storage on Supabase. A separate Railway worker processes imports and discovery without an open browser.

## Deploy

Follow **[DEPLOYMENT.md](DEPLOYMENT.md)** for the exact environment variables, Supabase setup, two Railway services, verification, and cutover checklist. **[.env.example](.env.example)** is the configuration template. No OpenAI plugin is required at runtime.

```sh
npm ci
# Copy .env.example to .env.local and fill in your own values.
npm run check:env
npm run db:migrate
npm run storage:setup
npm run dev
# In a second terminal:
npm run worker
```

## How to use it

1. Sign in with a Supabase email/password account created by your administrator. Its email must also be in `STUDIO_ALLOWED_EMAILS`.
2. In **Data library**, choose a folder or all original CSVs. Several complete extraction batches can be selected together. Unzip downloads first. Each batch must have all nine file types and retain its TxDOT filenames.
3. Keep the tab open until file transfer finishes. Then close it if you want: the worker validates and activates each complete batch, then scans the available history. Re-select identical files to resume an interrupted transfer.
4. Check the persistent **Activity inbox** for progress, failures, retries, and discovery results. The worker status detects missing/stopped workers. This is an in-app notification inbox, not an email delivery integration.

### Diagnosing a failed discovery scan

The inbox shows the job ID, attempt count, updated time, and current question/query stage. **Last failure** stays visible through automatic retries and manual **Retry job**; a successful job clears it. After five attempts the job needs an explicit retry. Deploying a new version does not reset exhausted attempts or re-import completed batches.

The Railway **worker** logs `Research job failed.` with `jobId`, `kind`, `attempt`, `phase`, and a safe `code` before trying to save the error. If the database also rejects that write, the original failure code remains in the logs. Driver messages, SQL, credentials, and row contents are not logged. For example, `57014` means a query was cancelled or timed out; `25006` means read-only; `53100` means disk full; `53200` means database memory exhausted. Inspect the actual code and stage before changing resources or timeouts.

This diagnostic update needs no migration or new environment variables. Deploy the updated code to **both** the web and worker services, refresh Data library, and use **Retry job** if the discovery job is failed. Imported data and verified checkpoints are preserved.
5. Review **Discover** findings, or ask in **Research**. English questions produce an explicit filter plan for review before execution. AI cannot run arbitrary SQL. Unsupported filters are rejected rather than silently invented.
6. Create a page, newsletter, or social draft. Edit, verify the evidence, and approve. Public exports require approval. Configure each publication's domain, brand, and byline. Download its static-site ZIP and deploy it on your chosen host; the studio does not change DNS or automatically publish.

## Data safeguards

- Original file chunks live in a private Supabase bucket, addressed by SHA-256. They never ship in the app or GitHub repository. Worker reads verify checksums.
- Server-side CSV parsing, 500-row checkpoints, transaction-protected writes, bounded-memory streaming, and automatic retries. An interrupted file is reread to verify checkpoints; completed files are skipped. This favors integrity over fastest possible restart.
- Staging stays invisible until all nine files validate. Newer extraction timestamps win per Crash_ID; upload order does not. Conflicting same-timestamp crash or unit snapshots are rejected.
- PostgreSQL foreign keys, SQL parameter binding, unique keys, and a single worker session lock protect joins and job ownership. If the worker loses that database session, its subsequent writes fail. Another worker can resume the job when the lock is released.
- The worker prioritizes imports over queued scans so a large initial upload can be scanned together. A scan does not publish or approve anything.
- All application tables are in the unexposed `studio` schema, with RLS enabled and no anonymous/authenticated Data API grants. Only server-side database credentials access it, after a verified login and explicit email allowlist. This is one shared editorial workspace, not a multi-tenant SaaS.
- Crash, unit, and lookup fields power the current research filters. The other six original files are validated for parent Crash_IDs and preserved intact, not fully indexed into person/charge-level research tables.
- PostGIS provides indexed geographic points. Existing intersection rankings still use reported street pairs, not a verified road-network intersection dataset.
- Counts are not traffic-exposure-adjusted risk or findings of legal fault. Partial intervals, small samples, overlapping vehicle categories, and exploratory comparisons are disclosed with each result. No participant identification or VIN-to-owner feature exists.

## Development and verification

```sh
npm test
npm run typecheck
npm run build
```

Tests exercise a real PostgreSQL engine in-process (PGlite) with synthetic data; CI additionally checks migrations and PostGIS on PostgreSQL/PostGIS. No real crash data is needed in CI. Full multi-year capacity, live Supabase credentials, and live OpenAI model access must be verified in your staging environment before cutover.

## Project map

- `app/`, `components/`: authenticated workspace, login, APIs, evidence and editorial UI.
- `lib/research.ts`: allowed query compiler, coverage rules, evidence snapshots.
- `lib/importer.ts`, `lib/process-import.ts`: original-file ingestion and revision activation.
- `lib/jobs.ts`, `scripts/worker.ts`: durable jobs, retries, worker ownership and heartbeats.
- `migrations/`: versioned, checksum-verified PostgreSQL migrations including PostGIS.
- `lib/ai.ts`: server-only OpenAI Responses API integration; aggregate data only, `store:false`.

The original Sites deployment is separate and remains unchanged. This repository intentionally starts with sanitized source history and does not contain the original starter CSVs, Sites credentials, database snapshots, or a copy of existing hosted editorial records.
