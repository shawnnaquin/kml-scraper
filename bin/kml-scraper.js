#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig } from '../lib/config.js';
import { TYPES } from '../lib/types.js';
import * as pipeline from '../lib/pipeline.js';
import { serve } from '../lib/serve.js';

const HELP = `kml-scraper — boundary files in, one simplified geoJSON per place out, matched to ad-platform location IDs

usage: kml-scraper <command> [type]

get the data
  fetch [census|google|overture|msft|meta|all] [--force]
                         download sources into src/ (msft / meta need credentials, see README)

pipelines
  <type>                 run every step for a type: ${Object.keys(TYPES).join(' | ')}
  all                    warning, every type with a source, bump patch version, pack
  all:complex            every step except simplify / ids
  all:simplify           simplify + ids for everything already in dist/complex

single steps (in the order you'd run them)
  shp <type>             SHP / zipped SHP / GPKG -> dist/temp/<type>/*.kml       (census, overture, zillow)
  dissolve dma           counties + old DMA map  -> dist/temp/dma/dma.json
  topo dma               v1: topoJSON DMA map    -> dist/temp/dma/dma.json
  features dma           FeatureCollection       -> dist/complex/dma/*.json
  process <type>         big KML file(s)         -> dist/complex/<type>/*.kml
  simplify <type>        dist/complex/<type>     -> dist/simplified/<type>/*.json
  ids <type>             Google / Microsoft / Meta / Trade Desk location IDs
                         -> geoJSON properties + dist/simplified/<type>/_index.json

other
  serve                  campaign-report map viewer at http://localhost:8080 (MAPS_API_KEY)
  pack                   zip dist/simplified into dist/processed-zip-files
  clean                  rm -rf dist
  sizeof                 size of each dist/simplified/<type>
  warning | beer         words of encouragement

Config lives in package.json#config; any key can be overridden by an env var of the same name
(e.g. PRECISION=0.0005). CONCURRENCY caps parallel workers (default: CPU count).`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: { help: { type: 'boolean', short: 'h' }, force: { type: 'boolean' } },
});

// v1 passed the type as a flag (`process.js --county`); still accept that.
const flagType = Object.keys(values).find((k) => k in TYPES);
const [command, typeArg = command === 'fetch' ? undefined : flagType] = positionals;

if (values.help || !command) {
  console.log(HELP);
  process.exit(command || values.help ? 0 : 1);
}

const config = loadConfig();

const commands = {
  all: () => pipeline.all(config),
  'all:complex': () => pipeline.allComplex(config),
  'all:simplify': () => pipeline.allSimplify(config),
  pack: () => pipeline.pack(config),
  fetch: () => pipeline.fetchSources(config, typeArg ?? 'all', { force: values.force }),
  serve: () => serve(config), // the open server keeps the process alive until Ctrl+C
  clean: () => pipeline.clean(config),
  sizeof: () => pipeline.sizeof(config),
  warning: () => process.stdout.write(pipeline.MESSAGES.warning),
  beer: () => process.stdout.write(pipeline.MESSAGES.beer),
};

try {
  const started = Date.now();
  if (commands[command]) {
    await commands[command]();
  } else if (command in TYPES) {
    await pipeline.runType(config, command);
  } else if (pipeline.STEPS.includes(command)) {
    if (!typeArg) throw new Error(`usage: kml-scraper ${command} <type>`);
    await pipeline.runStep(config, command, typeArg);
  } else {
    throw new Error(`Unknown command "${command}". Try --help`);
  }
  if (!['warning', 'beer', 'serve'].includes(command)) {
    console.log(`\nfinished ${command}${typeArg ? ` ${typeArg}` : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
} catch (err) {
  console.error(`\nerror: ${err.message}`);
  process.exit(1);
}
