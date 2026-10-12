# How tfg uses this output (heads-up from the tfg side, 2026-10-10)

Written from the `tfg` repo, branch `google-ads-geo-map`. Delete or fold into the
README as you see fit; nothing in this repo depends on it.

## What tfg does with the shapes

`/reports/{acronym}/geo-map` reads a client's Google Ads location targeting
live (GAQL `campaign_criterion` + `geo_target_constant`) and draws each targeted
place's outline on a Google map (`map.data.addGeoJson`). **The only key tfg has
for a place is Google's criteria id** (e.g. New Orleans city = `1018036`,
zip 70130 = `9025161`, Jefferson Parish = `9058055`, New Orleans DMA = `200622`).
It never sees a name slug like `louisiana_new_orleans`.

So the outlines live in mongo `geo_boundaries`, one doc per criteria id, loaded by
`php artisan geo:import <file>` from **NDJSON, one place per line**:

```json
{"criteria_id":1018036,"target_type":"City","name":"New Orleans","canonical_name":"New Orleans,Louisiana,United States","geometry":{"type":"MultiPolygon","coordinates":[[[[-90.1,29.9],...]]]},"source":"cb_2025_us_place_500k"}
```

- `criteria_id` (int) and `geometry` (GeoJSON `Polygon` or `MultiPolygon`, `[lng,lat]`, no z) are required; other lines are skipped.
- Upsert by `criteria_id`, so re-importing a newer file replaces in place.
- Page fetches up to 500 outlines a request; keep zips/cities small (simplified is right).

If this repo can emit that file (e.g. a final step after `simplify`, or alongside `pack`), tfg imports
it as-is. If you'd rather keep the per-place zips, tfg can join them instead, but the join belongs where
the source attributes still exist (GEOID, ZCTA, state FIPS), not on lossy slugs.

## Joining to Google criteria ids — what worked on the 2019 files

Google's geotargets CSV: https://developers.google.com/google-ads/api/data/geotargets
(`geotargets-2026-08-12.csv.zip`; columns `Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status`).

| type | Google `Target Type` | join |
|------|----------------------|------|
| zip | `Postal Code` | name = ZCTA code |
| state | `State` | name |
| county | `County` | state + name with ` County` / ` Parish` / ` Borough` / ` Census Area` stripped |
| city | `City` | state + name |
| neighborhood | `Neighborhood` | state + name |
| dma | `DMA Region` | **criteria id = 200000 + Nielsen DMA code** (verified via the API: 200525 = "Albany, GA", 200622 = "New Orleans, LA") |

- US rows only (`Country Code` = `US`); the state is the second-to-last part of `Canonical Name`.
- **The CSV has no DMA rows**; use the 200000 + code rule (name = `dmainfo.json` `dma1`).
- Normalize names before comparing: lower-case, `saint`/`st.` → `st`, drop non-alphanumerics.
- Prefer `Status` = `Active` over `Removal Planned` when both match.
- A place with several features → one `MultiPolygon`.

Matched from the 2019 files (all US): counties 3,098 (all of Google's), zips 32,022 of ~33k,
DMAs 206, cities ~17k (many census places/CDPs aren't Google targets), neighborhoods ~2.1k of
Google's 4.9k (Zillow set is sparse). That stand-in is what tfg's local mongo holds today.

## Nice to have

- `Municipality` (1,946 US targets), `Congressional District`, `Colloquial Area` exist in Google's
  list; no shapes for them today, tfg lists them as "no outline yet".
- Shapes from accounts are mostly zips, cities, counties, states, DMAs, and lots of *excluded*
  countries/states, so states need outlines too.
