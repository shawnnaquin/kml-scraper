import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { baseName, listDirs, listFiles, resetDir } from '../fsutil.js';

async function writeZip(dest, entries) {
  const zip = new yazl.ZipFile();
  for (const [file, name] of entries) zip.addFile(file, name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(dest));
}

/**
 * pack: one zip per dist/simplified/{type} folder, tagged `{type}-{year}-{version}.zip`, then
 * every zip rolled into `all-simplified-boundaries-{year}-{version}.zip`. Ready to hand off.
 * (v1 accidentally put *every* type into each per-type zip; each zip now holds just its own type.)
 */
export async function pack(config) {
  const { version } = JSON.parse(await readFile(path.join(config.root, 'package.json'), 'utf8'));
  const year = new Date().getFullYear();
  const folders = await listDirs(config.paths.simpleRoot);
  if (!folders.length) throw new Error('Nothing to pack — dist/simplified is empty');

  const zipDir = config.paths.zips;
  process.stdout.write(`... spooling... ${path.relative(config.root, zipDir)}/*-${year}-${version}.zip\n`);
  await resetDir(zipDir);

  const simpleName = path.basename(config.paths.simpleRoot);
  const zips = await Promise.all(
    folders.map(async (folder) => {
      const type = path.basename(folder);
      const dest = path.join(zipDir, `${type}-${year}-${version}.zip`);
      const files = await listFiles(folder, 'json');
      await writeZip(dest, files.map((f) => [f, `${simpleName}/${type}/${path.basename(f)}`]));
      process.stdout.write(`done! ${path.relative(config.root, dest)} (${files.length} files)\n`);
      return dest;
    }),
  );

  process.stdout.write('zipping zips!\n');
  const all = path.join(zipDir, `all-simplified-boundaries-${year}-${version}.zip`);
  await writeZip(all, zips.map((z) => [z, path.basename(z)]));
  process.stdout.write(`all done ${path.relative(config.root, all)}\n`);
  return { zips: zips.map(baseName), all };
}
