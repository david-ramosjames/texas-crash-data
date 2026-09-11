'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Database,
  FileText,
  FlaskConical,
  Inbox,
  LockKeyhole,
  Radar,
  Sparkles,
  Upload,
  RefreshCw,
  Search,
  Check,
  X,
  Globe,
  Settings2,
  Download,
  FolderUp,
  ShieldCheck,
  ArrowLeft,
  Save,
  Eye,
  Plus,
  ExternalLink,
  ChevronRight,
  LoaderCircle,
  BookOpen,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Choice } from './choice';
import { Bars, EvidencePanel, download } from './evidence';
import {
  COHORTS,
  GROUPS,
  Spec,
  Evidence,
  Finding,
  Draft,
  Domain,
  number,
  titleCase,
  slugify,
} from '@/lib/contracts';
import { uploadFiles, UploadProgress, validateResumeSelection } from '@/lib/upload';
import { ImportRecovery, type RecoveryBatch } from '@/components/import-recovery';
import { identify } from '@/lib/csv';
import { renderPage } from '@/lib/export';

async function api(path: string, body?: unknown, raw?: Blob) {
  const response = await fetch('/api/' + path, {
    method: body !== undefined || raw ? 'POST' : 'GET',
    headers: raw
      ? { 'Content-Type': 'application/octet-stream' }
      : body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {},
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server did not return a result. Please try again.');
  }
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
const NAV = [
  { key: 'discover', label: 'Discover', icon: Inbox },
  { key: 'research', label: 'Research', icon: FlaskConical },
  { key: 'editorial', label: 'Editorial', icon: FileText },
  { key: 'data', label: 'Data library', icon: Database },
  { key: 'publications', label: 'Publications', icon: Globe },
  { key: 'settings', label: 'How it works', icon: BookOpen },
];
const defaultSpec: Spec = {
  cohort: 'all',
  group: 'city',
  metric: 'crashes',
  start: '2024-12-10',
  end: '2024-12-31',
  min: 5,
  limit: 15,
};
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Empty className="empty-panel">
      <EmptyHeader>
        <Radar size={28} />
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
export default function Studio() {
  const [view, setView] = useState('discover'),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState('');
  const [question, setQuestion] = useState(''),
    [spec, setSpec] = useState<Spec>(defaultSpec),
    [interpretation, setInterpretation] = useState<string[]>([]),
    [result, setResult] = useState<(Evidence & { queryId: string }) | null>(
      null,
    );
  const [filter, setFilter] = useState('new'),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<Finding | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [editTab, setEditTab] = useState('write');
  const [files, setFiles] = useState<File[]>([]),
    [resumeBatch, setResumeBatch] = useState<RecoveryBatch | null>(null),
    [progress, setProgress] = useState<UploadProgress | null>(null),
    [fileDetails, setFileDetails] = useState<any[]>([]),
    [batchDetails, setBatchDetails] = useState<string | null>(null),
    [domain, setDomain] = useState<Domain>({
      id: '',
      name: '',
      host: '',
      byline: 'Research team',
      color: '#245bda',
    });
  const fileInput = useRef<HTMLInputElement>(null),
    uploadPanel = useRef<HTMLElement>(null),
    activityPanel = useRef<HTMLElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    uploadAbort = useRef<AbortController | null>(null),
    initial = useRef(true);
  const refresh = useCallback(async () => {
    const next = await api('bootstrap');
    setData(next);
    if (initial.current && next.summary.start) {
      setSpec({
        ...defaultSpec,
        start: next.summary.start,
        end: next.summary.end,
      });
      initial.current = false;
    }
    return next;
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const hash = () => {
      const key = window.location.hash.slice(1);
      if (NAV.some((n) => n.key === key)) setView(key);
    };
    hash();
    window.addEventListener('hashchange', hash);
    return () => window.removeEventListener('hashchange', hash);
  }, [refresh]);
  const navigate = (key: string) => {
    setView(key);
    window.history.replaceState(null, '', '#' + key);
    setError('');
  };
  const action = async (label: string, fn: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy('');
    }
  };
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirty || busy === 'Importing') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);
  const runResearch = async (s = spec) => {
    const r = await api('research', { spec: s, question });
    setResult(r);
    return r;
  };
  const ask = () =>
    action('Interpreting', async () => {
      const p = await api('interpret', { question });
      setSpec(p.spec);
      setInterpretation([p.engine, ...p.notes]);
      setResult(null);
      navigate('research');
      setNotice('Check the interpreted filters, then run the research.');
    });
  const scan = () =>
    action('Scanning', async () => {
      const r = await api('discover', {});
      await refresh();
      setNotice(
        `Discovery ${r.status === 'running' ? 'is running' : 'is queued'}. You can close this tab. Check the activity inbox in Data library for results.`,
      );
    });
  const changeFinding = (f: Finding, status: string) =>
    action('Saving', async () => {
      await api('findings/' + f.id, { status });
      await refresh();
      setSelected((old) => (old?.id === f.id ? { ...old, status } : old));
      setNotice(
        status === 'approved'
          ? 'Finding approved for development.'
          : status === 'dismissed'
            ? 'Finding dismissed. You can restore it from Dismissed.'
            : 'Finding restored.',
      );
    });
  const createDraft = (channel: string, f?: Finding) =>
    action('Drafting', async () => {
      if (dirty)
        throw new Error(
          'Save the open editorial draft before creating another.',
        );
      const r = await api('drafts', {
        ...(f
          ? { findingId: f.id }
          : {
              queryId: result?.queryId,
              title: question || 'Texas crash research',
            }),
        channel,
      });
      const next = await refresh();
      setDraft(next.drafts.find((d: Draft) => d.id === r.id));
      setDirty(false);
      setSelected(null);
      setEditTab('write');
      navigate('editorial');
    });
  const saveDraft = (status: string) =>
    action('Saving', async () => {
      if (!draft) return;
      await api('drafts/' + draft.id, { ...draft, status });
      const next = await refresh();
      setDraft(next.drafts.find((d: Draft) => d.id === draft.id));
      setDirty(false);
      setNotice(
        status === 'approved'
          ? 'Approved. Your export files are ready; nothing has been published.'
          : 'Draft saved.',
      );
    });
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch, status: 'draft' } : d));
    setDirty(true);
  };
  const chooseFiles = (incoming: File[]) => {
    setError('');
    setFiles([]);
    try {
      const csv = incoming.filter((f) => f.name.toLowerCase().endsWith('.csv'));
      csv.forEach((f) => identify(f.name));
      if (!csv.length)
        throw new Error(
          'Choose the original CSV files. Unzip any downloaded archives first.',
        );
      if (resumeBatch) validateResumeSelection(csv, resumeBatch.id);
      setFiles(csv);
      setProgress(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const importNow = () =>
    action('Importing', async () => {
      if (resumeBatch) validateResumeSelection(files, resumeBatch.id);
      uploadAbort.current = new AbortController();
      let reports;
      try { reports = await uploadFiles(
        files,
        api,
        setProgress,
        uploadAbort.current.signal,
      ); } catch (error) {
        await refresh().catch(() => {});
        throw error;
      }
      await refresh();
      setFiles([]);
      setResumeBatch(null);
      setNotice(
        reports.some((report:any) => report.status === 'failed')
          ? 'Some batches previously failed processing. Use Resume import on those batch rows; selecting files alone does not retry a failed job.'
          : `${reports.length} batch(es) stored or already submitted. Processing and discovery continue in the background. Check the activity inbox below; it is safe to close this tab.`,
      );
    });
  const showActivity = () => {
    setBatchDetails(null);
    activityPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const resumeImport = (batch: RecoveryBatch) => action('Resuming import', async () => {
    setBatchDetails(null);
    const result = await api(`imports/${batch.id}/resume`, {});
    await refresh();
    if (result.status === 'needs_files') {
      setResumeBatch(batch); setFiles([]); setProgress(null);
      setNotice('Select the same nine original files below, then click Resume selected batch. Stored chunks will be checked and reused.');
      uploadPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setNotice(result.status === 'complete' ? 'This batch is already complete. Nothing was duplicated.'
        : 'Import queued or already running. No files need to be uploaded again. The worker will continue from saved checkpoints.');
      showActivity();
    }
  });
  useEffect(() => {
    if (!batchDetails) return;
    let cancelled = false;
    const update = () => api('files/' + batchDetails).then(rows => { if (!cancelled) setFileDetails(rows); }).catch(() => {});
    update();
    const timer = setInterval(update, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [batchDetails]);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh().catch(() => {}); }, 10000);
    return () => clearInterval(timer);
  }, [!!data, refresh]);
  const registerRef = useRef({ runResearch, navigate, setQuestion, setSpec });
  registerRef.current = { runResearch, navigate, setQuestion, setSpec };
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'run_crash_research',
          title: 'Run crash research',
          description:
            'Run an aggregate crash query using the same validated filters as Research; saves query history and displays results. Does not publish or identify participants.',
          inputSchema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  cohort: { type: 'string', enum: Object.keys(COHORTS) },
                  group: { type: 'string', enum: Object.keys(GROUPS) },
                  metric: {
                    type: 'string',
                    enum: ['crashes', 'severe', 'fatal'],
                  },
                  start: { type: 'string' },
                  end: { type: 'string' },
                  min: { type: 'integer' },
                  limit: { type: 'integer' },
                  city: { type: 'string' },
                  county: { type: 'string' },
                  make: { type: 'string' },
                  color: { type: 'string' },
                },
                required: [
                  'cohort',
                  'group',
                  'metric',
                  'start',
                  'end',
                  'min',
                  'limit',
                ],
                additionalProperties: false,
              },
            },
            required: ['spec'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input: any) {
            if (!input?.spec || typeof input.spec !== 'object')
              throw new Error('A valid spec is required.');
            const r = await registerRef.current.runResearch(input.spec);
            registerRef.current.setSpec(r.spec);
            registerRef.current.navigate('research');
            return {
              total: r.total,
              rows: r.rows,
              queryId: r.queryId,
              warnings: r.warnings,
            };
          },
        },
        { signal: life.signal },
      ),
    ).catch(() => {});
    return () => life.abort();
  }, []);
  const s = data?.summary,
    detailBatch = s?.batches.find((batch: RecoveryBatch) => batch.id === batchDetails),
    findings: Finding[] = data?.findings || [],
    drafts: Draft[] = data?.drafts || [],
    domains: Domain[] = data?.domains || [];
  const visible = findings.filter(
    (f) =>
      (filter === 'all' ||
        (filter === 'new' && ['new', 'review'].includes(f.status)) ||
        f.status === filter) &&
      (!search ||
        `${f.title} ${f.category}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const pending = findings.filter((f) =>
    ['new', 'review'].includes(f.status),
  ).length;
  return (
    <SidebarProvider>
      <Sidebar className="studio-sidebar">
        <SidebarHeader>
          <div className="brand">
            <Radar />
            <div>
              CRASH<span>INTELLIGENCE / TEXAS</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-label">RESEARCH STUDIO</p>
          <SidebarMenu>
            {NAV.map((n) => (
              <SidebarMenuItem key={n.key}>
                <SidebarMenuButton
                  isActive={view === n.key}
                  onClick={() => navigate(n.key)}
                >
                  <n.icon />
                  <span>{n.label}</span>
                  {n.key === 'discover' && pending > 0 && (
                    <span className="nav-count">{pending}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-tip">
            <Sparkles size={18} />
            <p>Let the data bring you the next story.</p>
            <span>Import monthly. Discover continuously.</span>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <Button variant="ghost" onClick={async () => { if (dirty && !window.confirm('Leave without saving your draft?')) return; await fetch('/auth/logout',{method:'POST'}); window.location.assign('/login'); }}>Sign out</Button>
          <div className="private-note">
            <LockKeyhole size={15} /> Private workspace
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div>
            <SidebarTrigger /> Research studio{' '}
            <span>/ {NAV.find((n) => n.key === view)?.label}</span>
          </div>
          <span className="status-dot">
            {data?.ai.connected ? 'AI connected' : 'Evidence engine ready'}
          </span>
        </header>
        <main className="workspace">
          {error && (
            <div className="message error" role="alert">
              <X size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <Check size={17} />
              <span>{notice}</span>
              <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {busy && (
            <div className="working" role="status">
              <LoaderCircle className="spin" size={16} />
              {busy}…
            </div>
          )}
          {!data ? (
            <div className="loading-layout">
              <Skeleton className="h-12 w-80" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-64 w-full" />
              {error && (
                <Button
                  onClick={() =>
                    action('Loading', async () => {
                      await refresh();
                    })
                  }
                >
                  Retry
                </Button>
              )}
            </div>
          ) : (
            <>
              {view === 'discover' && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">YOUR RESEARCH DESK</p>
                      <h1>Find the story in the data.</h1>
                      <p>
                        Explore the evidence. Choose what deserves an audience.
                      </p>
                    </div>
                    <Button variant="outline" onClick={() => navigate('data')}>
                      <Upload /> Import data
                    </Button>
                  </div>
                  <section className="coverage-strip">
                    <Database />
                    <div>
                      <strong>
                        {s.start
                          ? `${s.start} — ${s.end}`
                          : 'No data loaded yet'}
                      </strong>
                      <span>
                        {
                          s.batches.filter((b: any) => b.status === 'complete')
                            .length
                        }{' '}
                        active source batch(es) · {s.completeMonths.length} full
                        calendar month(s) covered
                      </span>
                    </div>
                    <span
                      className={
                        'pill ' + (!s.completeMonths.length ? 'amber' : 'green')
                      }
                    >
                      {!s.completeMonths.length
                        ? 'Partial period'
                        : 'Check reporting lag'}
                    </span>
                  </section>
                  <section className="metrics">
                    {[
                      [number(s.crashes), 'Reported crashes'],
                      [number(s.severe), 'Fatal or serious-injury crashes'],
                      [number(s.cmv), 'CMV-involved crashes'],
                      [
                        s.crashes
                          ? ((100 * s.located) / s.crashes).toFixed(1) + '%'
                          : '—',
                        'With mapped coordinates',
                      ],
                    ].map(([v, l]) => (
                      <div key={l}>
                        <span>{l}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </section>
                  <form
                    className="ask-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask();
                    }}
                  >
                    <Sparkles />
                    <input
                      aria-label="Research question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Which intersections have the most serious crashes in Dallas?"
                    />
                    <Button disabled={!!busy || !question.trim()}>
                      Explore <ArrowUpRight />
                    </Button>
                  </form>
                  <div className="suggestions">
                    <span>Try asking</span>
                    {[
                      'Truck crashes by city',
                      'Pedestrian crashes by hour',
                      'Top 10 Dallas intersections',
                    ].map((q) => (
                      <button
                        onClick={() => {
                          setQuestion(q);
                          navigate('research');
                        }}
                        key={q}
                      >
                        {q}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                  <div className="section-heading">
                    <div>
                      <h2>
                        Discovery inbox{' '}
                        <span className="inline-count">{pending}</span>
                      </h2>
                      <p className="fine-print">
                        {data.settings.last_scan
                          ? `Last scan ${data.settings.last_scan.slice(0, 10)} · Full available history`
                          : 'Run a scan to surface findings from your data.'}
                      </p>
                    </div>
                    <Button disabled={!!busy || !s.crashes} onClick={scan}>
                      <RefreshCw />{' '}
                      {data.settings.discovery_stale === 'true'
                        ? 'Scan new data'
                        : 'Scan for findings'}
                    </Button>
                  </div>
                  <div className="inbox-toolbar">
                    <Tabs
                      value={filter}
                      onValueChange={(v) => setFilter(String(v))}
                    >
                      <TabsList variant="line">
                        {[
                          ['new', 'To review'],
                          ['approved', 'Approved'],
                          ['dismissed', 'Dismissed'],
                          ['all', 'All findings'],
                        ].map(([v, l]) => (
                          <TabsTrigger value={v} key={v}>
                            {l}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Filter findings"
                        placeholder="Filter findings"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="findings-grid">
                    {visible.map((f) => (
                      <article className="finding-card" key={f.id}>
                        <div className="card-top">
                          <span className="pill">{f.category}</span>
                          <span
                            className="priority"
                            title="Editorial priority heuristic, not statistical confidence"
                          >
                            Priority {f.score}
                          </span>
                        </div>
                        <button
                          className="finding-title"
                          onClick={() => setSelected(f)}
                        >
                          <h2>{f.title}</h2>
                        </button>
                        <p>{f.summary}</p>
                        <Bars e={f.evidence} small />
                        <div className="card-footer">
                          <span>
                            {f.status === 'review'
                              ? 'Updated data · review again'
                              : `${f.evidence.spec.start} – ${f.evidence.spec.end}`}
                          </span>
                          <Button
                            variant="ghost"
                            onClick={() => setSelected(f)}
                          >
                            Review evidence <ArrowUpRight />
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!visible.length && (
                    <EmptyState
                      title={
                        s.crashes
                          ? 'Your inbox is clear'
                          : 'Start with your TxDOT files'
                      }
                      body={
                        s.crashes
                          ? 'Run a discovery scan, or change the inbox filter. No weak findings are added just to fill a quota.'
                          : 'Open Data library and select all nine files from one or more extracts. The first discovery scan runs after import.'
                      }
                    />
                  )}
                  <p className="fine-print footer-note">
                    Findings are exploratory. Editorial priority is not
                    statistical significance. You decide what gets published.
                  </p>
                </>
              )}
              {view === 'research' && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">ASK · VERIFY · CREATE</p>
                      <h1>Research workbench</h1>
                      <p>
                        Turn a question into a reproducible piece of research.
                      </p>
                    </div>
                    <span className="pill">
                      {data.ai.connected
                        ? 'AI-assisted interpretation'
                        : 'Built-in language interpreter'}
                    </span>
                  </div>
                  <form
                    className="ask-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask();
                    }}
                  >
                    <Sparkles />
                    <input
                      aria-label="Research question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Top truck intersections in Dallas in the available data"
                    />
                    <Button disabled={!!busy || !question.trim()}>
                      Interpret <ArrowRight />
                    </Button>
                  </form>
                  {interpretation.length > 0 && (
                    <div className="interpretation">
                      {interpretation.map((t) => (
                        <p key={t}>{t}</p>
                      ))}
                    </div>
                  )}
                  <section className="panel">
                    <div className="section-heading compact">
                      <h2>Research filters</h2>
                      <span>The exact definition of your result</span>
                    </div>
                    <div className="filter-grid">
                      <Choice
                        label="Crash involvement"
                        value={spec.cohort}
                        onChange={(v) => setSpec({ ...spec, cohort: v as any })}
                        options={COHORTS}
                      />
                      <Choice
                        label="Group by"
                        value={spec.group}
                        onChange={(v) => setSpec({ ...spec, group: v as any })}
                        options={GROUPS}
                      />
                      <Choice
                        label="Rank by"
                        value={spec.metric}
                        onChange={(v) => setSpec({ ...spec, metric: v as any })}
                        options={{
                          crashes: 'Reported crashes',
                          severe: 'Fatal / serious-injury crashes',
                          fatal: 'Fatal crashes',
                        }}
                      />
                      <div className="field">
                        <label htmlFor="city">City (optional)</label>
                        <Input
                          id="city"
                          value={spec.city || ''}
                          onChange={(e) =>
                            setSpec({ ...spec, city: e.target.value })
                          }
                          placeholder="e.g. Dallas"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="start">From</label>
                        <Input
                          id="start"
                          type="date"
                          value={spec.start}
                          onChange={(e) =>
                            setSpec({ ...spec, start: e.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="end">Through</label>
                        <Input
                          id="end"
                          type="date"
                          value={spec.end}
                          onChange={(e) =>
                            setSpec({ ...spec, end: e.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="minimum">
                          Minimum crashes per group
                        </label>
                        <Input
                          id="minimum"
                          type="number"
                          min={1}
                          max={100000}
                          value={spec.min}
                          onChange={(e) =>
                            setSpec({ ...spec, min: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="limit">Number of results</label>
                        <Input
                          id="limit"
                          type="number"
                          min={1}
                          max={100}
                          value={spec.limit}
                          onChange={(e) =>
                            setSpec({ ...spec, limit: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                    <details className="advanced">
                      <summary>Additional filters</summary>
                      <div className="filter-grid">
                        {(['county', 'make', 'color'] as const).map((k) => (
                          <div className="field" key={k}>
                            <label htmlFor={'filter-' + k}>
                              {titleCase(k)} (exact label)
                            </label>
                            <Input
                              id={'filter-' + k}
                              value={spec[k] || ''}
                              onChange={(e) =>
                                setSpec({ ...spec, [k]: e.target.value })
                              }
                            />
                          </div>
                        ))}
                        {(['latitude','longitude','radiusMeters'] as const).map(k=><div className="field" key={k}>
                          <label htmlFor={'filter-'+k}>{k==='radiusMeters'?'Radius (meters)':titleCase(k)}</label>
                          <Input id={'filter-'+k} type="number" step="any" value={spec[k] ?? ''} onChange={e=>setSpec({...spec,[k]:e.target.value===''?undefined:Number(e.target.value)})}/>
                        </div>)}
                      </div>
                      <p className="fine-print">Optional location search: enter all three geographic fields. Reported coordinates are not verified intersection boundaries.</p>
                    </details>
                    <div className="panel-actions">
                      <span className="fine-print">
                        Available: {s.start || '—'} to {s.end || '—'}. “Last
                        month” uses the real calendar.
                      </span>
                      <Button
                        disabled={!!busy || !s.crashes}
                        onClick={() =>
                          action('Researching', async () => {
                            await runResearch();
                          })
                        }
                      >
                        <FlaskConical /> Run research
                      </Button>
                    </div>
                  </section>
                  {result && (
                    <section className="panel result-panel">
                      <div className="section-heading compact">
                        <h2>Your evidence</h2>
                        <div className="button-row">
                          {['page', 'newsletter', 'social'].map((c) => (
                            <Button
                              key={c}
                              variant="outline"
                              disabled={!!busy || !result.total}
                              onClick={() => createDraft(c)}
                            >
                              <Plus /> {titleCase(c)} draft
                            </Button>
                          ))}
                        </div>
                      </div>
                      <EvidencePanel e={result} />
                    </section>
                  )}
                </>
              )}
              {view === 'editorial' && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">
                        FROM FINDING TO FINISHED CONTENT
                      </p>
                      <h1>Editorial desk</h1>
                      <p>
                        Write, review, and export. Nothing publishes without
                        your approval.
                      </p>
                    </div>
                    {draft && (
                      <Button
                        variant="outline"
                        disabled={dirty}
                        title={dirty ? 'Save this draft before switching.' : ''}
                        onClick={() => setDraft(null)}
                      >
                        <ArrowLeft /> All drafts
                      </Button>
                    )}
                  </div>
                  {!draft ? (
                    <>
                      <div className="draft-list">
                        {drafts.map((d) => (
                          <button
                            className="draft-list-item"
                            key={d.id}
                            onClick={() => {
                              setDraft(d);
                              setDirty(false);
                              setEditTab('write');
                            }}
                          >
                            <div className="draft-icon">
                              <FileText />
                            </div>
                            <div>
                              <span className="eyebrow">{d.channel}</span>
                              <h3>{d.title}</h3>
                              <p>
                                {d.updated.slice(0, 10)} ·{' '}
                                {domains.find((x) => x.id === d.domain_id)
                                  ?.name || 'No publication selected'}
                              </p>
                            </div>
                            <span
                              className={
                                'pill ' +
                                (d.status === 'approved' ? 'green' : '')
                              }
                            >
                              {d.status}
                            </span>
                            <ChevronRight />
                          </button>
                        ))}
                      </div>
                      {!drafts.length && (
                        <EmptyState
                          title="Your next piece starts with a finding"
                          body="Review a discovery or run a research query, then choose Page, Newsletter, or Social to create an evidence-backed draft."
                        />
                      )}
                    </>
                  ) : (
                    <div className="editor-layout">
                      <section className="panel editor-main">
                        <div className="editor-status">
                          <span className="pill blue">
                            {titleCase(draft.channel)}
                          </span>
                          <span
                            className={
                              'pill ' +
                              (draft.status === 'approved' ? 'green' : '')
                            }
                          >
                            {dirty ? 'Unsaved changes' : draft.status}
                          </span>
                          <span className="fine-print">
                            Saved evidence snapshot
                          </span>
                          {data.ai.connected && (
                            <Button
                              variant="outline"
                              disabled={!!busy || dirty}
                              onClick={() =>
                                action('Writing with AI', async () => {
                                  const r = await api(
                                    'ai-write/' + draft.id,
                                    {},
                                  );
                                  edit({ body: r.body });
                                  setNotice(r.notice);
                                })
                              }
                            >
                              <Sparkles /> AI rewrite
                            </Button>
                          )}
                        </div>
                        <div className="field">
                          <label htmlFor="draft-title">Headline</label>
                          <Input
                            id="draft-title"
                            className="headline-input"
                            value={draft.title}
                            onChange={(e) => edit({ title: e.target.value })}
                          />
                        </div>
                        <Tabs
                          value={editTab}
                          onValueChange={(v) => setEditTab(String(v))}
                        >
                          <TabsList variant="line">
                            <TabsTrigger value="write">Write</TabsTrigger>
                            <TabsTrigger value="preview">
                              <Eye size={15} /> Page preview
                            </TabsTrigger>
                            <TabsTrigger value="evidence">Evidence</TabsTrigger>
                          </TabsList>
                          <TabsContent value="write">
                            <Textarea
                              aria-label="Draft content"
                              className="draft-body"
                              value={draft.body}
                              onChange={(e) => edit({ body: e.target.value })}
                            />
                            <p className="fine-print">
                              {draft.body.trim().split(/\s+/).length} words ·{' '}
                              {draft.body.length} characters ·{' '}
                              {data.ai.connected
                                ? 'AI available'
                                : 'Evidence-based template draft; edit freely'}
                            </p>
                          </TabsContent>
                          <TabsContent value="preview">
                            <iframe
                              title="Publication preview"
                              sandbox=""
                              className="page-preview"
                              srcDoc={renderPage(
                                draft,
                                domains.find((x) => x.id === draft.domain_id),
                                true,
                              )}
                            />
                          </TabsContent>
                          <TabsContent value="evidence">
                            <EvidencePanel e={draft.evidence} />
                          </TabsContent>
                        </Tabs>
                      </section>
                      <aside className="panel publishing-panel">
                        <h3>Publication settings</h3>
                        <Choice
                          label="Publication"
                          value={draft.domain_id || 'none'}
                          onChange={(v) =>
                            edit({ domain_id: v === 'none' ? undefined : v })
                          }
                          options={{
                            none: 'Choose a publication',
                            ...Object.fromEntries(
                              domains.map((d) => [d.id, d.name]),
                            ),
                          }}
                        />
                        <div className="field">
                          <label htmlFor="slug">Page URL slug</label>
                          <Input
                            id="slug"
                            value={draft.slug}
                            onChange={(e) => edit({ slug: e.target.value })}
                          />
                        </div>
                        <p className="url-preview">
                          {domains.find((x) => x.id === draft.domain_id)
                            ?.host || 'your-domain.com'}
                          /{draft.slug}/
                        </p>
                        <div className="editor-checklist">
                          <ShieldCheck />
                          <h3>Before you approve</h3>
                          <ul>
                            <li>Check date coverage and definitions.</li>
                            <li>Verify local roads and intersections.</li>
                            <li>Keep count-versus-risk caveats.</li>
                            <li>
                              Give each domain a distinct editorial purpose.
                            </li>
                          </ul>
                        </div>
                        <Button
                          variant="outline"
                          disabled={!!busy}
                          onClick={() => saveDraft('draft')}
                        >
                          <Save /> Save draft
                        </Button>
                        <Button
                          disabled={!!busy}
                          onClick={() => saveDraft('approved')}
                        >
                          <Check /> Approve for export
                        </Button>
                        <div className="export-links">
                          <h3>Export package</h3>
                          {draft.status === 'approved' && !dirty ? (
                            <>
                              {[
                                ['html', 'Standalone web page'],
                                ['txt', 'Newsletter / social text'],
                                ['csv', 'Research data table'],
                                ['json', 'Evidence & methodology'],
                              ].map(([f, l]) => (
                                <a
                                  key={f}
                                  href={`/api/export/${draft.id}?format=${f}`}
                                >
                                  <Download size={15} />
                                  {l}
                                </a>
                              ))}
                            </>
                          ) : (
                            <p className="fine-print">
                              Approve the saved draft to unlock exports. Editing
                              an approved draft returns it to review.
                            </p>
                          )}
                        </div>
                        <p className="fine-print">
                          Exports do not change your website or send any
                          messages. Host the HTML on your chosen domain.
                        </p>
                      </aside>
                    </div>
                  )}
                </>
              )}
              {view === 'data' && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">YOUR SOURCE OF TRUTH</p>
                      <h1>Data library</h1>
                      <p>
                        One initial history load. One upload each month after
                        that.
                      </p>
                    </div>
                    <span className="pill green">
                      <ShieldCheck size={14} /> Original files preserved
                    </span>
                  </div>
                  <section
                    ref={uploadPanel}
                    className="upload-zone"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!busy) chooseFiles(Array.from(e.dataTransfer.files));
                    }}
                  >
                    <div className="upload-icon">
                      <FolderUp />
                    </div>
                    <h2>{resumeBatch ? `Resume ${resumeBatch.start} — ${resumeBatch.end}` : 'Drop your TxDOT CSV files here'}</h2>
                    <p>
                      {resumeBatch ? 'Choose the same nine original CSVs for this batch. Existing verified chunks are reused; no records are deleted.'
                        : 'Select all nine files per extract. Multiple date ranges can be imported together.'}
                    </p>
                    <div className="button-row">
                      <Button
                        disabled={!!busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload /> {resumeBatch ? 'Select original files to resume' : 'Choose files'}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => folderInput.current?.click()}
                      >
                        <FolderUp /> Choose folder
                      </Button>
                      {resumeBatch && <Button type="button" variant="ghost" disabled={!!busy} onClick={() => { setResumeBatch(null); setFiles([]); setProgress(null); setNotice(''); }}>Cancel resume</Button>}
                    </div>
                    <input
                      hidden
                      ref={fileInput}
                      type="file"
                      accept=".csv"
                      multiple
                      onChange={(e) => { chooseFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                    />
                    <input
                      hidden
                      ref={folderInput}
                      type="file"
                      multiple
                      {...({ webkitdirectory: '' } as any)}
                      onChange={(e) => { chooseFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                    />
                    <span className="fine-print">
                      Original CSVs, not resaved Excel workbooks. Unzip
                      downloaded archives before selecting.
                    </span>
                  </section>
                  {files.length > 0 && (
                    <section className="panel">
                      <div className="section-heading compact">
                        <h3>
                          {files.length} files selected ·{' '}
                          {(
                            files.reduce((n, f) => n + f.size, 0) / 1048576
                          ).toFixed(1)}{' '}
                          MB
                        </h3>
                        <Button disabled={!!busy} onClick={importNow}>
                          {resumeBatch ? 'Resume selected batch' : 'Start import'} <ArrowRight />
                        </Button>
                      </div>
                      <div className="selected-files">
                        {files.map((f) => (
                          <div key={f.name}>
                            <FileText size={14} />
                            <span>{f.name}</span>
                            <span>{(f.size / 1048576).toFixed(1)} MB</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {progress && (
                    <section className="panel">
                      <div className="section-heading compact">
                        <h3>{progress.stage}</h3>
                        <span>{progress.percent}%</span>
                      </div>
                      <Progress
                        value={progress.percent}
                        aria-label="Import progress"
                      />
                      <p className="fine-print">
                        {progress.file}{' '}
                        {progress.rows ? `· ${number(progress.rows)} rows` : ''}
                      </p>
                      {busy === 'Importing' && (
                        <Button
                          variant="outline"
                          onClick={() => uploadAbort.current?.abort()}
                        >
                          Pause after current chunk
                        </Button>
                      )}
                    </section>
                  )}
                  <section className="panel" ref={activityPanel}>
                    <div className="section-heading compact"><h2>Activity inbox</h2><span className={'pill '+(data.worker?.online?'green':'amber')}>{data.worker?.online?'Worker online':'Worker offline or not started'}</span></div>
                    <p>Uploads need this tab until all files are stored. Validation and discovery then continue on the worker, including after a restart. This inbox updates every 10 seconds.</p>
                    {!data.jobs?.length && <p className="fine-print">Your first upload will start the activity history.</p>}
                    {s.batches.some((batch: RecoveryBatch) => batch.status === 'uploading') && <p>Some uploads are unfinished. Use <strong>Resume import</strong> beside the batch in Source batches below, even if no job appears here yet.</p>}
                    {data.jobs?.map((job:any) => {
                      const result = job.result ? JSON.parse(job.result) : null;
                      return <div key={job.id} style={{borderTop:'1px solid var(--border)',padding:'16px 0'}}>
                        <div className="section-heading compact"><strong>{job.kind==='import'?'Import and validation':'Discovery scan'}</strong><span className={'pill '+(job.status==='complete'?'green':'amber')}>{job.status}</span></div>
                        <p>{job.progress}</p>{job.batch_id && <p className="fine-print">{job.batch_id}</p>}
                        <p className="fine-print">Job <code>{job.id}</code> · Attempt {job.attempts}/5{job.updated && ` · Updated ${new Date(job.updated).toLocaleString()}`}</p>
                        {job.error && <p role="status"><strong>Last failure:</strong> {job.error}</p>}
                        {result && job.kind==='discover' && <p>{result.created} new findings · {result.refreshed} refreshed · {result.probes} questions tested. {result.aiError && `AI assistance: ${result.aiError}`}</p>}
                        {job.status==='failed' && <Button variant="outline" disabled={!!busy} onClick={()=>action('Retrying',async()=>{await api(`jobs/${job.id}/retry`,{});await refresh();})}>Retry job</Button>}
                      </div>;
                    })}
                  </section>
                  <div className="data-notes">
                    <div>
                      <ShieldCheck />
                      <h3>Safe, resumable imports</h3>
                      <p>
                        Incomplete batches stay out of research. Re-select the
                        same files to resume. Duplicate batches are skipped.
                      </p>
                    </div>
                    <div>
                      <RefreshCw />
                      <h3>Corrections stay traceable</h3>
                      <p>
                        Newer extraction timestamps supersede matching crash
                        IDs. Keep including amended older records in monthly
                        downloads.
                      </p>
                    </div>
                    <div>
                      <Database />
                      <h3>Every file stays available</h3>
                      <p>
                        Crash, unit, and lookup data are indexed for research.
                        The other six tables are validated and archived intact.
                      </p>
                    </div>
                  </div>
                  <div className="section-heading">
                    <h2>Source batches</h2>
                    <span>{s.batches.length} batch(es)</span>
                  </div>
                  <div className="panel table-panel">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Crash-date interval</TableHead>
                          <TableHead>Extracted</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Files</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.batches.map((b: any) => (
                          <TableRow key={b.id}>
                            <TableCell>
                              <strong>
                                {b.start} — {b.end}
                              </strong>
                              <div className="fine-print">
                                Imported {b.created.slice(0, 10)}
                              </div>
                            </TableCell>
                            <TableCell>
                              {b.extraction.slice(0, 4)}-
                              {b.extraction.slice(4, 6)}-
                              {b.extraction.slice(6, 8)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  'pill ' +
                                  (b.status === 'complete' ? 'green' : 'amber')
                                }
                              >
                                {b.status === 'complete'
                                  ? 'Validated'
                                  : b.status}
                              </span>
                              <ImportRecovery batch={b} busy={!!busy} workerOnline={!!data.worker?.online} onResume={resumeImport} onActivity={showActivity} />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  action('Loading files', async () => {
                                    setFileDetails(await api('files/' + b.id));
                                    setBatchDetails(b.id);
                                  })
                                }
                              >
                                View files <ChevronRight />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {!s.batches.length && (
                    <EmptyState
                      title="Your archive is empty"
                      body="Your original extracts and research-ready database will appear here after import."
                    />
                  )}
                  <section className="panel">
                    <h3>Coverage & quality</h3>
                    <div className="mini-metrics">
                      <div>
                        <strong>{number(s.crashes - s.located)}</strong>
                        <span>Crashes without usable coordinates</span>
                      </div>
                      <div>
                        <strong>{s.completeMonths.length}</strong>
                        <span>Calendar months covered in full</span>
                      </div>
                      <div>
                        <strong>{number(s.deaths)}</strong>
                        <span>Deaths recorded (people, not crashes)</span>
                      </div>
                    </div>
                    <p className="fine-print">
                      Calendar coverage comes from extraction intervals. It does
                      not mean all reports have arrived. Year-over-year and
                      month-over-month comparisons require comparable covered
                      periods. No uploaded history is invented.
                    </p>
                  </section>
                </>
              )}
              {view === 'publications' && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">
                        ONE RESEARCH ENGINE · YOUR PUBLICATIONS
                      </p>
                      <h1>Publication profiles</h1>
                      <p>
                        Give each destination its own byline, domain, and visual
                        identity.
                      </p>
                    </div>
                  </div>
                  <div className="publication-grid">
                    <section>
                      {domains.some((d) =>
                        drafts.some(
                          (x) =>
                            x.domain_id === d.id &&
                            x.status === 'approved' &&
                            x.channel === 'page',
                        ),
                      ) && (
                        <div className="panel">
                          <h3>Ready-to-host site packages</h3>
                          <p className="fine-print">
                            Approved pages, branded index, sitemap, source
                            evidence, and data tables. Download and upload to
                            that domain’s hosting.
                          </p>
                          <div className="export-links">
                            {domains
                              .filter((d) =>
                                drafts.some(
                                  (x) =>
                                    x.domain_id === d.id &&
                                    x.status === 'approved' &&
                                    x.channel === 'page',
                                ),
                              )
                              .map((d) => (
                                <a
                                  key={d.id}
                                  href={'/api/site-package/' + d.id}
                                >
                                  <Download size={16} />
                                  {d.host} · ZIP package
                                </a>
                              ))}
                          </div>
                        </div>
                      )}
                      <div className="domain-list">
                        {domains.map((d) => (
                          <button
                            key={d.id}
                            className="domain-card"
                            onClick={() => setDomain(d)}
                          >
                            <span
                              className="domain-avatar"
                              style={{ background: d.color }}
                            >
                              <Globe />
                            </span>
                            <div>
                              <h3>{d.name}</h3>
                              <p>{d.host}</p>
                              <span className="fine-print">
                                {
                                  drafts.filter((x) => x.domain_id === d.id)
                                    .length
                                }{' '}
                                drafts
                              </span>
                            </div>
                            <ChevronRight />
                          </button>
                        ))}
                      </div>
                      {!domains.length && (
                        <EmptyState
                          title="Where will your research live?"
                          body="Add your first domain. The profile controls branding and canonical URLs in exported pages; it does not change DNS."
                        />
                      )}
                      <div className="caution">
                        <Globe size={18} />
                        <span>
                          Each exported HTML page works independently on your
                          hosting. Domain profiles are editorial destinations,
                          not connected hosting accounts.
                        </span>
                      </div>
                    </section>
                    <section className="panel">
                      <h2>
                        {domain.id ? 'Edit publication' : 'Add a publication'}
                      </h2>
                      <div className="stack-fields">
                        {[
                          ['name', 'Publication name', 'Dallas Road Research'],
                          ['host', 'Domain', 'example.com'],
                          ['byline', 'Byline', 'Research team'],
                        ].map(([k, l, p]) => (
                          <div className="field" key={k}>
                            <label htmlFor={'domain-' + k}>{l}</label>
                            <Input
                              id={'domain-' + k}
                              value={(domain as any)[k]}
                              placeholder={p}
                              onChange={(e) =>
                                setDomain({ ...domain, [k]: e.target.value })
                              }
                            />
                          </div>
                        ))}
                        <div className="field">
                          <label htmlFor="brand-color">Brand color</label>
                          <div className="color-input">
                            <input
                              id="brand-color"
                              type="color"
                              value={domain.color}
                              onChange={(e) =>
                                setDomain({ ...domain, color: e.target.value })
                              }
                            />
                            <span>{domain.color}</span>
                          </div>
                        </div>
                        <Button
                          disabled={!!busy}
                          onClick={() =>
                            action('Saving publication', async () => {
                              await api(
                                'domains' + (domain.id ? '/' + domain.id : ''),
                                domain,
                              );
                              await refresh();
                              setDomain({
                                id: '',
                                name: '',
                                host: '',
                                byline: 'Research team',
                                color: '#245bda',
                              });
                              setNotice('Publication profile saved.');
                            })
                          }
                        >
                          <Save /> Save publication
                        </Button>
                        {domain.id && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setDomain({
                                id: '',
                                name: '',
                                host: '',
                                byline: 'Research team',
                                color: '#245bda',
                              })
                            }
                          >
                            Add another
                          </Button>
                        )}
                      </div>
                    </section>
                  </div>
                </>
              )}
              {view === 'settings' && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">A REPEATABLE EDITORIAL SYSTEM</p>
                      <h1>Your monthly workflow</h1>
                      <p>
                        Let the research engine do the searching. Keep the
                        editorial judgment.
                      </p>
                    </div>
                  </div>
                  <div className="workflow-grid">
                    {[
                      [
                        '01',
                        'Import',
                        'Select complete batches from your initial history or monthly download. Keep original filenames and include corrected older records.',
                      ],
                      [
                        '02',
                        'Discover',
                        'The engine tests location, vehicle, severity, timing, and condition questions. Qualified findings enter your review inbox.',
                      ],
                      [
                        '03',
                        'Investigate',
                        'Inspect counts, exact definitions, source batches, and caveats. Use Research to explore a more specific question.',
                      ],
                      [
                        '04',
                        'Create',
                        'Choose page, newsletter, or social. Edit the draft, set its publication, approve, and export.',
                      ],
                    ].map(([n, t, b]) => (
                      <div className="panel" key={n}>
                        <span className="step-number">{n}</span>
                        <h2>{t}</h2>
                        <p>{b}</p>
                      </div>
                    ))}
                  </div>
                  <section className="panel">
                    <div className="section-heading compact">
                      <h2>AI connection</h2>
                      <span
                        className={
                          'pill ' + (data.ai.connected ? 'green' : 'amber')
                        }
                      >
                        {data.ai.connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    <p>
                      The automated evidence scan runs without an AI
                      subscription or key. A connected OpenAI API enables richer
                      interpretation and editorial writing. AI only receives
                      aggregate research, never raw participant records or VINs.
                    </p>
                    <p className="fine-print">
                      {data.ai.connected
                        ? `Model: ${data.ai.model || 'configured default'}`
                        : 'To enable it, set OPENAI_API_KEY and OPENAI_MODEL in both Railway services. The OpenAI Developers plugin can help create a key but is not required to run this app. Never put keys in drafts or source files.'}
                    </p>
                  </section>
                  <section className="panel">
                    <h2>Definitions that protect your credibility</h2>
                    <div className="definition-grid">
                      <div>
                        <h3>Trucks ≠ all CMVs</h3>
                        <p>
                          Truck research uses truck and truck-tractor body
                          styles. CMVs also include qualifying buses and other
                          vehicles. Pickups are separate.
                        </p>
                      </div>
                      <div>
                        <h3>Counts ≠ risk</h3>
                        <p>
                          Busy places have more opportunities for crashes. These
                          rankings do not control for miles traveled, traffic
                          volumes, or number of vehicles on the road.
                        </p>
                      </div>
                      <div>
                        <h3>Crashes ≠ people</h3>
                        <p>
                          One crash can involve multiple people and vehicles.
                          Aggregations use unique crash IDs; deaths and serious
                          injuries count people where labeled.
                        </p>
                      </div>
                      <div>
                        <h3>Discovery ≠ proof</h3>
                        <p>
                          Many questions are explored. Priority scores rank
                          editorial usefulness, not statistical significance or
                          causal evidence.
                        </p>
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <h2>Storage & portability</h2>
                    <p>
                      Your private studio uses a hosted relational database for
                      indexed crash research and durable editorial records, plus
                      object storage for all original CSV files. Download any
                      original from Data library and export the query snapshot
                      with your content.
                    </p>
                    <p className="fine-print">
                      Indexed research currently covers crash, vehicle, and
                      lookup dimensions. Charges, people, damages, endorsements,
                      and restrictions are archived but not exposed as research
                      filters. Before a very large multi-year load, monitor
                      database capacity and import throughput; the complete
                      2020–present history has not yet been supplied or
                      load-tested.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </SidebarInset>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="evidence-sheet">
          <SheetHeader>
            <SheetDescription>DISCOVERY REVIEW</SheetDescription>
            <SheetTitle>{selected?.title}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="sheet-scroll">
              <p>{selected.summary}</p>
              <div className="review-actions">
                <Button
                  disabled={!!busy}
                  onClick={() => changeFinding(selected, 'approved')}
                >
                  <Check /> Approve finding
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    changeFinding(
                      selected,
                      selected.status === 'dismissed' ? 'new' : 'dismissed',
                    )
                  }
                >
                  {selected.status === 'dismissed' ? 'Restore' : 'Dismiss'}
                </Button>
                <span className="pill">{selected.status}</span>
              </div>
              <EvidencePanel e={selected.evidence} />
              <div className="draft-actions">
                <h3>Develop this finding</h3>
                <p className="fine-print">
                  Create an editable draft. Approval for publication comes
                  later.
                </p>
                <div className="button-row">
                  {['page', 'newsletter', 'social'].map((c) => (
                    <Button
                      variant="outline"
                      key={c}
                      disabled={!!busy}
                      onClick={() => createDraft(c, selected)}
                    >
                      <Plus />
                      {titleCase(c)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!batchDetails}
        onOpenChange={(open) => !open && setBatchDetails(null)}
      >
        <SheetContent className="evidence-sheet">
          <SheetHeader>
            <SheetTitle>Original source files</SheetTitle>
            <SheetDescription>
              Exact originals, archived privately. Research reads validated,
              indexed records.
            </SheetDescription>
          </SheetHeader>
          <div className="sheet-scroll">
            {detailBatch && <ImportRecovery batch={detailBatch} busy={!!busy} workerOnline={!!data?.worker?.online} onResume={resumeImport} onActivity={showActivity} />}
            {detailBatch?.status !== 'complete' && <p className="fine-print">File status updates every 10 seconds. This batch stays out of research until all nine files finish validation.</p>}
            {fileDetails.map((f) => (
              <div className="file-detail" key={f.kind}>
                <div>
                  <h3>{titleCase(f.kind)}</h3>
                  <span className="fine-print">
                    {number(f.rows)} rows · {(f.bytes / 1048576).toFixed(2)} MB
                    · {f.parsed ? 'Verified' : detailBatch?.status === 'uploading' ? 'Upload not yet submitted' : f.rows > 0 ? 'Validation incomplete' : 'Awaiting validation'}
                  </span>
                  <p>{f.name}</p>
                </div>
                {f.parsed === 1 && (
                  <a
                    aria-label={'Download ' + f.kind}
                    href={`/api/download/${batchDetails}?kind=${f.kind}`}
                  >
                    <Download size={19} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  );
}
