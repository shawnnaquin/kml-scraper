#!/usr/bin/env bash
type=$1;
SRCFOLDER=$(node -p "require('./package.json').config.SRCFOLDER ");
SRC=$(node -p "require('./package.json').config.SRCDMA ");

TEMP=dist/temp/${type};

rm -rf $TEMP;
mkdir -p $TEMP;

python utilities/topo2geojson.py $SRCFOLDER/$SRC $TEMP/$SRC