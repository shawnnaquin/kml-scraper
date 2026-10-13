import { existsSync, readdirSync, statSync } from 'node:fs';

/**
 * Every boundary "type" and how to build it. The type name is v1's `type = 'name'` argument and
 * becomes the dist sub-folder.
 *
 *   source.key     package.json#config key for the raw source under src/
 *   source.nameField  attribute that becomes the placemark name when converting non-KML sources
 *                  (a RegExp is matched against the source's field names — ZCTA fields change every decade)
 *   qualifiers     extra attributes folded into the file name between state and place
 *   steps          fixed step list; otherwise steps are worked out from the source (see stepsFor)
 *   google / msft / meta  ad-platform location types this layer is matched against by the `ids` step
 *                  (The Trade Desk and Meta DMA/ZIP IDs are derived from the codes, no lookup needed)
 */
export const TYPES = {
  neighborhood: {
    source: { key: 'SRCNEIGHBORHOOD', nameField: 'Name' },
    qualifiers: ['City'],
    google: ['Neighborhood'],
    msft: ['Neighborhood'],
    meta: ['neighborhood', 'subcity'],
  },
  dma: {
    steps: ['dissolve', 'features', 'simplify', 'ids'],
    source: { key: 'SRCCOUNTY' },
    format: 'json',
    google: ['DMA Region'],
    msft: ['MetroArea'],
  },
  city: {
    source: { key: 'SRCCITY' },
    google: ['City', 'Municipality', 'Borough'],
    msft: ['City'],
    meta: ['city'],
  },
  zip: {
    source: { key: 'SRCZCTA', nameField: /^ZCTA5CE\d*$/i },
    google: ['Postal Code'],
    msft: ['PostalCode'],
  },
  county: {
    source: { key: 'SRCCOUNTY' },
    google: ['County'],
    msft: ['County'],
    meta: ['medium_geo_area'],
  },
  state: {
    source: { key: 'SRCSTATE' },
    google: ['State'],
    msft: ['State'],
    meta: ['region'],
  },
  zillow: {
    source: { key: 'SRCZILLOWFOLDER' },
    google: ['Neighborhood'],
    msft: ['Neighborhood'],
    meta: ['neighborhood', 'subcity'],
    legacy: true,
  },
};

/** Order used by `all` (legacy types like `zillow` only run when asked for by name). */
export const ALL_TYPES = ['neighborhood', 'dma', 'city', 'zip', 'county', 'state'];

export function getType(name) {
  const type = TYPES[name];
  if (!type) throw new Error(`Unknown type "${name}". Expected one of: ${Object.keys(TYPES).join(', ')}`);
  return { format: 'kml', ...type };
}

/** KML sources (a .kml file or a folder of them) go straight to `process`; anything else GDAL reads is converted first. */
export function isKmlSource(path) {
  if (!existsSync(path)) return path.toLowerCase().endsWith('.kml');
  if (statSync(path).isDirectory()) return readdirSync(path).some((f) => f.toLowerCase().endsWith('.kml'));
  return path.toLowerCase().endsWith('.kml');
}

export function stepsFor(typeName, sourcePath) {
  const type = getType(typeName);
  if (type.steps) return type.steps;
  return isKmlSource(sourcePath) ? ['process', 'simplify', 'ids'] : ['shp', 'process', 'simplify', 'ids'];
}
