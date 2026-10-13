import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { humanSize } from '../fsutil.js';
import { ProgressBar } from '../progress.js';

const GOOGLE_GEOTARGETS_PAGE = 'https://developers.google.com/google-ads/api/data/geotargets';
const OVERTURE_BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com';
const MSADS_ENDPOINT = 'https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc';

export const FETCHERS = ['census', 'google', 'overture', 'geonames', 'naturalearth', 'msft', 'meta', 'ttd'];

const GEONAMES_ZIP = 'https://download.geonames.org/export/zip/US.zip';
const NATURAL_EARTH = 'https://naciscdn.org/naturalearth';

const say = (msg) => process.stdout.write(`${msg}\n`);

async function download(url, dest, label = path.basename(dest)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const size = Number(res.headers.get('content-length')) || 0;
  const bar = new ProgressBar(`download ${label}`, size || 1, { format: humanSize });
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => size && bar.update((got += chunk.length), label));
  const tmp = `${dest}.part`;
  await pipeline(body, createWriteStream(tmp));
  await rename(tmp, dest);
  if (!size) say(`downloaded ${label}`);
}

function extractFirst(zipFile, match, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('entry', (entry) => {
        if (!match.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          pipeline(stream, createWriteStream(dest)).then(() => (zip.close(), resolve(dest)), reject);
        });
      });
      zip.on('end', () => reject(new Error(`no entry matching ${match} in ${zipFile}`)));
      zip.readEntry();
    });
  });
}

const skip = (file, force) => {
  if (existsSync(file) && !force) {
    say(`have ${path.basename(file)} (use --force to re-download)`);
    return true;
  }
  return false;
};

/**
 * Census cartographic boundary shapefiles. The URL comes from the file name in package.json#config:
 * cb_2025_us_county_500k.zip -> https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip
 * so moving to a newer vintage is just a config change.
 */
async function census(config, { force }) {
  for (const key of ['SRCCOUNTY', 'SRCSTATE', 'SRCCITY', 'SRCZCTA']) {
    const file = config.paths.srcFile(key);
    const name = path.basename(file);
    const year = /^cb_(\d{4})_.*\.zip$/.exec(name)?.[1];
    if (!year) {
      say(`skip ${key}=${name} (not a Census cb_YYYY_*.zip name)`);
      continue;
    }
    if (skip(file, force)) continue;
    await download(`https://www2.census.gov/geo/tiger/GENZ${year}/shp/${name}`, file);
  }
}

/** Google Ads geo targets: every targetable location with its Criteria ID. Published roughly monthly. */
async function google(config, { force }) {
  const dest = config.paths.srcFile('SRCGOOGLEGEO');
  if (skip(dest, force)) return;
  const page = await (await fetch(GOOGLE_GEOTARGETS_PAGE)).text();
  const latest = [...page.matchAll(/\/static\/google-ads\/api\/data\/geo\/geotargets-(\d{4}-\d{2}-\d{2})\.csv\.zip/g)]
    .sort((a, b) => b[1].localeCompare(a[1]))[0];
  if (!latest) throw new Error(`Couldn't find a geotargets download on ${GOOGLE_GEOTARGETS_PAGE}`);
  const zip = `${dest}.zip`;
  await download(new URL(latest[0], GOOGLE_GEOTARGETS_PAGE).href, zip, `geotargets-${latest[1]}.csv.zip`);
  await extractFirst(zip, /\.csv$/i, dest);
  await rm(zip);
  say(`google geotargets ${latest[1]} -> ${path.relative(config.root, dest)}`);
}

/**
 * GeoNames US postal codes (CC BY 4.0): every US ZIP with a place name, state and a point — the
 * `zippoint` type draws the ZIPs that have no ZCTA area (PO box / unique ZIPs) from it.
 */
async function geonames(config, { force }) {
  const dest = config.paths.srcFile('SRCZIPPOINT');
  if (skip(dest, force)) return;
  await download(GEONAMES_ZIP, dest, 'geonames US.zip');
}

/**
 * Natural Earth admin 0 countries (public domain), for the `country` type. The scale comes from the
 * file name: ne_50m_admin_0_countries.zip -> https://naciscdn.org/naturalearth/50m/cultural/…
 */
