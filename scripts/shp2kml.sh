!/usr/bin/env bash
start_time="$(date -u +%s)";

PRECISION=$( source "utilities/readjson.sh" PRECISION );

TYPE=$1;
FILETYPE=$2;

DISTFOLDER=$( source "utilities/readjson.sh" DISTFOLDER );
DISTTEMPFOLDER=$( source "utilities/readjson.sh" DISTTEMPFOLDER );

TEMP=$DISTFOLDER/$DISTTEMPFOLDER/$TYPE;

SRCFOLDER=$( source "utilities/readjson.sh" SRCFOLDER );
SRC='';

if [ $TYPE == 'neighborhood' ]; then
    SRC=$( source "utilities/readjson.sh" "SRCNEIGHBORHOODFOLDER" );
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
done
exit;