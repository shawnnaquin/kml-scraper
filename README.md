# KML to geoJSON
#### converts kml from census.gov to geoJson
*process large KML files containing several locations to smaller individual KML files of individual locations*
___
### Update Source Files
`src/*/*.(json|kml)`
https://www.census.gov/geographies/mapping-files/time-series/geo/kml-cartographic-boundary-files.html

*see src/README.md*
___
### DMAs
*(topos need to first transformed to geo)*
```
npm run topo:dma
npm run dma
npm run simplify:dma
```
___
### County/Zip/City
```
npm run county
npm run simplify:county
```
**Notes:**
*- you can update the precision of the simplify command in `simplify.sh`*
*- `npm run simplify:(county|zip)` must be run after `npm run (county|zip)`*
____

### Required CLI tools ( Mac/Linux ):
`GDAL2`: `ogr2ogr`
https://varunpant.com/posts/gdal-2-on-mac-with-homebrew

```
brew tap osgeo/osgeo4mac
brew install gdal2
```

#### If that doesn't work try:

```
brew unlink gdal
brew tap osgeo/osgeo4mac && brew tap --repair
brew install jasper netcdf # gdal dependencies
brew install gdal2 --with-armadillo \
--with-complete --with-libkml --with-unsupported
brew link --force gdal2
```
##### that still might fail! google is your friend!

_
##### Notes:
*-- those packages have large dependencies: Java, Python, Perl, XCode, etc...*
*-- may take `> 1hr` to install!*

____

the nielson DMA src is in topojson format which needs to be converted to geojson, you'll need the following tools to do that:
```
brew install python // if not already installed
brew install geos
pip install shapely
```
____

#### Testing KML Files

*-- use `Google Earth Pro` - on Desktop PC/MAC to test*
```
Google Earth -> file -> open -> choose .kml file
```
___
( GDAL has a visual tool if you prefer ) 

thanks---Shawn