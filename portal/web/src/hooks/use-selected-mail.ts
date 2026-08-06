import { useCallback, useEffect, useState } from 'react';
import { mailHash, parseMailHash } from '@/lib/mail-hash';

function hashId(): string | null {
  return parseMailHash(globalThis.location?.hash ?? '');
}

/**
 * The currently open mail, mirrored in the URL hash so a reload reopens it.
 * Selecting pushes a history entry, so Back returns to the previously open
 * mail (or to the list); Back/Forward drive the selection in turn.
 */
export function useSelectedMail(): [string | null, (id: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(hashId);

  useEffect(() => {
    const sync = () => setSelectedId(hashId());
    // `hashchange` covers manual edits; `popstate` covers Back/Forward across
    // the entries we push ourselves (pushState alone fires neither).
    globalThis.addEventListener('hashchange', sync);
    globalThis.addEventListener('popstate', sync);
    return () => {
      globalThis.removeEventListener('hashchange', sync);
      globalThis.removeEventListener('popstate', sync);
    };
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const { pathname, search, hash } = globalThis.location;
    const next = mailHash(id);
    if (hash === next) return;
    try {
      globalThis.history.pushState(null, '', `${pathname}${search}${next}`);
    } catch {
      // Ignore history failures — the in-memory selection still applies.
    }
  }, []);

  return [selectedId, select];
}
