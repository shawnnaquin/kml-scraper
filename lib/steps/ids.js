import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toCsv } from '../csv.js';
import { baseName, listFiles } from '../fsutil.js';
import { countryIso, googleDmaId, loadGoogle, loadMeta, loadMsft, loadTtd, lookup, metaCountryKey, metaDmaKey, metaZipKey, ttdDmaId } from '../geoids.js';
import { matchKey } from '../naming.js';
import { mapPool } from '../pool.js';
import { ProgressBar } from '../progress.js';
import { getType } from '../types.js';
import { linkTowns } from './towns.js';

const INDEX = '_index.json';

/**
 * `_index.json`'s version. tfg's `geo:import` reads `type` and, per place, `file`, `name`, `label`,
 * `ids.google`, `ids.meta`, `ids.ttd_segment`, `names.google` and a zippoint's `town` (TFG_CONSUMER.md);
 * bump this when any of those change shape.
 */
export const INDEX_SCHEMA = 1;

/** The Trade Desk segment type each layer's places are looked up as (`fetch ttd`). */
const TTD_TYPES = { zip: 'zip', zippoint: 'zip', dma: 'dma', state: 'region', city: 'city', postaltown: 'city', country: 'country' };

/** Layers whose ids must not collide with another layer's: that layer's ids are left alone. */
const DEFERS_TO = { zillow: 'neighborhood', zippoint: 'zip', postaltown: 'city' };

/** Everything we know about one place, in the shape the `ids` step and the viewer use. */
function describe(typeName, name, attrs, lookups) {
  const { statefips, stateabbrev, abbrevByState } = lookups;
  const stateAbbr = attrs.STUSPS ?? attrs.State?.toUpperCase();
  const state = attrs.STATE_NAME ?? statefips[attrs.STATEFP] ?? stateabbrev[stateAbbr] ?? null;
  const abbr = stateAbbr ?? abbrevByState.get(matchKey(state ?? ''));

  switch (typeName) {
    case 'state':
      return { label: attrs.NAME, state: attrs.NAME, abbr, geoid: attrs.GEOID, candidates: [[attrs.NAME, null]], extraKeys: [attrs.NAME, abbr] };
    case 'county':
      return {
        label: `${attrs.NAMELSAD ?? attrs.NAME}, ${state}`,
        state,
        abbr,
        geoid: attrs.GEOID,
        // "Orleans Parish", "Anchorage Municipality"; independent cities (VA, Carson City) are Cities to Google
        candidates: [[attrs.NAMELSAD, state], [attrs.NAME, state], [`${attrs.NAME} County`, state]],
        fallbackTypes: ['City'],
      };
    case 'city':
      return { label: `${attrs.NAME}, ${state}`, state, abbr, geoid: attrs.GEOID, candidates: [[attrs.NAME, state]] };
    case 'postaltown':
      return { label: `${attrs.PLACE}, ${state}`, state, abbr, geoid: `${attrs.PLACE}, ${abbr}`, candidates: [[attrs.PLACE, state]] };
    case 'zip': {
      const code = Object.entries(attrs).find(([k]) => /^ZCTA5CE/i.test(k))?.[1] ?? attrs.GEOID20 ?? attrs.NAME ?? name;
      return { label: code, state: null, abbr: null, geoid: code, candidates: [[code, null]], extraKeys: [code] };
    }
    case 'zippoint': {
      const code = attrs.ZIP ?? name;
      return {
        label: attrs.PLACE ? `${code} (${attrs.PLACE}, ${attrs.STUSPS})` : code,
        state,
        abbr,
        geoid: code,
        candidates: [[code, null]],
        extraKeys: [code],
      };
    }
    case 'country': {
      const { iso, exact } = countryIso(attrs);
      return { label: attrs.NAME ?? name, state: null, abbr: null, geoid: iso, iso, isoExact: exact, candidates: [], extraKeys: [attrs.NAME_LONG, attrs.ADMIN, iso] };
    }
    case 'dma':
      return {
        label: attrs.dma1 ?? ([attrs['Designated Market Area (DMA)'], attrs.states?.replaceAll(',', '-')].filter(Boolean).join(', ') || name),
        state: null,
        abbr: null,
        geoid: String(attrs.dma),
        candidates: [],
        googleId: googleDmaId(attrs.dma),
        extraKeys: [attrs.dma1, attrs['Designated Market Area (DMA)'], String(attrs.dma)],
      };
    default: {
      // neighborhood / zillow
      const place = attrs.Name ?? attrs.NAME ?? name;
      const city = attrs.City;
      return {
        label: [place, city, abbr].filter(Boolean).join(', '),
        state,
        abbr,
        geoid: attrs.OvertureId ?? attrs.RegionID ?? null,
        // with its city: Google qualifies some neighborhoods by city ("Downtown,Richmond,Virginia")
        candidates: [[place, state, city]],
        extraKeys: city ? [`${place} ${city} ${state}`, `${place} ${city} ${abbr}`] : [],
      };
    }
  }
}

