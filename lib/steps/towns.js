import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nameVariants } from '../geoids.js';
import { matchKey } from '../naming.js';

const INDEX = '_index.json';

/**
 * The town a PO box (`zippoint`) is in, by the USPS town name and state its ZIP carries: the Census
 * place (`city`, by the same name variants `postaltown` skips them by), else the postal town of that
 * name. Null when there's none, or when the name fits two places.
 *
 * @param {{ PLACE?: string, STUSPS?: string }} attrs  the zippoint's attributes (points step)
 * @param {Map<string, string[]>} cities  matchKey(NAME, STUSPS) -> city files
 * @param {Map<string, string[]>} postalTowns  matchKey(PLACE, STUSPS) -> postaltown files
 */
export function townOf(attrs, cities, postalTowns) {
  if (!attrs?.PLACE || !attrs?.STUSPS) return null;
  const found = (byKey, keys) => [...new Set(keys.flatMap((k) => byKey.get(k) ?? []))];

  const city = found(cities, nameVariants(attrs.PLACE).map((name) => matchKey(name, attrs.STUSPS)));
  if (city.length) return city.length === 1 ? { type: 'city', file: city[0] } : null;

  const town = found(postalTowns, [matchKey(attrs.PLACE, attrs.STUSPS)]);
  return town.length === 1 ? { type: 'postaltown', file: town[0] } : null;
}

/** Each place's file by its key from a type's attributes.json (`dist/temp/{type}`) and `_index.json`. */
async function filesByKey(config, typeName, keyOf) {
  const attrsFile = path.join(config.paths.temp(typeName), 'attributes.json');
  const indexFile = path.join(config.paths.simple(typeName), INDEX);
  if (!existsSync(attrsFile) || !existsSync(indexFile)) return null;

  const attributes = JSON.parse(await readFile(attrsFile, 'utf8'));
  const { places } = JSON.parse(await readFile(indexFile, 'utf8'));
  const byKey = new Map();
  for (const place of places) {
    const attrs = attributes[place.name];
    if (!attrs) continue;
    const key = keyOf(attrs);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(place.file);
  }
  return byKey;
}

/**
 * towns: writes `town` ({type, file} or null) on every place in dist/simplified/zippoint/_index.json,
 * the `city` or `postaltown` shape tfg draws the PO box as. Runs after `ids` of `zippoint`, `city` and
 * `postaltown`, whichever comes last, so a rebuild of any of them keeps the links; a no-op until
 * `zippoint` and `city` are built.
 */
export async function linkTowns(config) {
  const indexFile = path.join(config.paths.simple('zippoint'), INDEX);
  const attrsFile = path.join(config.paths.temp('zippoint'), 'attributes.json');
  const cities = await filesByKey(config, 'city', (a) => matchKey(a.NAME, a.STUSPS));
  if (!existsSync(indexFile) || !existsSync(attrsFile) || !cities) return null;
  const postalTowns = (await filesByKey(config, 'postaltown', (a) => matchKey(a.PLACE, a.STUSPS))) ?? new Map();

  const attributes = JSON.parse(await readFile(attrsFile, 'utf8'));
  const index = JSON.parse(await readFile(indexFile, 'utf8'));
  const counts = { city: 0, postaltown: 0, none: 0 };
  for (const place of index.places) {
    place.town = townOf(attributes[place.name], cities, postalTowns);
    counts[place.town?.type ?? 'none']++;
  }
  index.matched = { ...index.matched, town: counts.city + counts.postaltown };
  await writeFile(indexFile, JSON.stringify(index));

  process.stdout.write(`towns zippoint: ${index.places.length} PO boxes, city ${counts.city}, postal town ${counts.postaltown}, none ${counts.none}\n`);
  return counts;
}
