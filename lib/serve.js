import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { listDirs } from './fsutil.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
};

/**
 * serve: a tiny static server for the map viewer (viewer/) and the generated shapes (dist/simplified).
 *   /                -> viewer/index.html
 *   /api/layers      -> which dist/simplified/<type>/_index.json exist
 *   /api/config      -> the Maps API key from MAPS_API_KEY / package.json#config.MAPSAPIKEY, if set
 *   /data/<type>/…   -> dist/simplified/<type>/…
 */
export function serve(config, { port = Number(config.raw.PORT) || 8080, host = process.env.HOST ?? '127.0.0.1' } = {}) {
  const viewer = path.join(config.root, 'viewer');
  const data = config.paths.simpleRoot;

  const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const sendFile = (res, file) => {
    if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  };
  /** Resolve a URL path under `root`, refusing anything that escapes it. */
  const within = (root, rel) => {
    const file = path.resolve(root, `.${path.posix.normalize(`/${decodeURIComponent(rel)}`)}`);
    return file.startsWith(root + path.sep) || file === root ? file : null;
  };

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/layers') {
        const layers = (await listDirs(data))
          .filter((d) => existsSync(path.join(d, '_index.json')))
          .map((d) => path.basename(d));
        return send(res, 200, JSON.stringify(layers), TYPES['.json']);
      }
      if (pathname === '/api/config') {
        const key = process.env.MAPS_API_KEY || config.raw.MAPSAPIKEY || '';
        return send(res, 200, JSON.stringify({ mapsApiKey: key }), TYPES['.json']);
      }
      if (pathname.startsWith('/data/')) {
        const file = within(data, pathname.slice('/data/'.length));
        return file ? sendFile(res, file) : send(res, 403, 'forbidden');
      }
      const file = within(viewer, pathname === '/' ? 'index.html' : pathname.slice(1));
      return file ? sendFile(res, file) : send(res, 403, 'forbidden');
    } catch (err) {
      send(res, 500, err.message);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const shown = host === '0.0.0.0' ? 'localhost' : host;
      process.stdout.write(`map viewer: http://${shown}:${port}/   (Ctrl+C to stop)\n`);
      resolve(server);
    });
  });
}
