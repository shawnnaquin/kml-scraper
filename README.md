# kml-scraper

Turns US boundary data (Census, Overture, GeoNames, Natural Earth) into one small geoJSON file **per place**, each tagged with the location IDs **Google Ads, Microsoft Advertising, Meta and The Trade Desk** use for it.

```
src/cb_2025_us_county_500k.zip  ──►  dist/simplified/county/texas_harris.json   one per place, ready for the Google Maps JS API
                                     dist/simplified/county/_index.json         every place's platform IDs
```

## Quick start

```bash
npm run docker:build                      # once: the GDAL + Node image
export UID GID=$(id -g)                   # files in dist/ and src/ owned by you
npm run docker -- fetch                   # download sources into src/
npm run docker -- all                     # build every type, then pack
MAPS_API_KEY=AIza… npm run docker:serve   # map viewer on http://localhost:8080
```

Natively (Node ≥ 22, GDAL ≥ 3.1 with SpatiaLite on `PATH`): `npm install`, then the same commands without `docker --`, e.g. `npm run all`.

## Sources — `fetch`

```bash
npm run fetch                  # everything that needs no credentials
npm run fetch -- ttd           # one source
npm run fetch -- all --force   # download again
```

| source | file in `src/` | needs |
|---|---|---|
| `census` | `cb_2025_us_{county,state,place}_500k.zip`, `cb_2020_us_zcta520_500k.zip` | — |
| `google` | `google-geotargets.csv` (Google Ads Criteria IDs) | — |
| `overture` | `overture-neighborhoods.gpkg` (via DuckDB) | — |
| `geonames` | `geonames-US.zip`: a point and town per ZIP | — |
| `zipcodes` | `zipcodes-us.json`: USPS ZIPs GeoNames lacks (PO box, unique), from the pinned `zipcodes` package | — |
| `dma` | `dma-county-list.csv`: county → DMA, about 2021 ([BritCrit/dma_county_zip](https://github.com/BritCrit/dma_county_zip), pinned; no license, so never committed) | — |
| `naturalearth` | `ne_50m_admin_0_countries.zip` | — |
| `msft` | `msft-geolocations.csv` | `MSADS_DEVELOPER_TOKEN`, `MSADS_ACCESS_TOKEN` |
| `meta` | `meta-geolocations.csv` (state keys) | `META_ACCESS_TOKEN` |
| `ttd` | `ttd-geosegments.csv` (standard US segments + countries) | `TTD_TOKEN` |

`src/meta-targeted.csv` (Meta city, county and neighborhood keys) comes from tfg's `geo:missing --meta-csv`; Meta only reveals those keys for places someone targets. Without Microsoft tokens, tfg's `geo:msft-locations src/msft-geolocations.csv` writes the `msft` file. A source that needs credentials skips without them. Downloads are git-ignored; [`src/README.md`](src/README.md) covers each one.

## Types

`npm run <type>` runs every step for one type; `npm run all` runs them in this order.

| type | what | steps |
|---|---|---|
| `neighborhood` | Overture neighborhoods | `shp` → `process` → `simplify` → `ids` |
| `dma` | Census counties unioned per Nielsen DMA | `dissolve` → `features` → `simplify` → `ids` |
| `city` | Census places | `shp` → `process` → `simplify` → `ids` |
| `zip` | Census ZCTAs | `shp` → `process` → `simplify` → `ids` |
| `zippoint` | ZIPs with no ZCTA (PO box, unique) as a Point; after `zip` | `points` → `ids` |
| `postaltown` | USPS mail towns that aren't Census places (`Cypress, TX`): their ZIPs' ZCTAs unioned; after `city`, `zip` | `dissolve` → `features` → `simplify` → `ids` |
| `county` | Census counties | `shp` → `process` → `simplify` → `ids` |
| `state` | Census states | `shp` → `process` → `simplify` → `ids` |
| `country` | Natural Earth countries | `shp` → `process` → `simplify` → `ids` |
| `zillow` | Zillow neighborhoods (`src/neighborhoodshp`), the fallback for `neighborhood`; by name only | `shp` → `process` → `simplify` → `ids` |

One step at a time: `npm run <step>:<type>` (`npm run ids:city`). Each step rewrites only its own `dist/<stage>/<type>`, so reruns are safe.

- `shp`: any GDAL source (zipped shapefile, GeoPackage, geoJSON) → KML in `dist/temp`
- `process`: big KML → one lossless KML per place in `dist/complex` (streamed, one worker per core)
- `simplify`: → geoJSON in `dist/simplified` (`PRECISION` tolerance)
- `dissolve`: DMAs from counties (the old polygons, then `src/dma-county-list.csv`, then `src/county-dma-overrides.csv`; every assignment in `dist/temp/dma/county-dma.csv`); postal towns from ZCTAs
- `points`: one Point file per ZIP with no ZCTA
- `ids`: platform IDs, see below

File names: `<state>_<place>` (`ohio_columbus`), `<place>` for `state`, `zip`, `zippoint`, `country`, the DMA name for `dma` (`portland-auburn_me`), `<state>_<city>_<neighborhood>` for neighborhoods.

## Platform IDs — `ids`

| field | platform | how |
|---|---|---|
| `google` | Google Ads, DV360 | name + state in `google-geotargets.csv`; DMAs `200000 + code`; countries by ISO code |
| `msft` | Microsoft Advertising | via the Google ID, else name + state |
| `meta` | Meta | ZIPs `US:70130`, DMAs `DMA:501`, countries ISO; states, cities, counties, neighborhoods from the Meta CSVs |
| `ttd_segment` | The Trade Desk | the `GeoSegmentId` bid lists target, by name + state |
| `ttd` | The Trade Desk | DMA code, ZIP |

- One ID, one place: a city match wins, then the exact name; a tie clears the ID (`dist/temp/<type>/ambiguous.csv`).
- A type never takes an ID its parent holds: `zippoint` ← `zip`, `postaltown` ← `city`, `zillow` ← `neighborhood`.
- Unmatched places: `dist/temp/<type>/unmatched-google.csv`.

Match rates, Google: DMA 100%, ZIP 96%, county 97%, city 53% (Google targets ~21,600 US cities; 80% matched), postal towns 1,577. Microsoft: DMA 100%, ZIP 99.5%, county 95.7%, city 58.5%, country 94.2%. Trade Desk: ZIP 99.6%, DMA 97.6%, city 70.8%.

## Output contract — `_index.json`

`dist/simplified/<type>/_index.json` is what tfg's `geo:import` reads. Keep these stable, bump `schema` if they change: `schema`, `type`, and per place `file`, `name`, `label`, `ids.google`, `ids.msft`, `ids.meta`, `ids.ttd_segment`, `names.google`. A new type isn't a schema change. Place files are `Polygon`/`MultiPolygon` (`[lng, lat]`), a `zippoint` file one `Point`. How tfg uses it: [`TFG_CONSUMER.md`](TFG_CONSUMER.md).

## Pack

`npm run pack` zips each `dist/simplified/<type>` and all of them together into `dist/processed-zip-files/<type>-<year>-<version>.zip`. `npm run all` bumps the patch version first.

## Map viewer — `serve`

`MAPS_API_KEY=AIza… npm run serve`, then pick a layer and drop in location reports (CSV/TSV) from Google Ads, Microsoft, Meta or The Trade Desk. Rows join to shapes by platform ID, else by name; filter by platform or account and colour by any metric (spend, impressions, clicks, conversions line up across platforms). Listens on `127.0.0.1` only.

## Config

`package.json#config`: folder names, source file names (`SRC*`), `PRECISION` (simplify tolerance, degrees), `GEOPRECISION` (decimals for json sources), `OVERTURERELEASE`, `PORT`. Any key can be set per run as an env var (`PRECISION=0.0005 npm run simplify:county`); `CONCURRENCY=4` caps workers.

## Commands

| | |
|---|---|
| `npm run all` / `all:complex` / `all:simplify` | everything / up to `dist/complex` / simplify + ids only |
| `npm test` / `npm run docker:test` | unit tests (GDAL ones need `ogr2ogr`) / all of them in the container |
| `npm run sizeof` | size and file count per type |
| `npm run clean` | `rm -rf dist` |
| `npm run docker:shell` | a shell in the image |
| `node bin/kml-scraper.js --help` | everything |

Code: `bin/kml-scraper.js` (CLI), `lib/types.js` (the type table), `lib/steps/` (one file per step), `lib/geoids.js` (platform catalogs), `viewer/` (the map), `test/`.

## Credits

Census TIGER/cartographic boundaries; [Overture Maps](https://overturemaps.org); [GeoNames](https://www.geonames.org/) postal codes (CC BY 4.0); the [`zipcodes`](https://pypi.org/project/zipcodes/) package (MIT); [Natural Earth](https://www.naturalearthdata.com/) (public domain).
