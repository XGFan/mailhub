import { useEffect, useState } from 'react';
import type { MailDetail } from '@mailhub/shared';
import { ApiError, api } from '@/lib/api';

export interface MailDetailState {
  data: MailDetail | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  reload: () => void;
}

/** Fetch a single mail's full detail. Passing `null` clears the state. */
export function useMailDetail(id: string | null): MailDetailState {
  const [data, setData] = useState<MailDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) {
      setData(null);
      setIsLoading(false);
      setIsError(false);
      return;
    }
    const ctrl = new AbortController();
    setIsLoading(true);
    setIsError(false);
    setErrorMessage(null);
    api
      .getMail(id, ctrl.signal)
      .then((res) => {
        setData(res);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setIsError(true);
        setErrorMessage(err instanceof ApiError ? err.message : 'Failed to load message');
        setIsLoading(false);
      });
    return () => ctrl.abort();
  }, [id, reloadKey]);

  return {
    data,
    isLoading,
    isError,
    errorMessage,
    reload: () => setReloadKey((k) => k + 1),
  };
}
