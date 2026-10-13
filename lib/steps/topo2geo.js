import path from 'node:path';
import { ogr2ogr } from '../gdal.js';
import { resetDir } from '../fsutil.js';

/**
 * topo: a single topoJSON file -> a single geoJSON FeatureCollection in dist/temp/{type}.
 * Replaces v1's Python 2 + shapely script; `-makevalid` stands in for its `buffer(0)` repair.
 * v2 builds DMAs with `dissolve` instead; this is kept for the original Nielsen shapes.
 */
export async function topo2geo(config, typeName, sourceFile, dest) {
  await resetDir(path.dirname(dest));
  process.stdout.write(`topo2geo ${typeName}: ${path.basename(sourceFile)} -> ${path.relative(config.root, dest)}\n`);
  await ogr2ogr(['-f', 'GeoJSON', '-makevalid', dest, sourceFile]);
  return dest;
}
