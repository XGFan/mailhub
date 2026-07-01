import { useEffect, useState } from 'react';
import type { SearchResponse } from '@mailhub/shared';
import { ApiError, api, type SearchParams } from '@/lib/api';

export interface MailSearchState {
  data: SearchResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  refetch: () => void;
}

/** Fetch the paginated mail list; refetches when any search param changes. */
export function useMailSearch(params: SearchParams): MailSearchState {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setIsLoading(true);
    setIsError(false);
    setErrorMessage(null);
    api
      .searchMails(params, ctrl.signal)
      .then((res) => {
        setData(res);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setIsError(true);
        setErrorMessage(err instanceof ApiError ? err.message : 'Failed to load mail');
        setIsLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, params.field, params.page, params.pageSize, params.includeSpam, reloadKey]);

  return {
    data,
    isLoading,
    isError,
    errorMessage,
    refetch: () => setReloadKey((k) => k + 1),
  };
}
