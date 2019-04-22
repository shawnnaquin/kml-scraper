#!/usr/bin/env bash
PRECISION=0.001;
TYPE=$1;
SIMPLE=dist/simplified/$TYPE;
COMPLEX=dist/complex/$TYPE;

rm -rf $SIMPLE && mkdir $SIMPLE

for f in ${COMPLEX}/*.kml ; do FILENAME=`basename ${f} .kml`;

    FILE=${SIMPLE}/${FILENAME};
    echo $FILENAME;

    ogr2ogr -f libkml -simplify $PRECISION ${SIMPLE}/${FILENAME}.kml ${COMPLEX}/${FILENAME}.kml;
    ogr2ogr -f GeoJSON ${SIMPLE}/${FILENAME}.json ${SIMPLE}/${FILENAME}.kml
    rm ${SIMPLE}/${FILENAME}.kml;

done;