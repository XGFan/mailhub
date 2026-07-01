import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { PortalSettings } from '@mailhub/shared';
import { api } from '@/lib/api';

const DEFAULT_SETTINGS: PortalSettings = { showRemoteImages: false };

export interface SettingsState {
  settings: PortalSettings;
  isLoading: boolean;
  setShowRemoteImages: (value: boolean) => void;
}

/**
 * Load portal settings once, and persist changes via PUT with an optimistic
 * update (reverting + toasting on failure). Defaults are kept if the backend
 * is unreachable so the UI still renders.
 */
export function useSettings(): SettingsState {
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .getSettings(ctrl.signal)
      .then((s) => setSettings(s))
      .catch(() => {
        /* keep defaults when the backend is unavailable */
      })
      .finally(() => setIsLoading(false));
    return () => ctrl.abort();
  }, []);

  const setShowRemoteImages = useCallback(
    (value: boolean) => {
      setSettings((prev) => {
        const next = { ...prev, showRemoteImages: value };
        api.updateSettings(next).catch(() => {
          setSettings(prev);
          toast.error('Could not save settings');
        });
        return next;
      });
    },
    [],
  );

  return { settings, isLoading, setShowRemoteImages };
}