function keysFor(place, d, google, msft) {
  const name = d.candidates[0]?.[0];
  const keys = [
    d.label,
    ...(d.extraKeys ?? []),
    name && d.state && `${name} ${d.state}`,
    name && d.abbr && `${name} ${d.abbr}`,
    google?.canonical,
    google?.canonical?.replace(/,United States$/, ''),
    google?.name && d.state && `${google.name} ${d.state}`,
    msft?.display,
    msft?.display?.replace(/\|United States$/, ''),
  ];
  return [...new Set(keys.filter(Boolean).map((k) => matchKey(k)))];
}

/**
 * ids: match every simplified place to its ad-platform location IDs — Google Ads Criteria ID (also what
 * Display & Video 360 uses), Microsoft Advertising Location Id, Meta targeting key, The Trade Desk metro/ZIP —
 * write those (plus the Census attributes: GEOID, NAMELSAD, …) into each geoJSON's properties, and write
 * dist/simplified/{type}/_index.json — the lookup table the map viewer joins campaign reports against.
 *
 * Google IDs come from src/<SRCGOOGLEGEO> (`kml-scraper fetch google`); DMA IDs are derived (200000 + code).
 * Microsoft IDs come from src/<SRCMSFTGEO>: via its "AdWords Location Id" column first, then by name.
 * Meta state/city keys come from src/<SRCMETAGEO> (`fetch meta`); Meta and Trade Desk DMA/ZIP IDs are derived.
 */
