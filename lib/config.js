import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_JSON = path.join(ROOT, 'package.json');

/**
 * Everything is still driven by `package.json#config`, same keys as v1.
 * Any key can be overridden with an env var of the same name,
 * e.g. `PRECISION=0.0005 npm run simplify:county`.
 */
export function loadConfig(root = ROOT) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = { ...pkg.config };
  for (const key of Object.keys(config)) {
    if (process.env[key] !== undefined) config[key] = process.env[key];
  }

  const src = path.resolve(root, config.SRCFOLDER);
  const dist = path.resolve(root, config.DISTFOLDER);

  return {
    root,
    version: pkg.version,
    raw: config,
    precision: Number(config.PRECISION),
    geoPrecision: Number(config.GEOPRECISION),
    src,
    dist,
    paths: {
      temp: (type) => path.join(dist, config.DISTTEMPFOLDER, type),
      complex: (type) => path.join(dist, config.DISTCOMPLEXFOLDER, type),
      simple: (type) => path.join(dist, config.DISTSIMPLEFOLDER, type),
      simpleRoot: path.join(dist, config.DISTSIMPLEFOLDER),
      zips: path.join(dist, config.DISTRIBUTIONZIPFOLDER),
      srcFile: (key) => path.join(src, config[key]),
    },
  };
}
