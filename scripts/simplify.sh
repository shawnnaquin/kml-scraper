#!/usr/bin/env bash
start_time="$(date -u +%s)";

PRECISION=$(node -p "require('./package.json').config.PRECISION");
GEOPRECISION=$(node -p "require('./package.json').config.GEOPRECISION")

DISTFOLDER=$(node -p "require('./package.json').config.DISTFOLDER");
DISTSIMPLEFOLDER=$(node -p "require('./package.json').config.DISTSIMPLEFOLDER");
DISTTEMPFOLDER=$(node -p "require('./package.json').config.DISTTEMPFOLDER");
DISTCOMPLEXFOLDER=$(node -p "require('./package.json').config.DISTCOMPLEXFOLDER");

TYPE=$1;
FILETYPE=$2;

SIMPLE=$DISTFOLDER/$DISTSIMPLEFOLDER/$TYPE;
COMPLEX=$DISTFOLDER/$DISTCOMPLEXFOLDER/$TYPE;
TEMP=$DISTFOLDER/$DISTTEMPFOLDER/$TYPE;

COUNT=$(find $COMPLEX -name "*.$FILETYPE" -maxdepth 1 -type f | wc -l);

SECONDS=0
i=0;
total=0;

rm -rf $SIMPLE && mkdir -p $SIMPLE;
mkdir -p $TEMP && mkdir -p $COMPLEX;

for f in ${COMPLEX}/*.${FILETYPE} ; do FILENAME=`basename ${f} .${FILETYPE}`;

    i=$(($i+1));

    if [ "${FILETYPE}" == "kml" ];
        then
            {
                ogr2ogr -f libkml -simplify $PRECISION ${TEMP}/${FILENAME}-s.${FILETYPE} ${COMPLEX}/${FILENAME}.${FILETYPE};
                ogr2ogr -f GeoJSON ${SIMPLE}/${FILENAME}.json ${TEMP}/${FILENAME}-s.${FILETYPE};
            } &> /dev/null;
        else
            {
                ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=${GEOPRECISION} ${SIMPLE}/${FILENAME}.json ${COMPLEX}/${FILENAME}.${FILETYPE};
            } &> /dev/null;
    fi

    end_time="$(date -u +%s)";
    elapsed="$(($end_time-$start_time))";
#    echo "$i $COUNT $FILENAME $elapsed";
    source "utilities/percentbar.sh" $i $COUNT $FILENAME $elapsed;

done;