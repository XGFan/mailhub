import { useEffect } from 'react';
import { useTheme } from 'next-themes';

/** Page background per theme — mirrors `--background` in index.css. */
const THEME_COLORS = { light: '#ffffff', dark: '#0a0a0a' } as const;

/**
 * Keep `<meta name="theme-color">` (the installed app's title/status bar) in
 * step with the in-app theme. index.html's per-scheme metas only follow the OS
 * setting, so an explicit toggle would otherwise leave a mismatched bar.
 */
export function useThemeColor(): void {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = THEME_COLORS[resolvedTheme];
    }
  }, [resolvedTheme]);
}
