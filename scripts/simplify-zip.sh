rm -rf ../dist/simplified
mkdir ../dist/simplified
mkdir ../dist/simplified/zip

for f in ../dist/zip/*.kml ; do FILENAME=`basename ${f%%}`;
    ogr2ogr -f libkml -simplify 0.001 ../dist/simplified/zip/${FILENAME} ../dist/zip/${FILENAME}
done;