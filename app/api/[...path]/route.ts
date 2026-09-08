import { getUser, sameOrigin } from '@/lib/auth';
import { queueImport, enqueueDiscovery, retryJob } from '@/lib/jobs';
import { originalStream } from '@/lib/process-import';
import { all, first, run, runtime, bucket } from '@/lib/db';
import {
  summary,
  research,
  interpret,
  validateSpec,
  BASE,
} from '@/lib/research';
import { discover, draftBody } from '@/lib/discovery';
import {
  beginImport,
  storeRaw,
  storeRows,
  finishFile,
  activate,
} from '@/lib/importer';
import { slugify, FILE_TYPES } from '@/lib/contracts';
import { renderPage, exportCSV } from '@/lib/export';
import { escapeHTML } from '@/lib/export';
import { zip } from '@/lib/zip';
import { aiInterpret, aiWrite } from '@/lib/ai';
import { requestFailure } from '@/lib/errors';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function handler(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const user = await getUser();
    if (!user)
      return json({ error: 'Sign in to your private workspace.' }, 401);
    if (req.method !== 'GET' && !sameOrigin(req))
      return json({ error: 'Cross-origin writes are not allowed.' }, 403);
    const path = (await context.params).path;
    const [area, id, action] = path;
    const url = new URL(req.url);
    const body = async () => {
      if (!req.headers.get('content-type')?.includes('application/json'))
        throw new Error('Expected JSON.');
      if (Number(req.headers.get('content-length') || 0) > 1_000_000)
        throw new Error('Request body exceeds 1 MB.');
      const reader = req.body?.getReader();
      if (!reader) throw new Error('Request body required.');
      let size = 0,
        text = '';
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1_000_000) {
          await reader.cancel();
          throw new Error('Request body exceeds 1 MB.');
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    };
    if (req.method === 'GET') {
      if (area === 'imports' && action === 'parts') return json(await all('SELECT kind,part,sha256 FROM raw_parts WHERE batch_id=?',id));
      if (area === 'site-package') {
        const domain = await first<any>('SELECT * FROM domains WHERE id=?', id);
        if (!domain) throw new Error('Publication not found.');
        const drafts = (
          await all<any>(
            "SELECT * FROM drafts WHERE domain_id=? AND channel='page' AND status='approved' ORDER BY updated DESC",
            id,
          )
        ).map((d) => ({ ...d, evidence: JSON.parse(d.evidence) }));
        if (!drafts.length)
          throw new Error(
            'Approve at least one page for this publication first.',
          );
        if (drafts.length > 100)
          throw new Error(
            'This export supports up to 100 pages per publication. Split a larger publication into export batches.',
          );
        const entries = drafts.flatMap((d) => [
          { name: d.slug + '/index.html', text: renderPage(d, domain) },
          {
            name: d.slug + '/evidence.json',
            text: JSON.stringify(d.evidence, null, 2),
          },
          { name: d.slug + '/data.csv', text: exportCSV(d) },
        ]);
        entries.push({
          name: 'index.html',
          text: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(domain.name)}</title><link rel="canonical" href="https://${domain.host}/"><style>body{font:17px/1.7 system-ui;max-width:850px;margin:60px auto;padding:25px;color:#172c42}a{color:${domain.color}}li{margin:20px 0}h1{font-size:38px}</style></head><body><h1>${escapeHTML(domain.name)}</h1><p>Independent research using Texas Department of Transportation public crash data.</p><ul>${drafts.map((d) => `<li><a href="/${d.slug}/">${escapeHTML(d.title)}</a><br><small>Data: ${d.evidence.spec.start} – ${d.evidence.spec.end}</small></li>`).join('')}</ul></body></html>`,
        });
        entries.push({
          name: 'sitemap.xml',
          text: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${domain.host}/</loc></url>${drafts.map((d) => `<url><loc>https://${domain.host}/${d.slug}/</loc><lastmod>${d.updated.slice(0, 10)}</lastmod></url>`).join('')}</urlset>`,
        });
        entries.push({
          name: 'robots.txt',
          text: `User-agent: *\nAllow: /\nSitemap: https://${domain.host}/sitemap.xml\n`,
        });
        entries.push({
          name: 'README.txt',
          text: `Publication: ${domain.name}\nDomain: ${domain.host}\nUpload the contents of this archive to the web root of your static hosting account. Keep each page in its slug/index.html folder so canonical URLs match. Configure your own domain with your hosting provider. No DNS or live website changes were made by this export. Each article contains methods and links to TxDOT. Evidence JSON and aggregate CSV files accompany every page. Review geographic labels and reporting completeness before deployment.\n`,
        });
        const archive = zip(entries);
        return new Response(archive, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${domain.host}.zip"`,
            'Cache-Control': 'no-store',
          },
        });
      }
      if (area === 'export') {
        const draft = await first<any>('SELECT * FROM drafts WHERE id=?', id);
        if (!draft) throw new Error('Draft not found.');
        if (!['approved', 'exported'].includes(draft.status))
          throw new Error(
            'Approve this draft before exporting publication content.',
          );
        draft.evidence = JSON.parse(draft.evidence);
        const domain = draft.domain_id
          ? await first<any>(
              'SELECT * FROM domains WHERE id=?',
              draft.domain_id,
            )
          : null;
        const format = url.searchParams.get('format') || 'html';
        if (!['html', 'csv', 'json', 'txt'].includes(format))
          throw new Error('Unsupported export format.');
        const content =
          format === 'html'
            ? renderPage(draft, domain)
            : format === 'csv'
              ? exportCSV(draft)
              : format === 'json'
                ? JSON.stringify(draft.evidence, null, 2)
                : draft.title + '\n\n' + draft.body;
        return new Response(content, {
          headers: {
            'Content-Type':
              format === 'html'
                ? 'text/html; charset=utf-8'
                : format === 'csv'
                  ? 'text/csv; charset=utf-8'
                  : format === 'json'
                    ? 'application/json'
                    : 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${draft.slug}.${format}"`,
            'Cache-Control': 'no-store',
            'Content-Security-Policy':
              "default-src 'none'; style-src 'unsafe-inline'",
          },
        });
      }
      if (area === 'bootstrap') {
        const [s, findings, drafts, domains, settings] = await Promise.all([
          summary(),
          all<any>('SELECT * FROM findings ORDER BY score DESC'),
          all<any>('SELECT * FROM drafts ORDER BY updated DESC'),
          all<any>('SELECT * FROM domains ORDER BY name'),
          all<any>('SELECT * FROM settings'),
        ]);
        return json({
          jobs: await all('SELECT * FROM jobs ORDER BY created DESC LIMIT 40'),
          worker: await first('SELECT heartbeat,job_id,(heartbeat>now()-interval \'60 seconds\') online FROM worker_health ORDER BY heartbeat DESC LIMIT 1'),
          summary: s,
          findings: findings.map((x) => ({
            ...x,
            evidence: JSON.parse(x.evidence),
          })),
          drafts: drafts.map((x) => ({
            ...x,
            evidence: JSON.parse(x.evidence),
          })),
          domains,
          settings: Object.fromEntries(settings.map((x) => [x.key, x.value])),
          ai: {
            connected: !!runtime().OPENAI_API_KEY && !!runtime().OPENAI_MODEL,
            model: runtime().OPENAI_MODEL || null,
          },
          user: user.displayName,
        });
      }
      if (area === 'files')
        return json(
          await all('SELECT * FROM files WHERE batch_id=? ORDER BY kind', id),
        );
      if (area === 'download') {
        const kind = url.searchParams.get('kind');
        if (!FILE_TYPES.includes(kind as any))
          throw new Error('Invalid file type.');
        const f = await first<any>(
          'SELECT * FROM files WHERE batch_id=? AND kind=?',
          id,
          kind,
        );
        if (!f) throw new Error('File not found.');
        if (f.parts !== Math.ceil(Number(f.bytes)/(8*1024*1024))) throw new Error('Original file is still uploading.');
        const stream = await originalStream(id,kind!);
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${f.name}"`,
            'Cache-Control': 'no-store',
          },
        });
      }
      if (area === 'queries')
        return json(
          (
            await all<any>(
              'SELECT id,question,spec,created FROM queries ORDER BY created DESC LIMIT 30',
            )
          ).map((x) => ({ ...x, spec: JSON.parse(x.spec) })),
        );
      if (area === 'lookup')
        return json(
          await all(
            'SELECT DISTINCT "column",code,description FROM lookups WHERE "column"=? ORDER BY code LIMIT 1000',
            url.searchParams.get('column') || 'VEH_BODY_STYL_ID',
          ),
        );
    }
    if (req.method === 'POST') {
      if (area === 'jobs' && action === 'retry') return json(await retryJob(id));
      if (area === 'imports' && !id)
        return json(await beginImport(await body()));
      if (area === 'imports' && action === 'raw')
        return json(
          await storeRaw(
            id,
            url.searchParams.get('kind') || '',
            Number(url.searchParams.get('part')),
            req,
          ),
        );
      if (area === 'imports' && action === 'queue') return json(await queueImport(id));
      if (area === 'discover') {
        return json(await enqueueDiscovery());
      }
      if (area === 'interpret') {
        const { question } = await body();
        if (typeof question !== 'string' || question.length > 2000)
          throw new Error('Use a question of 2,000 characters or fewer.');
        const s = await summary();
        if (!s.crashes) throw new Error('Import your data first.');
        if (runtime().OPENAI_API_KEY)
          return json(await aiInterpret(question, s));
        const parsed = interpret(question, s);
        return json({ ...parsed, engine: 'Built-in language interpreter' });
      }
      if (area === 'ai-write') {
        const d = await first<any>('SELECT * FROM drafts WHERE id=?', id);
        if (!d) throw new Error('Draft not found.');
        const text = await aiWrite(JSON.parse(d.evidence), d.channel, d.title);
        return json({
          body: text,
          notice:
            'AI rewrite is unsaved and unapproved. Check every factual claim against the evidence.',
        });
      }
      if (area === 'research') {
        const input = await body();
        const spec = validateSpec(input.spec);
        const result = await research(spec);
        const id = crypto.randomUUID();
        await run(
          'INSERT INTO queries(id,question,spec,result,created) VALUES(?,?,?,?,?)',
          id,
          String(input.question || 'Research filters').slice(0, 2000),
          JSON.stringify(spec),
          JSON.stringify(result),
          new Date().toISOString(),
        );
        return json({ ...result, queryId: id });
      }
      if (area === 'findings') {
        const input = await body();
        if (!['new', 'approved', 'dismissed', 'review'].includes(input.status))
          throw new Error('Invalid finding status.');
        const result = await run(
          'UPDATE findings SET status=?,updated=? WHERE id=?',
          input.status,
          new Date().toISOString(),
          id,
        );
        if (!result.meta.changes) throw new Error('Finding not found.');
        return json({ saved: true });
      }
      if (area === 'drafts' && !id) {
        const input = await body();
        let evidence: any;
        let title: string;
        let findingId: string | null = null;
        if (input.findingId) {
          const f = await first<any>(
            'SELECT * FROM findings WHERE id=?',
            input.findingId,
          );
          if (!f) throw new Error('Finding not found.');
          evidence = JSON.parse(f.evidence);
          title = f.title;
          findingId = f.id;
        } else if (input.queryId) {
          const q = await first<any>(
            'SELECT * FROM queries WHERE id=?',
            input.queryId,
          );
          if (!q) throw new Error('Saved query not found.');
          evidence = JSON.parse(q.result);
          title = `Reported ${evidence.spec.cohort === 'all' ? '' : evidence.spec.cohort + '-involved '}crashes by ${evidence.spec.group}${evidence.spec.city ? ' in ' + evidence.spec.city : ''}: ${evidence.spec.start} to ${evidence.spec.end}`;
        } else
          throw new Error('Choose a finding or run a research query first.');
        if (!evidence.total || !evidence.rows.length)
          throw new Error('There are no matching crashes to draft from.');
        if (!['page', 'newsletter', 'social'].includes(input.channel))
          throw new Error('Choose a content format.');
        const newId = crypto.randomUUID(),
          now = new Date().toISOString();
        await run(
          "INSERT INTO drafts(id,finding_id,title,slug,channel,domain_id,body,status,evidence,created,updated) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)",
          newId,
          findingId,
          title,
          slugify(title),
          input.channel,
          null,
          draftBody(evidence, title, input.channel),
          JSON.stringify(evidence),
          now,
          now,
        );
        return json({ id: newId });
      }
      if (area === 'drafts' && id) {
        const input = await body();
        const old = await first<any>('SELECT * FROM drafts WHERE id=?', id);
        if (!old) throw new Error('Draft not found.');
        if (
          typeof input.title !== 'string' ||
          !input.title.trim() ||
          input.title.length > 250 ||
          typeof input.body !== 'string' ||
          input.body.length > 100000
        )
          throw new Error('A title and body are required.');
        if (!['draft', 'approved', 'exported'].includes(input.status))
          throw new Error('Invalid editorial state.');
        if (
          input.domain_id &&
          !(await first('SELECT id FROM domains WHERE id=?', input.domain_id))
        )
          throw new Error('Choose an existing publication.');
        const slug = slugify(input.slug || input.title);
        if (!slug) throw new Error('A valid page slug is required.');
        const duplicate = await first(
          'SELECT id FROM drafts WHERE domain_id IS NOT DISTINCT FROM ? AND slug=? AND id<>?',
          input.domain_id || null,
          slug,
          id,
        );
        if (duplicate)
          throw new Error(
            'Another draft uses this publication and slug. Choose a unique URL.',
          );
        await run(
          'UPDATE drafts SET title=?,slug=?,body=?,domain_id=?,status=?,updated=? WHERE id=?',
          input.title.trim(),
          slug,
          input.body,
          input.domain_id || null,
          input.status,
          new Date().toISOString(),
          id,
        );
        return json({ saved: true });
      }
      if (area === 'domains') {
        const input = await body();
        if (!input.name?.trim() || !input.host?.trim())
          throw new Error('Publication name and domain are required.');
        const host = String(input.host)
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '');
        if (
          !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(
            host,
          )
        )
          throw new Error('Enter a domain, such as example.com, with no path.');
        if (!/^#[0-9a-f]{6}$/i.test(input.color || ''))
          throw new Error('Use a six-digit brand color.');
        const newId = id || crypto.randomUUID();
        await run(
          'INSERT INTO domains(id,name,host,byline,color) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,byline=excluded.byline,color=excluded.color',
          newId,
          String(input.name).slice(0, 120),
          host,
          String(input.byline || 'Research team').slice(0, 160),
          input.color,
        );
        return json({ id: newId });
      }
    }
    return json({ error: 'Endpoint not found.' }, 404);
  } catch (error) {
    const failure = requestFailure(error);
    // Log only the validated code, never the raw error or request payload.
    console.error('Studio request failed.', { code: failure.code });
    return json(failure, 400);
  }
}
export const GET = handler;
export const POST = handler;