export async function geoIds(config, typeName) {
  const type = getType(typeName);
  const dir = config.paths.simple(typeName);
  const files = (await listFiles(dir, 'json')).filter((f) => path.basename(f) !== INDEX);
  if (!files.length) throw new Error(`Nothing in ${path.relative(config.root, dir)} — run \`simplify ${typeName}\` first`);

  const attrsFile = path.join(config.paths.temp(typeName), 'attributes.json');
  const attributes = existsSync(attrsFile) ? JSON.parse(await readFile(attrsFile, 'utf8')) : {};
  if (!existsSync(attrsFile)) process.stdout.write(`ids ${typeName}: no attributes.json (re-run process/features) — matching on names only\n`);

  const [statefips, stateabbrev, google, msft, meta, ttdSegments] = await Promise.all([
    readFile(config.paths.srcFile('SRCFIPS'), 'utf8').then(JSON.parse),
    readFile(config.paths.srcFile('SRCABBREV'), 'utf8').then(JSON.parse),
    loadGoogle(config.paths.srcFile('SRCGOOGLEGEO')),
    loadMsft(config.paths.srcFile('SRCMSFTGEO')),
    loadMeta(config.paths.srcFile('SRCMETAGEO'), config.paths.srcFile('SRCMETATARGETED')),
    loadTtd(config.paths.srcFile('SRCTTDGEO')),
  ]);
  // the legacy Zillow layer only fills Google / Meta neighborhoods the Overture one didn't claim; a zippoint never takes a ZCTA's id
  const claimed = DEFERS_TO[typeName] ? await claimedIds(config, DEFERS_TO[typeName]) : { google: new Set(), meta: new Set(), ttd_segment: new Set() };
  const abbrevByState = new Map(Object.entries(stateabbrev).map(([abbr, name]) => [matchKey(name), abbr]));
  if (!google) process.stdout.write(`ids ${typeName}: no Google geotargets file — run \`kml-scraper fetch google\`\n`);
  if (!msft) process.stdout.write(`ids ${typeName}: no Microsoft locations file — Microsoft IDs skipped (see README)\n`);

  const bar = new ProgressBar(`ids ${typeName}`, files.length);
  const places = await mapPool(files, async (file) => {
    const name = baseName(file);
    const attrs = attributes[name] ?? { NAME: name };
    const d = describe(typeName, name, attrs, { statefips, stateabbrev, abbrevByState });

    let g = d.googleId ? (google?.byId.get(d.googleId) ?? { id: d.googleId, canonical: null, type: 'DMA Region' }) : null;
    // a country's ids are its ISO code's; one that only borrows it (ISO_A2_EH) loses a tie (settleClaims)
    if (typeName === 'country') g = d.iso && google?.countries.get(d.iso) ? { ...google.countries.get(d.iso), exact: d.isoExact } : null;
    g ??= lookup(google, type.google, d.candidates) ?? lookup(google, d.fallbackTypes ?? [], d.candidates);

    let m = null;
    if (msft && g) m = (msft.byAdwords.get(g.id) ?? []).find((row) => type.msft.includes(row.type)) ?? null;
    m ??= lookup(msft, type.msft, d.candidates);

    let fb = null;
    if (typeName === 'dma') fb = { id: metaDmaKey(attrs.dma), name: d.label };
    else if (typeName === 'zip' || typeName === 'zippoint') fb = { id: metaZipKey(d.geoid), name: d.geoid };
    else if (typeName === 'country') fb = metaCountryKey(d.iso) && { id: metaCountryKey(d.iso), name: d.label, exact: d.isoExact };
    else fb = lookup(meta, type.meta ?? [], d.candidates);

    if (g && claimed.google.has(g.id)) g = null;
    if (fb && claimed.meta.has(fb.id)) fb = null;

    const ttd = typeName === 'dma' ? ttdDmaId(attrs.dma) : typeName === 'zip' || typeName === 'zippoint' ? d.geoid : null;
    // a DMA or country goes by its names (a country by Google's too: TTD says "United States")
    const named = typeName === 'dma' || typeName === 'country'
      ? [d.label, ...d.extraKeys, typeName === 'country' ? g?.name : null].filter(Boolean).map((k) => [k, null])
      : d.candidates;
    let ttdSegment = TTD_TYPES[typeName] ? lookup(ttdSegments, [TTD_TYPES[typeName]], named) : null;
    if (ttdSegment && claimed.ttd_segment.has(ttdSegment.id)) ttdSegment = null;

    const place = {
      file: path.basename(file),
      name,
      label: d.label,
      state: d.state,
      geoid: d.geoid ?? null,
      ids: { google: g?.id ?? null, msft: m?.id ?? null, meta: fb?.id ?? null, ttd, ttd_segment: ttdSegment?.id ?? null },
      names: { google: g?.canonical ?? null, msft: m?.display ?? null, meta: fb?.name ?? null },
    };
    place.keys = keysFor(place, d, g, m);
    // how the ids were found, for settling two places that claim one (below); not written out
    Object.defineProperty(place, 'how', { value: { google: g, meta: fb, ttd_segment: ttdSegment } });

    Object.defineProperty(place, 'attrs', { value: attrs });
    bar.tick(1, name);
    return place;
  });

  places.sort((a, b) => a.name.localeCompare(b.name));
  const ambiguous = settleClaims(places);

  await mapPool(places, async (place) => {
    const file = path.join(dir, place.file);
    const geojson = JSON.parse(await readFile(file, 'utf8'));
    for (const feature of geojson.features) {
      feature.properties = {
        Name: place.name,
        label: place.label,
        google_criteria_id: place.ids.google,
        google_canonical_name: place.names.google,
        msft_location_id: place.ids.msft,
        msft_display_name: place.names.msft,
        meta_location_key: place.ids.meta,
        ttd_geo_id: place.ids.ttd,
        ttd_segment_id: place.ids.ttd_segment,
        ...place.attrs,
      };
    }
    await writeFile(file, JSON.stringify(geojson));
  });
  const matched = Object.fromEntries(['google', 'msft', 'meta', 'ttd', 'ttd_segment'].map((k) => [k, places.filter((p) => p.ids[k]).length]));
  await writeFile(
    path.join(dir, INDEX),
    JSON.stringify({ schema: INDEX_SCHEMA, type: typeName, generated: new Date().toISOString(), count: places.length, matched, places }),
  );
  await mkdir(config.paths.temp(typeName), { recursive: true });
  await writeFile(
    path.join(config.paths.temp(typeName), 'ambiguous.csv'),
    toCsv([['platform', 'id', 'places', 'kept'], ...ambiguous.map((a) => [a.platform, a.id, a.places.join(' | '), a.kept ?? ''])]),
  );
  const unmatched = places.filter((p) => !p.ids.google);
  await writeFile(
    path.join(config.paths.temp(typeName), 'unmatched-google.csv'),
    toCsv([['name', 'label', 'geoid'], ...unmatched.map((p) => [p.name, p.label, p.geoid])]),
  );

  const pct = (n) => `${((n / places.length) * 100).toFixed(1)}%`;
  process.stdout.write(
    `ids ${typeName}: ${places.length} places, Google ${matched.google} (${pct(matched.google)})` +
      (msft ? `, Microsoft ${matched.msft} (${pct(matched.msft)})` : '') +
      (matched.meta ? `, Meta ${matched.meta} (${pct(matched.meta)})` : '') +
      (matched.ttd ? `, Trade Desk ${matched.ttd} (${pct(matched.ttd)})` : '') +
      (matched.ttd_segment ? `, Trade Desk segments ${matched.ttd_segment} (${pct(matched.ttd_segment)})` : '') +
      (ambiguous.length ? `, ${ambiguous.length} ids claimed by several places (${ambiguous.filter((a) => !a.kept).length} left empty)` : '') +
      ` -> ${path.relative(config.root, path.join(dir, INDEX))}\n`,
  );
  // a PO box's town: whichever of the three is rebuilt last links them again
  if (['zippoint', 'city', 'postaltown'].includes(typeName)) await linkTowns(config);
  return { count: places.length, matched };
}

