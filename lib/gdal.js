import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function gdal(tool, args) {
  try {
    return await run(tool, args, { maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`${tool} not found on PATH. Install GDAL >= 3.1 or run inside Docker: \`npm run docker -- <command>\``);
    }
    const detail = (err.stderr || err.message).trim();
    throw new Error(`${tool} ${args.join(' ')}\n${detail}`);
  }
}

/** Thin wrapper around `ogr2ogr`; surfaces GDAL's stderr when it fails instead of swallowing it. */
export const ogr2ogr = (args) => gdal('ogr2ogr', args);

export async function ogrinfoJson(source, args = ['-so']) {
  const { stdout } = await gdal('ogrinfo', ['-json', ...args, source]);
  return JSON.parse(stdout);
}
