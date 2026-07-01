import { useEffect, useState } from 'react';

/** Reactive `window.matchMedia` boolean for a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** True below the desktop breakpoint (single-pane layout). Desktop ≥ 1024px. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}
