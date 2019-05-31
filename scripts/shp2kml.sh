#!/usr/bin/env bash
start_time="$(date -u +%s)";

PRECISION=$(cat './package.json' | grep -E '\bPRECISION\b'| awk '{print$2}' | cut -d '"' -f2 | cut -d ',' -f1);

TYPE=$1;
FILETYPE=$2;

DISTFOLDER=$(node -p "require('./package.json').config.DISTFOLDER");
DISTTEMPFOLDER=$(node -p "require('./package.json').config.DISTTEMPFOLDER");

TEMP=$DISTFOLDER/$DISTTEMPFOLDER/$TYPE;

SRCFOLDER=$(node -p "require('./package.json').config.SRCFOLDER ");
SRC='';

if [ $TYPE == 'neighborhood' ]; then
    SRC=$(node -p "require('./package.json').config.SRCNEIGHBORHOODFOLDER");
fi;

COUNT=$(find "${SRCFOLDER}/${SRC}" -name "*.$FILETYPE" -maxdepth 1 -type f | wc -l);

SECONDS=0
i=0;
total=0;

rm -rf $TEMP;
mkdir -p $TEMP;

for f in ${SRCFOLDER}/${SRC}/*.${FILETYPE} ; do FILENAME=`basename ${f} .${FILETYPE}`;

    i=$(($i+1));

    {
        ogr2ogr -f libkml ${TEMP}/${FILENAME}.kml ${SRCFOLDER}/${SRC}/${FILENAME}.${FILETYPE} -t_srs "EPSG:4326"
    } &> /dev/null;

    end_time="$(date -u +%s)"
    elapsed="$(($end_time-$start_time))";

    source "utilities/percentbar.sh" $i $COUNT $FILENAME $elapsed;

done;