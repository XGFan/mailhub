/**
 * `parseInIsolation` — run the MIME parse inside a worker_thread bounded by a
 * timeout. On timeout or crash the worker is terminated and the promise
 * rejects, so the ingestor routes the offending object to `dead/` instead of
 * hanging the loop (sec-M2).
 */
import { Worker } from 'node:worker_threads';
import type { ParsedAttachment, ParsedMail } from './parser';

const WORKER_URL = new URL('./parse-worker.ts', import.meta.url);

/**
 * Build the worker's execArgv. Under `tsx`/`node --import tsx` the parent's
 * execArgv already carries the TS loader, so we inherit it; otherwise we append
 * `--import tsx` so the .ts worker still loads (e.g. under a plain node parent).
 */
function tsxExecArgv(): string[] {
  const argv = process.execArgv;
  return argv.some((a) => a.includes('tsx')) ? argv : [...argv, '--import', 'tsx'];
}

interface WorkerReply {
  ok: boolean;
  mail?: ParsedMail;
  error?: string;
}

function reviveBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  return Buffer.from(content as ArrayBuffer);
}

/** Structured-clone turns the worker's Buffers into Uint8Arrays; revive them. */
function reviveMail(mail: ParsedMail): ParsedMail {
  const attachments: ParsedAttachment[] = mail.attachments.map((a) => ({
    ...a,
    content: reviveBuffer(a.content),
  }));
  return { ...mail, attachments };
}

/** Parse `buf` in an isolated worker, rejecting after `timeoutMs`. */
export function parseInIsolation(buf: Buffer, timeoutMs: number): Promise<ParsedMail> {
  return new Promise((resolve, reject) => {
    // Copy out of the (possibly pooled) Buffer into a standalone ArrayBuffer
    // we can transfer to the worker.
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
    const worker = new Worker(WORKER_URL, { execArgv: tsxExecArgv() });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`parse timeout after ${timeoutMs}ms`)));
    }, timeoutMs);

    worker.once('message', (msg: WorkerReply) => {
      finish(() => {
        if (msg.ok && msg.mail) resolve(reviveMail(msg.mail));
        else reject(new Error(msg.error ?? 'parse failed'));
      });
    });
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`parse worker exited (${code})`)));
    });

    worker.postMessage(ab, [ab]);
  });
}
