import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resetDir } from '../fsutil.js';
import { nameParser } from '../naming.js';
import { ProgressBar } from '../progress.js';
import { writeAttributes } from './process.js';

/**
 * features: a geoJSON FeatureCollection -> one FeatureCollection file per Feature in dist/complex/{type}.
 *
 * For DMAs the file is named from `dmainfo.json[dma].dma1` ("Portland-Auburn, ME" -> portland-auburn_me.json)
 * and the dmainfo record (rank, TV homes, lat/long…) is merged into the feature's properties. v1 wrote the
 * merged record back over src/dmainfo.json; v2 leaves src alone and writes it to dist/temp/{type}/dmainfo.json.
 */
export async function featureCollection2features(config, typeName, collectionFile) {
  const collection = JSON.parse(await readFile(collectionFile, 'utf8'));
  const isDma = typeName === 'dma';
  const dmainfo = isDma ? JSON.parse(await readFile(config.paths.srcFile('SRCDMAINFO'), 'utf8')) : null;

  const out = config.paths.complex(typeName);
  await resetDir(out);

  const bar = new ProgressBar(`features ${typeName}`, collection.features.length);
  const attributes = {};

  for (const [index, source] of collection.features.entries()) {
    // GDAL's TopoJSON driver copies the topology `id` into properties; v1's converter didn't.
    const { id: _topologyId, ...own } = source.properties ?? {};
    const key = own.dma ?? own.name;

    let properties = own;
    let label = own.name ?? String(index);
    if (isDma) {
      if (dmainfo[key]) dmainfo[key] = { ...dmainfo[key], ...own };
      properties = { ...dmainfo[key], ...own };
      // DMAs only in the dissolved map (Alaska / Hawaii) have no dma1: "Anchorage" + states -> "Anchorage, AK"
      const short = dmainfo[key]?.['Designated Market Area (DMA)'];
      label = dmainfo[key]?.dma1 ?? own.dma1 ?? (short && own.states ? `${short}, ${own.states.replaceAll(',', '-')}` : String(key));
    }

    const name = nameParser(label);
    attributes[name] = properties;
    const feature = { id: index, type: 'Feature', properties, geometry: source.geometry };
    await writeFile(path.join(out, `${name}.json`), JSON.stringify({ type: 'FeatureCollection', features: [feature] }));
    bar.tick(1, name);
  }

  if (isDma) {
    const dest = path.join(config.paths.temp(typeName), path.basename(config.paths.srcFile('SRCDMAINFO')));
    await writeFile(dest, `${JSON.stringify(dmainfo, null, 4)}\n`);
  }
  await writeAttributes(config, typeName, attributes);
  const written = Object.keys(attributes).length;
  return { written, collisions: collection.features.length - written };
}
