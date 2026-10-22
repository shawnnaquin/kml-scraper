# How tfg uses this output (from the tfg side, updated 2026-10-13)

Written from `tfg`, branch `google-ads-geo-map`, against this repo's `modernize` branch.
Fold into the README when you like; nothing here runs.

## Who does what

| kml-scraper (this repo) | tfg |
|---|---|
| download sources, build simplified shapes | read clients' live targeting (Google Ads SEM/SEIM, Facebook, Trade Desk) |
| match each place to platform ids (`ids` step) | import shapes by those ids into mongo `geo_boundaries` (`php artisan geo:import`) |
| the viewer (CSV reports on a map, for checking shapes) | the client report and its PDF (`/geomap/panel/{acronym}`) |

tfg does no name matching of its own; if a place doesn't match, the fix belongs here.
The viewer's report joining is yours to keep; tfg won't build on it, and you don't need to grow it into a client report.

## The contract: `dist/simplified/{type}/_index.json` + one file per place

`geo:import` reads a `dist/simplified` folder, one type folder, or the `pack` zips (nested all-in-one too). From `_index.json` it uses only:

- `type` (`zip`, `zippoint`, `city`, `county`, `state`, `country`, `dma`, `neighborhood`); new types are not a schema change
- `schema` (1 today; bump it if anything below changes)
- per place: `file`, `name`, `label`, `ids.google` (criteria id, string or number), `ids.meta` (Meta key, e.g. `US:70130`, `DMA:622`), `ids.ttd_segment` (Trade Desk `GeoSegmentId`), `names.google`

and from each place file, every feature's `Polygon`/`MultiPolygon` (`[lng, lat]`, rings closed), merged into one shape; a `zippoint` file holds one `Point` (`[lng, lat]`) instead: draw a pin.
A place with none of `ids.google`, `ids.meta`, `ids.ttd_segment` is skipped without reading its file. Please treat those fields as the stable interface; anything else can change freely. `ids.msft` and `ids.ttd` are unused today.
`zillow` is imported as Neighborhood beside `neighborhood`; within one build an id a second place claims is refused (first wins), as a backstop to `ambiguous.csv`.

`geo:import --prune` deletes the imported types' places that a build no longer has, so dropping a place here removes it there.
`geo:import --targeted` loads only places some client account targets. `geo:missing` lists what accounts target that has no shape; that list is your to-do list.

## Asks: status 2026-10-12 (all five worked in this repo and in tfg)

1. **`_index.json` stable**: done. It now carries `schema: 1`; the fields above are the contract (README "ids").
2. **Neighborhoods**: `zillow` is back as the fallback, built after `neighborhood` and skipping Google ids Overture already has. Overture 557 + Zillow 1,657 = 2,214 Google-matched neighborhoods (was 684). Run `ids neighborhood` then `zillow`; `all` still leaves zillow out.
3. **Trade Desk**: `fetch ttd` (needs `TTD_TOKEN`) pages TTD's GraphQL `geoSegmentsSearch` for the standard US segments (72,496: zip 41,285, city 30,950, DMA 210, state 51) into `src/ttd-geosegments.csv`; `ids` writes `ids.ttd_segment`. Matched: ZIP 99.6%, DMA 97.6%, city 55%, state 51/56. tfg outlines Trade Desk bid lists by it (`ttd:{segment}`) and names the place from the shape.
4. **Meta cities and regions**: `fetch meta` ran (51 states). Meta city/neighborhood keys only come from what accounts target, so tfg's `geo:missing --meta-csv src/meta-targeted.csv` writes them in the same columns and `ids` reads both files. Done 2026-10-13 with the production fleet sample: Meta cities 148 of 156 targeted; DC matched (keyed by its region column).
   - Done tfg side (3002befe02): `--meta-csv` writes Meta's `medium_geo_area` targets as county rows, regions trimmed; the next production sample picks up the 37 counties.
