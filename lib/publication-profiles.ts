import type { Domain } from "./contracts";

/** Fixed, reviewed templates. Domain names never become CSS or asset URLs. */
export const PUBLICATION_PROFILES = [
  {
    id: "publication-trucking-chicas",
    name: "Trucking Chicas",
    host: "truckingchicas.com",
    byline: "Trucking Chicas Research Team",
    color: "#e53935",
  },
  {
    id: "publication-ramos-james",
    name: "Ramos James Law",
    host: "ramosjames.com",
    byline: "Ramos James Law Research Team",
    color: "#011e4d",
  },
  {
    id: "publication-find-austin-lawyer",
    name: "Find Austin Lawyer",
    host: "findaustinlawyer.com",
    byline: "Find Austin Lawyer Research Team",
    color: "#174b75",
  },
] satisfies Domain[];

export function publicationHost(host = "") {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/^www\./, "");
}

export function publicationTheme(domain?: Pick<Domain, "host" | "color">) {
  const host = publicationHost(domain?.host);
  const color = /^#[0-9a-f]{6}$/i.test(domain?.color || "") ? domain!.color : undefined;
  if (host === "truckingchicas.com")
    return {
      key: "trucking-chicas",
      label: "Trucking Chicas · black & red",
      provisional: false,
      description: "Bold sans-serif headings, dark masthead, red accents and warm neutral panels.",
      color: color || "#e53935",
      ink: "#121212",
      accent: "#e53935",
      soft: "#f3e8d9",
      font: '"Inter",system-ui,sans-serif',
      heading: '"Inter",system-ui,sans-serif',
    };
  if (host === "ramosjames.com")
    return {
      key: "ramos-james",
      label: "Ramos James · navy editorial",
      provisional: false,
      description: "Serif headlines, navy typography, light-blue panels and pink accents.",
      color: color || "#011e4d",
      ink: "#011e4d",
      accent: "#fd2489",
      soft: "#f3faff",
      font: '"Avenir LT Std","Avenir Next",Arial,sans-serif',
      heading: '"Ivy Mode",Georgia,serif',
    };
  if (host === "findaustinlawyer.com")
    return {
      key: "find-austin-lawyer",
      label: "Find Austin Lawyer · provisional",
      provisional: true,
      description:
        "Clean blue research-journal layout. Site design could not be verified; review before publishing.",
      color: color || "#174b75",
      ink: "#17344b",
      accent: "#174b75",
      soft: "#eff5fa",
      font: "system-ui,sans-serif",
      heading: "Georgia,serif",
    };
  return {
    key: "custom",
    label: "Custom publication · research journal",
    provisional: false,
    description: "Research-journal layout using your publication name, byline and brand color.",
    color: color || "#245bda",
    ink: "#183047",
    accent: color || "#245bda",
    soft: "#eef3f8",
    font: "system-ui,sans-serif",
    heading: "system-ui,sans-serif",
  };
}
