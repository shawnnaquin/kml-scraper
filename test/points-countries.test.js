import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWriteStream, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { toCsv } from '../lib/csv.js';
import { loadConfig, ROOT } from '../lib/config.js';
import { countryIso, loadGoogle, metaCountryKey } from '../lib/geoids.js';
import { parseGeonamesPostal } from '../lib/geonames.js';
import { runStep } from '../lib/pipeline.js';
import { zipPointsWithoutZcta } from '../lib/steps/points.js';
import { geoIds } from '../lib/steps/ids.js';

const GEONAMES = [
  ['US', '70130', 'New Orleans', 'Louisiana', 'LA', 'Orleans', '071', '', '', '29.9435', '-90.0703', '4'],
  ['US', '70502', 'Lafayette', 'Louisiana', 'LA', 'Lafayette', '055', '', '', '30.2241', '-92.0198', '4'],
  ['US', '70469', 'Slidell', 'Louisiana', 'LA', 'Saint Tammany', '103', '', '', '30.2752', '-89.7812', '4'],
  ['US', '09001', 'APO AA', '', '', '', '', '', '', '38.1105', '15.6613', ''],
  ['US', '96860', 'Jbphh', 'Hawaii', 'HI', 'Honolulu', '003', '', '', '21.316', '-157.8677', '1'],
  ['US', '96860', 'FPO AA', '', '', '', '', '', '', '21.3448', '-157.9774', '4'],
  ['US', '99999', 'Nowhere', 'Alaska', 'AK', '', '', '', '', '', '', ''],
]
  .map((r) => r.join('\t'))
  .join('\n');

const GOOGLE = toCsv([
  ['Criteria ID', 'Name', 'Canonical Name', 'Parent ID', 'Country Code', 'Target Type', 'Status'],
  ['9012130', '70130', '70130,Louisiana,United States', '21152', 'US', 'Postal Code', 'Active'],
  ['9012502', '70502', '70502,Louisiana,United States', '21152', 'US', 'Postal Code', 'Active'],
  ['2840', 'United States', 'United States', '', 'US', 'Country', 'Active'],
  ['2203', 'Czechia', 'Czechia', '', 'CZ', 'Country', 'Active'],
  ['2036', 'Australia', 'Australia', '', 'AU', 'Country', 'Active'],
  ['2250', 'France', 'France', '', 'FR', 'Country', 'Active'],
  ['2630', 'Puerto Rico', 'Puerto Rico', '', 'PR', 'Region', 'Active'],
  ['9070168', 'Pembroke Parish', 'Pembroke Parish,Bermuda', '2060', 'BM', 'Region', 'Active'],
]);

const TTD = toCsv([
  ['id', 'type', 'name', 'region', 'segment_name'],
  ['zip130', 'zip', '70130', '', 'United States - 70130'],
  ['zip502', 'zip', '70502', '', 'United States - 70502'],
]);

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'kml-scraper-points-'));
  cpSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  mkdirSync(path.join(root, 'src'));
  for (const f of ['statefips.json', 'stateabbrev.json']) cpSync(path.join(ROOT, 'src', f), path.join(root, 'src', f));
  const config = loadConfig(root);
  writeFileSync(config.paths.srcFile('SRCGOOGLEGEO'), GOOGLE);
  writeFileSync(config.paths.srcFile('SRCTTDGEO'), TTD);
  return config;
}

test('geonames: US postal rows parse; no-state military ZIPs and pointless rows dropped, first row wins', () => {
  const rows = parseGeonamesPostal(GEONAMES);
  assert.deepEqual([...rows.keys()], ['70130', '70502', '70469', '96860']);
  assert.deepEqual(rows.get('70502'), {
    zip: '70502',
    country: 'US',
    place: 'Lafayette',
    state: 'Louisiana',
    stateCode: 'LA',
    county: 'Lafayette',
    countyCode: '055',
    latitude: 30.2241,
    longitude: -92.0198,
    accuracy: 4,
  });
  assert.equal(rows.get('96860').place, 'Jbphh');
});

test('zippoint: only ZIPs with no ZCTA', () => {
  const rows = zipPointsWithoutZcta(parseGeonamesPostal(GEONAMES), new Set(['70130', '96860']));
  assert.deepEqual(rows.map((r) => r.zip), ['70469', '70502']);
});