/**
 * One platform id, one place. When several places claim an id, the one matched by its city wins, then
 * the one whose name is the platform's exactly (not "Lakeview" for "Lake View"); if that still leaves a
 * tie, nobody gets it — an empty id is better than drawing the wrong place.
 */
export function settleClaims(places) {
  const out = [];
  for (const platform of ['google', 'meta', 'ttd_segment']) {
    const byId = new Map();
    for (const place of places) {
      const id = place.ids[platform];
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(place);
    }
    for (const [id, claims] of byId) {
      if (claims.length < 2) continue;
      const score = (p) => (p.how?.[platform]?.via === 'city' ? 2 : 0) + (p.how?.[platform]?.exact ? 1 : 0);
      const best = Math.max(...claims.map(score));
      const top = claims.filter((p) => score(p) === best);
      const kept = top.length === 1 ? top[0] : null;
      for (const p of claims) {
        if (p === kept) continue;
        p.ids[platform] = null;
        if (platform === 'google') p.names.google = null;
        if (platform === 'meta') p.names.meta = null;
      }
      out.push({ platform, id, places: claims.map((p) => p.label), kept: kept?.label ?? null });
    }
  }
  return out;
}

/** Google, Meta and Trade Desk segment ids another layer's `_index.json` already holds. */
async function claimedIds(config, typeName) {
  const file = path.join(config.paths.simple(typeName), INDEX);
  if (!existsSync(file)) {
    process.stdout.write(`ids: no ${typeName} ${INDEX} yet — run \`${typeName}\` first, or both layers may claim one place\n`);
    return { google: new Set(), meta: new Set(), ttd_segment: new Set() };
  }
  const { places } = JSON.parse(await readFile(file, 'utf8'));
  const ids = (platform) => new Set(places.map((p) => p.ids[platform]).filter(Boolean));
  return { google: ids('google'), meta: ids('meta'), ttd_segment: ids('ttd_segment') };
}
