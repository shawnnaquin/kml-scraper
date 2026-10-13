import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseCsvObjects } from './csv.js';
import { matchKey } from './naming.js';

/**
 * Lookup tables for Google Ads geo targets and Microsoft Advertising locations (US only).
 *
 * Both platforms describe a location as "most specific, …, state, country":
 *   Google     "Columbus,Ohio,United States"       (Canonical Name)
 *   Microsoft  "Columbus|Ohio|United States"       (Bing Display Name)
 * so both are indexed by `{target type} -> matchKey(name)|matchKey(state)`.
 */

const placeKey = (name, state, city) => `${matchKey(name)}|${city ? `${matchKey(city)}|` : ''}${matchKey(state ?? '')}`;

/** States and ZIPs are unique nationwide, so they're keyed without a state (ZCTAs don't carry one). */
const STATELESS = new Set(['State', 'Postal Code', 'PostalCode', 'region', 'zip']);

function splitLocation(parts) {
  const [name] = parts;
  const state = parts.length >= 3 ? parts.at(-2) : null; // ["Ohio","United States"] is itself a state
  // "Downtown,Richmond,Virginia,United States": the city tells this Downtown from the others in the state
  const city = parts.length >= 4 ? parts.at(-3) : null;
  return { name, state, city };
}

function addTo(index, type, key, row) {
  if (!index.has(type)) index.set(type, new Map());
  const byKey = index.get(type);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(row);
}

const ACTIVE_FIRST = (a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1);

/**
 * Towns Google qualifies by county or township ("Somerset,Perry County,Ohio", "Albion,Albion,New York"):
 * Census places carry no county, so these are also found by name + state — but only when they're the
 * one such town of that name in the state. Neighborhoods stay city-only ("Downtown" is everywhere).
 */
const QUALIFIED_TOWNS = new Set(['City', 'Municipality', 'Borough']);

export async function loadGoogle(file) {
  if (!file || !existsSync(file)) return null;
  const index = new Map();
  const byId = new Map();
  const qualifiedTowns = new Map();
  const countries = new Map();
  for (const r of parseCsvObjects(await readFile(file, 'utf8'))) {
    if (!['Active', 'Removal Planned'].includes(r.Status)) continue;
    const row = { id: r['Criteria ID'], name: r.Name, canonical: r['Canonical Name'], type: r['Target Type'], active: r.Status === 'Active' };
    // countries by ISO 3166-1 alpha-2 (`Country Code`), not by name ("Czechia" / "Czech Republic"); territories
    // Google files as a top-level Region (Puerto Rico, Hong Kong, Bermuda) count too, a Country row first
    const code = r['Country Code'];
    if (code && (row.type === 'Country' || (!r['Parent ID'] && !row.canonical.includes(',')))) {
      const rank = (c) => (c.type === 'Country' ? 2 : 0) + (c.active ? 1 : 0);
      if (!countries.has(code) || rank(row) > rank(countries.get(code))) countries.set(code, row);
    }
    if (r['Country Code'] !== 'US') continue;
    const { name, state, city } = splitLocation(r['Canonical Name'].split(','));
    // a city-qualified target is only ever matched with its city, never by name + state alone
    addTo(index, row.type, STATELESS.has(row.type) ? placeKey(name, null) : placeKey(name, state, city), row);
    byId.set(row.id, row);
    if (city && QUALIFIED_TOWNS.has(row.type)) {
      const key = placeKey(name, state);
      if (!qualifiedTowns.has(key)) qualifiedTowns.set(key, []);
      qualifiedTowns.get(key).push(row);
    }
  }
  for (const [key, rows] of qualifiedTowns) {
    if (rows.length !== 1 || [...QUALIFIED_TOWNS].some((type) => index.get(type)?.has(key))) continue;
    addTo(index, rows[0].type, key, rows[0]);
  }
  for (const byKey of index.values()) for (const rows of byKey.values()) rows.sort(ACTIVE_FIRST);
  return { index, byId, countries };
}

export async function loadMsft(file) {
  if (!file || !existsSync(file)) return null;
  const index = new Map();
  const byAdwords = new Map();
  for (const r of parseCsvObjects(await readFile(file, 'utf8'))) {
    const display = r['Bing Display Name'] ?? '';
    const parts = display.split('|');
    if (parts.at(-1) !== 'United States' || r.Status === 'Deprecated') continue;
    const row = { id: r['Location Id'], display, type: r['Location Type'], adwords: r['AdWords Location Id'], active: r.Status === 'Active' };
    const { name, state } = splitLocation(parts);
    addTo(index, row.type, placeKey(name, STATELESS.has(row.type) ? null : state), row);
    if (row.adwords) {
      if (!byAdwords.has(row.adwords)) byAdwords.set(row.adwords, []);
      byAdwords.get(row.adwords).push(row);
    }
  }
  for (const byKey of index.values()) for (const rows of byKey.values()) rows.sort(ACTIVE_FIRST);
  return { index, byAdwords };
}

