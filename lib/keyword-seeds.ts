// Observed in Google Keyword Planner on 2026-09-14, not modeled volumes.
// Geography is the searcher's location, not a promise of Texas-specific intent.
export const keywordSnapshot = {
  observed: "2026-09-14",
  period: "September 2025–August 2026",
  geography: "Texas, United States",
  language: "English",
  network: "Google",
  source: "https://ads.google.com/aw/keywordplanner/home",
};
export const keywordSeeds = [
  {
    keyword: "car accident statistics",
    volume: "100–1K",
    cohort: "all",
    group: "month",
    question: "How did monthly reported crash counts change in Texas?",
    note: "Broad statistics intent; this research covers all reported crashes, not passenger cars alone.",
  },
  {
    keyword: "texas car accident statistics",
    volume: "10–100",
    cohort: "all",
    group: "city",
    question: "How were reported crashes distributed across Texas cities?",
    note: "Raw counts, not population- or mileage-adjusted city safety.",
  },
  {
    keyword: "truck accident statistics",
    volume: "10–100",
    cohort: "truck",
    group: "month",
    question: "How did Texas truck-involved crash counts change by month?",
    note: "Truck body styles exclude pickups; not identical to all commercial vehicles.",
  },
  {
    keyword: "dangerous roads",
    volume: "10–100",
    cohort: "all",
    group: "road",
    question: "Which reported Texas roads had the most fatal or serious-injury crashes?",
    note: "Ranks recorded severe crash counts, not risk per trip. Verify road labels.",
  },
  {
    keyword: "pedestrian accidents",
    volume: "10–100",
    cohort: "pedestrian",
    group: "city",
    question: "Where were pedestrian crashes concentrated across Texas cities?",
    note: "A broad topic with mixed intent. Monthly historical data cannot answer live incident queries.",
  },
] as const;
export const keywordFieldGaps = [
  {
    keyword: "drunk driving statistics",
    volume: "100–1K",
    needed:
      "Validated impairment definitions across the relevant person, primary-person and crash fields. First contributing factor alone is incomplete.",
  },
  {
    keyword: "distracted driving statistics",
    volume: "100–1K",
    needed:
      "Validated distraction indicators and all relevant contributing factors. First contributing factor alone is incomplete.",
  },
] as const;
