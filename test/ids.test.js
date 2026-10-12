import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCsv, toCsv } from '../lib/csv.js';
import { loadConfig, ROOT } from '../lib/config.js';
import { googleDmaId, nameVariants, loadGoogle, loadMsft, loadTtd, lookup, metaDmaKey, metaZipKey, ttdDmaId } from '../lib/geoids.js';
import { parseTtdSegment } from '../lib/steps/fetch.js';
import { geoIds, INDEX_SCHEMA, settleClaims } from '../lib/steps/ids.js';

const GOOGLE = toCsv([
  ['Criteria ID', 'Name', 'Canonical Name', 'Parent ID', 'Country Code', 'Target Type', 'Status'],
  ['1023191', 'New York', 'New York,New York,United States', '21167', 'US', 'City', 'Active'],
  ['1018605', 'Columbus', 'Columbus,Ohio,United States', '21168', 'US', 'City', 'Active'],
  ['9058661', 'Columbus', 'Columbus,Georgia,United States', '21142', 'US', 'City', 'Active'],
  ['21168', 'Ohio', 'Ohio,United States', '2840', 'US', 'State', 'Active'],
  ['9012345', '43215', '43215,Ohio,United States', '21168', 'US', 'Postal Code', 'Active'],
  ['9999999', 'Old Place', 'Old Place,Ohio,United States', '21168', 'US', 'City', 'Removed'],
  ['9060287', 'Downtown', 'Downtown,California,United States', '21137', 'US', 'Neighborhood', 'Active'],
  ['9060300', 'Downtown', 'Downtown,Richmond,Virginia,United States', '21183', 'US', 'Neighborhood', 'Active'],
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
  assert.deepEqual(oh.ids, { google: '1018605', msft: '72060', meta: null, ttd: null, ttd_segment: null });
  assert.equal(index.schema, INDEX_SCHEMA);
  assert.equal(oh.label, 'Columbus, Ohio');
  assert.ok(oh.keys.includes('columbusohio') && oh.keys.includes('columbusoh'));
  assert.equal(index.places.find((p) => p.name === 'ga-columbus').ids.google, '9058661');

  const props = JSON.parse(readFileSync(path.join(simple, 'oh-columbus.json'), 'utf8')).features[0].properties;
  assert.equal(props.google_criteria_id, '1018605');
  assert.equal(props.msft_location_id, '72060');
  assert.equal(props.GEOID, '3918000');
  assert.match(readFileSync(path.join(config.paths.temp('city'), 'unmatched-google.csv'), 'utf8'), /oh-nowhere/);
});

test('geoids: a city-qualified Google target matches only with its city', async () => {
  const { google } = await catalogs();
  assert.equal(lookup(google, ['Neighborhood'], [['Downtown', 'Virginia', 'Richmond']]).id, '9060300');
  assert.equal(lookup(google, ['Neighborhood'], [['Downtown', 'Virginia', 'Norfolk']]), null, 'not another city\'s Downtown');
  assert.equal(lookup(google, ['Neighborhood'], [['Downtown', 'Virginia', 'Richmond']]).via, 'city');
  const ca = lookup(google, ['Neighborhood'], [['Downtown', 'California', 'Sacramento']]);
  assert.equal(ca.id, '9060287');
  assert.equal(ca.via, 'state');
});

test('ids: one id, one place — city match, then exact name, else nobody', () => {
  const place = (label, id, via, exact) => {
    const p = { label, ids: { google: id, meta: null, ttd_segment: null }, names: { google: 'x' } };
    Object.defineProperty(p, 'how', { value: { google: { via, exact } } });
    return p;
  };
  const sacramento = place('Downtown, Sacramento, CA', '9060287', 'state', true);
  const ukiah = place('Downtown, Ukiah, CA', '9060287', 'state', true);
  const lakeView = place('Lake View, Alabama', '9207301', 'state', true);
  const lakeview = place('Lakeview, Alabama', '9207301', 'state', false);
  const richmond = place('Downtown, Richmond, VA', '9060300', 'city', true);

  const out = settleClaims([sacramento, ukiah, lakeView, lakeview, richmond]);

  assert.equal(sacramento.ids.google, null);
  assert.equal(ukiah.ids.google, null);
  assert.equal(lakeView.ids.google, '9207301');
  assert.equal(lakeview.ids.google, null);
  assert.equal(lakeview.names.google, null);
  assert.equal(richmond.ids.google, '9060300');
  assert.deepEqual(out.map((a) => [a.id, a.kept]), [['9060287', null], ['9207301', 'Lake View, Alabama']]);
});

test('fetch ttd: US standard segment names become places', async () => {
  assert.deepEqual(parseTtdSegment('zip', 'United States - 27614'), { name: '27614', region: '' });
  assert.equal(parseTtdSegment('zip', 'United States - 140-0002'), null);
  assert.equal(parseTtdSegment('zip', 'Brazil - 15162'), null);
  assert.deepEqual(parseTtdSegment('dma', 'United States - Nielsen DMA - Dallas-Ft. Worth TX'), { name: 'Dallas-Ft. Worth TX', region: '' });
  assert.deepEqual(parseTtdSegment('city', 'United States - Louisiana - New Orleans'), { name: 'New Orleans', region: 'Louisiana' });

  const dir = mkdtempSync(path.join(tmpdir(), 'kml-scraper-ttd-'));
  writeFileSync(path.join(dir, 't.csv'), toCsv([
    ['id', 'type', 'name', 'region', 'segment_name'],
    ['g12ik2flrj', 'zip', '27614', '', 'United States - 27614'],
    ['y2muwi8xz9', 'dma', 'Dallas-Ft. Worth TX', '', 'United States - Nielsen DMA - Dallas-Ft. Worth TX'],
    ['c1', 'city', 'Columbus', 'Ohio', 'United States - Ohio - Columbus'],
  ]));
  const ttd = await loadTtd(path.join(dir, 't.csv'));
  assert.equal(lookup(ttd, ['zip'], [['27614', null]]).id, 'g12ik2flrj');
  assert.equal(lookup(ttd, ['dma'], [['Dallas-Ft. Worth, TX', null]]).id, 'y2muwi8xz9', 'DMA names match without the comma');
  assert.equal(lookup(ttd, ['city'], [['Columbus', 'Ohio']]).id, 'c1');
  assert.equal(lookup(ttd, ['city'], [['Columbus', 'Georgia']]), null);
});
