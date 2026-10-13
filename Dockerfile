# GDAL (ogr2ogr) + Node in one image. Replaces v1's from-source GDAL 2.4 build and separate node container.
ARG GDAL_IMAGE=ghcr.io/osgeo/gdal:ubuntu-small-3.13.3
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS node

FROM ${GDAL_IMAGE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# The project (src/ in, dist/ out) is bind-mounted over /data by docker-compose. node_modules is
# installed here so the anonymous /data/node_modules volume in docker-compose is seeded from the image.
WORKDIR /data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
ENTRYPOINT ["node", "/data/bin/kml-scraper.js"]
CMD ["--help"]
