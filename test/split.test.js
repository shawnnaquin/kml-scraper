import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitKml } from '../lib/kml/split.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const statefips = JSON.parse(readFileSync(new URL('../src/statefips.json', import.meta.url)));
const stateabbrev = JSON.parse(readFileSync(new URL('../src/stateabbrev.json', import.meta.url)));

async function split(file, type) {
  const out = {};
  const stats = await splitKml(fixture(file), {
    type,
    statefips,
    stateabbrev,
    onPlacemark: async (name, kml) => {
      out[name] = kml;
    },
  });
  return { out, stats };
}

test('census KML: one lossless document per place, v1 layout', async () => {
  const { out, stats } = await split('census-place.kml', 'city');

  assert.deepEqual(Object.keys(out), ['alabama_canon_town__co', 'alabama_abbeville']);
  assert.equal(stats.duplicates, 1, 'second "Cañon" placemark is dropped, first one wins');

  assert.equal(
    out.alabama_canon_town__co,
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      '<name>city</name><visibility>1</visibility>' +
      '<Style id="KMLStyler"><LineStyle><color>ffbc822f</color><gx:labelVisibility>0</gx:labelVisibility></LineStyle></Style>' +
      '<Schema name="cb_2017_01_place_500k" id="kml_schema_ft_cb_2017_01_place_500k"/>' +
      '<Folder><name>alabama_canon_town__co</name>' +
      '<Placemark id="alabama_canon_town__co"><name>alabama_canon_town__co</name><visibility>1</visibility><styleUrl>#KMLStyler</styleUrl>' +
      '<Polygon><outerBoundaryIs><LinearRing><coordinates>-85.5,33.1,0.0 -85.6,33.1,0.0 -85.6,33.2,0.0 -85.5,33.1,0.0</coordinates></LinearRing></outerBoundaryIs></Polygon>' +
      '</Placemark></Folder></Document></kml>',
  );
});

test('state type never gets a state prefix', async () => {
  const { out } = await split('census-place.kml', 'state');
  assert.deepEqual(Object.keys(out), ['canon_town__co', 'abbeville']);
});

test('GDAL/Zillow KML: state comes from the State abbreviation, Document name is added', async () => {
  const { out } = await split('gdal-neighborhood.kml', 'neighborhood');
  const [[name, kml]] = Object.entries(out);
  assert.equal(name, 'vermont_graniteville-east_barre');
  assert.match(kml, /^<\?xml version="1.0" encoding="utf-8"\?><kml xmlns="http:\/\/www.opengis.net\/kml\/2.2"><Document id="root_doc">/);
  assert.match(kml, /<Schema name="ZillowNeighborhoods_VT" id="ZillowNeighborhoods_VT"\/><name>neighborhood<\/name><Folder>/);
  assert.match(kml, /<Placemark id="vermont_graniteville-east_barre"><name>vermont_graniteville-east_barre<\/name><Style>/);
  assert.doesNotMatch(kml, /ExtendedData|SimpleField/);
});
