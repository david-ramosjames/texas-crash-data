"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { pngFromSvg } from "./infographic-panel";
import {
  socialDesign,
  socialCaption,
  defaultSocialHeadline,
  renderSocialCard,
  SOCIAL_STYLES,
  type SocialDesign,
} from "@/lib/social";
import { narrativeOnly } from "@/lib/editorial";
import type { Draft, Domain } from "@/lib/contracts";
import { SocialReferenceBoard } from "./social-reference-board";
export function SocialEditor({
  draft,
  domain,
  drafts,
  domains,
  edit,
  dirty,
}: {
  draft: Draft;
  domain?: Domain;
  drafts: Draft[];
  domains: Domain[];
  edit: (p: Partial<Draft>) => void;
  dirty: boolean;
}) {
  const [photo, setPhoto] = useState<string>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [slide, setSlide] = useState(0);
  const settings = socialDesign(draft.social_json, false),
    approved = !dirty && ["approved", "exported"].includes(draft.status);
  const update = (patch: Partial<SocialDesign>) => {
    edit({ social_json: JSON.stringify({ ...settings, ...patch }) });
    setSlide(0);
  };
  useEffect(() => {
    let active = true;
    setPhoto(undefined);
    setError("");
    if (draft.cover?.url)
      fetch(draft.cover.url)
        .then(async (r) => {
          if (!r.ok) throw new Error("Could not load the selected illustration.");
          const blob = await r.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })
        .then((v) => {
          if (active) setPhoto(v);
        })
        .catch(() => {
          if (active)
            setError("Cover preview could not load. Choose another illustration or refresh.");
        });
    return () => {
      active = false;
    };
  }, [draft.cover?.url]);
  const preview = useMemo(() => {
    try {
      return {
        svg: renderSocialCard(draft, domain, photo, settings.carousel ? slide : 0, !approved),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not render social card." };
    }
  }, [draft, domain, photo, slide, approved, settings.carousel]);
  async function download(format: "png" | "svg" | "copy") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(
        `/api/export/${encodeURIComponent(draft.id)}?format=${format === "copy" ? "txt" : "social-image&slide=" + slide}`,
      );
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Export failed.");
      }
      if (format === "copy") {
        await navigator.clipboard.writeText(await r.text());
        setMessage("Caption copied. Nothing has been posted.");
        return;
      }
      const svg = await r.blob(),
        blob = format === "png" ? await pngFromSvg(svg) : svg,
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `${draft.slug}-social-${slide + 1}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Export failed. If clipboard access is unavailable, download caption.txt from the export panel.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack-fields">
      <h2>Social post studio</h2>
      <p>
        One caption and a feed-ready image—not a web page. Your publication controls the colors; the
        style controls the layout.
      </p>
      <div className="field">
        <label htmlFor="social-caption">Post caption</label>
        <Textarea
          id="social-caption"
          rows={7}
          value={narrativeOnly(draft.body)}
          onChange={(e) => edit({ body: e.target.value })}
        />
        <p className="fine-print">
          Source and date details are added below the caption. Full evidence stays in the Evidence
          tab and export package.
        </p>
      </div>
      <div className="field">
        <label htmlFor="article-link">Article link (optional)</label>
        <Input
          id="article-link"
          type="url"
          value={settings.articleUrl}
          placeholder="https://your-site.com/published-article/"
          onChange={(e) => update({ articleUrl: e.target.value })}
        />
        <p className="fine-print">
          Confirm the article is live before sharing. An approved draft is not automatically
          published.
        </p>
      </div>
      <details>
        <summary>Use an article’s intended URL</summary>
        <div className="grid gap-2 mt-2">
          {drafts
            .filter((d) => d.channel === "page" && d.status === "approved" && d.domain_id)
            .map((d) => (
              <Button
                key={d.id}
                variant="outline"
                onClick={() => {
                  const host = domains.find((x) => x.id === d.domain_id)?.host;
                  if (host) update({ articleUrl: `https://${host}/${d.slug}/` });
                }}
              >
                {d.title}
              </Button>
            ))}
        </div>
      </details>
      <div>
        <h3>Card style</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SOCIAL_STYLES).map(([key, label]) => (
            <Button
              key={key}
              variant={settings.style === key ? "default" : "outline"}
              aria-pressed={settings.style === key}
              onClick={() => update({ style: key as SocialDesign["style"] })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {settings.style === "photo" && (
        <>
          <div className="field">
            <label htmlFor="social-headline">Image headline (optional override)</label>
            <Textarea
              id="social-headline"
              rows={3}
              maxLength={180}
              value={settings.headline}
              placeholder={defaultSocialHeadline(draft)}
              onChange={(e) => update({ headline: e.target.value })}
            />
            <p className="fine-print">
              Leave blank to use the verified lead group and count. Custom wording needs a factual
              review.
            </p>
          </div>
          <div className="flex gap-2">
            {(["center", "left"] as const).map((align) => (
              <Button
                key={align}
                variant={settings.align === align ? "default" : "outline"}
                aria-pressed={settings.align === align}
                onClick={() => update({ align })}
              >
                {align === "center" ? "Centered headline" : "Left-aligned headline"}
              </Button>
            ))}
          </div>
        </>
      )}
      <label className="flex gap-2 items-center">
        <input
          type="checkbox"
          checked={settings.carousel}
          onChange={(e) => update({ carousel: e.target.checked })}
        />
        Create a three-slide carousel: lead card, ranking, context
      </label>
      <SocialReferenceBoard
        key={draft.id}
        draft={draft}
        notes={settings.referenceNotes}
        onNotes={(referenceNotes) => update({ referenceNotes })}
      />
      <h3>Post preview</h3>
      {settings.carousel && (
        <div className="flex flex-wrap gap-2">
          {["Lead", "Ranking", "Context"].map((label, i) => (
            <Button
              key={label}
              variant={slide === i ? "default" : "outline"}
              onClick={() => setSlide(i)}
            >
              {i + 1}. {label}
            </Button>
          ))}
        </div>
      )}
      <div
        style={{
          border: "1px solid #dbe2e7",
          borderRadius: 12,
          overflow: "hidden",
          maxWidth: 600,
          background: "#fff",
        }}
      >
        <div style={{ padding: 18 }}>
          <strong>{domain?.name || "Select a publication"}</strong>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{socialCaption(draft)}</p>
        </div>
        {preview.svg ? (
          <img
            style={{ display: "block", width: "100%", height: "auto" }}
            src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(preview.svg)}
            alt={`Social ${["lead", "ranking", "context"][slide]} card with verified dates and source`}
          />
        ) : (
          <p role="status" style={{ padding: 18 }}>
            {preview.error}
          </p>
        )}
      </div>
      {!approved && (
        <p role="status">
          Save your changes and approve the post to unlock downloads and caption copying. You can
          preview while editing.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!approved || busy || !preview.svg} onClick={() => download("png")}>
          {busy
            ? "Preparing…"
            : `Download ${settings.carousel ? "slide " + (slide + 1) + " " : ""}PNG`}
        </Button>
        <Button
          variant="outline"
          disabled={!approved || busy || !preview.svg}
          onClick={() => download("svg")}
        >
          Download SVG
        </Button>
        <Button variant="outline" disabled={!approved || busy} onClick={() => download("copy")}>
          Copy approved caption
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
