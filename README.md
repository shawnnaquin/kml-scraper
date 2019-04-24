```
npm run county
npm run simplify:county

npm run zip
npm run simplify:zip
```
see package.json for more scripts

____

`npm run simplify:(county|zip)` must be run after `npm run (county|zip)`

process large KML files containing several locations 
to smaller individual KML files of individual locations;

finally, process each KML to geoJSON;

____

check readme in src folder for more info on sources.
```
https://www.census.gov/geographies/mapping-files/time-series/geo/kml-cartographic-boundary-files.html
```
____

required CLI tools (mac/linux):
GDAL2: ogr2ogr
https://varunpant.com/posts/gdal-2-on-mac-with-homebrew

```
brew tap osgeo/osgeo4mac
brew install gdal2
```

if that doesn't work try:

```
brew unlink gdal
brew tap osgeo/osgeo4mac && brew tap --repair
brew install jasper netcdf # gdal dependencies
brew install gdal2 --with-armadillo \
--with-complete --with-libkml --with-unsupported
brew link --force gdal2
```
that still might fail! google is your friend!

those packages have large dependencies: Java, Python, Perl, XCode, etc...
may take >1hr to install!

____

the nielson DMA src is in topojson format which needs to be converted to geojson, you'll need the following tools to do that:
```
brew install python // if not already installed
brew install geos
brew install shapely
```
____

test KML with:

use Google Earth Pro - on Desktop PC/MAC to test:

Google Earth -> file -> open -> choose .kml file
___

use GDAL desktop 

( if you can get it to install, for extended visual tools )