import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Wipe and recreate a dist folder so stale output from a previous run never leaks into a zip. */
export async function resetDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

/** Files in `dir` (not recursive) with the given extension, sorted for deterministic runs. */
export async function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === `.${ext}`)
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function listDirs(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort();
}

export async function totalSize(files) {
  const sizes = await Promise.all(files.map(async (f) => (await stat(f)).size));
  return sizes.reduce((a, b) => a + b, 0);
}

export const baseName = (file) => path.basename(file, path.extname(file));

export function humanSize(bytes) {
  const units = ['B', 'K', 'M', 'G'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i ? 1 : 0)}${units[i]}`;
}
