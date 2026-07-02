import type {
  BlockRule,
  BlockRuleType,
  BlockRulesResponse,
  FavoriteResponse,
  IngestRunResponse,
  MailDetail,
  MailSort,
  PortalSettings,
  SearchField,
  SearchResponse,
} from '@mailhub/shared';

/** Base path for the portal API. In dev, Vite proxies `/api` → the backend. */
const API_BASE = '/api';

/** localStorage key holding the optional client-side API key (feature C). */
const API_KEY_STORAGE = 'mailhub-api-key';

/** A typed error carrying the HTTP status when the server responded. */
export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The API key stored in this browser (trimmed), or `''` when none is set. */
export function getStoredApiKey(): string {
  try {
    return globalThis.localStorage?.getItem(API_KEY_STORAGE)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Persist (or clear, when blank) the client-side API key in this browser. */
export function setStoredApiKey(key: string): void {
  const trimmed = key.trim();
  try {
    if (trimmed) globalThis.localStorage?.setItem(API_KEY_STORAGE, trimmed);
    else globalThis.localStorage?.removeItem(API_KEY_STORAGE);
  } catch {
    // Ignore storage failures (private mode / disabled) — requests still work.
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Build headers on a Headers object so our defaults and the stored API key
  // always win: a caller-passed `init.headers` seeds it, then our `set()` calls
  // override. (The `...init` spread below carries `init.headers` too, so we pass
  // the merged `headers` last to clobber it.)
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const apiKey = getStoredApiKey();
  if (apiKey) headers.set('X-API-Key', apiKey);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Network error — is the portal reachable?');
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Query parameters accepted by the search endpoint (client shape). */
export interface SearchParams {
  q?: string;
  field?: SearchField;
  sort?: MailSort;
  page?: number;
  pageSize?: number;
  includeSpam?: boolean;
  favorite?: boolean;
}

export const api = {
  searchMails(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.field) qs.set('field', params.field);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.includeSpam) qs.set('includeSpam', 'true');
    if (params.favorite) qs.set('favorite', 'true');
    const query = qs.toString();
    return request<SearchResponse>(`/mails${query ? `?${query}` : ''}`, { signal });
  },

  getMail(id: string, signal?: AbortSignal): Promise<MailDetail> {
    return request<MailDetail>(`/mails/${encodeURIComponent(id)}`, { signal });
  },

  /** Star / unstar a mail. Starred mail is exempt from the retention purge. */
  setFavorite(id: string, favorite: boolean): Promise<FavoriteResponse> {
    return request<FavoriteResponse>(`/mails/${encodeURIComponent(id)}/favorite`, {
      method: 'PUT',
      body: JSON.stringify({ favorite }),
    });
  },

  /** Permanently delete a mail (row + attachment files + raw .eml). */
  deleteMail(id: string): Promise<void> {
    return request<void>(`/mails/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  runIngest(): Promise<IngestRunResponse> {
    return request<IngestRunResponse>('/ingest/run', { method: 'POST' });
  },

  getSettings(signal?: AbortSignal): Promise<PortalSettings> {
    return request<PortalSettings>('/settings', { signal });
  },

  updateSettings(settings: PortalSettings): Promise<PortalSettings> {
    return request<PortalSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  /** List block (拒收) rules, newest first. */
  getBlockRules(signal?: AbortSignal): Promise<BlockRulesResponse> {
    return request<BlockRulesResponse>('/block-rules', { signal });
  },

  /** Create a block rule. 409 (duplicate) / 400 (invalid) surface via ApiError. */
  createBlockRule(ruleType: BlockRuleType, value: string): Promise<BlockRule> {
    return request<BlockRule>('/block-rules', {
      method: 'POST',
      body: JSON.stringify({ ruleType, value }),
    });
  },

  /** Delete a block rule by id (204; 404 if already gone). */
  deleteBlockRule(id: string): Promise<void> {
    return request<void>(`/block-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Force-download URL for the raw `.eml`. Server sets Content-Disposition. */
  rawUrl(id: string): string {
    return `${API_BASE}/mails/${encodeURIComponent(id)}/raw`;
  },

  /** Force-download URL for an attachment. Server sets Content-Disposition. */
  attachmentUrl(id: string): string {
    return `${API_BASE}/attachments/${encodeURIComponent(id)}`;
  },
};
