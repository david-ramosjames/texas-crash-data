"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import type { Cover, Draft, Domain } from "@/lib/contracts";
import { COVER_CAPTION, roadNameWarnings } from "@/lib/editorial";
import { renderPage } from "@/lib/export";
type API = (path: string, body?: unknown) => Promise<any>;
export function EditorialAssets({
  draft,
  edit,
  api,
  revision,
  images,
  dirty,
  jobs,
  onQueued,
}: {
  draft: Draft;
  edit: (patch: Partial<Draft>) => void;
  api: API;
  revision: string;
  images: boolean;
  dirty: boolean;
  jobs: any[];
  onQueued: () => Promise<unknown>;
}) {
  const [covers, setCovers] = useState<Cover[]>([]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    api(`draft-covers/${draft.id}`)
      .then((r) => {
        if (live) {
          setCovers(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [draft.id, revision, api]);
  const job = jobs.find((j) => {
    try {
      return j.kind === "cover" && JSON.parse(j.payload || "{}").draftId === draft.id;
    } catch {
      return false;
    }
  });
  const running = job && ["queued", "running"].includes(job.status);
  async function generate() {
    setPending(true);
    setError("");
    try {
      await api(`draft-covers/${draft.id}`, {});
      await onQueued();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue cover.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="editorial-assets">
      <h3>Cover illustration</h3>
      <p className="fine-print">
        Choose the included image or generate a new cover. Selecting or removing a cover returns the
        draft to review.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="cover-options">
        {covers.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={draft.cover_id === c.id}
            className={"cover-choice " + (draft.cover_id === c.id ? "selected" : "")}
            onClick={() => edit({ cover_id: c.id, cover: c })}
          >
            <img src={c.url} alt={c.alt} loading="lazy" />
            <span>
              {i === 0 ? "Included truck illustration" : "Generated cover"}
              {draft.cover_id === c.id ? " · Selected" : ""}
            </span>
          </button>
        ))}
      </div>
      {draft.cover_id && (
        <Button variant="outline" onClick={() => edit({ cover_id: null, cover: undefined })}>
          Remove cover
        </Button>
      )}
      <Button
        variant="outline"
        disabled={!images || dirty || pending || !!running}
        onClick={generate}
      >
        {pending
          ? "Queuing…"
          : running
            ? "Cover generation in progress"
            : "Generate new cover · API usage"}
      </Button>
      <p className="fine-print">
        {dirty ? "Save your draft before requesting a new cover. " : ""}Generation uses your OpenAI
        API account. Images wait here for selection; nothing is attached or published automatically.
      </p>
      {job && (
        <p className="fine-print" role="status">
          Cover job: {job.status} · {job.progress}
          {job.status === "failed"
            ? ` · ${job.error} Retry explicitly in Data library; another API request may incur a charge.`
            : ""}
          {job.status === "complete" ? " · Choose the generated image above." : ""}
        </p>
      )}
      <p className="fine-print">{COVER_CAPTION}</p>
      {roadNameWarnings(draft.evidence).map((w) => (
        <p key={w} className="cover-warning">
          {w}
        </p>
      ))}
    </section>
  );
}
export function PublicationPreview({ draft, domain }: { draft: Draft; domain?: Domain }) {
  const [src, setSrc] = useState<string>(),
    [error, setError] = useState("");
  const url = draft.cover?.url;
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    setError("");
    if (url)
      fetch(url)
        .then(async (r) => {
          if (!r.ok) throw new Error("Cover preview could not load.");
          const blob = await r.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })
        .then((value) => {
          if (live) setSrc(value);
        })
        .catch(() => {
          if (live) setError("Cover preview could not load. Refresh before exporting.");
        });
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {url && !src && !error ? (
        <p>Loading cover preview…</p>
      ) : (
        <iframe
          title="Publication preview"
          sandbox=""
          className="page-preview"
          srcDoc={renderPage(draft, domain, true, src)}
        />
      )}
    </>
  );
}
