/**
 * A tiny out-of-band HTTP "tracker" server used to prove AC6b end-to-end: an
 * email's remote `<img>` / CSS `url()` beacon points here, and the specs assert
 * this server receives ZERO hits when a message is opened with remote content
 * blocked (the default), and a hit only once the reader opts in.
 *
 * It is started once in global-setup (the main Playwright process, which stays
 * alive for the whole run). Because hit state must be shared across Playwright's
 * separate worker processes, counters are exposed over HTTP (`/__hits`,
 * `/__reset`) rather than in memory — any worker can read/reset them.
 */
import http from 'node:http';
import { TRACKER_ORIGIN, TRACKER_PORT } from './env';

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

interface Hit {
  path: string;
  method: string;
  at: string;
  ua?: string;
}

let server: http.Server | null = null;
const hits: Hit[] = [];

export function startTracker(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', TRACKER_ORIGIN);

      // Control endpoints (not counted as tracker hits).
      if (url.pathname === '/__hits') {
        const body = JSON.stringify({ total: hits.length, hits });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
        return;
      }
      if (url.pathname === '/__reset') {
        hits.length = 0;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }

      // Anything else is a real content fetch → record it.
      hits.push({
        path: url.pathname,
        method: req.method ?? 'GET',
        at: new Date().toISOString(),
        ua: req.headers['user-agent'],
      });
      res.writeHead(200, {
        'content-type': 'image/gif',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(PIXEL);
    });
    server.on('error', reject);
    server.listen(TRACKER_PORT, '127.0.0.1', () => resolve());
  });
}

export function stopTracker(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
}