async function naturalearth(config, { force }) {
  const dest = config.paths.srcFile('SRCCOUNTRY');
  const name = path.basename(dest);
  const scale = /^ne_(\d+m)_.*\.zip$/.exec(name)?.[1];
  if (!scale) return say(`skip SRCCOUNTRY=${name} (not a Natural Earth ne_<scale>_*.zip name)`);
  if (skip(dest, force)) return;
  await download(`${NATURAL_EARTH}/${scale}/cultural/${name}`, dest);
}

async function latestOvertureRelease() {
  const xml = await (await fetch(`${OVERTURE_BUCKET}/?list-type=2&prefix=release/&delimiter=/`)).text();
  const releases = [...xml.matchAll(/<Prefix>release\/([^<]+)\/<\/Prefix>/g)].map((m) => m[1]).sort();
  if (!releases.length) throw new Error('Could not list Overture releases');
  return releases.at(-1);
}

/**
 * Overture Maps neighborhoods (CDLA-Permissive / ODbL sources) — the open replacement for the retired Zillow set.
 * DuckDB reads just the US neighborhood + macrohood rows straight out of Overture's GeoParquet on S3.
 */
async function overture(config, { force }) {
  const dest = config.paths.srcFile('SRCNEIGHBORHOOD');
  if (skip(dest, force)) return;
  const release = config.raw.OVERTURERELEASE === 'latest' ? await latestOvertureRelease() : config.raw.OVERTURERELEASE;
  say(`overture ${release}: querying US neighborhoods (this reads a few hundred MB from S3)…`);

  const { DuckDBInstance } = await import('@duckdb/node-api');
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  // keep DuckDB's extension cache in the project (the Docker user has no home directory)
  const duckHome = path.join(config.root, '.cache', 'duckdb');
  await mkdir(duckHome, { recursive: true });
  await conn.run(`SET home_directory='${duckHome.replaceAll("'", "''")}'`);
  await conn.run("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");

  const base = `s3://overturemaps-us-west-2/release/${release}/theme=divisions`;
  const tmp = `${dest}.part.gpkg`;
  await rm(tmp, { force: true });
  await conn.run(`
    COPY (
      SELECT
        a.names.primary AS Name,
        list_filter(d.hierarchies[1], x -> x.subtype = 'locality')[1].name AS City,
        list_filter(d.hierarchies[1], x -> x.subtype = 'county')[1].name AS County,
        replace(a.region, 'US-', '') AS State,
        a.subtype AS Subtype,
        a.division_id AS OvertureId,
        d.wikidata AS Wikidata,
        a.geometry AS geom
      FROM read_parquet('${base}/type=division_area/*', hive_partitioning = 1) a
      JOIN read_parquet('${base}/type=division/*', hive_partitioning = 1) d ON d.id = a.division_id
      WHERE a.country = 'US' AND d.country = 'US'
        AND a.subtype IN ('neighborhood', 'macrohood') AND a.is_land
        AND a.names.primary IS NOT NULL
      ORDER BY State, City, Name
    ) TO '${tmp.replaceAll("'", "''")}' WITH (FORMAT GDAL, DRIVER 'GPKG', SRS 'EPSG:4326', LAYER_NAME 'neighborhoods')`);
  const [[count]] = (await conn.runAndReadAll(`SELECT count(*) FROM ST_Read('${tmp.replaceAll("'", "''")}')`)).getRows();
  conn.closeSync();
  await rename(tmp, dest);
  await writeFile(`${dest}.release`, `${release}\n`);
  say(`overture ${release}: ${count} neighborhoods -> ${path.relative(config.root, dest)}`);
}

const soap = ({ developerToken, accessToken, customerId, accountId }) => `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <s:Header xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
    <AuthenticationToken>${accessToken}</AuthenticationToken>
    ${customerId ? `<CustomerId>${customerId}</CustomerId>` : ''}
    ${accountId ? `<CustomerAccountId>${accountId}</CustomerAccountId>` : ''}
    <DeveloperToken>${developerToken}</DeveloperToken>
  </s:Header>
  <s:Body>
    <GetGeoLocationsFileUrlRequest xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
      <Version>2.0</Version>
      <LanguageLocale>en</LanguageLocale>
    </GetGeoLocationsFileUrlRequest>
  </s:Body>
</s:Envelope>`;

