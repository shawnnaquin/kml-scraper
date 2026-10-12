import { existsSync } from 'node:fs';
import path from 'node:path';
import { ogr2ogr } from '../gdal.js';
import { baseName, humanSize, listFiles, resetDir, totalSize } from '../fsutil.js';
import { mapPool } from '../pool.js';
import { ProgressBar } from '../progress.js';

/**
 * simplify: dist/complex/{type}/*.{kml|json} -> dist/simplified/{type}/*.json, geoJSON that the
 * Google Maps JS API can load directly.
 *   kml  -> simplified with PRECISION (degrees) tolerance
 *   json -> written with GEOPRECISION decimal places (DMA shapes are already coarse)
 * Still the slow one, but it now runs one ogr2ogr per core instead of one at a time.
 */
export async function simplify(config, typeName, format) {
  const complex = config.paths.complex(typeName);
  const files = await listFiles(complex, format);
  if (!existsSync(complex) || !files.length) {
    throw new Error(`Nothing to simplify in ${path.relative(config.root, complex)} — run the earlier ${typeName} steps first`);
  }

  const out = config.paths.simple(typeName);
  await resetDir(out);

  const bar = new ProgressBar(`simplify ${typeName}`, files.length);
  const outputs = await mapPool(files, async (file) => {
    const name = baseName(file);
    const dest = path.join(out, `${name}.json`);
    const args =
      format === 'kml'
        ? ['-f', 'GeoJSON', '-simplify', String(config.precision), dest, file]
        : ['-f', 'GeoJSON', '-lco', `COORDINATE_PRECISION=${config.geoPrecision}`, dest, file];
    await ogr2ogr(args);
    bar.tick(1, name);
    return dest;
  });

  process.stdout.write(`done ${humanSize(await totalSize(outputs))}\t${path.relative(config.root, out)}\n`);
  return out;
}