5. **One id, several places**: neighborhoods match on Google's city (`Downtown,Sacramento,…`) first; then `settleClaims` keeps a city match, then the exact name, else clears the id for everyone. Claims land in `dist/temp/<type>/ambiguous.csv` (city 11, neighborhood 42 with 41 cleared, zillow 11).

Left over: 37 counties share their Google id with the city of the same name (Virginia's independent cities, Carson City, a few Alaska boroughs); Google targets them as City, so tfg keeps the city shape and refuses the county's. Clearing `ids.google` on those counties would make that explicit. DC has no Meta region key (Meta calls it "Washington D. C."); Trade Desk cities match 55%, like Google's.

## Asks: status 2026-10-13 (branch `zip-points-countries`)

6. **ZIPs with no area**: new type `zippoint` (folder `dist/simplified/zippoint`, pack `zippoint-*.zip`): 7,337 US ZIPs the ZCTA build lacks, one `Point` each from GeoNames `US.zip` (CC BY 4.0), label `70502 (Lafayette, LA)`. Ids as `zip`: Google Postal Code (904), Meta `US:70502` (all), Trade Desk ZIP segment (7,025); never an id the `zip` build has.
7. **Countries**: new type `country` (folder `dist/simplified/country`): 242 Natural Earth 1:50m outlines, 1.6 MB. `ids.google` = Google's `Country` row by ISO code (top-level Google `Region`s like Puerto Rico, Hong Kong count), 233; `ids.meta` = ISO alpha-2 (`US`), 237; `ids.ttd_segment` null.
   - tfg: import both folders; draw `zippoint` as a pin (Point geometry), `country` as polygons like the others.
   - Coverage of the fleet sample's keys, before → after: Google 2,172 → 2,400 of 2,431 (192 countries, 5 territories, 31 ZIPs); Meta 3,721 → 4,972 of 5,100 (1,250 ZIPs, `US`); Trade Desk 5,679 → 7,314 of 7,393 (1,635 ZIPs). Left: 54 Meta pins, 37 Meta counties (tfg rows), 79 Trade Desk custom segments, 25 Meta ZIPs GeoNames lacks, 15 foreign postal codes, 1 foreign region.

## Asks: status 2026-10-13 (branch `ttd-complete-segments`)

8. **Trade Desk "custom" segments**: all 77 that resolve are standard (45 city, 31 ZIP, 1 country); a client's bid list name made them look custom. `fetch ttd` paged unsorted and lost a third of the cities (24,382 unique of 30,951); it now sorts by id, retries TTD's occasional server error, and refuses a short or repeated list. Countries are fetched too (236), matched by name: 218 of 242.
   - Trade Desk cities 55% → 70.8%; of the fleet's 77, 32 now have a shape. Left: 14 postal town names that aren't Census places (Cypress TX, New Caney, Greenwell Springs), 31 PO-box ZIPs GeoNames lacks (70140, 70595, CA 9xxxx).

9. **ZIPs GeoNames lacks**: `fetch zipcodes` (the `zipcodes` package's USPS list, MIT; 3.0.0 since 2026-10-14, 42,789 ZIPs) fills `zippoint`: 7,337 → 8,159 points; 26 of the fleet's 31 Trade Desk and 24 of Meta's 25 now have one. Left: 32574, 32598, 91186, 90097, 91187, 00116 (retired; no source has them).
10. **Postal towns**: new type `postaltown` (folder `dist/simplified/postaltown`, 6,332 towns, 11.6 MB): USPS town names that aren't Census places, as their ZIPs' ZCTAs unioned. Ids as a city (Google 1,577, Trade Desk 6,175, Meta where targeted), never one `city` holds. All 14 of the fleet's unmatched Trade Desk towns (Cypress TX, New Caney, Greenwell Springs) now have a shape.
11. **Microsoft Ads ids** (2026-10-13): tfg's map now reads Microsoft Ads and outlines by `ids.msft` (`geo_boundaries.msft_id`, key `msft:{LocationId}`). `src/msft-geolocations.csv` comes from tfg's `geo:msft-locations`. Countries were 0%: `loadMsft` kept only US rows and `country` had no msft type; now 228 of 242. US types: DMA 100%, ZIP 99.5%, county 95.7%, city 58.5%.
12. **Sources refreshed** (2026-10-14): `zipcodes` 3.0.0 (zippoint 8,175); DMAs now also follow a ~2021 county list (`fetch dma`, not committed), moving 81 counties off the 2013 polygons (Franklin PA → Harrisburg). Changed folders: `dma`, `zippoint`, `postaltown`; reimport them.
   - tfg: import it as City.
13. **A PO box's town** (done 2026-10-22; asked 2026-10-21): a `zippoint` should draw as the town it's in, not a pin (`75011 (Carrollton, TX)` → Carrollton, Texas; user's call, big towns too: `75368 (Dallas, TX)` draws Dallas). Please add per `zippoint` place `town: {"type": "city" | "postaltown", "file": "texas_carrollton.json"}`, or `null` when there's no one town. The label's town + state against the `city` and `postaltown` `keys` (`carrolltontx`) gives one town for 6,863 of 8,175, two for 1 (`34611 (Spring Hill, FL)`: Spring Hill / Springhill), none for 1,311; the matching is yours.
   - tfg: `geo:import` draws a `zippoint` with a `town` as that town's shape, under the ZIP's own ids; no `town`, still a pin. First client: NLEW's PMA (75011, 75027, 75029, 75099, 75368, 76099).
   - Done: `lib/steps/towns.js`, run at the end of `ids` for `zippoint`, `city` and `postaltown`. Census place first (name variants, as `postaltown` skips them), else the postal town; two fits, `null`. 8,175 PO boxes: city 6,567, postal town 377, none 1,231 (USPS service names: Parcel Return Service DC, Valley Forge PA, Dpo); no ids changed. All six of NLEW's link.

## Fleet sample (2026-10-13, `geo:missing` on production, every place accounts target)

Targeted places with a shape, before → after this round (weighted by targeting count in brackets):

- Google: 2,087 → 2,088 of 2,139 (98.9%); towns Google qualifies by county (`Somerset,Perry County,Ohio`) now match by name + state when unique (+96 cities nationwide).
- Meta: 3,568 → 3,718 of 5,096 (71.7% → 73.0%); 3,755 once the next sample carries the county rows tfg now writes.
- Trade Desk: 5,577 of 7,238 (78.7%), unchanged: every uncovered standard segment is a ZIP with no area.
- Of places that have an area at all, 99.6% are covered; left: 37 Meta counties (tfg rows above), 14 towns that aren't Census places (unincorporated; Google's `Pryor` is Census `Pryor Creek`).
- Not drawable, by count: 2,949 US ZIPs that aren't ZCTAs (PO box / unique; Meta 1,275, Trade Desk 1,646, Google 28); 54 Meta business pins (`Place`); 15 Trade Desk custom segments; 13 foreign postal codes (German, Brazilian); countries; 1 Google Colloquial Area.
- 3 Meta `COMSCORE_MARKET:` keys are DMAs under Meta's newer market ids; a DMA carries one `ids.meta` (`DMA:`), so tfg would map them by name or schema 2 would need a list.
- Exclusions: 196 countries / foreign regions (incl. Puerto Rico, USVI) and the same ZIP / custom-segment classes; nothing drawable missing.
- Point ZIPs and countries: done as `zippoint` / `country` (ask 6, 7).
- Size: shapes the targeted keys need are 6,904 files, 24.9 MB (ZIP 18.3, state 2.0, DMA 1.9, city 1.6, county 1.0) of a 109,233-file, 206 MB build (12%); `geo:import --targeted` loads only those.

## Reference: Google ids

- DMA Region criteria id = 200000 + Nielsen code (verified against the API: 200622 = New Orleans).
- The state is the second-to-last part of `Canonical Name`. Prefer `Active` over `Removal Planned`.
