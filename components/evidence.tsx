'use client';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Evidence, number, titleCase, COHORTS, GROUPS } from '@/lib/contracts';
import {
  AlertTriangle,
  ChartNoAxesCombined,
  FileCheck2,
  Code2,
  Download,
} from 'lucide-react';
export function download(
  name: string,
  text: string,
  type = 'application/json',
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Bars({ e, small = false }: { e: Evidence; small?: boolean }) {
  const rows = e.rows.slice(0, small ? 4 : 12);
  const max = Math.max(1, ...rows.map((r) => r[e.spec.metric]));
  return (
    <div
      className={small ? 'bars small' : 'bars'}
      role="img"
      aria-label={`${GROUPS[e.spec.group]} ranking by ${e.spec.metric}. Values also available in the evidence table.`}
    >
      {rows.map((r, i) => (
        <div className="bar-row" key={r.label}>
          <div className="bar-label" title={r.label}>
            {titleCase(r.label)}
          </div>
          <div className="bar-track">
            <div
              className={'bar-fill ' + (i === 0 ? 'lead' : '')}
              style={{ width: `${(100 * r[e.spec.metric]) / max}%` }}
            />
          </div>
          <strong>{number(r[e.spec.metric])}</strong>
        </div>
      ))}
    </div>
  );
}
export function EvidencePanel({ e }: { e: Evidence }) {
  return (
    <div className="evidence">
      <div className="evidence-context">
        <span className="pill blue">{COHORTS[e.spec.cohort]}</span>
        <span className="pill">
          {e.spec.start} → {e.spec.end}
        </span>
        {e.spec.city && <span className="pill">{titleCase(e.spec.city)}</span>}
      </div>
      <div className="mini-metrics">
        <div>
          <strong>{number(e.total)}</strong>
          <span>Matching crashes</span>
        </div>
        <div>
          <strong>{number(e.severe)}</strong>
          <span>Fatal / serious</span>
        </div>
        <div>
          <strong>{number(e.fatal)}</strong>
          <span>Fatal crashes</span>
        </div>
      </div>
      {e.comparison && (
        <div className="panel">
          <h3>
            Comparison: {e.comparison.start} – {e.comparison.end}
          </h3>
          <p className="fine-print">{e.comparison.caveat}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>City</TableHead>
                <TableHead>Previous</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {e.rows
                .filter((r) =>
                  e.comparison!.rows.some((p) => p.label === r.label),
                )
                .slice(0, 15)
                .map((r) => {
                  const p = e.comparison!.rows.find(
                    (x) => x.label === r.label,
                  )!;
                  return (
                    <TableRow key={r.label}>
                      <TableCell>{titleCase(r.label)}</TableCell>
                      <TableCell>{p.crashes}</TableCell>
                      <TableCell>{r.crashes}</TableCell>
                      <TableCell>
                        {((r.crashes / p.crashes - 1) * 100).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      )}
      <Tabs defaultValue="chart">
        <TabsList variant="line">
          <TabsTrigger value="chart">
            <ChartNoAxesCombined size={15} /> Findings
          </TabsTrigger>
          <TabsTrigger value="table">Data table</TabsTrigger>
          <TabsTrigger value="sources">
            <FileCheck2 size={15} /> Methodology
          </TabsTrigger>
          <TabsTrigger value="query">
            <Code2 size={15} /> Query
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chart">
          <Bars e={e} />
          <p className="fine-print">
            Ranked by{' '}
            {e.spec.metric === 'severe'
              ? 'fatal or serious-injury crashes'
              : e.spec.metric === 'fatal'
                ? 'fatal crashes'
                : 'crash count'}
            . Minimum {e.spec.min} crashes per group. Showing up to{' '}
            {e.spec.limit} groups.
          </p>
          {!e.rows.length && (
            <div className="empty-note">
              No groups meet these filters and minimum count. Try a larger date
              range or lower the minimum.
            </div>
          )}
        </TabsContent>
        <TabsContent value="table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{GROUPS[e.spec.group]}</TableHead>
                <TableHead>Crashes</TableHead>
                <TableHead>Fatal / serious</TableHead>
                <TableHead>Fatal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {e.rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell>{titleCase(r.label)}</TableCell>
                  <TableCell>{number(r.crashes)}</TableCell>
                  <TableCell>{number(r.severe)}</TableCell>
                  <TableCell>{number(r.fatal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="sources">
          <div className="limitations">
            <h3>What this can—and can’t—tell you</h3>
            <ul>
              {e.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p>
              {number(e.unlocated)} matching crashes have no usable coordinates.{' '}
              {number(e.excluded)} excluded from the selected grouping.
            </p>
            <h3>Source batches</h3>
            {e.sources.map((s) => (
              <div className="source-row" key={s.id}>
                <strong>
                  {s.start} – {s.end}
                </strong>
                <span>
                  Extracted {s.extraction.slice(0, 4)}-
                  {s.extraction.slice(4, 6)}-{s.extraction.slice(6, 8)}
                </span>
                <code>{s.id}</code>
              </div>
            ))}
            <a
              href="https://www.txdot.gov/data-maps/crash-reports-records/crash-data-analysis-statistics.html"
              target="_blank"
              rel="noreferrer"
            >
              TxDOT crash-data documentation ↗
            </a>
          </div>
        </TabsContent>
        <TabsContent value="query">
          <p className="fine-print">
            Saved, reproducible query snapshot · {e.generated.slice(0, 10)} ·{' '}
            {e.engine}
          </p>
          <pre>{JSON.stringify(e.spec, null, 2)}</pre>
          <pre>
            {e.sql}
            {'\n\nParameters: ' + JSON.stringify(e.parameters)}
          </pre>
          <Button
            variant="outline"
            onClick={() =>
              download('research-evidence.json', JSON.stringify(e, null, 2))
            }
          >
            <Download /> Evidence JSON
          </Button>
        </TabsContent>
      </Tabs>
      <div className="caution">
        <AlertTriangle size={16} />
        <span>{e.warnings[0]}</span>
      </div>
    </div>
  );
}
