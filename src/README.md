# Source data

Everything the pipeline reads lives here. File names are set in `package.json#config`. To use a different vintage (e.g. `cb_2024_…`), point the config key at it, or override it for one run: `SRCCOUNTY=cb_2024_us_county_500k.zip npm run county`.

`npm run fetch` downloads everything that doesn't need credentials. Downloaded files are `.gitignore`d. The small lookup tables (`*.json`, `county-dma-overrides.csv`) are committed.

___

### Census cartographic boundaries — `SRCCOUNTY`, `SRCSTATE`, `SRCCITY`, `SRCZCTA`
```
cb_2025_us_county_500k.zip
cb_2025_us_state_500k.zip
cb_2025_us_place_500k.zip        (cities, towns, villages, CDPs — the whole country in one file)
cb_2020_us_zcta520_500k.zip      (ZCTAs are only redrawn each decennial census)
```

`npm run fetch -- census`, or by hand from https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html (`https://www2.census.gov/geo/tiger/GENZ<year>/shp/<file>`).

The zipped shapefiles are read in place (GDAL `/vsizip/`). A key can also point at a `.kml` file (or `SRCCITY` at a folder of KMLs); that type then skips the `shp` step.

___

### Neighborhoods — Overture Maps — `SRCNEIGHBORHOOD`, `OVERTURERELEASE`
```
overture-neighborhoods.gpkg
overture-neighborhoods.gpkg.release      (which Overture release it came from)
```

`npm run fetch -- overture` queries the Overture `divisions/division_area` GeoParquet on S3 with DuckDB (no AWS account needed): US `neighborhood` and `macrohood` land areas, with `Name`, `City`, `County`, `State`, `Subtype`, `OvertureId`, `Wikidata`. `OVERTURERELEASE` is `latest` or a release like `2026-09-23.1`.

https://docs.overturemaps.org/guides/divisions/ — data is ODbL; credit "© OpenStreetMap contributors, Overture Maps Foundation" wherever you show it.

___

### Nielsen DMAs — `SRCDMA`, `SRCDMAINFO`, `SRCCOUNTYDMA`
```
nielsentopo.json                 old DMA polygons (topoJSON) — only used to assign counties to DMAs
dmainfo.json                     DMA code -> name (dma1), rank, TV homes, …
county-dma-overrides.csv         geoid,dma,note — wins over the spatial assignment
```

https://github.com/simzou/nielsen-dma/blob/master/nielsentopo.json

https://raw.githubusercontent.com/simzou/nielsen-dma/master/tv.json

`dissolve:dma` gives each Census county the DMA its interior falls in, then applies `county-dma-overrides.csv`: a 5-digit county GEOID, or a 2-digit state FIPS for a whole-state default. It ships with Hawaii → Honolulu (744), Alaska → Anchorage (743), and the Fairbanks (745) and Juneau (747) borough lists. **Those Alaska borough lists are a best effort, so check them against Nielsen.** If you license Nielsen's county-to-DMA list, put all of it here and the shapes will match Nielsen exactly. `dist/temp/dma/county-dma.csv` lists every county's DMA and how it was assigned.

`dmainfo.json` is only read. `features:dma` writes the enriched copy to `dist/temp/dma/dmainfo.json`.

___

### ZIP points — GeoNames — `SRCZIPPOINT`
```
geonames-US.zip                  US.txt: postal code, place, state, county, lat/lng (one point per ZIP)
```

`npm run fetch -- geonames` (https://download.geonames.org/export/zip/US.zip). CC BY 4.0: credit "GeoNames" wherever you show it. `zippoint` draws the ZIPs the ZCTA file doesn't have.

___

### Countries — Natural Earth — `SRCCOUNTRY`
```
ne_50m_admin_0_countries.zip     admin 0 countries, 1:50m (242; 1:110m has 177 and drops microstates Google targets)
```

`npm run fetch -- naturalearth` (https://naciscdn.org/naturalearth/50m/cultural/). Public domain. Point the key at `ne_110m_…` or `ne_10m_…` for another scale.

___

### Ad-platform locations — `SRCGOOGLEGEO`, `SRCMSFTGEO`, `SRCMETAGEO`
```
google-geotargets.csv            Google Ads geotargets (Criteria ID, Canonical Name, Target Type, Status)
msft-geolocations.csv            Microsoft Advertising geographic locations (Location Id, Bing Display Name, AdWords Location Id)
meta-geolocations.csv            Meta targeting keys for US regions (key, name, type, region, country_code)
```

- **Google** — `npm run fetch -- google` downloads the newest file from https://developers.google.com/google-ads/api/data/geotargets. Display & Video 360 uses the same IDs. The file has no DMA rows, but a DMA's ID is always `200000 + DMA code`.
- **Microsoft** — `npm run fetch -- msft` with `MSADS_DEVELOPER_TOKEN` + `MSADS_ACCESS_TOKEN` (optional `MSADS_CUSTOMER_ID`, `MSADS_ACCOUNT_ID`) calls the Campaign Management API's `GetGeoLocationsFileUrl`. Or download it from Microsoft Advertising and save it here under this name. https://learn.microsoft.com/advertising/guides/geographical-location-codes
- **Meta** — `npm run fetch -- meta` with `META_ACCESS_TOKEN` looks up each state's region key with the Marketing API targeting search. You don't need it for DMAs (`DMA:501`) or ZIPs (`US:43215`). https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
- **The Trade Desk** — no file. TTD targets US metros by Nielsen DMA code and postal codes as-is.

___

### State lookups — `SRCFIPS`, `SRCABBREV`
```
statefips.json      "39" -> "Ohio"        (census STATEFP field)
stateabbrev.json    "OH" -> "Ohio"        (Zillow / Overture State field)
```

https://gist.github.com/mshafrir/2646763

___

### Legacy: Zillow neighborhoods — `SRCZILLOWFOLDER` (the `zillow` type)
```
neighborhoodshp/ZillowNeighborhoods-<ST>.(shp|shx|dbf|prj)
```

Zillow stopped publishing these, and they haven't been updated since around 2017. They're kept for reproducing old output: `npm run zillow`.
