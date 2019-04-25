# KML to geoJSON
#### converts census data from multiple sources to geoJson
*process large src files containing several locations to smaller individual geoJSON files*
___
### Update Source Files
`src/*/*.(json|kml)`
https://www.census.gov/geographies/mapping-files/time-series/geo/kml-cartographic-boundary-files.html

*see src/README.md*
___
### Adjusting Config variables
```
package.json.config
```
- make sure you know what you're doing if you adjust these!
- the scripts are pretty agnostic;
- be wary of using a single file where you need a folder of files and vice/versa
- you should be able to use `shp2kml`, `simplify.sh`, `topo2geo`, `process.js`, `featureCollection2feaatures.js`
to do what you think they should
___
### Script Descriptions

- These scripts are listed in order that you should execute them

- all files should be processed to individual json or KML before the running simplify!

- the type argument should be kept the same throughout the different commands (usually)

#### shp2kml.sh

converts a folder of shp files to kml;

##### argument: `type`=name

- output file extension: `kml`
- output file data type: `kml`
- input file extension: `shp`
- input file data type: `shp`
- output stored in `/${DIST}/${TEMP}/${TYPE}`
- input filename used as output filename
- operates on folder of `SHP` files

##### example 

- each state has its own SHP file containing multiple neighborhoods
- each State's `SHP` file is converted to an equivilent `KML` file
- each state is output to `/${DIST}/${TEMP}/${TYPE}`


#### topo2geo.sh

converts a single topoJSON file to a geoJSON featureCollection

##### argument: `type`=name

- output file extension: `json`
- output file data type: `geoJSON`
- input file extension: `json`
- input file data type: `topoJSON`
- output stored in `/${DIST}/${TEMP}/${TYPE}`
- input filename used as output filename
- operates on a single topoJSON file

##### example 

- each dma region is stored in one file as topoJSON;
- the dma src file is converted to a single equivilent geoJSON FeatureCollection json file
- output to `/${DIST}/${TEMP}/${TYPE}`


#### featureCollection2features.js

converts a single geoJSON featureCollection file to individual geoJSON feature files;

##### argument: `type`=name

- output file extension: `json`
- output file data type: `geoJSON Feature`
- input file extension: `json`
- input file data type: `geoJSON Feature Collection`
- output stored in `/${DIST}/${COMPLEX}/${TYPE}`
- individual filenames calculated from input src file
- operates on a single geoJSON Feature Collection file

##### example 

- you have a single file of a geoJSON feature collection you want to output as individual geoJSON feature files
- output to `/${DIST}/${COMPLEX}/${TYPE}`

#### process.js

converts a folder of KML or a single file of KML features to individual lossles KML feature files.

##### argument: `type`=name

- THIS IS A BAD MAMA JAMMA - the real workhorse.
- promisified for extra processing power.
- this command may exceed your javascript heap memory.
- output file extension: `kml`
- output file data type: `kml`
- input file extension: `kml`
- input file data type: `kml`
- output stored in `/${DIST}/${COMPLEX}/${TYPE}`
- individual filenames calculated from input src file(s)
- operates on a single KML src file -OR- folder of individual KML files!

##### example 

- you have a src folder or src kml file you'd like to chop up into individual files;
- output to `/${DIST}/${COMPLEX}/${TYPE}`

#### simplify.sh

converts a folder of complex KML files to simplified geoJSON files

##### argument: `type`=name, `format`=(json|kml)

- finally!
- this command takes a loonnnng time to run.
- enough time for you to shop for new processors, since you just burned yours with process.js
- output file extension: `json`
- output file data type: `geoJSON`
- input file extension: `KML or geoJSON`
- input file data type: `kml or json`
- output stored in `/${DIST}/${SIMPLE}/${TYPE}`
- individual filenames from `/${DIST}/${COMPLEX}/${TYPE}`
- operates on a folder from the `/${DIST}/${COMPLEX}/${TYPE}`

##### example 

- you've already chopped a bunch of large KML or geoJSON into smaller geoJSON files!
- output to `/${DIST}/${SIMPLE}/${TYPE}`

___
### DMAs
*(topos need to first transformed to geo)*
```
npm run topo:dma
npm run features:dma
npm run simplify:dma
```
**Notes:**
*- dmas src are topoJSON!*
*- dmas are single files!*
*- dmas are parsed after `topo:dma` into a single feature collection*
*- the feature collection is then paresd `features:dma` into single feature files*
___
### County/Zip/City
```
npm run process:county
npm run simplify:county
```
**Notes:**
*- cities are a folder!*
*- zip/county are single files!*
*- src is KML format!*
*- you can update the precision of the simplify command in `simplify.sh`*
*- `npm run simplify:(county|zip)` must be run after `npm run (county|zip)`*
____

### Neighborhood
```
npm run shp:neighborhood
npm run process:neighborhood
npm run simplify:neighborhood
```
**Notes:**
*- neighborhoods are a folder!*
*- src is SHP format!*
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

#### Testing KML/XML Files

*-- use `Google Earth Pro` - on Desktop PC/MAC to test*
```
Google Earth -> file -> open -> choose .kml file
```
___

#### Testing geoJSON

*-- http://geojson.io*
```
drop in some JSON!
```
___

( GDAL has a visual tool if you prefer ) 

thanks---Shawn let me know if this is missing something!
