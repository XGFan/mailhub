/**
 * Worker-thread entry: parses one raw MIME buffer in isolation so a malicious
 * message that hangs or blows up memory can be timed-out / terminated by the
 * caller without taking down the ingestor loop (sec-M2 DoS defense).
 *
 * Protocol: the parent posts the raw bytes as an ArrayBuffer (transferred);
 * this worker replies once with `{ ok: true, mail }` or `{ ok: false, error }`.
 */
import { parentPort } from 'node:worker_threads';
import { parseRaw } from './parser';

parentPort?.on('message', async (ab: ArrayBuffer) => {
  try {
    const mail = await parseRaw(Buffer.from(ab));
    parentPort!.postMessage({ ok: true, mail });
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
