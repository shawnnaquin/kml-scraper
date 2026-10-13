import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { baseName, listFiles, resetDir } from '../fsutil.js';
import { nameVariants } from '../geoids.js';
import { ogr2ogr } from '../gdal.js';
import { parseGeonamesPostal, parseZipcodes, readZipText } from '../geonames.js';
import { matchKey } from '../naming.js';
import { withFallback } from './points.js';

/**
 * The towns to build: each (town, state) the USPS gives as a ZIP's place name that is not a Census
 * place (`city` already has those), with the ZIPs of it that have a ZCTA shape. "Cypress, TX" and
 * "Greenwell Springs, LA" are mail towns, not incorporated places or CDPs, but ad platforms target them
 * as cities.
 */
export function postalTowns(postal, zctas, censusPlaces) {
  const towns = new Map();
  for (const row of postal.values()) {
    if (!row.place || !row.stateCode || !zctas.has(row.zip)) continue;
    if (nameVariants(row.place).some((name) => censusPlaces.has(matchKey(name, row.stateCode)))) continue;
    const key = matchKey(row.place, row.stateCode);
    if (!towns.has(key)) towns.set(key, { place: row.place, stateCode: row.stateCode, zips: [] });
    towns.get(key).zips.push(row.zip);
  }
  return [...towns.values()].sort((a, b) => a.stateCode.localeCompare(b.stateCode) || a.place.localeCompare(b.place));
}

/**
 * dissolve postaltown: the ZCTA shapes of each postal town's ZIPs (dist/simplified/zip), unioned with
 * SpatiaLite into dist/temp/postaltown/postaltown.json. Run `city`, `zip` (and `fetch geonames`,
 * optionally `fetch zipcodes`) first.
 */
export async function dissolvePostalTowns(config) {
  const say = (msg) => process.stdout.write(`dissolve postaltown: ${msg}\n`);
  const zipDir = config.paths.simple('zip');
  const zctas = new Set((await listFiles(zipDir, 'json')).map(baseName).filter((n) => n !== '_index'));
  const cityAttrs = path.join(config.paths.temp('city'), 'attributes.json');
  if (!zctas.size) throw new Error(`No ZCTAs in ${path.relative(config.root, zipDir)} — run \`zip\` first`);
  if (!existsSync(cityAttrs)) throw new Error(`No ${path.relative(config.root, cityAttrs)} — run \`city\` first`);

  const census = new Set(Object.values(JSON.parse(await readFile(cityAttrs, 'utf8'))).map((a) => matchKey(a.NAME, a.STUSPS)));
  const extra = config.paths.srcFile('SRCZIPCODES');
  const postal = withFallback(
    parseGeonamesPostal(await readZipText(config.paths.srcFile('SRCZIPPOINT'), /^US\.txt$/)),
    existsSync(extra) ? parseZipcodes(JSON.parse(await readFile(extra, 'utf8'))) : null,
  );
  const states = JSON.parse(await readFile(config.paths.srcFile('SRCABBREV'), 'utf8'));
  const towns = postalTowns(postal, zctas, census);
  say(`${towns.length} postal towns that aren't Census places, from ${towns.reduce((n, t) => n + t.zips.length, 0)} ZIPs`);

  const out = config.paths.temp('postaltown');
  await resetDir(out);
  const members = path.join(out, 'members.json');
  const features = [];
  for (const town of towns) {
    for (const zip of town.zips) {
      const { features: zipFeatures } = JSON.parse(await readFile(path.join(zipDir, `${zip}.json`), 'utf8'));
      for (const f of zipFeatures) {
        if (f.geometry) features.push({ type: 'Feature', properties: { town: `${town.place}, ${town.stateCode}`, place: town.place, stusps: town.stateCode, zip }, geometry: f.geometry });
      }
    }
  }
  await writeFile(members, JSON.stringify({ type: 'FeatureCollection', features }));

  const dest = path.join(out, 'postaltown.json');
  await ogr2ogr([
    '-f', 'GeoJSON', dest, members, '-dialect', 'SQLite', '-nln', 'postaltown', '-nlt', 'PROMOTE_TO_MULTI', '-makevalid', '-sql',
    'SELECT town AS name, place AS PLACE, stusps AS STUSPS, GROUP_CONCAT(zip) AS ZIPS, ST_Union(geometry) AS geometry FROM members GROUP BY town, place, stusps',
  ]);
  // the state's name, for matching like a city (`Cypress`, `Texas`)
  const collection = JSON.parse(await readFile(dest, 'utf8'));
  for (const f of collection.features) f.properties.STATE_NAME = states[f.properties.STUSPS] ?? null;
  await writeFile(dest, JSON.stringify(collection));
  say(`${collection.features.length} towns -> ${path.relative(config.root, dest)}`);
  return dest;
}
