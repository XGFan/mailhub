import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Bounds for the draggable mail-list column (px). */
export const MIN_LIST_WIDTH = 320;
export const MAX_LIST_WIDTH = 720;
/** Keyboard nudge step for the resize separator. */
const NUDGE_STEP = 24;

function clamp(n: number): number {
  return Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, Math.round(n)));
}

/**
 * A persisted, pointer-draggable width for the mail-list column. The separator
 * calls `startResize` on pointer-down (window listeners then track the drag) and
 * `nudge` on arrow keys for keyboard accessibility; the width is written back to
 * localStorage whenever a drag settles.
 */
export function useResizableWidth(storageKey: string, fallback: number) {
  const [width, setWidth] = useState<number>(() => {
    const raw = globalThis.localStorage?.getItem(storageKey);
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? clamp(n) : fallback;
  });
  const [resizing, setResizing] = useState(false);
  const start = useRef({ x: 0, w: fallback });

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      start.current = { x: e.clientX, w: width };
      setResizing(true);
    },
    [width],
  );

  const nudge = useCallback((delta: number) => {
    setWidth((w) => clamp(w + delta));
  }, []);

  const onSeparatorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudge(-NUDGE_STEP);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudge(NUDGE_STEP);
      }
    },
    [nudge],
  );

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: PointerEvent) {
      setWidth(clamp(start.current.w + (e.clientX - start.current.x)));
    }
    function onUp() {
      setResizing(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // A canceled pointer (touch interrupted, gesture, context menu) never fires
    // pointerup — treat it as a drag end so the UI can't get stuck mid-resize.
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizing]);

  // Persist the settled width (never mid-drag) — best-effort, ignore storage errors.
  useEffect(() => {
    if (resizing) return;
    try {
      globalThis.localStorage?.setItem(storageKey, String(width));
    } catch {
      // Private mode / disabled storage — the in-memory width still applies.
    }
  }, [resizing, width, storageKey]);

  return { width, resizing, startResize, onSeparatorKeyDown };
}