/**
 * Microsoft Advertising geographic locations file. It's behind the Bing Ads API, so it needs credentials:
 *   MSADS_DEVELOPER_TOKEN, MSADS_ACCESS_TOKEN (OAuth), and optionally MSADS_CUSTOMER_ID / MSADS_ACCOUNT_ID.
 * Without them, save the CSV yourself as src/<SRCMSFTGEO> (see README).
 */
async function msft(config, { force }) {
  const dest = config.paths.srcFile('SRCMSFTGEO');
  if (skip(dest, force)) return;
  const creds = {
    developerToken: process.env.MSADS_DEVELOPER_TOKEN,
    accessToken: process.env.MSADS_ACCESS_TOKEN,
    customerId: process.env.MSADS_CUSTOMER_ID,
    accountId: process.env.MSADS_ACCOUNT_ID,
  };
  if (!creds.developerToken || !creds.accessToken) {
    say(
      `msft: skipped — set MSADS_DEVELOPER_TOKEN and MSADS_ACCESS_TOKEN to download it, or save the ` +
        `geographic locations CSV as ${path.relative(config.root, dest)}. The ids step works without it (Google IDs only).`,
    );
    return;
  }
  const res = await fetch(MSADS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'GetGeoLocationsFileUrl' },
    body: soap(creds),
  });
  const xml = await res.text();
  const url = /<FileUrl>([^<]+)<\/FileUrl>/.exec(xml)?.[1]?.replaceAll('&amp;', '&');
  if (!res.ok || !url) throw new Error(`GetGeoLocationsFileUrl failed (${res.status}):\n${xml.slice(0, 1000)}`);

  const tmp = `${dest}.download`;
  await download(url, tmp, 'msft geolocations');
  const head = Buffer.alloc(2);
  const fh = await open(tmp);
  await fh.read(head, 0, 2, 0);
  await fh.close();
  if (head.toString('latin1') === 'PK') {
    await extractFirst(tmp, /\.csv$/i, dest);
    await rm(tmp);
  } else {
    await rename(tmp, dest);
  }
  say(`msft geolocations -> ${path.relative(config.root, dest)}`);
}

/**
 * Meta (Facebook / Instagram) region keys for every US state, via the Marketing API targeting search.
 * Needs META_ACCESS_TOKEN (any token with ads_read). DMA and ZIP keys don't need this — they're derived
 * (DMA:501, US:43215). Cities aren't fetched: that's ~30k API calls, and Meta's reports break down by
 * region and DMA, which the viewer matches by name anyway.
 */
async function meta(config, { force }) {
  const dest = config.paths.srcFile('SRCMETAGEO');
  if (skip(dest, force)) return;
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    say(`meta: skipped — set META_ACCESS_TOKEN to look up Meta region keys. DMA/ZIP keys are derived without it.`);
    return;
  }
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const { readFile } = await import('node:fs/promises');
  const states = Object.values(JSON.parse(await readFile(config.paths.srcFile('SRCFIPS'), 'utf8')));
  const rows = [['key', 'name', 'type', 'region', 'country_code']];
  const bar = new ProgressBar('meta regions', states.length);
  for (const state of states) {
    const url = new URL(`https://graph.facebook.com/${version}/search`);
    url.search = new URLSearchParams({
      type: 'adgeolocation',
      location_types: JSON.stringify(['region']),
      country_code: 'US',
      q: state,
      access_token: token,
    });
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(`Meta targeting search failed: ${JSON.stringify(body.error ?? body)}`);
    const hit = body.data?.find((d) => d.name?.toLowerCase() === state.toLowerCase()) ?? body.data?.[0];
    if (hit) rows.push([hit.key, hit.name, hit.type, hit.name, hit.country_code]);
    bar.tick(1, state);
  }
  const { toCsv } = await import('../csv.js');
  await writeFile(dest, toCsv(rows));
  say(`meta: ${rows.length - 1} region keys -> ${path.relative(config.root, dest)}`);
}

/**
 * The Trade Desk's standard geo segments: what an ad group's geo bid list targets (`GeoSegmentId`).
 * Needs TTD_TOKEN (an API token; it is sent as TTD-Auth). Read through the GraphQL API's
 * `geoSegmentsSearch`, one segment type at a time, the US ones by name (zips are ~45 pages), sorted
 * by id: unsorted pages overlap, and a third of the cities never came back. Segment names carry the
 * place: "United States - 27614", "United States - Nielsen DMA - Dallas-Ft. Worth TX",
 * "United States - Louisiana - New Orleans"; a country is its name ("United States").
 */
