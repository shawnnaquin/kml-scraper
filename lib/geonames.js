import yauzl from 'yauzl';

/**
 * GeoNames postal codes (https://download.geonames.org/export/zip/, CC BY 4.0): one tab-separated row
 * per postal code — country, postal code, place name, admin name1 (state), admin code1 (state abbr),
 * admin name2 (county), admin code2, admin name3, admin code3, latitude, longitude, accuracy.
 *
 * Rows with no state (military APO / FPO, which GeoNames places abroad) or no point are dropped; a code
 * listed twice keeps its first row.
 */
export function parseGeonamesPostal(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const [country, zip, place, state, stateCode, county, countyCode, , , lat, lng, accuracy] = line.split('\t');
    if (!zip || !stateCode || out.has(zip)) continue;
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!lat || !lng || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    out.set(zip, {
      zip,
      country,
      place,
      state,
      stateCode,
      county: county || null,
      countyCode: countyCode || null,
      latitude,
      longitude,
      accuracy: accuracy ? Number(accuracy) : null,
    });
  }
  return out;
}

/**
 * The `zipcodes` package's zips.json (fetch zipcodes): the USPS ZIPs GeoNames may lack (PO box, unique),
 * as parseGeonamesPostal's rows. Military ZIPs and rows with no point are dropped; `stateCode` is the
 * USPS abbreviation, `state` is left to the ids step.
 */
export function parseZipcodes(rows) {
  const out = new Map();
  for (const r of rows) {
    const latitude = Number(r.lat);
    const longitude = Number(r.long);
    if (!/^\d{5}$/.test(r.zip_code ?? '') || r.zip_code_type === 'MILITARY' || !r.state || out.has(r.zip_code)) continue;
    if (!r.lat || !r.long || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    out.set(r.zip_code, {
      zip: r.zip_code,
      country: r.country ?? 'US',
      place: r.city,
      state: null,
      stateCode: r.state,
      county: r.county || null,
      countyCode: null,
      latitude,
      longitude,
      accuracy: null,
      kind: r.zip_code_type ?? null,
      source: 'zipcodes',
    });
  }
  return out;
}

/** The text of the first entry in a zip file whose name matches. */
export function readZipText(zipFile, match) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('entry', (entry) => {
        if (!match.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            zip.close();
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        });
      });
      zip.on('end', () => reject(new Error(`no entry matching ${match} in ${zipFile}`)));
      zip.readEntry();
    });
  });
}
