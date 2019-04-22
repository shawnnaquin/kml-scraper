#!/usr/bin/env bash

rm -rf dist/simplified/$1
mkdir dist/simplified/$1

for f in dist/complex/$1/*.kml ; do FILENAME=`basename ${f%%}`;

    FILE=dist/simplified/$1/${FILENAME};
    echo ${FILENAME};

    ogr2ogr -f libkml -simplify 0.01 $FILE dist/complex/$1/${FILENAME};

	if grep -q MultiGeometry $FILE; then
		poly=`sed -n '/<MultiGeometry/,/<\/MultiGeometry/p' $FILE | tr -d '[:space:]'`;
	else
		poly=`sed -n '/<Polygon/,/<\/Polygon/p' $FILE | tr -d '[:space:]'`;
	fi

	# poly=${poly//<tessellate>[^;]<\/tessellate>/};
	# poly=${poly//<altitudeMode>clampToGround<\/altitudeMode>/};
	# poly=${poly//<extrude>[^;]<\/extrude>/};

	echo $poly > $FILE;

done;