import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCsv, toCsv } from '../lib/csv.js';
import { loadConfig, ROOT } from '../lib/config.js';
import { googleDmaId, nameVariants, loadGoogle, loadMsft, lookup, metaDmaKey, metaZipKey, ttdDmaId } from '../lib/geoids.js';
import { geoIds } from '../lib/steps/ids.js';

const GOOGLE = toCsv([
  ['Criteria ID', 'Name', 'Canonical Name', 'Parent ID', 'Country Code', 'Target Type', 'Status'],
  ['1023191', 'New York', 'New York,New York,United States', '21167', 'US', 'City', 'Active'],
  ['1018605', 'Columbus', 'Columbus,Ohio,United States', '21168', 'US', 'City', 'Active'],
  ['9058661', 'Columbus', 'Columbus,Georgia,United States', '21142', 'US', 'City', 'Active'],
  ['21168', 'Ohio', 'Ohio,United States', '2840', 'US', 'State', 'Active'],
  ['9012345', '43215', '43215,Ohio,United States', '21168', 'US', 'Postal Code', 'Active'],
  ['9999999', 'Old Place', 'Old Place,Ohio,United States', '21168', 'US', 'City', 'Removed'],
]);
const MSFT = toCsv([
  ['Location Id', 'Bing Display Name', 'Location Type', 'Replaces', 'Status', 'AdWords Location Id'],
  ['72060', 'Columbus|Ohio|United States', 'City', '', 'Active', '1018605'],
  ['200', 'Ohio|United States', 'State', '', 'Active', ''],
]);

async function catalogs() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kml-scraper-ids-'));
  writeFileSync(path.join(dir, 'g.csv'), GOOGLE);
  writeFileSync(path.join(dir, 'm.csv'), MSFT);
  return { google: await loadGoogle(path.join(dir, 'g.csv')), msft: await loadMsft(path.join(dir, 'm.csv')) };
}

test('csv: quoted fields, escaped quotes and CRLF round-trip', () => {
  const rows = [['a', 'b,c'], ['say "hi"', 'x\ny']];
  assert.deepEqual(parseCsv(toCsv(rows).replaceAll('\n', '\r\n').replace('x\r\ny', 'x\ny')), rows);
});

test('geoids: derived DMA / ZIP IDs for Google, Meta, The Trade Desk', () => {
  assert.equal(googleDmaId(501), '200501');
  assert.equal(googleDmaId('535'), '200535');
  assert.equal(metaDmaKey('501'), 'DMA:501');
  assert.equal(metaZipKey('43215'), 'US:43215');
  assert.equal(ttdDmaId('0535'), '535');
});

test('geoids: Saint / Mount / Fort spellings', () => {
  assert.deepEqual(nameVariants('St. Louis'), ['St. Louis', 'Saint Louis']);
  assert.deepEqual(nameVariants('Mount Vernon'), ['Mount Vernon', 'Mt. Vernon']);
  assert.deepEqual(nameVariants('Fort Myers'), ['Fort Myers', 'Ft. Myers']);
  assert.deepEqual(nameVariants('Stanton'), ['Stanton']);
});

test('geoids: Google and Microsoft lookups by name + state, removed rows ignored', async () => {
  const { google, msft } = await catalogs();
  assert.equal(lookup(google, ['City'], [['Columbus', 'Ohio']]).id, '1018605');
  assert.equal(lookup(google, ['City'], [['Columbus', 'Georgia']]).id, '9058661');
  assert.equal(lookup(google, ['State'], [['Ohio', null]]).id, '21168');
  assert.equal(lookup(google, ['City'], [['Old Place', 'Ohio']]), null);
  assert.equal(lookup(google, ['Postal Code'], [['43215', null]]).id, '9012345', 'ZIPs match without a state');
  assert.equal(lookup(google, ['County'], [['Columbus', 'Ohio']]), null, 'type filter applies');
  assert.equal(msft.byAdwords.get('1018605')[0].id, '72060');
  assert.equal(lookup(msft, ['State'], [['Ohio', null]]).id, '200');
});

test('ids: writes platform IDs into each geoJSON and the _index.json the viewer uses', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kml-scraper-'));
  cpSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  mkdirSync(path.join(root, 'src'));
  for (const f of ['statefips.json', 'stateabbrev.json']) cpSync(path.join(ROOT, 'src', f), path.join(root, 'src', f));
  const config = loadConfig(root);
  writeFileSync(config.paths.srcFile('SRCGOOGLEGEO'), GOOGLE);
  writeFileSync(config.paths.srcFile('SRCMSFTGEO'), MSFT);

  const simple = config.paths.simple('city');
  mkdirSync(simple, { recursive: true });
  mkdirSync(config.paths.temp('city'), { recursive: true });
  const empty = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] });
  writeFileSync(path.join(simple, 'oh-columbus.json'), empty);
  writeFileSync(path.join(simple, 'ga-columbus.json'), empty);
  writeFileSync(path.join(simple, 'oh-nowhere.json'), empty);
  writeFileSync(
    path.join(config.paths.temp('city'), 'attributes.json'),
    JSON.stringify({
      'oh-columbus': { NAME: 'Columbus', STATEFP: '39', GEOID: '3918000' },
      'ga-columbus': { NAME: 'Columbus', STATEFP: '13', GEOID: '1319000' },
      'oh-nowhere': { NAME: 'Nowhere', STATEFP: '39', GEOID: '3999999' },
    }),
  );

  const { count, matched } = await geoIds(config, 'city');
  assert.equal(count, 3);
  assert.equal(matched.google, 2);
  assert.equal(matched.msft, 1);

  const index = JSON.parse(readFileSync(path.join(simple, '_index.json'), 'utf8'));
  const oh = index.places.find((p) => p.name === 'oh-columbus');
  assert.deepEqual(oh.ids, { google: '1018605', msft: '72060', meta: null, ttd: null });
  assert.equal(oh.label, 'Columbus, Ohio');
  assert.ok(oh.keys.includes('columbusohio') && oh.keys.includes('columbusoh'));
  assert.equal(index.places.find((p) => p.name === 'ga-columbus').ids.google, '9058661');

  const props = JSON.parse(readFileSync(path.join(simple, 'oh-columbus.json'), 'utf8')).features[0].properties;
  assert.equal(props.google_criteria_id, '1018605');
  assert.equal(props.msft_location_id, '72060');
  assert.equal(props.GEOID, '3918000');
  assert.match(readFileSync(path.join(config.paths.temp('city'), 'unmatched-google.csv'), 'utf8'), /oh-nowhere/);
});