const TTD_SEGMENT_TYPES = { zip: 'POSTAL_CODE', dma: 'NIELSEN_DMA', region: 'REGION', city: 'CITY', country: 'COUNTRY' };

/** What each type's search is narrowed by: the US, except countries (all of them). */
const TTD_SEARCH = { country: null };

export function parseTtdSegment(type, segmentName) {
  const parts = String(segmentName).split(' - ');
  if (type === 'country') return parts.length === 1 && parts[0] ? { name: parts[0], region: '' } : null;
  if (parts[0] !== 'United States') return null;
  switch (type) {
    case 'zip':
      return /^\d{5}$/.test(parts[1] ?? '') && parts.length === 2 ? { name: parts[1], region: '' } : null;
    case 'dma':
      return parts[1] === 'Nielsen DMA' && parts[2] ? { name: parts.slice(2).join(' - '), region: '' } : null;
    case 'region':
      return parts.length === 2 ? { name: parts[1], region: parts[1] } : null;
    case 'city':
      return parts.length === 3 ? { name: parts[2], region: parts[1] } : null;
    default:
      return null;
  }
}

async function ttd(config, { force }) {
  const dest = config.paths.srcFile('SRCTTDGEO');
  if (skip(dest, force)) return;
  const token = process.env.TTD_TOKEN;
  if (!token) {
    say('ttd: skipped — set TTD_TOKEN to list The Trade Desk geo segments.');
    return;
  }
  const query = `query($type: GeoSegmentType!, $search: String, $after: String) {
    geoSegmentsSearch(input: {geoSegmentType: $type, nameSearchTerm: $search}, order: {id: ASC}, first: 1000, after: $after) {
      totalCount pageInfo { hasNextPage endCursor } nodes { id name isStandard isDeprecated }
    }
  }`;
  const rows = [['id', 'type', 'name', 'region', 'segment_name']];
  for (const [type, segmentType] of Object.entries(TTD_SEGMENT_TYPES)) {
    const bar = new ProgressBar(`ttd ${type}`, 1);
    const search = type in TTD_SEARCH ? TTD_SEARCH[type] : 'United States';
    const seen = new Set();
    let total = 0;
    let after = null;
    let pages = 0;
    do {
      // TTD answers an occasional INTERNAL_SERVER_ERROR (or 429); the same page again usually works
      let res;
      let body;
      for (let attempt = 1; ; attempt++) {
        res = await fetch('https://desk.thetradedesk.com/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'TTD-Auth': token },
          body: JSON.stringify({ query, variables: { type: segmentType, search, after } }),
        });
        body = await res.json().catch(() => ({}));
        if ((res.ok && body.data?.geoSegmentsSearch) || attempt === 5) break;
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
      const page = body.data?.geoSegmentsSearch;
      if (!res.ok || !page) throw new Error(`Trade Desk geo segment search failed: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
      total = page.totalCount;
      for (const node of page.nodes) {
        if (seen.has(node.id)) throw new Error(`Trade Desk returned ${node.id} twice: its paging is unstable, so the list would have gaps`);
        seen.add(node.id);
        const place = node.isStandard && !node.isDeprecated ? parseTtdSegment(type, node.name) : null;
        if (place) rows.push([node.id, type, place.name, place.region, node.name]);
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      bar.update(1, `${type} page ${++pages}`);
    } while (after);
    if (seen.size !== total) throw new Error(`Trade Desk listed ${seen.size} ${type} segments of ${total}`);
  }
  const { toCsv } = await import('../csv.js');
  await writeFile(dest, toCsv(rows));
  say(`ttd: ${rows.length - 1} geo segments (US, and countries) -> ${path.relative(config.root, dest)}`);
}

export async function fetchSources(config, which = 'all', { force = false } = {}) {
  await mkdir(config.src, { recursive: true });
  const fetchers = { census, google, overture, geonames, naturalearth, msft, meta, ttd };
  const names = which === 'all' ? FETCHERS : [which];
  for (const name of names) {
    if (!fetchers[name]) throw new Error(`Unknown source "${name}". Expected one of: ${FETCHERS.join(', ')}, all`);
    process.stdout.write(`\n== fetch ${name} ==\n`);
    await fetchers[name](config, { force });
  }
}