test('zippoint: points + ids write a Point per non-ZCTA ZIP with Google / Meta / Trade Desk ids', async () => {
  const config = sandbox();
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(GEONAMES), 'US.txt');
  zip.addBuffer(Buffer.from('readme'), 'readme.txt');
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(config.paths.srcFile('SRCZIPPOINT')));

  // the ZCTA build: 70130 has an area
  const zipDir = config.paths.simple('zip');
  mkdirSync(zipDir, { recursive: true });
  writeFileSync(path.join(zipDir, '70130.json'), '{}');
  writeFileSync(
    path.join(zipDir, '_index.json'),
    JSON.stringify({ schema: 1, type: 'zip', places: [{ file: '70130.json', ids: { google: '9012130', meta: 'US:70130', ttd_segment: 'zip130' } }] }),
  );

  await runStep(config, 'points', 'zippoint');
  await runStep(config, 'ids', 'zippoint');

  const dir = config.paths.simple('zippoint');
  const index = JSON.parse(readFileSync(path.join(dir, '_index.json'), 'utf8'));
  assert.equal(index.type, 'zippoint');
  assert.equal(index.schema, 1);
  assert.deepEqual(index.places.map((p) => p.file), ['70469.json', '70502.json', '96860.json']);
  const lafayette = index.places.find((p) => p.name === '70502');
  assert.equal(lafayette.label, '70502 (Lafayette, LA)');
  assert.deepEqual(lafayette.ids, { google: '9012502', msft: null, meta: 'US:70502', ttd: '70502', ttd_segment: 'zip502' });
  assert.equal(lafayette.names.google, '70502,Louisiana,United States');
  assert.equal(index.places.find((p) => p.name === '70469').ids.google, null, 'Google does not know 70469 here');

  const zipIds = new Set(['9012130', 'US:70130', 'zip130']);
  for (const p of index.places) for (const id of Object.values(p.ids)) assert.ok(!zipIds.has(id), `${p.name} takes a ZCTA id`);

  const feature = JSON.parse(readFileSync(path.join(dir, '70502.json'), 'utf8'));
  assert.equal(feature.type, 'FeatureCollection');
  assert.equal(feature.features.length, 1);
  assert.deepEqual(feature.features[0].geometry, { type: 'Point', coordinates: [-92.0198, 30.2241] });
  assert.equal(feature.features[0].properties.meta_location_key, 'US:70502');
});

test('country: Google ids by ISO code (Country Code), not name; top-level territories count; Meta key is the code', async () => {
  const config = sandbox();
  const google = await loadGoogle(config.paths.srcFile('SRCGOOGLEGEO'));
  assert.equal(google.countries.get('CZ').id, '2203');
  assert.equal(google.countries.get('US').id, '2840');
  assert.equal(google.countries.get('PR').id, '2630', 'Puerto Rico is a top-level Region in Google');
  assert.equal(google.countries.has('BM'), false, 'a parish is not a country');

  assert.deepEqual(countryIso({ ISO_A2: '-99', ISO_A2_EH: 'FR' }), { iso: 'FR', exact: false });
  assert.deepEqual(countryIso({ ISO_A2: 'AU', ISO_A2_EH: 'AU' }), { iso: 'AU', exact: true });
  assert.deepEqual(countryIso({ ISO_A2: '-99', ISO_A2_EH: '-99' }), { iso: null, exact: false });
  assert.equal(metaCountryKey('US'), 'US');
  assert.equal(metaCountryKey(null), null);

  const simple = config.paths.simple('country');
  mkdirSync(simple, { recursive: true });
  mkdirSync(config.paths.temp('country'), { recursive: true });
  const attrs = {
    czech_republic: { NAME: 'Czech Rep.', ISO_A2: 'CZ', ISO_A2_EH: 'CZ' },
    france: { NAME: 'France', ISO_A2: '-99', ISO_A2_EH: 'FR' },
    australia: { NAME: 'Australia', ISO_A2: 'AU', ISO_A2_EH: 'AU' },
    ashmore_and_cartier_is: { NAME: 'Ashmore and Cartier Is.', ISO_A2: '-99', ISO_A2_EH: 'AU' },
    somaliland: { NAME: 'Somaliland', ISO_A2: '-99', ISO_A2_EH: '-99' },
    puerto_rico: { NAME: 'Puerto Rico', ISO_A2: 'PR', ISO_A2_EH: 'PR' },
  };
  const shape = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] });
  for (const name of Object.keys(attrs)) writeFileSync(path.join(simple, `${name}.json`), shape);
  writeFileSync(path.join(config.paths.temp('country'), 'attributes.json'), JSON.stringify(attrs));

  await geoIds(config, 'country');
  const { places } = JSON.parse(readFileSync(path.join(simple, '_index.json'), 'utf8'));
  const ids = Object.fromEntries(places.map((p) => [p.name, [p.ids.google, p.ids.meta, p.ids.ttd_segment]]));
  assert.deepEqual(ids, {
    ashmore_and_cartier_is: [null, null, null],
    australia: ['2036', 'AU', null],
    czech_republic: ['2203', 'CZ', null],
    france: ['2250', 'FR', null],
    puerto_rico: ['2630', 'PR', null],
    somaliland: [null, null, null],
  });
});
