import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { baseName, humanSize, listFiles, resetDir, totalSize } from '../fsutil.js';
import { parseGeonamesPostal, readZipText } from '../geonames.js';
import { mapPool } from '../pool.js';
import { writeAttributes } from './process.js';

/**
 * The ZIPs to draw as points: every GeoNames ZIP the ZCTA build has no shape for (PO box, unique and
 * single-address ZIPs). A zippoint never exists where `zip` has a place, so the two never share an id.
 */
export function zipPointsWithoutZcta(postal, zctas) {
  return [...postal.values()].filter((row) => !zctas.has(row.zip)).sort((a, b) => a.zip.localeCompare(b.zip));
}

/** One ZIP as a FeatureCollection holding one Point feature. */
export const zipPointFeature = (row) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { Name: row.zip }, geometry: { type: 'Point', coordinates: [row.longitude, row.latitude] } }],
});

/** The attributes the `ids` step names and matches a zippoint by. */
export const zipPointAttributes = (row) => ({
  ZIP: row.zip,
  PLACE: row.place,
  STATE_NAME: row.state,
  STUSPS: row.stateCode,
  COUNTY: row.county,
  ACCURACY: row.accuracy,
});

/**
 * points: src/<SRCZIPPOINT> (GeoNames US.zip) -> dist/simplified/zippoint/{zip}.json for every ZIP
 * the `zip` build has no ZCTA for, plus dist/temp/zippoint/attributes.json for `ids`.
 * Run `zip` first: its dist/simplified/zip is the list of ZIPs that already have an area.
 */
export async function zipPoints(config, typeName, source) {
  const zipDir = config.paths.simple('zip');
  const zctas = new Set((await listFiles(zipDir, 'json')).map(baseName).filter((n) => n !== '_index'));
  if (!existsSync(zipDir) || !zctas.size) throw new Error(`No ZCTAs in ${path.relative(config.root, zipDir)} — run \`zip\` before \`${typeName}\``);

  const postal = parseGeonamesPostal(await readZipText(source, /^US\.txt$/));
  const rows = zipPointsWithoutZcta(postal, zctas);

  const out = config.paths.simple(typeName);
  await resetDir(out);
  const files = await mapPool(rows, async (row) => {
    const file = path.join(out, `${row.zip}.json`);
    await writeFile(file, JSON.stringify(zipPointFeature(row)));
    return file;
  });
  await writeAttributes(config, typeName, Object.fromEntries(rows.map((row) => [row.zip, zipPointAttributes(row)])));
  process.stdout.write(
    `points ${typeName}: ${postal.size} GeoNames ZIPs, ${postal.size - rows.length} have a ZCTA, ` +
      `${rows.length} points ${humanSize(await totalSize(files))} -> ${path.relative(config.root, out)}\n`,
  );
  return { count: rows.length };
}
