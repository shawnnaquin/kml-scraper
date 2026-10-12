import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { splitKml } from './split.js';

const { file, outDir, type, statefips, stateabbrev, qualifiers } = workerData;
const attributes = {};

const stats = await splitKml(file, {
  type,
  statefips,
  stateabbrev,
  qualifiers,
  onPlacemark: (name, kml, attrs) => {
    attributes[name] = attrs;
    return writeFile(path.join(outDir, `${name}.kml`), kml);
  },
  onProgress: (bytes) => parentPort.postMessage({ progress: bytes }),
});

parentPort.postMessage({ done: stats, attributes });
