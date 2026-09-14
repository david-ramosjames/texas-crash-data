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
5. Review **Discover** findings, or ask in **Research**. English questions produce an explicit filter plan for review before execution. AI cannot run arbitrary SQL. Unsupported filters are rejected rather than silently invented.
6. Create a page, newsletter, or social draft. Edit, verify the evidence, and approve. Public exports require approval. Configure each publication's domain, brand, and byline. Download its static-site ZIP and deploy it on your chosen host; the studio does not change DNS or automatically publish.

### Diagnosing a failed discovery scan

The inbox shows the job ID, attempt count, updated time, and current question/query stage. **Last failure** stays visible through automatic retries and manual **Retry job**; a successful job clears it. After five attempts the job needs an explicit retry. Deploying a new version does not reset exhausted attempts or re-import completed batches.

The Railway **worker** logs `Research job failed.` with `jobId`, `kind`, `attempt`, `phase`, and a safe `code` before trying to save the error. If the database also rejects that write, the original failure code remains in the logs. Driver messages, SQL, credentials, and row contents are not logged. For example, `57014` means a query was cancelled or timed out; `25006` means read-only; `53100` means disk full; `53200` means database memory exhausted. Inspect the actual code and stage before changing resources or timeouts.

Deploy the updated code to **both** the web and worker services, with `npm run db:migrate` in the pre-deploy commands. Refresh Data library and use **Retry job** if the discovery job is failed. Imported data and verified checkpoints are preserved.

### Summary cache and low-load polling

The visible studio polls `/api/activity` about every 10 seconds **after the preceding request finishes**. This endpoint reads jobs, worker health, source-batch status, and small revision markers—not crash records or finding/draft evidence. Dashboard reloads are coalesced and happen after explicit actions or a data/scan revision change. Hidden tabs skip polling.

Dashboard and language-interpreter requests only read saved summary totals. Discovery builds a missing summary on the worker using indexed pages of at most 10,000 active crash IDs, with a visible counted-record checkpoint. This is progress reporting, not a resumable summary checkpoint: an interrupted unfinished build starts again; an already saved valid summary is reused. The worker still reads the active history once to build a new summary. This does not eliminate the I/O cost of imports or discovery queries.

Totals and city names are stored privately in `studio.settings`. Activation changes a generation marker in the same transaction as switching active crash revisions. Old totals are withheld until rebuilt; a build interrupted by a generation change is never published. No estimates or partial counts are shown as final statistics.

For an existing installation, deploy **both web and worker**, refresh the studio, and **Retry job** on the failed discovery scan. Until it prepares the first cache, the studio shows **Summary needs preparation**, with Data library and job controls still available. New imports automatically queue discovery to refresh the summary. No re-upload, timeout increase, environment variable, or infrastructure purchase is required. Exhausted disk I/O or later expensive discovery queries can still require additional tuning or compute capacity; this update does not guarantee completion on every instance size.

### Resumable discovery questions

Migration `004_discovery_checkpoints.sql` adds a private, RLS-protected checkpoint table. Railway's existing pre-deploy `npm run db:migrate` applies it before the new worker starts. If you do not use those pre-deploy commands, run the migration command before starting the updated worker.

Completed analysis results and completed questions (including questions with no qualifying finding) are recorded by job ID, imported-data generation, algorithm version, and exact query inputs. Finding writes and their completion marker commit together. Automatic and manual retries reuse these checkpoints without repeating completed queries or overwriting later editorial decisions. A new scan, new imported-data generation, or algorithm-version change does not reuse an incompatible checkpoint. Successful completion still requires all planned deterministic and comparison queries; SQL failures in AI-proposed questions also fail the job. Failure of the optional idea-proposal service itself is reported separately as AI assistance unavailable.

The first run after upgrading cannot reuse work from the older version, because it never wrote these checkpoints. Use **Retry job** to continue the same failed job; **Scan for findings** starts a new scan and therefore does not reuse another job's checkpoints. Progress labels show **Already complete** or **Reusing verified result** during a retry. Counts in the final result include completed work from earlier attempts.

Body-style rankings use a batch-specific lookup join instead of a per-vehicle correlated subquery. The lookup's primary key keeps that join one-to-one. Distinct-crash counting by displayed label, missing-code behavior, vehicle filters, and source-specific descriptions are preserved. This is a query optimization, not a change to the definition of a truck or to reported crash counts.

### City/pedestrian timeouts and within-question recovery