const ABBREVIATIONS = [
  [/\bSt\.?(?= )/g, 'Saint'],
  [/\bSaint\b/g, 'St.'],
  [/\bMt\.?(?= )/g, 'Mount'],
  [/\bMount\b/g, 'Mt.'],
  [/\bFt\.?(?= )/g, 'Fort'],
  [/\bFort\b/g, 'Ft.'],
];

/** "St. Louis" <-> "Saint Louis", "Mt. Vernon" <-> "Mount Vernon", "Ft. Myers" <-> "Fort Myers". */
export function nameVariants(name) {
  const out = [name];
  for (const [re, to] of ABBREVIATIONS) {
    const v = name.replace(re, to);
    if (v !== name && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * First row found for any candidate [name, state, city?] across the given target types, in order: with
 * the city first (a city-qualified target), then by name + state. The row comes back with `via`
 * ('city' | 'state') and `exact` (the platform's name is the candidate's, not a spelling variant), which
 * the `ids` step uses to settle two places claiming one id.
 */
export function lookup(catalog, types, candidates) {
  if (!catalog) return null;
  for (const [name, state, city] of candidates) {
    if (!name) continue;
    for (const [via, key] of [['city', city], ['state', null]]) {
      if (via === 'city' && !key) continue;
      for (const variant of nameVariants(name)) {
        for (const type of types) {
          const hit = catalog.index.get(type)?.get(placeKey(variant, state, key));
          if (hit) return { ...hit[0], via, exact: hit[0].name?.toLowerCase() === String(name).toLowerCase() };
        }
      }
    }
  }
  return null;
}

/** Google DMA Region criteria IDs are 200000 + the Nielsen DMA code (New York, 501 -> 200501). */
export const googleDmaId = (code) => String(200000 + Number(code));

/**
 * Meta (Facebook / Instagram) targeting keys. DMAs and ZIPs have fixed formats; states and cities are
 * opaque keys looked up through the Marketing API (`kml-scraper fetch meta` -> src/<SRCMETAGEO>).
 */
export const metaDmaKey = (code) => `DMA:${Number(code)}`;
export const metaZipKey = (zip) => `US:${zip}`;
/** Meta targets countries by ISO 3166-1 alpha-2 code (`US`). */
export const metaCountryKey = (iso) => (/^[A-Z]{2}$/.test(iso ?? '') ? iso : null);

/**
 * A Natural Earth country's ISO alpha-2: ISO_A2_EH fills the -99s ISO_A2 has for France, Norway, Kosovo
 * (but also gives Australia's code to Ashmore and Cartier, so `exact` says ISO_A2 itself carries it).
 */
export function countryIso(attrs) {
  const valid = (code) => /^[A-Z]{2}$/.test(code ?? '');
  const iso = [attrs.ISO_A2, attrs.ISO_A2_EH].find(valid) ?? null;
  return { iso, exact: valid(attrs.ISO_A2) };
}

/** Meta's region search calls DC "Washington D. C."; Census and Google call it District of Columbia. */
const META_REGION_ALIASES = { 'Washington D. C.': 'District of Columbia' };

/**
 * Meta keys: `fetch meta` (regions) plus any further files in the same columns — tfg's
 * `geo:missing --meta-csv` writes the cities and neighborhoods its Facebook accounts target, which
 * is how city keys get here without ~30k searches.
 */
export async function loadMeta(...files) {
  const present = files.filter((file) => file && existsSync(file));
  if (!present.length) return null;
  const index = new Map();
  const seen = new Set();
  for (const file of present) {
    for (const r of parseCsvObjects(await readFile(file, 'utf8'))) {
      if (r.country_code?.trim() !== 'US' || seen.has(r.key)) continue;
      seen.add(r.key);
      const name = r.name.trim();
      const region = r.region?.trim() ?? '';
      const row = { id: r.key, name, type: r.type, active: true };
      // a region is keyed by its region column: Meta's targeting spec names DC "Washington" (region "District of Columbia")
      const key = r.type === 'region' ? placeKey(META_REGION_ALIASES[region || name] ?? (region || name), null) : placeKey(name, STATELESS.has(r.type) ? null : region);
      addTo(index, r.type, key, row);
    }
  }
  return { index };
}

/** The Trade Desk targets US metros by Nielsen DMA code and postal codes as-is. */
export const ttdDmaId = (code) => String(Number(code));

/**
 * The Trade Desk's standard US geo segments (`fetch ttd`): what an ad group's geo bid list holds
 * (`GeoSegmentId`). Indexed like the others: zip by code, DMA by name, region (state) by name,
 * city by name + state.
 */
export async function loadTtd(file) {
  if (!file || !existsSync(file)) return null;
  const index = new Map();
  for (const r of parseCsvObjects(await readFile(file, 'utf8'))) {
    const row = { id: r.id, name: r.name, type: r.type, active: true };
    addTo(index, r.type, placeKey(r.name, STATELESS.has(r.type) || r.type === 'dma' ? null : r.region), row);
  }
  return { index };
}
