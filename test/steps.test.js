import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from '../lib/config.js';
import { featureCollection2features } from '../lib/steps/features.js';
import { processKml } from '../lib/steps/process.js';
import { pack } from '../lib/steps/pack.js';
import { runStep } from '../lib/pipeline.js';

const fixture = (name) => path.join(ROOT, 'test/fixtures', name);
const hasGdal = (() => {
  try {
    execFileSync('ogr2ogr', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A throwaway project root: package.json + the small src lookup tables. */
function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'kml-scraper-'));
  cpSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  mkdirSync(path.join(root, 'src'));
  for (const f of ['statefips.json', 'stateabbrev.json', 'dmainfo.json']) cpSync(path.join(ROOT, 'src', f), path.join(root, 'src', f));
  return loadConfig(root);
}

test('process: worker threads write one KML per place into dist/complex/<type>', async () => {
  const config = sandbox();
  const stats = await processKml(config, 'city', [fixture('census-place.kml'), fixture('gdal-neighborhood.kml')]);
  assert.equal(stats.written, 3);
  assert.deepEqual(readdirSync(config.paths.complex('city')).sort(), [
    'alabama_abbeville.kml',
    'alabama_canon_town__co.kml',
    'vermont_graniteville-east_barre.kml',
  ]);
});

test('features: DMA FeatureCollection -> one file per DMA named from dmainfo, src left untouched', async () => {
  const config = sandbox();
  const before = readFileSync(config.paths.srcFile('SRCDMAINFO'), 'utf8');
  const temp = config.paths.temp('dma');
  mkdirSync(temp, { recursive: true });
  const collection = path.join(temp, 'nielsentopo.json');
  writeFileSync(
    collection,
    JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { id: '500', dma: 500, dma1: 'Portland-Auburn, ME' }, geometry: null }],
    }),
  );

  await featureCollection2features(config, 'dma', collection);

  const out = JSON.parse(readFileSync(path.join(config.paths.complex('dma'), 'portland-auburn_me.json'), 'utf8'));
  assert.equal(out.features.length, 1);
  const [feature] = out.features;
  assert.equal(feature.id, 0);
  assert.equal(feature.properties.id, undefined, 'topology id is stripped');
  // the feature's own properties win; dmainfo (TV homes, rank, …) is merged in
  assert.equal(feature.properties.dma, 500);
  assert.equal(feature.properties.dma1, 'Portland-Auburn, ME');
  assert.equal(feature.properties.Rank, '80');
  assert.equal(feature.properties['TV Homes'], '389530');
  assert.equal(readFileSync(config.paths.srcFile('SRCDMAINFO'), 'utf8'), before);
  assert.equal(JSON.parse(readFileSync(path.join(temp, 'dmainfo.json'), 'utf8'))['500'].dma, 500);
});

test('pack: one zip per simplified type plus the all-in-one zip', async () => {
  const config = sandbox();
  for (const type of ['county', 'dma']) {
    mkdirSync(config.paths.simple(type), { recursive: true });
    writeFileSync(path.join(config.paths.simple(type), `${type}-a.json`), '{}');
  }
  await pack(config);
  const year = new Date().getFullYear();
  const { version } = JSON.parse(readFileSync(path.join(config.root, 'package.json'), 'utf8'));
  assert.deepEqual(readdirSync(config.paths.zips).sort(), [
    `all-simplified-boundaries-${year}-${version}.zip`,
    `county-${year}-${version}.zip`,
    `dma-${year}-${version}.zip`,
  ]);
  const listing = execFileSync('python3', ['-m', 'zipfile', '-l', path.join(config.paths.zips, `county-${year}-${version}.zip`)], { encoding: 'utf8' });
  assert.match(listing, /simplified\/county\/county-a\.json/);
  assert.doesNotMatch(listing, /dma/);
});

test('dma pipeline end to end (needs GDAL)', { skip: !hasGdal && 'ogr2ogr not on PATH — run `npm run docker:test`' }, async () => {
  const config = sandbox();
  cpSync(fixture('dma-topo.json'), config.paths.srcFile('SRCDMA'));
  for (const step of ['topo', 'features', 'simplify']) await runStep(config, step, 'dma');
  const out = JSON.parse(readFileSync(path.join(config.paths.simple('dma'), 'portland-auburn_me.json'), 'utf8'));
  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].properties.dma1, 'Portland-Auburn, ME');
});

test('kml simplify end to end (needs GDAL)', { skip: !hasGdal && 'ogr2ogr not on PATH — run `npm run docker:test`' }, async () => {
  const config = sandbox();
  await processKml(config, 'county', [fixture('census-place.kml')]);
  await runStep(config, 'simplify', 'county');
  const out = JSON.parse(readFileSync(path.join(config.paths.simple('county'), 'alabama_abbeville.json'), 'utf8'));
  assert.equal(out.features[0].properties.Name, 'alabama_abbeville');
});
