rm -rf ../dist/simplified/county
mkdir ../dist/simplified/county

for f in ../dist/county/*.kml ; do FILENAME=`basename ${f%%}`;
    ogr2ogr -f libkml -simplify 0.001 ../dist/simplified/county/${FILENAME} ../dist/zip/${FILENAME}
done;