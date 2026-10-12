import { existsSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { humanSize, listDirs, listFiles, totalSize } from './fsutil.js';
import { getType, stepsFor, isKmlSource, ALL_TYPES } from './types.js';
import { shp2kml } from './steps/shp2kml.js';
import { topo2geo } from './steps/topo2geo.js';
import { featureCollection2features } from './steps/features.js';
import { processKml } from './steps/process.js';
import { simplify } from './steps/simplify.js';
import { pack } from './steps/pack.js';
import { dissolveDma } from './steps/dissolve.js';
import { geoIds } from './steps/ids.js';
import { fetchSources } from './steps/fetch.js';

export const STEPS = ['shp', 'topo', 'dissolve', 'features', 'process', 'simplify', 'ids'];

export const MESSAGES = {
  warning: "WARNING: YOU'RE CRAZY!\n\n",
  beer: 'Grab a beer, this is going to take minute...\n\n',
};

const say = (msg) => process.stdout.write(msg);
const heading = (msg) => say(`\n== ${msg} ==\n`);

/** Absolute path of a type's raw source (file or folder) under src/. */
export const sourcePath = (config, typeName) => config.paths.srcFile(getType(typeName).source.key);

export function hasSource(config, typeName) {
  const needs = typeName === 'dma' ? ['SRCCOUNTY', 'SRCDMA'] : [getType(typeName).source.key];
  return needs.every((key) => existsSync(config.paths.srcFile(key)));
}

export const typeSteps = (config, typeName) => stepsFor(typeName, sourcePath(config, typeName));

export async function runStep(config, step, typeName) {
  const type = getType(typeName);
  const steps = typeSteps(config, typeName);
  // `topo` is the v1 way to build DMAs and `shp` can always be forced; everything else must be in the plan
  const allowed = [...steps, ...(typeName === 'dma' ? ['topo'] : ['shp'])];
  if (!allowed.includes(step)) {
    throw new Error(`"${step}" isn't a step for ${typeName}. ${typeName} runs: ${steps.join(' -> ')}`);
  }
  const src = sourcePath(config, typeName);
  const needSource = (file = src) => {
    if (!existsSync(file)) {
      throw new Error(`Missing source for ${typeName}: ${path.relative(config.root, file)} — try \`kml-scraper fetch\` or see src/README.md`);
    }
  };

  heading(`${step} ${typeName}`);
  switch (step) {
    case 'shp':
      needSource();
      return shp2kml(config, typeName, src, { nameField: type.source.nameField });
    case 'topo': {
      const topo = config.paths.srcFile('SRCDMA');
      needSource(topo);
      return topo2geo(config, typeName, topo, path.join(config.paths.temp(typeName), 'dma.json'));
    }
    case 'dissolve':
      return dissolveDma(config);
    case 'features': {
      const collection = path.join(config.paths.temp(typeName), 'dma.json');
      if (!existsSync(collection)) throw new Error(`Run \`dissolve ${typeName}\` (or v1's \`topo ${typeName}\`) first`);
      return featureCollection2features(config, typeName, collection);
    }
    case 'process': {
      // converted sources are read from the KML `shp` left in dist/temp; KML sources straight from src
      if (!isKmlSource(src)) {
        const files = await listFiles(config.paths.temp(typeName), 'kml');
        if (!files.length) throw new Error(`Run \`shp ${typeName}\` first`);
        return processKml(config, typeName, files, { qualifiers: type.qualifiers });
      }
      needSource();
      const files = statSync(src).isDirectory() ? await listFiles(src, 'kml') : [src];
      return processKml(config, typeName, files, { qualifiers: type.qualifiers });
    }
    case 'simplify':
      return simplify(config, typeName, type.format);
    case 'ids':
      return geoIds(config, typeName);
  }
}

export async function runType(config, typeName, { only } = {}) {
  for (const step of typeSteps(config, typeName)) {
    if (!only || only(step)) await runStep(config, step, typeName);
  }
}

/** Types we can actually build — `all` skips (and reports) the ones whose src files you haven't downloaded. */
function availableTypes(config) {
  const ready = ALL_TYPES.filter((t) => hasSource(config, t));
  const missing = ALL_TYPES.filter((t) => !ready.includes(t));
  if (missing.length) {
    say(`skipping (no source in ${path.relative(config.root, config.src)}/): ${missing.map((t) => `${t} [${path.basename(sourcePath(config, t))}]`).join(', ')}\n`);
  }
  return ready;
}

export async function bumpPatch(config) {
  const file = path.join(config.root, 'package.json');
  const raw = await readFile(file, 'utf8');
  const pkg = JSON.parse(raw);
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  await writeFile(file, raw.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
  say(`version ${pkg.version} -> ${next}\n`);
  return next;
}

export async function all(config) {
  say(MESSAGES.warning);
  for (const t of availableTypes(config)) await runType(config, t);
  await bumpPatch(config);
  return pack(config);
}

export async function allComplex(config) {
  for (const t of availableTypes(config)) await runType(config, t, { only: (s) => !['simplify', 'ids'].includes(s) });
}

export async function allSimplify(config) {
  say(MESSAGES.beer);
  for (const t of ALL_TYPES) {
    if (!existsSync(config.paths.complex(t))) continue;
    await runStep(config, 'simplify', t);
    await runStep(config, 'ids', t);
  }
}

export { pack, fetchSources };

export async function clean(config) {
  await rm(config.dist, { recursive: true, force: true });
  say(`removed ${path.relative(config.root, config.dist)}/\n`);
}

export async function sizeof(config) {
  const dirs = await listDirs(config.paths.simpleRoot);
  if (!dirs.length) return say('dist/simplified is empty\n');
  for (const dir of dirs) {
    const files = await listFiles(dir, 'json');
    say(`${humanSize(await totalSize(files)).padStart(8)}  ${String(files.length).padStart(6)} files  ${path.basename(dir)}\n`);
  }
}
