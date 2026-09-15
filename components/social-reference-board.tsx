"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import type { Draft } from "@/lib/contracts";
export function SocialReferenceBoard({
  draft,
  notes,
  onNotes,
}: {
  draft: Draft;
  notes: string;
  onNotes: (v: string) => void;
}) {
  const [reference, setReference] = useState(
      draft.social_reference_id ? `/api/social-reference/${draft.id}` : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 8_000_000) {
      setError("Choose a PNG or JPEG reference under 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/social-reference/${draft.id}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed.");
      setReference(`/api/social-reference/${draft.id}?v=${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Reference style board</summary>
      <p className="fine-print">
        Save a screenshot privately with this draft for side-by-side comparison. Use the style and
        alignment controls to match its layout. It is not analyzed by AI or included in your post;
        publication colors always come from your profile.
      </p>
      <input
        aria-label="Upload style reference"
        type="file"
        accept="image/png,image/jpeg"
        disabled={busy}
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {busy && <p role="status">Saving reference privately…</p>}
      {reference && (
        <>
          <img
            src={reference}
            alt="Saved style reference; not part of the exported post"
            style={{ maxWidth: 320, width: "100%", marginTop: 12 }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await fetch(`/api/social-reference/${draft.id}/remove`, {
                  method: "POST",
                });
                if (!r.ok) throw new Error("Could not remove reference.");
                setReference("");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Remove failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Detach reference
          </Button>
        </>
      )}
      <label htmlFor="reference-notes">Saved design notes</label>
      <Textarea
        id="reference-notes"
        maxLength={1000}
        value={notes}
        placeholder="Large photo, white uppercase headline, dark gradient; use our own colors."
        onChange={(e) => onNotes(e.target.value)}
      />
      <p className="fine-print">
        Images save immediately; design notes save with your draft. Notes are a design reminder, not
        instructions sent to AI. Detaching a reference keeps its private archived original.
      </p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
