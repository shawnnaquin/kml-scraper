#!/usr/bin/env bash
rm -rf dist/simplified/zip
mkdir dist/simplified/zip

for f in dist/zip/*.kml ; do FILENAME=`basename ${f%%}`;
    echo ${f};
    echo ${FILENAME};
    ogr2ogr -f libkml -simplify 0.001 dist/simplified/zip/${FILENAME} dist/zip/${FILENAME}
done;