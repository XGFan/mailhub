/**
 * The open message is encoded in the URL hash (`#/mail/<id>`) so a reload —
 * or a bookmarked / shared link — reopens the same mail. The hash keeps this
 * purely client-side: the static SPA server needs no rewrite rules.
 */

const PREFIX = '#/mail/';

/** Extract the mail id from a `location.hash`; null when none is encoded. */
export function parseMailHash(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  const raw = hash.slice(PREFIX.length);
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-escape — treat as "nothing open"
  }
  id = id.trim();
  return id || null;
}

/** The hash for a mail id; empty string means "no mail open". */
export function mailHash(id: string | null): string {
  return id ? PREFIX + encodeURIComponent(id) : '';
}
