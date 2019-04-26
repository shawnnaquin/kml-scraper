
# KML to geoJSON
#### converts census data from multiple sources to geoJson
*process large src files containing several locations to smaller individual geoJSON files*
___
### Update Source Files
`src/*/*.(json|kml)`

https://www.census.gov/geographies/mapping-files/time-series/geo/kml-cartographic-boundary-files.html

see `src/README.md` for more
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
### Dist directories

- **SIMPLE**: the finalized production files, ready to ship, grouped by type and named
- **COMPLEX**: lossless `kml` files containing exactly one place or feature each, grouped by type and named
- **TEMP**: stores intermediate files of different types for processing, grouped by type

TODO: it is possible that running scripts in random order will overwrite the DIST/TEMP/TYPE/* data, resulting in immediate stdout errors, exits and kill cmds while processing

```
"config": {

    "DISTFOLDER": "dist",
    "DISTTEMPFOLDER": "temp",
    "DISTCOMPLEXFOLDER": "complex",
    "DISTSIMPLEFOLDER": "simplified",
    ... 
 }
 ```
___
### Script Descriptions

- These scripts are listed in order that you should execute them

- all files should be processed to individual `(topo|geo)JSON` or `KML` before the running simplify!

- the `type = 'name'` argument should be kept the same throughout the different commands for each group -- *usually*

```
`type = 'dma'
`type = 'neighborhood'
`type = 'city'
```
the argument is either a `flag (node)` or `parameter (sh)`
```
sh ... *.sh 'dma'
npm run ... --dma
```
#### shp2kml.sh

converts a folder of `SHP` files to `KML`;

##### argument: `type = 'name'`

- src input container: **folder**
- output file extension: `kml`
- output file data type: `kml`
- input file extension: `shp`
- input file data type: `shp`
- output stored in `/${DIST}/${TEMP}/${TYPE}`
- input filename used as output filename

##### example 

- each state has its own `SHP` file containing multiple neighborhoods
- each State's `SHP` file is converted to an equivilent `KML` file
- each state is output to `/${DIST}/${TEMP}/${TYPE}`


#### topo2geo.sh

converts a single `topoJSON` file to a `geoJSON` `FeatureCollection`

##### argument: `type = 'name'`

- src input container: **file**
- output file extension: `json`
- output file data type: `geoJSON`
- input file extension: `json`
- input file data type: `topoJSON`
- output stored in `/${DIST}/${TEMP}/${TYPE}`
- input filename used as output filename

##### example 

- each dma region is stored in one file as `topoJSON`;
- the dma src file is converted to a single equivalent `geoJSON`  `geoJSON` file containing a`FeatureCollection` with multiple `Feature`
- output to `/${DIST}/${TEMP}/${TYPE}`


#### featureCollection2features.js

converts a single `geoJSON` `FeatureCollection` file to individual `geoJSON` `Feature` files;

##### argument: `type = 'name'`

- src input container: **file** 
- output file extension: `json`
- output file data type: `geoJSON Feature`
- input file extension: `json`
- input file data type: `geoJSON FeatureCollection`
- output stored in `/${DIST}/${COMPLEX}/${TYPE}`
- individual filenames calculated from input src file

##### example 

- you have a single file of a `geoJSON` `FeatureCollection` you want to output as individual `geoJSON` `Feature` files
- output to `/${DIST}/${COMPLEX}/${TYPE}`

#### process.js

converts a folder of large `KML` files (each containing multiple features) or a single `KML` file (containing multiple features) to individual lossles KML files. Each output file contains exactly one feature or place after processing.

##### argument: `type = 'name'`

- THIS IS A BAD MAMA JAMMA - the real workhorse.
--*promiseified for extra processing power*--
- process.js may exceed your javascript heap memory (depending on src files).
_
- src input container: **file|folder**
- output file extension: `kml`
- output file data type: `kml`
- input file extension: `kml`
- input file data type: `kml`
- output stored in `/${DIST}/${COMPLEX}/${TYPE}`
- individual filenames calculated from input src file(s)
- operates on a single `kml` src file -OR- folder of individual `kml` files!

##### example 

- you have a src folder or src `kml` file you'd like to chop up into individual `kml` files;
- output to `/${DIST}/${COMPLEX}/${TYPE}`

#### simplify.sh

converts a folder of complex `kml` files to simplified `geoJSON` files, which `Google Maps JS API` can read!

##### argument: `type = 'name'`, `format = ( 'json' | 'kml' )`

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
