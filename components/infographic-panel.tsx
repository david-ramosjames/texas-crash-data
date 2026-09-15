"use client";
import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import type { Draft, Domain } from "@/lib/contracts";
import { renderInfographic } from "@/lib/infographic";

async function pngFromSvg(svg: Blob) {
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Image conversion timed out. Try the SVG download.")),
        15000,
      );
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Image conversion failed. Try the SVG download."));
      };
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    if (!canvas.width || !canvas.height || canvas.width * canvas.height > 10_000_000)
      throw new Error("Unsupported image dimensions. Download SVG instead.");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG conversion is unavailable. Download SVG instead.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG conversion failed. Download SVG instead."))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function InfographicPanel({
  draft,
  domain,
  dirty,
}: {
  draft: Draft;
  domain?: Domain;
  dirty: boolean;
}) {
  const [created, setCreated] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const approved = !dirty && ["approved", "exported"].includes(draft.status);
  const graphic = useMemo(() => {
    if (!created) return {};
    try {
      return { svg: renderInfographic(draft, domain, !approved) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not create infographic." };
    }
  }, [created, draft, domain, approved]);
  async function download(format: "png" | "svg") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/export/${encodeURIComponent(draft.id)}?format=infographic`,
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Could not export infographic.");
      }
      const svg = await response.blob(),
        blob = format === "png" ? await pngFromSvg(svg) : svg;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `${draft.slug}-infographic.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack-fields">
      <h3>Create an infographic</h3>
      <p>
        Publication branding, date range, full-query totals and up to five ranked groups. Built from
        the saved evidence, with no AI image charges or new database scan.
      </p>
      {!created && <Button onClick={() => setCreated(true)}>Create infographic preview</Button>}
      {created && (
        <>
          <p className="fine-print">
            Preview updates when you change the headline or publication. The infographic is separate
            from your cover and does not replace it.
          </p>
          {!approved && (
            <p role="status">
              Save your draft, review the infographic, then approve for export to unlock downloads.
              You can preview without saving.
            </p>
          )}
          {graphic.error && <p role="alert">{graphic.error}</p>}
          {graphic.svg && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!approved || busy} onClick={() => download("png")}>
                  {busy ? "Preparing download…" : "Download PNG"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!approved || busy}
                  onClick={() => download("svg")}
                >
                  Download SVG
                </Button>
              </div>
              <p className="fine-print">
                PNG for posts and newsletters. SVG for scalable web/print use. Full methods and
                evidence accompany the article ZIP.
              </p>
              <img
                src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(graphic.svg)}
                alt="Infographic preview with verified crash counts, ranked groups, dates and methodology"
                style={{
                  display: "block",
                  width: "100%",
                  maxWidth: 800,
                  height: "auto",
                  border: "1px solid #dbe2e7",
                }}
              />
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
