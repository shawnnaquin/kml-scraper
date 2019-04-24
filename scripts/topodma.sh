#!/usr/bin/env bash

rm -rf dist/temp/dma/;
mkdir dist/temp/dma/;
python utilities/topo2geojson.py src/nielsentopo.json dist/temp/dma/geodma.json;