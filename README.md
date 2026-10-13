# KML to geoJSON
## DOCKERIFIED~ (now with one container instead of two)

#### converts census data from multiple sources to geoJSON — and puts your campaign geo reports on a map
*process large src files containing several locations to smaller individual geoJSON files*

One giant county/zip/city/neighborhood/DMA file goes in. One small, simplified geoJSON file **per place** comes out, ready for the `Google Maps JS API`, tagged with the location IDs **Google Ads, Microsoft Advertising, Meta and The Trade Desk** use for it, zipped up and version-tagged for hand-off.

```
src/cb_2025_us_county_500k.zip  ──►  dist/simplified/county/ohio_franklin.json   (+ google_criteria_id, msft_location_id, …)
                                     dist/simplified/county/texas_harris.json
                                     … one per county
                                     dist/simplified/county/_index.json          (lookup table for the map viewer)
```

Then `npm run serve`, drop in location reports from your ad accounts, and get a choropleth on Google Maps.

___
### Quick start

```bash
npm run docker:build                 # once: builds the GDAL + Node image
export UID GID=$(id -g)              # so files in dist/ and src/ are owned by you, not root

npm run docker -- fetch              # download the newest Census / Google / Overture sources into src/
npm run docker -- dma                # one type, every step
npm run docker -- all                # do all the things, set-it-and-forget-it

MAPS_API_KEY=AIza… npm run docker:serve   # map viewer on http://localhost:8080
```

Or natively, if you have **Node ≥ 22** and **GDAL ≥ 3.1** (`ogr2ogr`) on your `PATH`:

```bash
npm install
npm run fetch
npm run dma
npm run all
MAPS_API_KEY=AIza… npm run serve
```

Every `npm run <script>` below works both ways: `npm run county` (native) or `npm run docker -- county` (container).

___
### What's new

#### v2.1 — ad-platform IDs and a map

