import { statSync } from 'node:fs';
import path from 'node:path';
import { ogr2ogr, ogrinfoJson } from '../gdal.js';
import { baseName, listFiles, resetDir } from '../fsutil.js';
import { mapPool } from '../pool.js';
import { ProgressBar } from '../progress.js';

const VECTOR_EXTS = ['shp', 'zip', 'gpkg', 'geojson', 'json', 'fgb', 'gdb'];

/** GDAL path for a source: zipped shapefiles are read in place through /vsizip/, no unzip step. */
export const gdalPath = (file) => (file.toLowerCase().endsWith('.zip') ? `/vsizip/${path.resolve(file)}` : file);

async function resolveNameField(file, nameField) {
  if (!(nameField instanceof RegExp)) return nameField;
  const info = await ogrinfoJson(gdalPath(file));
  const fields = info.layers?.[0]?.fields?.map((f) => f.name) ?? [];
  return fields.find((f) => nameField.test(f));
}

/**
 * shp: any vector source GDAL can read (zipped shapefile, folder of SHPs, GeoPackage…) -> one KML per
 * input in dist/temp/{type}, reprojected to WGS84, ready for `process`.
 * v1 only took a folder of SHP files (Zillow); Census now ships zipped shapefiles, so those come through here too.
 */
export async function shp2kml(config, typeName, source, { nameField, select } = {}) {
  const files = statSync(source).isDirectory()
    ? (await Promise.all(['shp', 'gpkg', 'geojson'].map((ext) => listFiles(source, ext)))).flat()
    : [source];
  if (!files.length || !files.every((f) => VECTOR_EXTS.includes(path.extname(f).slice(1).toLowerCase()))) {
    throw new Error(`No vector files GDAL can convert in ${source}`);
  }

  const out = config.paths.temp(typeName);
  await resetDir(out);

  const bar = new ProgressBar(`shp2kml ${typeName}`, files.length);
  await mapPool(files, async (file) => {
    const name = baseName(file);
    const field = nameField && (await resolveNameField(file, nameField));
    const args = ['-f', 'KML', path.join(out, `${name}.kml`), gdalPath(file), '-t_srs', 'EPSG:4326'];
    // KML has no 64-bit ints; say so up front instead of GDAL warning once per field
    args.push('-mapFieldType', 'Integer64=Real');
    if (field) args.push('-dsco', `NameField=${field}`);
    if (select?.length) args.push('-select', select.join(','));
    await ogr2ogr(args);
    bar.tick(1, name);
  });
  return out;
}