Migrations `005_city_research.index.json` and `006_unit_kind_research.index.json` add btree indexes for `upper(city), date` and `kind, batch_id, crash_id`. The migration runner builds each index concurrently, outside a transaction, with a migration-only 30-minute statement limit and 15-second lock limit. Normal research retains its existing timeout. Concurrent builds permit normal writes but still consume disk space and I/O; postpone additional imports until deployment finishes. See [PostgreSQL concurrent-index guidance](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

Both services can run the migration command: a session lock serializes migrations (up to 65 minutes waiting for the other deploy). Successful indexes are verified before the migration is recorded. Retrying an interrupted migration reuses a matching valid index or rebuilds only a matching invalid index left by the interrupted build. Conflicting definitions fail safely. Previously applied SQL migrations and checksums remain unchanged.

Discovery now saves ranking, matching totals, and source coverage separately. A timeout during counting no longer discards a completed ranking; failure during source coverage preserves both ranking and totals. Existing complete-question checkpoints remain compatible. Failed stages are never saved as successful, and exact counts and editorial decisions are unchanged.

After both Railway services finish deploying and the index migrations show **Applied**, use **Retry job** on the existing failed scan. Do not start a new scan or re-upload files to resume it. No new environment variables are needed. These changes reduce repeat work and provide matching access paths; they do not guarantee a particular runtime on an I/O-throttled instance. If a migration or scan still times out, retain its phase/code for diagnosis rather than repeatedly restarting it.

## Research ideas and AM/PM correction (migration 007)

Deploy both Railway services with the existing pre-deploy command `npm run db:migrate`. No new environment variables or original-file uploads are required. Keep the web start command and worker start command separate.

- The worker automatically queues **Correct AM/PM hours from archived originals** for legacy imports. This reads checksum-verified crash originals and updates only changed hour values in 500-row transactions, with resumable progress. It consumes Storage reads and database I/O; allow it to finish before adding large imports. A terminal failure has a named Retry job action. It does not delete originals or change crash counts.
- Hour-based queries are blocked until correction completes. Old hour-based findings/drafts are visibly marked and blocked from approval, AI writing and publication exports. After repair, use **Scan for findings** or re-run selected research to regenerate evidence. The correction does not automatically launch an expensive full-history scan.
- **Ideas to research** is separate from verified Discover findings. Suggest more ideas prepares editorial templates, measured-keyword topic candidates and optional AI hypotheses from cached coverage. Suggestions do not execute crash queries. Review the exact dates/filters, then approve an individual research job. Duplicate approval and worker replay do not duplicate findings.
- Finding cards show their period. Research supports matched year-over-year or previous equal-length-period comparisons. Both source intervals must be loaded. Absent ranked groups are not assumed zero. The extra filters expose exact road/weather/light/model/first-factor labels, rural flag, hour, posted-speed-limit and vehicle-model-year ranges. These are not every CSV column.
- Keyword Planner was inspected on 2026-09-14 with Texas / English / Google / September 2025–August 2026. This account showed ranges, not exact counts. Checked topic signals are included with provenance; no campaign or billing changes were made. These figures are not search volume for a generated question, not SEO difficulty, and not LLM prompt volume. Close variants must not be summed as independent demand.
- The Planner export importer accepts up to 500 English-export CSV/TSV rows under 750 KB, including UTF-16 exports. Record geography, language, network and date range. Unsupported legal/live-incident/participant-identification and certain unmapped research intents are skipped. Review mapped filters before approval. The app is not continuously connected to your Google Ads account.
- Impairment and distraction topic opportunities are shown as **field-expansion backlog**, not automatically executed using an incomplete first-factor proxy.

Your existing 2022-onward history is sufficient to use these features; no 2020–2021 load is required. Supabase Storage holds originals while research reads private PostgreSQL tables under schema **studio**, not **public**. Person, primary-person, charges, damages, endorsements and restrictions are currently validated/archived, not fully indexed as research tables.

## Body-type discovery recovery

Body-type analysis now traverses current crash IDs in pages of at most 2,000 before joining vehicle and lookup records. Each successful page saves its group counts, crash totals, source batch IDs, and next cursor through the existing discovery checkpoints. Retries reuse saved pages; the first 23 completed questions remain compatible. Final minimum counts and top-N limits apply only after all pages are combined. Multiple vehicles or body codes with the same label still count once per crash, and superseded crash versions remain excluded.

After the worker deploys, use **Retry job** on the existing failed discovery job. No migration, environment change, re-upload, or checkpoint reset is required. Progress shows **Body types · page N · X crashes checked**. Bounded work reduces the size of each query but does not eliminate database I/O limits or guarantee production runtime. Non-body research is unchanged.

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
