export const FILE_TYPES = [
  'crash',
  'unit',
  'lookup',
  'primaryperson',
  'person',
  'charges',
  'damages',
  'endorsements',
  'restrictions',
] as const;
export type FileKind = (typeof FILE_TYPES)[number];
export const COHORTS = {
  all: 'All crashes',
  truck: 'Truck / truck-tractor involved',
  cmv: 'Commercial motor vehicle involved',
  pedestrian: 'Pedestrian involved',
  cyclist: 'Cyclist involved',
  motorcycle: 'Motorcycle involved',
  pickup: 'Pickup involved',
  suv: 'SUV involved',
  car: 'Passenger car involved',
} as const;
export const GROUPS = {
  city: 'City',
  county: 'County',
  intersection: 'Reported intersection',
  road: 'Reported road',
  month: 'Month',
  weekday: 'Day of week',
  hour: 'Hour of day',
  weather: 'Weather',
  light: 'Lighting',
  make: 'Vehicle make',
  color: 'Vehicle color',
  body: 'Vehicle body style',
} as const;
export type Spec = {
  cohort: keyof typeof COHORTS;
  group: keyof typeof GROUPS;
  metric: 'crashes' | 'severe' | 'fatal';
  start: string;
  end: string;
  city?: string;
  county?: string;
  make?: string;
  color?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  min: number;
  limit: number;
};
export type ResultRow = {
  label: string;
  crashes: number;
  severe: number;
  fatal: number;
  deaths: number;
  serious: number;
  share?: number;
};
export type Evidence = {
  comparison?: {
    start: string;
    end: string;
    rows: ResultRow[];
    total: number;
    caveat: string;
  };
  spec: Spec;
  rows: ResultRow[];
  total: number;
  severe: number;
  fatal: number;
  unlocated: number;
  excluded: number;
  warnings: string[];
  sources: { id: string; extraction: string; start: string; end: string }[];
  generated: string;
  engine: string;
  sql: string;
  parameters: unknown[];
};
export type Finding = {
  id: string;
  title: string;
  category: string;
  summary: string;
  score: number;
  status: string;
  evidence: Evidence;
  created: string;
  updated: string;
};
export type Draft = {
  id: string;
  finding_id?: string;
  title: string;
  slug: string;
  channel: string;
  domain_id?: string;
  body: string;
  status: string;
  evidence: Evidence;
  created: string;
  updated: string;
};
export type Domain = {
  id: string;
  name: string;
  host: string;
  byline: string;
  color: string;
};
export const number = (v: unknown) => Number(v || 0).toLocaleString('en-US');
export const titleCase = (v: string) =>
  v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
export const period = (s: { start: string; end: string }) =>
  `${s.start} – ${s.end}`;
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 110);
