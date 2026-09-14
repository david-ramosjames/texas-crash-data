"use client";
import type { Spec } from "@/lib/contracts";
import { Input } from "./ui/input";
import { Choice } from "./choice";
export function ExtraFilters({ spec, onChange }: { spec: Spec; onChange: (s: Spec) => void }) {
  return (
    <>
      {(
        [
          ["road", "Reported road"],
          ["weather", "Weather"],
          ["light", "Lighting"],
          ["model", "Vehicle model"],
          ["factor", "First contributing factor"],
        ] as const
      ).map(([k, label]) => (
        <div className="field" key={k}>
          <label htmlFor={`extra-${k}`}>{label} (exact label)</label>
          <Input
            id={`extra-${k}`}
            value={spec[k] || ""}
            onChange={(e) => onChange({ ...spec, [k]: e.target.value })}
          />
        </div>
      ))}
      <Choice
        label="Rural / urban"
        value={spec.rural || ""}
        onChange={(v) => onChange({ ...spec, rural: v || undefined })}
        options={{ "": "All", Y: "Rural", N: "Urban" }}
      />
      {(
        [
          ["hourFrom", "Hour from (0–23)"],
          ["hourThrough", "Hour through (0–23)"],
          ["speedMin", "Posted speed minimum"],
          ["speedMax", "Posted speed maximum"],
          ["yearMin", "Vehicle year from"],
          ["yearMax", "Vehicle year through"],
        ] as const
      ).map(([k, label]) => (
        <div className="field" key={k}>
          <label htmlFor={`extra-${k}`}>{label}</label>
          <Input
            id={`extra-${k}`}
            type="number"
            value={spec[k] ?? ""}
            onChange={(e) =>
              onChange({ ...spec, [k]: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </div>
      ))}
    </>
  );
}
export function ComparisonFilter({ spec, onChange }: { spec: Spec; onChange: (s: Spec) => void }) {
  return (
    <Choice
      label="Compare with"
      value={spec.compare || ""}
      onChange={(v) => onChange({ ...spec, compare: (v || undefined) as Spec["compare"] })}
      options={{
        "": "No comparison",
        year_over_year: "Same dates one year earlier",
        previous_period: "Previous equal-length period",
      }}
    />
  );
}
