# How tfg uses this output (from the tfg side, updated 2026-10-12)

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

- `type` (`zip`, `city`, `county`, `state`, `dma`, `neighborhood`)
- `schema` (1 today; bump it if anything below changes)
- per place: `file`, `name`, `label`, `ids.google` (criteria id, string or number), `ids.meta` (Meta key, e.g. `US:70130`, `DMA:622`), `ids.ttd_segment` (Trade Desk `GeoSegmentId`), `names.google`

and from each place file, every feature's `Polygon`/`MultiPolygon` (`[lng, lat]`, rings closed), merged into one shape.
A place with none of `ids.google`, `ids.meta`, `ids.ttd_segment` is skipped without reading its file. Please treat those fields as the stable interface; anything else can change freely. `ids.msft` and `ids.ttd` are unused today.
`zillow` is imported as Neighborhood beside `neighborhood`; within one build an id a second place claims is refused (first wins), as a backstop to `ambiguous.csv`.

`geo:import --prune` deletes the imported types' places that a build no longer has, so dropping a place here removes it there.
`geo:import --targeted` loads only places some client account targets. `geo:missing` lists what accounts target that has no shape; that list is your to-do list.

## Asks: status 2026-10-12 (all five worked in this repo and in tfg)

1. **`_index.json` stable**: done. It now carries `schema: 1`; the fields above are the contract (README "ids").
2. **Neighborhoods**: `zillow` is back as the fallback, built after `neighborhood` and skipping Google ids Overture already has. Overture 557 + Zillow 1,657 = 2,214 Google-matched neighborhoods (was 684). Run `ids neighborhood` then `zillow`; `all` still leaves zillow out.
3. **Trade Desk**: `fetch ttd` (needs `TTD_TOKEN`) pages TTD's GraphQL `geoSegmentsSearch` for the standard US segments (72,496: zip 41,285, city 30,950, DMA 210, state 51) into `src/ttd-geosegments.csv`; `ids` writes `ids.ttd_segment`. Matched: ZIP 99.6%, DMA 97.6%, city 55%, state 51/56. tfg outlines Trade Desk bid lists by it (`ttd:{segment}`) and names the place from the shape.
4. **Meta cities and regions**: `fetch meta` ran (51 states). Meta city/neighborhood keys only come from what accounts target, so tfg's `geo:missing --meta-csv src/meta-targeted.csv` writes them in the same columns and `ids` reads both files. Still open: that file needs a production run of `geo:missing` (the fleet sample).
5. **One id, several places**: neighborhoods match on Google's city (`Downtown,Sacramento,…`) first; then `settleClaims` keeps a city match, then the exact name, else clears the id for everyone. Claims land in `dist/temp/<type>/ambiguous.csv` (city 11, neighborhood 42 with 41 cleared, zillow 11).

Left over: 37 counties share their Google id with the city of the same name (Virginia's independent cities, Carson City, a few Alaska boroughs); Google targets them as City, so tfg keeps the city shape and refuses the county's. Clearing `ids.google` on those counties would make that explicit. DC has no Meta region key (Meta calls it "Washington D. C."); Trade Desk cities match 55%, like Google's.

## Reference: Google ids

- DMA Region criteria id = 200000 + Nielsen code (verified against the API: 200622 = New Orleans).
- The state is the second-to-last part of `Canonical Name`. Prefer `Active` over `Removal Planned`.
