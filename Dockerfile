FROM geographica/gdal2:latest

RUN apt-get update && apt-get install -y \
	python-shapely