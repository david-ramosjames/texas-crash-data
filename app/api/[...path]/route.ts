import { getUser, sameOrigin } from '@/lib/auth';
import { queueImport, enqueueDiscovery, retryJob, resumeImport } from '@/lib/jobs';
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
import { exportCSV, renderChart } from '@/lib/export';
import { zip } from '@/lib/zip';
import { aiInterpret, aiWrite } from '@/lib/ai';
import { requestFailure } from '@/lib/errors';
import { activity } from '@/lib/activity';
import { approveIdea, enqueueProposals, saveIdea } from '@/lib/ideas';
import { needsTimeRefresh } from '@/lib/research-quality';
import { importPlanner } from '@/lib/keyword-planner';
import { assertEditorialReady, composeEditorial, starterArticle } from '@/lib/editorial';
import { coverBytes, coverChoices, hydrateCover, queueCover, validateCover } from '@/lib/covers';
import { articleEntries, standaloneArticle } from '@/lib/editorial-package';
import { renderPublicationIndex } from '@/lib/publication-template';
import { renderInfographic } from '@/lib/infographic';
import { socialDesign, socialCaption, renderSocialCard } from '@/lib/social';
import { socialImage, socialEntries } from '@/lib/social-package';
import { BUILTIN_COVER, narrativeOnly } from '@/lib/editorial';
import { storeReference, referenceImage } from '@/lib/social-reference';
import type { ZipEntry } from '@/lib/zip';
const assertFreshTime = (e:any) => { if(needsTimeRefresh(e)) throw new Error('This hour-based evidence predates the AM/PM correction. Run fresh research before drafting or exporting.'); };
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
      if(area==='social-reference' && id) {
        const file=await referenceImage(id);
        return new Response(file.body,{headers:{'Content-Type':file.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
      }
      if (area === 'covers' && id) {
        const cover = await coverBytes(id);
        return new Response(cover.bytes, { headers: { 'Content-Type': cover.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options':'nosniff' } });
      }
      if (area === 'draft-covers' && id) {
        if (!await first('SELECT id FROM drafts WHERE id=?',id)) throw new Error('Draft not found.');
        return json(await coverChoices(id));
      }
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
        drafts.forEach(d=>assertFreshTime(d.evidence));
        if (!drafts.length)
          throw new Error(
            'Approve at least one page for this publication first.',
          );
        if (drafts.length > 100)
          throw new Error(
            'This export supports up to 100 pages per publication. Split a larger publication into export batches.',
          );
        const entries: ZipEntry[] = [];
        let packageBytes = 0;
        for (const d of drafts) {
          for (const entry of await articleEntries(d,domain)) {
            packageBytes += entry.bytes?.length ?? Buffer.byteLength(entry.text!);
            if (packageBytes > 150_000_000) throw new Error('Publication package exceeds 150 MB. Split it into smaller publications.');
            entries.push({ ...entry, name: d.slug + '/' + entry.name });
          }
        }
        entries.push({
          name: 'index.html',
          text: renderPublicationIndex(drafts, domain),
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
          text: `Publication: ${domain.name}\nDomain: ${domain.host}\nThis is a portable static research package, not a WordPress import or an automatic publishing connection. For an existing website, integrate the article folders using your site's publishing workflow; DO NOT overwrite its homepage, robots.txt or sitemap.xml. The included index is an optional research listing, not a replacement for your live homepage. Keep each article in its slug/index.html folder at the configured domain root so its canonical URL matches, or update canonical URLs if your CMS uses another path. Brand fonts use system fallbacks unless installed by the destination site. No DNS or live website changes were made by this export. Each article contains methods and links to TxDOT. Evidence JSON and aggregate CSV files accompany every page. Review the selected template, geographic labels and reporting completeness before deployment.\n`,
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
        assertFreshTime(draft.evidence);
        const domain = draft.domain_id
          ? await first<any>(
              'SELECT * FROM domains WHERE id=?',
              draft.domain_id,
            )
          : null;
        const format = url.searchParams.get('format') || 'html';
        if (draft.channel === 'social') {
          if(format==='html')throw new Error('Social drafts export as captions and images, not web pages. Use the Social post editor.');
          if(format==='zip')return new Response(zip(await socialEntries(draft,domain)),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${draft.slug}-social.zip"`,'Cache-Control':'no-store'}});
          if(format==='social-image'||format==='svg') {
            const svg=await socialImage(draft,domain,Number(url.searchParams.get('slide')||0));
            return new Response(svg,{headers:{'Content-Type':'image/svg+xml','Content-Disposition':`attachment; filename="${draft.slug}-social.svg"`,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; img-src data:; sandbox"}});
          }
          if(format==='txt')return new Response(socialCaption(draft),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${draft.slug}-caption.txt"`,'Cache-Control':'no-store'}});
        }
        if (!['html', 'csv', 'json', 'txt','svg','zip','infographic'].includes(format))
          throw new Error('Unsupported export format.');
        if (format === 'infographic') return new Response(renderInfographic(draft,domain), { headers: {'Content-Type':'image/svg+xml','Content-Disposition':`attachment; filename="${draft.slug}-infographic.svg"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"} });
        if (format === 'zip') return new Response(zip(await articleEntries(draft,domain)), { headers: {'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${draft.slug}.zip"`,'Cache-Control':'no-store'} });
        if (format === 'svg') return new Response(renderChart(draft,domain), { headers: {'Content-Type':'image/svg+xml','Content-Disposition':`attachment; filename="${draft.slug}-chart.svg"`,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"} });
        if (format === 'txt') assertEditorialReady(draft.body);
        const content =
          format === 'html'
            ? await standaloneArticle(draft, domain)
            : format === 'csv'
              ? exportCSV(draft)
              : format === 'json'
                ? JSON.stringify(draft.evidence, null, 2)
                : draft.title + '\n\n' + composeEditorial(draft.body,draft.evidence);
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
              "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          },
        });
      }
      if (area === 'activity') return json(await activity());
      if (area === 'bootstrap') {
        // Capture the revision first. A completion during bootstrap will then
        // cause the next activity poll to load the newer dashboard once.
        const status = await activity();
        const [s, findings, drafts, domains, settings] = await Promise.all([
          summary(undefined, { cachedOnly: true }),
          all<any>('SELECT * FROM findings ORDER BY score DESC'),
          all<any>('SELECT * FROM drafts ORDER BY updated DESC'),
          all<any>('SELECT * FROM domains ORDER BY name'),
          all<any>("SELECT * FROM settings WHERE key NOT IN ('summary_cache','summary_generation','summary_cached_generation')"),
        ]);
        return json({
          ...status,
          summary: s,
          findings: findings.map((x) => ({
            ...x,
            evidence: JSON.parse(x.evidence),
          })),
          drafts: await Promise.all(drafts.map((x) => hydrateCover({
            ...x,
            evidence: JSON.parse(x.evidence),
          }))),
          domains,
          settings: Object.fromEntries(settings.map((x) => [x.key, x.value])),
          ideas: (await all<any>('SELECT i.*,j.status job_status,j.error job_error FROM research_ideas i LEFT JOIN jobs j ON j.id=i.job_id ORDER BY i.created DESC')).map(i=>({...i,spec:JSON.parse(i.spec)})),
          timeRepairNeeded: !!await first("SELECT id FROM batches WHERE status='complete' AND time_parser_version<2 LIMIT 1"),
          ai: {
            connected: !!runtime().OPENAI_API_KEY && !!runtime().OPENAI_MODEL,
            model: runtime().OPENAI_MODEL || null,
            images: !!runtime().OPENAI_API_KEY,
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
      if(area==='social-reference' && id) {
        if(action==='remove'){await run('UPDATE drafts SET social_reference_id=NULL WHERE id=?',id);return json({removed:true});}
        return json(await storeReference(id,req));
      }
      if (area === 'draft-covers' && id) return json(await queueCover(id));
      if (area === 'article-template' && id) {
        const d = await first<any>('SELECT * FROM drafts WHERE id=?',id);
        if (!d) throw new Error('Draft not found.');
        const e = JSON.parse(d.evidence); assertFreshTime(e);
        return json({body: starterArticle(e,d.channel), notice:'New evidence-based article is unsaved. Review it before saving.'});
      }
      if(area==='ideas' && id==='keyword-planner'){const input=await body();return json(await importPlanner(input.text,input.context));}
      if(area==='ideas' && id==='propose') return json(await enqueueProposals());
      if(area==='ideas' && action==='approve') return json(await approveIdea(id,await body()));
      if(area==='ideas' && !id) {
        const input=await body();await saveIdea(input.question,input.spec,'Your question','Added for approval before research.');return json({saved:true});
      }
      if(area==='ideas' && action==='status') {
        const {status}=await body();if(!['suggested','dismissed'].includes(status))throw new Error('Invalid idea status.');
        await run("UPDATE research_ideas SET status=?,updated=now() WHERE id=? AND status IN ('suggested','dismissed')",status,id);return json({saved:true});
      }
      if (area === 'imports' && id && action === 'resume') return json(await resumeImport(id));
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
        const s = await summary(undefined, { cachedOnly: true });
        if (!s.ready) throw new Error('The worker needs to prepare the summary. Start or retry discovery in the Data library.');
        if (!s.crashes) throw new Error('Import your data first.');
        if (runtime().OPENAI_API_KEY)
          return json(await aiInterpret(question, s));
        const parsed = interpret(question, s);
        return json({ ...parsed, engine: 'Built-in language interpreter' });
      }
      if (area === 'ai-write') {
        const d = await first<any>('SELECT * FROM drafts WHERE id=?', id);
        if (!d) throw new Error('Draft not found.');
        assertFreshTime(JSON.parse(d.evidence));
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
        if(input.status==='approved') {const f=await first<any>('SELECT evidence FROM findings WHERE id=?',id);if(f)assertFreshTime(JSON.parse(f.evidence));}
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
        let publicationId: string | null = null;
        if (input.sourceDraftId) {
          const source=await first<any>('SELECT * FROM drafts WHERE id=?',input.sourceDraftId);
          if(!source || source.channel!=='page' || source.status!=='approved' || input.channel!=='social')throw new Error('Choose an approved page to create a social post.');
          evidence=JSON.parse(source.evidence);title=source.title;findingId=source.finding_id;publicationId=source.domain_id;
        } else if (input.findingId) {
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
        assertFreshTime(evidence);
        if (!evidence.total || !evidence.rows.length)
          throw new Error('There are no matching crashes to draft from.');
        if (!['page', 'newsletter', 'social'].includes(input.channel))
          throw new Error('Choose a content format.');
        const newId = crypto.randomUUID(),
          now = new Date().toISOString();
        await run(
          "INSERT INTO drafts(id,finding_id,title,slug,channel,domain_id,body,status,evidence,created,updated,social_json,cover_id) VALUES(?,?,?,?,?,?,?,'draft',?,?,?,?,?)",
          newId,
          findingId,
          title,
          input.channel==='social'?`${slugify(title).slice(0,90)}-social-${newId.slice(0,8)}`:slugify(title),
          input.channel,
          publicationId,
          input.channel==='social'?narrativeOnly(draftBody(evidence,title,input.channel)):draftBody(evidence, title, input.channel),
          JSON.stringify(evidence),
          now,
          now,
          input.channel==='social'?JSON.stringify(socialDesign(JSON.stringify({style:evidence.spec.cohort==='truck'?'photo':'statistic'}))):'{}',
          input.channel==='social'&&evidence.spec.cohort==='truck'?BUILTIN_COVER:null,
        );
        return json({ id: newId });
      }
      if (area === 'drafts' && id) {
        const input = await body();
        const old = await first<any>('SELECT * FROM drafts WHERE id=?', id);
        if (!old) throw new Error('Draft not found.');
        if(['approved','exported'].includes(input.status)) assertFreshTime(JSON.parse(old.evidence));
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
        if (['approved','exported'].includes(input.status)) assertEditorialReady(input.body);
        if (
          input.domain_id &&
          !(await first('SELECT id FROM domains WHERE id=?', input.domain_id))
        )
          throw new Error('Choose an existing publication.');
        const slug = old.channel==='social' ? `${slugify(input.slug || input.title).replace(/-social-[a-z0-9]+$/,'').slice(0,90)}-social-${id.slice(0,8)}` : slugify(input.slug || input.title);
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
        const design=old.channel==='social'?socialDesign(input.social_json??old.social_json):null;
        const selectedCover=await validateCover(input.cover_id === undefined ? old.cover_id : input.cover_id,id);
        if(old.channel==='social' && ['approved','exported'].includes(input.status)) {
          if(design!.style==='photo'&&!selectedCover)throw new Error('Select an illustration for the photo-led card, or choose Big statistic / Mini infographic before approval.');
          const socialDraft={...old,...input,social_json:JSON.stringify(design),evidence:JSON.parse(old.evidence)};
          const socialDomain=input.domain_id?await first<any>('SELECT * FROM domains WHERE id=?',input.domain_id):undefined;
          for(let i=0;i<(design!.carousel?3:1);i++)renderSocialCard(socialDraft,socialDomain,selectedCover?'data:image/png;base64,AA==':undefined,i);
        }
        await run(
          'UPDATE drafts SET title=?,slug=?,body=?,domain_id=?,status=?,updated=?,cover_id=?,social_json=? WHERE id=?',
          input.title.trim(),
          slug,
          old.channel==='social'?narrativeOnly(input.body):composeEditorial(input.body,JSON.parse(old.evidence)),
          input.domain_id || null,
          input.status,
          new Date().toISOString(),
          selectedCover,
          design?JSON.stringify(design):old.social_json||'{}',
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
