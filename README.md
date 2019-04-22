process large KML files containing several locations to smaller KML files of individual locations;

download a kml file from:
https://www.census.gov/geographies/mapping-files/time-series/geo/kml-cartographic-boundary-files.html

currently using `src/cb_2017_us_county_20m.kml`

use Google Earth Pro - on Desktop PC/MAC to test:

Google Earth -> file -> open -> choose .kml file

use QGIS or ogr2ogr for command line / python testing ( if you want ;-) );

to run the sh scripts you'll need to install gdal on mac with homebrew;
you need the ogr2ogr from gdal;