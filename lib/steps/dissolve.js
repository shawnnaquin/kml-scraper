import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsvObjects, toCsv } from '../csv.js';
import { resetDir } from '../fsutil.js';
import { ogr2ogr } from '../gdal.js';
import { gdalPath } from './shp2kml.js';

/** Territories aren't part of Nielsen's DMA map. */
const NO_DMA_STATEFP = ['60', '66', '69', '72', '78'];

/**
 * dissolve: build current DMA shapes from current Census counties.
 *
 * Nielsen DMAs are groups of whole counties, but the only free DMA polygons (src/nielsentopo.json) are
 * a decade old and coarse. So:
 *   1. each county in SRCCOUNTY is assigned to the old DMA polygon containing a point inside it
 *      (or the nearest one if it falls in a gap along the coast)
 *   2. src/county-dma-overrides.csv wins over that — Alaska/Hawaii aren't in the old file at all
 *   3. counties are unioned per DMA with SpatiaLite
 * The result has crisp, current county edges, and dist/temp/dma/county-dma.csv records every assignment.
 */
export async function dissolveDma(config) {
  const out = config.paths.temp('dma');
  await resetDir(out);
  const work = path.join(out, 'work.gpkg');
  const countySource = config.paths.srcFile('SRCCOUNTY');
  const dmaSource = config.paths.srcFile('SRCDMA');
  for (const f of [countySource, dmaSource]) {
    if (!existsSync(f)) throw new Error(`Missing ${path.relative(config.root, f)} — try \`kml-scraper fetch census\``);
  }

  const say = (msg) => process.stdout.write(`dissolve dma: ${msg}\n`);
  say(`loading counties from ${path.basename(countySource)} and DMAs from ${path.basename(dmaSource)}`);
  await ogr2ogr([
    '-f', 'GPKG', work, gdalPath(countySource), '-nln', 'counties', '-t_srs', 'EPSG:4326', '-nlt', 'PROMOTE_TO_MULTI',
    '-where', `STATEFP NOT IN (${NO_DMA_STATEFP.map((f) => `'${f}'`).join(',')})`,
    '-ct_opt', 'WARN_ABOUT_DIFFERENT_COORD_OP=NO',
  ]);
  await ogr2ogr(['-update', '-f', 'GPKG', work, dmaSource, '-nln', 'dma_old', '-makevalid', '-nlt', 'PROMOTE_TO_MULTI']);

  say('assigning counties to DMAs');
  const spatialCsv = path.join(out, 'county-dma-spatial.csv');
  await ogr2ogr([
    '-f', 'CSV', spatialCsv, work, '-dialect', 'SQLite', '-sql',
    'SELECT c.GEOID, c.NAME, c.STUSPS, c.STATEFP, ' +
      '(SELECT d.dma FROM dma_old d WHERE ST_Intersects(d.geom, ST_PointOnSurface(c.geom)) LIMIT 1) AS dma FROM counties c',
  ]);
  let spatial = parseCsvObjects(await readFile(spatialCsv, 'utf8')).map((r) => ({ ...r, method: r.dma ? 'within' : '' }));

  // counties in a gap between the coarse old polygons (coastal islands, tiny VA cities): nearest DMA
  const gaps = spatial.filter((r) => !r.dma).map((r) => `'${r.GEOID}'`);
  if (gaps.length) {
    const nearestCsv = path.join(out, 'county-dma-nearest.csv');
    await ogr2ogr([
      '-f', 'CSV', nearestCsv, work, '-dialect', 'SQLite', '-sql',
      // SQLite returns the row holding the MIN() for bare columns
      `SELECT c.GEOID, d.dma, MIN(ST_Distance(d.geom, ST_PointOnSurface(c.geom))) AS distance FROM counties c, dma_old d WHERE c.GEOID IN (${gaps.join(',')}) GROUP BY c.GEOID`,
    ]);
    const nearest = new Map(parseCsvObjects(await readFile(nearestCsv, 'utf8')).map((r) => [r.GEOID, r.dma]));
    spatial = spatial.map((r) => (r.dma ? r : { ...r, dma: nearest.get(r.GEOID) ?? '', method: 'nearest' }));
  }

  const overridesFile = config.paths.srcFile('SRCCOUNTYDMA');
  const overrides = existsSync(overridesFile) ? parseCsvObjects(await readFile(overridesFile, 'utf8')) : [];
  const byGeoid = new Map(overrides.filter((o) => o.geoid.length === 5).map((o) => [o.geoid, o.dma]));
  const byState = new Map(overrides.filter((o) => o.geoid.length === 2).map((o) => [o.geoid, o.dma]));

  const rows = spatial.map((r) => {
    if (byGeoid.has(r.GEOID)) return { ...r, dma: byGeoid.get(r.GEOID), method: 'override' };
    if (byState.has(r.STATEFP)) return { ...r, dma: byState.get(r.STATEFP), method: 'override (state)' };
    return r;
  });
  const assignment = path.join(out, 'county-dma.csv');
  await writeFile(assignment, toCsv([['GEOID', 'NAME', 'STUSPS', 'dma', 'method'], ...rows.map((r) => [r.GEOID, r.NAME, r.STUSPS, r.dma, r.method])]));

  const count = (m) => rows.filter((r) => r.method.startsWith(m)).length;
  say(`${rows.length} counties: ${count('within')} inside a DMA, ${count('nearest')} nearest, ${count('override')} overridden`);
  for (const r of rows.filter((r) => r.method === 'nearest')) say(`  nearest: ${r.NAME}, ${r.STUSPS} -> ${r.dma}`);

  say('unioning counties per DMA');
  await ogr2ogr(['-update', '-f', 'GPKG', work, assignment, '-nln', 'assign']);
  const union =
    "SELECT CAST(a.dma AS INTEGER) AS dma, COUNT(*) AS counties, GROUP_CONCAT(DISTINCT c.STUSPS) AS states, ST_Union(c.geom) AS geom FROM counties c JOIN assign a ON a.GEOID = c.GEOID WHERE a.dma <> '' GROUP BY a.dma";
  const dest = path.join(out, 'dma.json');
  const geojson = ['-f', 'GeoJSON', dest, work, '-dialect', 'SQLite', '-nln', 'dma', '-nlt', 'PROMOTE_TO_MULTI', '-makevalid', '-sql'];

  // A few DMAs split a county (Palm Springs is the east end of Riverside County), so no county lands in them.
  // Keep their old polygon, clipped to the county it sits in, and cut it out of the DMA that county went to.
  const oldCsv = path.join(out, 'dma-old.csv');
  await ogr2ogr(['-f', 'CSV', oldCsv, work, '-dialect', 'SQLite', '-sql', 'SELECT DISTINCT CAST(dma AS INTEGER) AS dma FROM dma_old']);
  const assigned = new Set(rows.map((r) => String(Number(r.dma))));
  const split = parseCsvObjects(await readFile(oldCsv, 'utf8')).map((r) => r.dma).filter((d) => d && !assigned.has(d));
  if (!split.length) {
    await ogr2ogr([...geojson, union]);
  } else {
    say(`county-splitting DMAs kept from the old map: ${split.join(', ')}`);
    await ogr2ogr(['-update', '-f', 'GPKG', work, work, '-dialect', 'SQLite', '-nln', 'dma_union', '-nlt', 'PROMOTE_TO_MULTI', '-sql', union]);
    await ogr2ogr([
      '-update', '-f', 'GPKG', work, work, '-dialect', 'SQLite', '-nln', 'dma_split', '-nlt', 'PROMOTE_TO_MULTI', '-makevalid', '-sql',
      'SELECT CAST(d.dma AS INTEGER) AS dma, CAST(a.dma AS INTEGER) AS host, c.STUSPS AS states, ' +
        'ST_Intersection(d.geom, c.geom) AS geom FROM dma_old d ' +
        'JOIN counties c ON ST_Intersects(c.geom, ST_PointOnSurface(d.geom)) JOIN assign a ON a.GEOID = c.GEOID ' +
        `WHERE CAST(d.dma AS INTEGER) IN (${split.join(',')})`,
    ]);
    await ogr2ogr([
      ...geojson,
      'SELECT u.dma, u.counties, u.states, ' +
        'COALESCE(ST_Difference(u.geom, (SELECT ST_Union(s.geom) FROM dma_split s WHERE s.host = u.dma)), u.geom) AS geom FROM dma_union u ' +
        'UNION ALL SELECT s.dma, 0 AS counties, s.states, s.geom FROM dma_split s',
    ]);
  }
  const { features } = JSON.parse(await readFile(dest, 'utf8'));
  say(`${features.length} DMAs -> ${path.relative(config.root, dest)}`);
  return dest;
}
