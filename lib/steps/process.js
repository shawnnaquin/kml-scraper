import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { baseName, humanSize, resetDir, totalSize } from '../fsutil.js';
import { mapPool } from '../pool.js';
import { ProgressBar } from '../progress.js';

const WORKER = new URL('../kml/split-worker.js', import.meta.url);

/**
 * process: the bad mama jamma. One or more big KML files (many placemarks each) ->
 * one lossless KML file per place in dist/complex/{type}.
 *
 * v1 parsed whole files into memory and fanned them out with Promise.all (heap go boom).
 * v2 streams every file and splits them on real worker threads, one file per core.
 *
 * Each place's source attributes (GEOID, NAMELSAD, STATEFP…) are saved to dist/temp/{type}/attributes.json
 * so the `ids` step can match places to Google Ads / Microsoft Advertising locations.
 */
export async function processKml(config, typeName, files, { qualifiers = [] } = {}) {
  if (!files.length) throw new Error(`No .kml files to process for ${typeName}`);

  const [statefips, stateabbrev] = await Promise.all(
    ['SRCFIPS', 'SRCABBREV'].map(async (key) => JSON.parse(await readFile(config.paths.srcFile(key), 'utf8'))),
  );

  const out = config.paths.complex(typeName);
  await resetDir(out);

  const total = await totalSize(files);
  const bar = new ProgressBar(`process ${typeName}`, total, { format: humanSize });
  const done = new Map(files.map((f) => [f, 0]));
  const sum = { written: 0, duplicates: 0, skipped: [] };
  const attributes = {};

  await mapPool(files, (file) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(WORKER, { workerData: { file, outDir: out, type: typeName, statefips, stateabbrev, qualifiers } });
      worker.on('message', (msg) => {
        if (msg.progress !== undefined) {
          done.set(file, msg.progress);
          bar.update([...done.values()].reduce((a, b) => a + b, 0), baseName(file));
        } else if (msg.done) {
          sum.written += msg.done.written;
          sum.duplicates += msg.done.duplicates;
          sum.skipped.push(...msg.done.skipped);
          for (const [name, attrs] of Object.entries(msg.attributes)) attributes[name] ??= attrs;
          resolve();
        }
      });
      worker.once('error', (err) => reject(new Error(`${file}: ${err.message}`, { cause: err })));
      worker.once('exit', (code) => code !== 0 && reject(new Error(`${file}: worker exited with code ${code}`)));
    }),
  );

  bar.update(total);
  await writeAttributes(config, typeName, attributes);
  process.stdout.write(`process ${typeName}: ${sum.written} places, ${sum.duplicates} duplicates dropped\n`);
  if (sum.skipped.length) process.stdout.write(`  skipped ${sum.skipped.length} placemarks with no name\n`);
  return sum;
}

export async function writeAttributes(config, typeName, attributes) {
  const dir = config.paths.temp(typeName);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'attributes.json'), JSON.stringify(attributes));
}
