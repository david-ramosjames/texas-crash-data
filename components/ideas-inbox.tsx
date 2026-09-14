"use client";
import { useState } from "react";
import { COHORTS, GROUPS, Spec } from "@/lib/contracts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Choice } from "./choice";
import { ExtraFilters, ComparisonFilter } from "./research-fields";
import { keywordFieldGaps, keywordSnapshot } from "@/lib/keyword-seeds";
type Props = {
  ideas: any[];
  summary: any;
  api: (path: string, body?: unknown) => Promise<any>;
  refresh: () => Promise<any>;
  selectFinding: (id: string) => void;
};
export function IdeasInbox({ ideas, summary, api, refresh, selectFinding }: Props) {
  const [filter, setFilter] = useState("suggested"),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [plannerContext, setPlannerContext] = useState("");
  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  const base: Spec = {
    cohort: "all",
    group: "city",
    metric: "crashes",
    start: summary.start,
    end: summary.end,
    min: 10,
    limit: 15,
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Ideas to research</h2>
          <p>
            Potential questions, not verified findings. Approve only the research you want to run.
          </p>
        </div>
        <div className="button-row">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => setEditing({ question: "", spec: base })}
          >
            Add a question
          </Button>
          <Button
            disabled={busy || !summary.crashes}
            onClick={() =>
              act(async () => {
                await api("ideas/propose", {});
                setNotice(
                  "Idea generation queued. It reads cached coverage, not all crash records.",
                );
              })
            }
          >
            Suggest more ideas
          </Button>
        </div>
      </div>
      <p className="fine-print">
        Editorial templates and AI hypotheses are not measured search demand. Keyword Planner cards
        cite the observed topic, estimate, geography and period—not search volume for the proposed
        headline. Google Ads competition is not SEO difficulty.
      </p>
      <details className="advanced">
        <summary>Search opportunities that need more data fields</summary>
        <p>
          Observed in Google Keyword Planner: {keywordSnapshot.geography},{" "}
          {keywordSnapshot.language}, {keywordSnapshot.network}, {keywordSnapshot.period}.
        </p>
        {keywordFieldGaps.map((k) => (
          <p key={k.keyword}>
            <strong>
              {k.keyword}: {k.volume} monthly searches.
            </strong>{" "}
            {k.needed}
          </p>
        ))}
        <p>
          These are a research backlog, not currently executable or verified findings. No reliable
          LLM question-volume data is available here.
        </p>
      </details>
      <details className="advanced">
        <summary>Import Google Keyword Planner ideas</summary>
        <p>
          Export up to 500 selected keywords using the English Keyword Planner CSV. The app
          preserves estimates or ranges exactly and does not treat them as LLM prompt volume.
        </p>
        <div className="field">
          <label htmlFor="planner-context">
            Export settings: location, language, network and date range
          </label>
          <Input
            id="planner-context"
            value={plannerContext}
            onChange={(e) => setPlannerContext(e.target.value)}
            placeholder="Texas; English; Google; Sep 2025–Aug 2026"
          />
        </div>
        <div className="field">
          <label htmlFor="planner-file">Keyword Planner CSV / TSV</label>
          <input
            id="planner-file"
            type="file"
            accept=".csv,.tsv,.txt"
            disabled={busy || plannerContext.trim().length < 10}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              act(async () => {
                if (file.size > 750000) throw new Error("Select an export smaller than 750 KB.");
                const bytes = new Uint8Array(await file.arrayBuffer());
                const encoding =
                  bytes[0] === 255 && bytes[1] === 254
                    ? "utf-16le"
                    : bytes[0] === 254 && bytes[1] === 255
                      ? "utf-16be"
                      : "utf-8";
                const result = await api("ideas/keyword-planner", {
                  text: new TextDecoder(encoding).decode(bytes),
                  context: plannerContext,
                });
                setNotice(
                  `${result.accepted} keyword candidates processed; ${result.skipped} unsupported intents skipped. Repeated question-and-filter pairs are kept once. No research was run.`,
                );
              });
              e.target.value = "";
            }}
          />
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="filter-grid">
        <Choice
          label="Idea status"
          value={filter}
          onChange={setFilter}
          options={{
            suggested: "Awaiting approval",
            queued: "Approved / processing",
            complete: "Researched",
            dismissed: "Dismissed",
            all: "All ideas",
          }}
        />
        <div className="field">
          <label htmlFor="idea-search">Search questions</label>
          <Input id="idea-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {editing && (
        <div className="panel">
          <h3>{editing.id ? "Edit and approve research" : "New research question"}</h3>
          <div className="field">
            <label htmlFor="idea-question">Question</label>
            <Input
              id="idea-question"
              value={editing.question}
              onChange={(e) => setEditing({ ...editing, question: e.target.value })}
            />
          </div>
          <div className="filter-grid">
            <Choice
              label="Involvement"
              value={editing.spec.cohort}
              onChange={(v) => setEditing({ ...editing, spec: { ...editing.spec, cohort: v } })}
              options={COHORTS}
            />
            <Choice
              label="Group by"
              value={editing.spec.group}
              onChange={(v) => setEditing({ ...editing, spec: { ...editing.spec, group: v } })}
              options={GROUPS}
            />
            <Choice
              label="Rank by"
              value={editing.spec.metric}
              onChange={(v) => setEditing({ ...editing, spec: { ...editing.spec, metric: v } })}
              options={{
                crashes: "Crashes",
                severe: "Fatal / serious crashes",
                fatal: "Fatal crashes",
              }}
            />
            {(["city", "start", "end"] as const).map((k) => (
              <div className="field" key={k}>
                <label htmlFor={`idea-${k}`}>
                  {k === "start" ? "From" : k === "end" ? "Through" : "City (exact label)"}
                </label>
                <Input
                  id={`idea-${k}`}
                  type={k === "city" ? "text" : "date"}
                  value={editing.spec[k] || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, spec: { ...editing.spec, [k]: e.target.value } })
                  }
                />
              </div>
            ))}
            <ComparisonFilter
              spec={editing.spec}
              onChange={(spec) => setEditing({ ...editing, spec })}
            />
            {(["min", "limit"] as const).map((k) => (
              <div className="field" key={k}>
                <label htmlFor={`idea-${k}`}>
                  {k === "min" ? "Minimum crashes per group" : "Maximum results (1–100)"}
                </label>
                <Input
                  id={`idea-${k}`}
                  type="number"
                  min={1}
                  value={editing.spec[k]}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      spec: { ...editing.spec, [k]: Number(e.target.value) },
                    })
                  }
                />
              </div>
            ))}
          </div>
          <details className="advanced">
            <summary>Additional research filters</summary>
            <div className="filter-grid">
              <ExtraFilters
                spec={editing.spec}
                onChange={(spec) => setEditing({ ...editing, spec })}
              />
              {(["county", "make", "color"] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`idea-${k}`}>{k} (exact label)</label>
                  <Input
                    id={`idea-${k}`}
                    value={editing.spec[k] || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, spec: { ...editing.spec, [k]: e.target.value } })
                    }
                  />
                </div>
              ))}
            </div>
          </details>
          <p className="fine-print">
            These filters define the query. Editing question wording alone does not change its
            filters. Results are reported counts, not risk per mile.
          </p>
          <div className="button-row">
            <Button
              disabled={busy || !editing.question.trim()}
              onClick={() =>
                act(async () => {
                  await api(editing.id ? `ideas/${editing.id}/approve` : "ideas", {
                    question: editing.question,
                    spec: editing.spec,
                  });
                  setNotice(
                    editing.id
                      ? "Approved research is queued on the worker."
                      : "Question saved for approval.",
                  );
                  setEditing(null);
                })
              }
            >
              {editing.id ? "Approve and run research" : "Save idea (do not run)"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="findings-grid">
        {ideas
          .filter(
            (i) =>
              (filter === "all" || i.status === filter) &&
              i.question.toLowerCase().includes(search.toLowerCase()),
          )
          .map((i) => (
            <article className="finding-card" key={i.id}>
              <div className="card-top">
                <span className="pill">{i.source}</span>
                <span className="pill">
                  {i.job_status === "failed" ? "Needs attention" : i.status}
                </span>
              </div>
              <p className="fine-print">
                {i.spec.start} – {i.spec.end}
                {i.spec.compare ? " · Comparison planned" : ""}
              </p>
              <h3>{i.question}</h3>
              <p>{i.rationale}</p>
              {i.demand && <p>{i.demand}</p>}
              {i.job_error && <p role="alert">{i.job_error}</p>}
              <div className="button-row">
                {i.status === "suggested" && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => setEditing({ ...i, spec: { ...i.spec } })}
                    >
                      Review plan and approve
                    </Button>
                    <Button
                      disabled={busy}
                      variant="ghost"
                      onClick={() =>
                        act(async () => {
                          await api(`ideas/${i.id}/status`, { status: "dismissed" });
                        })
                      }
                    >
                      Dismiss
                    </Button>
                  </>
                )}
                {i.status === "dismissed" && (
                  <Button
                    onClick={() =>
                      act(async () => {
                        await api(`ideas/${i.id}/status`, { status: "suggested" });
                      })
                    }
                  >
                    Restore
                  </Button>
                )}
                {i.job_status === "failed" && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api(`jobs/${i.job_id}/retry`, {});
                      })
                    }
                  >
                    Retry research
                  </Button>
                )}
                {i.finding_id && (
                  <Button variant="outline" onClick={() => selectFinding(i.finding_id)}>
                    View evidence
                  </Button>
                )}
              </div>
            </article>
          ))}
      </div>
      {!ideas.length && (
        <p>No ideas yet. Select “Suggest more ideas” to build your approval list.</p>
      )}
    </section>
  );
}
