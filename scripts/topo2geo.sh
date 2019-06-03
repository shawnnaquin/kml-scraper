#!/usr/bin/env bash
type=$1;
SRCFOLDER=$( source "utilities/readjson.sh" SRCFOLDER );
SRC='';

if [ $type == 'dma' ]; then
    SRC=$( source "utilities/readjson.sh" SRCDMA );
fi;

TEMP=dist/temp/${type};

rm -rf $TEMP;
mkdir -p $TEMP;

python utilities/topo2geojson.py $SRCFOLDER/$SRC $TEMP/$SRC;
exit;