| | |
|----|----|
| sources | newest Census cartographic boundaries (2025 county / state / place, 2020 ZCTA), read straight from the zipped shapefiles; [Overture Maps](https://overturemaps.org) neighborhoods replace the (retired) Zillow ones |
| `fetch` | downloads all of the above, plus Google's geotargets CSV, into `src/` — no more clicking around census.gov |
| DMAs | rebuilt from current Census counties (`dissolve`): crisp county edges, and Alaska + Hawaii are finally in |
| `ids` | every place is matched to its **Google Ads Criteria ID** (also DV360's), **Microsoft Advertising Location Id**, **Meta targeting key** and **Trade Desk** metro / ZIP; written into each geoJSON's properties and a per-type `_index.json` |
| `serve` | a Google Maps viewer that joins Google / Microsoft / Meta / Trade Desk reports to the shapes, with platform + account filters (e.g. two Google accounts side by side) |

#### v2.0 — same pipeline, modern guts

Same steps, same dist folders, same file names, same per-place KML. Under the hood:

| v1 | v2 |
|----|----|
| two containers (`node:latest` + GDAL 2.4 compiled from source on Ubuntu 18.04) | one image: official `ghcr.io/osgeo/gdal` 3.13 + Node 24 |
| bash + Python 2 + JS | everything is Node (ESM), shelling out to `ogr2ogr` |
| `process.js` read every file fully into memory (heap go boom) | streams KML; memory stays flat no matter the file size |
| `Promise.all` "for extra processing power" | real worker threads, one file per core |
| `simplify.sh` ran `ogr2ogr` twice per file, one file at a time | one `ogr2ogr` per file, one per core |
| `topo2geojson.py` (Python 2 + shapely) | `ogr2ogr -makevalid` (GDAL's TopoJSON driver) |
| `features:dma` rewrote `src/dmainfo.json` on every feature | `src/` is read-only; enriched copy goes to `dist/temp/dma/dmainfo.json` |
| `pack` put *every* type into each per-type zip | each zip holds just its own type |
| no tests | `npm test` (and `npm run docker:test` for the GDAL bits) |

On the v1 sample data, `process` produces **byte-identical** complex KML to v1 (621 city files, 16,376 neighborhood files).

___
### Update Source Files

```bash
npm run fetch                 # everything that can be fetched without credentials
npm run fetch -- census       # just one: census | google | overture | msft | meta
npm run fetch -- all --force  # re-download even if the file is already there
```

| source | what you get | needs |
|--------|--------------|-------|
| `census` | `cb_2025_us_{county,state,place}_500k.zip`, `cb_2020_us_zcta520_500k.zip` | — |
| `google` | `google-geotargets.csv` — newest Google Ads geotargets (Criteria IDs) | — |
| `overture` | `overture-neighborhoods.gpkg` — US neighborhoods + macrohoods from the latest Overture release (via DuckDB, ~1 min) | — |
| `msft` | `msft-geolocations.csv` — Microsoft Advertising geographic locations | `MSADS_DEVELOPER_TOKEN`, `MSADS_ACCESS_TOKEN` (+ optional `MSADS_CUSTOMER_ID`, `MSADS_ACCOUNT_ID`) |
| `meta` | `meta-geolocations.csv` — Meta region (state) keys | `META_ACCESS_TOKEN` (any token with `ads_read`; `META_GRAPH_VERSION` defaults to `v23.0`) |

Without credentials `msft` / `meta` just skip: Google IDs are always there, Meta and Trade Desk DMA / ZIP IDs are derived, and the viewer still matches Microsoft and Meta report rows by name. You can also save the Microsoft CSV by hand (Microsoft Advertising → Tools → Geographic locations) as `src/msft-geolocations.csv`.

> The `msft` and `meta` downloaders are written against the documented APIs but haven't been run against live credentials yet — if one fails, the error includes the API's response.

See [`src/README.md`](src/README.md) for every source, where it comes from, and how to use a different vintage. Downloaded sources are `.gitignore`d. `all` skips (and tells you about) any type whose source isn't there.

___
### Adjusting Config variables
```
package.json#config
```

```jsonc
"config": {
    "DISTFOLDER": "dist",
    "DISTTEMPFOLDER": "temp",
    "DISTCOMPLEXFOLDER": "complex",
    "DISTSIMPLEFOLDER": "simplified",
    "DISTRIBUTIONZIPFOLDER": "processed-zip-files",
    "PRECISION": 0.001,        // simplify tolerance in degrees (kml sources)
    "GEOPRECISION": 6,         // decimal places written for json sources (dma)
    "SRCFOLDER": "src",
    "SRCCOUNTY": "cb_2025_us_county_500k.zip",
    "SRCSTATE": "cb_2025_us_state_500k.zip",
    "SRCCITY": "cb_2025_us_place_500k.zip",
    "SRCZCTA": "cb_2020_us_zcta520_500k.zip",
    "SRCNEIGHBORHOOD": "overture-neighborhoods.gpkg",
    "OVERTURERELEASE": "latest",          // or a release like "2026-09-23.1"
    "SRCDMA": "nielsentopo.json",         // old DMA map, only used to assign counties to DMAs
    "SRCDMAINFO": "dmainfo.json",
    "SRCCOUNTYDMA": "county-dma-overrides.csv",
    "SRCGOOGLEGEO": "google-geotargets.csv",
    "SRCMSFTGEO": "msft-geolocations.csv",
    "SRCMETAGEO": "meta-geolocations.csv",
    "SRCMETATARGETED": "meta-targeted.csv", // Meta places accounts target (from tfg)
    "SRCTTDGEO": "ttd-geosegments.csv",
    "SRCABBREV": "stateabbrev.json",
    "SRCFIPS": "statefips.json",
    "SRCZILLOWFOLDER": "neighborhoodshp", // legacy `zillow` type
    "MAPSAPIKEY": "",                     // Google Maps JS API key for `serve` (or MAPS_API_KEY env)
    "PORT": 8080
}
```

- make sure you know what you're doing if you adjust these!
- any key can be overridden for one run with an env var of the same name:
  ```bash
  PRECISION=0.0005 npm run simplify:county
  SRCCOUNTY=cb_2024_us_county_500k.zip npm run county
  ```
- `CONCURRENCY=4` caps the number of parallel workers / `ogr2ogr` processes (default: every core)
- sources can be a `.kml` file, a folder of `.kml` files, a zipped or plain shapefile, a folder of shapefiles, a `.gpkg` or `.geojson` — non-KML sources get a `shp` step first

___
### Dist directories

- **SIMPLE** (`dist/simplified/<type>`): the finalized production files, ready to ship, grouped by type and named — plus `_index.json`
- **COMPLEX** (`dist/complex/<type>`): lossless `kml` (or `json` for DMAs) files containing exactly one place or feature each, grouped by type and named
- **TEMP** (`dist/temp/<type>`): intermediate files, plus reports worth a look: `attributes.json`, `unmatched-google.csv`, `dma/county-dma.csv`
- **ZIPS** (`dist/processed-zip-files`): `pack` output

Each step wipes and rewrites only its own `dist/<stage>/<type>` folder, so re-running a step is always safe.

___
### Types and their steps

The `type` argument (`dma`, `county`, …) is the same through every step for a group and becomes the dist sub-folder name.

| type | source | steps |
|------|--------|-------|
| `neighborhood` | `src/overture-neighborhoods.gpkg` (Overture Maps) | `shp` → `process` → `simplify` → `ids` |
| `dma` | Census counties + `src/nielsentopo.json` + `src/county-dma-overrides.csv` + `src/dmainfo.json` | `dissolve` → `features` → `simplify` → `ids` |
| `city` | `src/cb_2025_us_place_500k.zip` (Census places) | `shp` → `process` → `simplify` → `ids` |
| `zip` | `src/cb_2020_us_zcta520_500k.zip` (Census ZCTAs) | `shp` → `process` → `simplify` → `ids` |
| `county` | `src/cb_2025_us_county_500k.zip` | `shp` → `process` → `simplify` → `ids` |
| `state` | `src/cb_2025_us_state_500k.zip` | `shp` → `process` → `simplify` → `ids` |
| `zillow` | `src/neighborhoodshp/*.shp` (legacy Zillow; only runs when asked for by name) | `shp` → `process` → `simplify` → `ids` |

Point a type at a KML source (like v1's) and it skips `shp`, exactly as before.

File names are `<state>_<place>` (e.g. `ohio_columbus`, `vermont_east_barre`), just `<place>` for `state` and `zip`, `<state>_<city>_<neighborhood>` for `neighborhood`, and the DMA name for `dma` (`portland-auburn_me`). Names go through the same slugger as v1: lower-case, accents stripped, spaces → `_`, `/` → `-`, and `' " ( ) , &` removed.

___
### Script Descriptions

These are listed in the order you'd run them. All files should be processed to individual `(geo)JSON` or `KML` before running simplify!

```
npm run <step>:<type>              # e.g. npm run process:county
node bin/kml-scraper.js <step> <type>
npm run docker -- <step> <type>
```

#### shp — `shp:(neighborhood|county|zip|city|state)`

converts a shapefile (zipped or not), a folder of them, a GeoPackage or geoJSON to `KML`, reprojected to `EPSG:4326`

- input: **file | folder** → output: one `kml` per input in `dist/temp/<type>`
- the field that becomes each placemark's name is picked per type (`NAME`, `ZCTA5CE20`, …)
- every other attribute rides along to `process`, which saves them to `dist/temp/<type>/attributes.json` for the `ids` step

#### dissolve — `dissolve:dma`

builds current DMA shapes out of current Census counties

- every county goes to the old (`nielsentopo.json`) DMA containing a point inside it — or the nearest one, for coastal counties that fall in a gap
- `src/county-dma-overrides.csv` wins over that; it's how Alaska and Hawaii (not in the old map) get DMAs. **Nielsen's actual county list is licensed; if you have it, put every county in this file**
- counties are unioned per DMA → `dist/temp/dma/dma.json`; every assignment, and how it was made, is in `dist/temp/dma/county-dma.csv`
- the rare DMA that splits a county (Palm Springs = east Riverside County) keeps its old polygon, clipped to that county and cut out of its neighbor

#### topo — `topo:dma`

v1's DMA path, still here: converts the `topoJSON` file to a `geoJSON` `FeatureCollection` (`-makevalid`) at `dist/temp/dma/dma.json`. Run it instead of `dissolve` to get the old shapes.

#### features — `features:dma`

converts a single `geoJSON` `FeatureCollection` file to individual files, one `Feature` each

- input: `dist/temp/dma/dma.json` → output: `dist/complex/dma/<name>.json`
- each output is a `FeatureCollection` holding exactly one `Feature`
- DMA names come from `dmainfo.json` (`dma1`), its record (rank, TV homes, …) is merged into the feature's properties, and the enriched copy goes to `dist/temp/dma/dmainfo.json`

#### process — `process:(county|zip|city|state|neighborhood)`

converts a single big `KML` file or a folder of them (each containing multiple features) into individual, lossless `KML` files. Each output file contains exactly one feature or place.

- THIS IS STILL A BAD MAMA JAMMA — the real workhorse.
- *now streamed and run on worker threads*, so it won't exceed your javascript heap any more, no matter how big the zip-code file gets
- input: **file | folder** of `kml` → output: `dist/complex/<type>/<name>.kml`
- the document `Style` is kept (minus icon/label styles), the `Schema` fields, `description` and `ExtendedData` are dropped, and the placemark is renamed to its slug
- duplicate names: the first one wins

#### simplify — `simplify:(type)`

converts a folder of complex `kml` / `json` files to simplified `geoJSON` files, which `Google Maps JS API` can read!

- finally!
- `kml` sources are simplified with a `PRECISION` tolerance; `json` (DMA) sources are written with `GEOPRECISION` decimals
- input: `dist/complex/<type>` → output: `dist/simplified/<type>/<name>.json`
- this command used to take long enough for you to shop for new processors. It now uses all of the ones you have, so maybe just window-shop.

#### ids — `ids:(type)`

matches every simplified place to the location IDs each ad platform uses for it

| property | platform | how |
|----------|----------|-----|
| `google_criteria_id`, `google_canonical_name` | Google Ads (all accounts) and Display & Video 360 | name + state lookup in `google-geotargets.csv`; DMAs are `200000 + DMA code` |
| `msft_location_id`, `msft_display_name` | Microsoft Advertising | the Google ID via the file's "AdWords Location Id" column, then name + state |
| `meta_location_key` | Meta (Facebook / Instagram) | DMAs `DMA:501`, ZIPs `US:43215`; states from `meta-geolocations.csv` (`fetch meta`), cities, counties (`medium_geo_area`) and neighborhoods (`neighborhood`, `subcity`) from `meta-targeted.csv` (same columns; tfg's `geo:missing --meta-csv` writes it from what accounts target) |
| `ttd_geo_id` | The Trade Desk | DMA code (`501`) and ZIP as-is |
| `ttd_segment_id` | The Trade Desk | the `GeoSegmentId` bid lists target, from `ttd-geosegments.csv` (`fetch ttd`, needs `TTD_TOKEN`) by name + state |

- the Census / Overture attributes (`GEOID`, `NAMELSAD`, `STUSPS`, …) are added too
- writes `dist/simplified/<type>/_index.json`: every place's IDs and match keys — what the viewer joins reports against, and what tfg's `geo:import` reads (`schema`, `type`, per place `file`, `name`, `label`, `ids.google`, `ids.meta`, `ids.ttd_segment`, `names.google`; keep those stable, bump `schema` if they change)
- one ID, one place: when several places match the same ID, a city match (neighborhoods, from Google's `Canonical Name`) wins, then the exact name; a tie leaves the ID empty. The claims are in `dist/temp/<type>/ambiguous.csv`
- `zillow` skips Google IDs the `neighborhood` build already has, so run `ids neighborhood` before `zillow`; together they're the neighborhood set
- places Google doesn't know end up in `dist/temp/<type>/unmatched-google.csv`
- a town Google qualifies by county or township (`Somerset,Perry County,Ohio`) also matches by name + state when it's the only one of that name in the state
- match rates on the 2025 / 2020 sources against Google: DMA 100%, ZIP 96%, county 97% (misses: Connecticut's new planning regions — Google still uses the old counties — a few Alaska boroughs, territories), state 51/56 (territories), city 53% (17,220; Google only targets ~21,600 US cities; 80% of those are matched — most of the rest are tiny towns and CDPs), neighborhood 557 of 23,166 Overture places plus 1,657 Zillow ones (see below), Trade Desk segments: ZIP 99.6%, DMA 97.6%, city 55%, state 51/56
- against the fleet sample (2026-10-13, every place tfg's accounts target): Google 97.6% of places covered, Meta 73%, Trade Desk 77%; nearly all the rest are ZIPs with no area (PO box / unique ZIPs, not ZCTAs: 2,949), then Meta business pins, countries and foreign postal codes; of drawable places 99.6% are covered (TFG_CONSUMER.md)

#### pack — `pack`

packs every folder in `dist/simplified` into a zip, one per type, then rolls them all into one:

```
dist/processed-zip-files/county-2026-2.1.1.zip
dist/processed-zip-files/dma-2026-2.1.1.zip
…
dist/processed-zip-files/all-simplified-boundaries-2026-2.1.1.zip
```

- this is to hand off production-ready zip files!
- the zips are tagged with the year and package version
- `npm run all` bumps the patch version for you; otherwise bump it yourself with `npm run semver`

___
### The map viewer — `serve`

```bash
MAPS_API_KEY=AIza… npm run serve          # http://localhost:8080
MAPS_API_KEY=AIza… npm run docker:serve   # same, in the container
```

You need a Google Maps JavaScript API key ([get one](https://developers.google.com/maps/documentation/javascript/get-api-key)). Without `MAPS_API_KEY` the page asks for one and keeps it in your browser's local storage. The server only listens on `127.0.0.1` (the container sets `HOST=0.0.0.0` and publishes the port to your machine).

1. pick a boundary layer (any type that's been through `ids`)
2. drop in one or more location reports — CSV or TSV, straight out of the platform:

   | platform | report | matched on |
   |----------|--------|------------|
   | Google Ads | Locations / user locations ("Matched" or "Targeted"), any account | Criteria ID column, else location names |
   | Microsoft Advertising | Geographic report | Location Id, else location names |
   | Meta | Ads Manager breakdown by Region or DMA | `DMA:501` keys, else names |
   | The Trade Desk | Geo / Metro report | metro code / ZIP, else names |

3. each report's platform is detected from its file name and columns — change it in the list if it's wrong. Its **account** comes from an account column (Account, Customer, Ad account name, Advertiser, …) when there is one, else from the file name; rename it there
4. **Platforms & accounts** filters toggle whole platforms or single accounts — e.g. two Google Ads accounts (SEM and SEIM) as separate reports, or one export containing both
5. **Color by** any metric. Spend / Impressions / Clicks / Conversions / Reach are lined up across platforms (`Cost`, `Spend`, `Amount spent`, `Advertiser Cost` → Spend), so combined reports add up

Hover a shape for its IDs on every platform and a per-platform breakdown; click a row in the table to zoom to it. Rows that didn't match anything are listed under **Unmatched rows**.

___
### DMAs
```
npm run dissolve:dma
npm run features:dma
npm run simplify:dma
npm run ids:dma
# or just: npm run dma
```
- all 210 DMAs: the 206 from the old map, rebuilt from 2025 counties, plus Anchorage, Honolulu, Fairbanks and Juneau
- DMA code → IDs is fixed, so DMAs match on every platform

___
### County / Zip / City / State
```
npm run shp:county
npm run process:county
npm run simplify:county
npm run ids:county
# or just: npm run county
```
- *src is a zipped shapefile* — GDAL reads it in place, no unzipping
- `simplify:<type>` must be run *after* `process:<type>`

___
### Neighborhood
```
npm run shp:neighborhood
npm run process:neighborhood
npm run simplify:neighborhood
npm run ids:neighborhood
# or just: npm run neighborhood
```
- *src is a GeoPackage* from Overture Maps (`npm run fetch -- overture`)
- file names include the city: `ohio_columbus_short_north`
- Google only knows ~4,900 US "neighborhoods" (Overture has ~23,000) and many of Google's are really unincorporated communities, which the `city` layer covers as CDPs — so expect a low Google match rate here (~3%). The viewer still matches neighborhood report rows by name
- the old Zillow shapefiles still work as the `zillow` type: `npm run zillow`

___
### Other `npm run` commands

- `npm run all`: do all the things, set-it-and-forget-it (warning → every type → bump version → pack)
- `npm run all:complex`: do all the things, but don't simplify
- `npm run all:simplify`: simplify + ids for everything already in `dist/complex`
- `npm run fetch`: download sources, see above
- `npm run serve` / `npm run docker:serve`: the map viewer
- `npm run pack`: generate zip files, see above
- `npm run semver`: bump the package version by a patch level
- `npm run sizeof`: size and file count of each `dist/simplified/<type>`
- `npm run clean`: `rm -rf dist`
- `npm run warning`: outputs a warning message
- `npm run beer`: outputs a message that it'll take a while
- `npm test`: unit tests (GDAL tests are skipped without `ogr2ogr`)
- `npm run docker:test`: the whole suite inside the container
- `npm run docker:build` / `npm run docker:shell`: build the image / get a bash prompt in it

`node bin/kml-scraper.js --help` lists everything too.

___
### Project layout

```
bin/kml-scraper.js          CLI — every npm script goes through here
lib/pipeline.js             wires types → steps, `all`, `pack`, `clean`, …
lib/types.js                the type table above
lib/steps/*.js              fetch, shp2kml, dissolve, topo2geo, features, process, simplify, ids, pack
lib/geoids.js               Google / Microsoft / Meta / Trade Desk location catalogs
lib/kml/split.js            streaming KML → one-document-per-placemark splitter
lib/naming.js               the name slugger + match keys
lib/serve.js                tiny static server for the viewer
viewer/                     the Google Maps viewer (plain HTML / JS, no build step)
test/                       node:test suites + tiny fixtures
src/                        source data (see src/README.md)
```

___
### Installing GDAL natively (optional)

Docker handles this for you. If you'd rather run on the host you need `ogr2ogr` from GDAL **3.1 or newer**, built with SpatiaLite (for `dissolve`):

```bash
brew install gdal                 # macOS
sudo apt install gdal-bin         # Debian / Ubuntu
```

No Python, shapely or GDAL-from-source required any more.

___
#### Testing KML/XML Files

*-- use `Google Earth Pro` - on Desktop PC/MAC to test*
```
Google Earth -> file -> open -> choose .kml file
```

#### Testing geoJSON

*-- `npm run serve`, or http://geojson.io*
```
drop in some JSON!
```

( QGIS is a good visual tool if you prefer )

thanks---Shawn let me know if this is missing something!
