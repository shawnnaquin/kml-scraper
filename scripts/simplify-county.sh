#!/usr/bin/env bash
rm -rf dist/simplified/county/
mkdir dist/simplified/county/

for f in dist/county/*.kml ; do FILENAME=`basename ${f%%}`;
    echo ${f};
    echo ${FILENAME};
    ogr2ogr -f libkml -simplify 0.001 dist/simplified/county/${FILENAME} dist/county/${FILENAME}
done;