import { useEffect, useMemo, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { MailSort, SearchField } from '@mailhub/shared';
import { ApiError, api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { useIsMobile } from '@/hooks/use-media-query';
import { useMailSearch } from '@/hooks/use-mail-search';
import { MAX_LIST_WIDTH, MIN_LIST_WIDTH, useResizableWidth } from '@/hooks/use-resizable-width';
import { useSettings } from '@/hooks/use-settings';
import { AppHeader } from '@/components/app-header';
import { MailDetailPane } from '@/components/mail-detail';
import { MailList } from '@/components/mail-list';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
const LIST_WIDTH_KEY = 'mailhub:list-width';
const LIST_COLLAPSED_KEY = 'mailhub:list-collapsed';
const DEFAULT_LIST_WIDTH = 400;

export default function App() {
  const [rawQuery, setRawQuery] = useState('');
  const [field, setField] = useState<SearchField>('all');
  const [includeSpam, setIncludeSpam] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<MailSort>('date-desc');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [isFetching, setIsFetching] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [listCollapsed, setListCollapsed] = useState<boolean>(
    () => globalThis.localStorage?.getItem(LIST_COLLAPSED_KEY) === '1',
  );

  const isMobile = useIsMobile();
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), 300);
  const { settings, setShowRemoteImages } = useSettings();
  const { width, resizing, startResize, onSeparatorKeyDown } = useResizableWidth(
    LIST_WIDTH_KEY,
    DEFAULT_LIST_WIDTH,
  );

  const params = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      field,
      sort,
      page,
      pageSize: PAGE_SIZE,
      includeSpam,
      favorite: favoriteOnly || undefined,
    }),
    [debouncedQuery, field, sort, page, includeSpam, favoriteOnly],
  );

  const { data, isLoading, isError, errorMessage, refetch } = useMailSearch(params);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Reset to the first page whenever the query or filters change.
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, field, sort, includeSpam, favoriteOnly]);

  // Clamp the keyboard-active row to the current result set.
  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(0, i), Math.max(0, items.length - 1)));
  }, [items.length]);

  // Selection is per-page (batch actions only see the visible rows), so drop it
  // whenever the page changes — otherwise the "N selected" count would count
  // rows the batch buttons can't act on.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

  function openIndex(index: number) {
    const item = items[index];
    if (!item) return;
    setActiveIndex(index);
    setSelectedId(item.id);
    if (isMobile) setMobileView('detail');
  }

  async function handleFetchNow() {
    setIsFetching(true);
    try {
      const res = await api.runIngest();
      if (res.alreadyRunning) {
        toast.info('A fetch is already running…');
      } else if (typeof res.processed === 'number') {
        toast.success(
          res.processed > 0
            ? `Fetched ${res.processed} new message${res.processed === 1 ? '' : 's'}`
            : 'No new mail',
        );
      } else {
        toast.success('Fetch started');
      }
      refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to fetch mail');
    } finally {
      setIsFetching(false);
    }
  }

  function toggleListCollapsed() {
    setListCollapsed((c) => {
      const next = !c;
      try {
        globalThis.localStorage?.setItem(LIST_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / disabled) — state still applies.
      }
      return next;
    });
  }

  function toggleSelectionMode() {
    setSelectionMode((on) => {
      if (on) setSelectedIds(new Set()); // leaving selection clears the checks
      return !on;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Star toggle from a list row / row menu. Persist then resync the list so
  // unstarred mail leaves the Starred filter.
  async function handleToggleFavorite(id: string, next: boolean) {
    try {
      await api.setFavorite(id, next);
      refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update star');
    }
  }

  async function handleBatchFavorite(ids: string[], next: boolean) {
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => api.setFavorite(id, next)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) toast.error(`Failed to update ${failed} of ${ids.length} message(s)`);
    setSelectedIds(new Set());
    refetch();
  }

  // Delete one or many mails (already confirmed by the list's dialog).
  async function handleDeleteMany(ids: string[]) {
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => api.deleteMail(id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const ok = ids.length - failed;
    if (ok > 0) toast.success(`Deleted ${ok} message${ok === 1 ? '' : 's'}`);
    if (failed > 0) toast.error(`Failed to delete ${failed} message${failed === 1 ? '' : 's'}`);
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId(null);
      setMobileView('list');
    }
    setSelectedIds(new Set());
    refetch();
  }

  // Delete initiated from the reading pane's own confirm dialog.
  function handleDeleted(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
      setMobileView('list');
    }
    refetch();
  }

  const showList = !isMobile || mobileView === 'list';
  const showDetail = !isMobile || mobileView === 'detail';
  const desktopCollapsed = !isMobile && listCollapsed;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <AppHeader
        onFetchNow={handleFetchNow}
        isFetching={isFetching}
        showRemoteImages={settings.showRemoteImages}
        onShowRemoteImagesChange={setShowRemoteImages}
      />

      <main className={cn('flex min-h-0 flex-1', resizing && 'select-none')}>
        {/* Slim rail with the expand control when the list is collapsed (desktop). */}
        {desktopCollapsed && (
          <div className="flex w-10 shrink-0 flex-col items-center justify-end border-r bg-muted/20 py-2">
            <button
              type="button"
              onClick={toggleListCollapsed}
              aria-label="Expand list"
              title="Expand list"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="size-4" aria-hidden />
            </button>
          </div>
        )}

        <section
          id="mail-list-pane"
          aria-label="Message list"
          style={!isMobile && !desktopCollapsed ? { width } : undefined}
          className={cn(
            'min-h-0 flex-col border-r',
            isMobile ? 'w-full' : 'shrink-0',
            showList && !desktopCollapsed ? 'flex' : 'hidden',
          )}
        >
          <MailList
            items={items}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            selectedId={selectedId}
            activeIndex={activeIndex}
            query={debouncedQuery}
            rawQuery={rawQuery}
            onQueryChange={setRawQuery}
            field={field}
            onFieldChange={setField}
            hasQuery={debouncedQuery.length > 0}
            favoriteOnly={favoriteOnly}
            onFavoriteOnlyChange={setFavoriteOnly}
            includeSpam={includeSpam}
            onIncludeSpamChange={setIncludeSpam}
            sort={sort}
            onSortChange={setSort}
            selectionMode={selectionMode}
            onToggleSelectionMode={toggleSelectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={() => setSelectedIds(new Set(items.map((i) => i.id)))}
            onClearSelection={() => setSelectedIds(new Set())}
            onBatchFavorite={handleBatchFavorite}
            canCollapse={!isMobile}
            onCollapse={toggleListCollapsed}
            isLoading={isLoading}
            isError={isError}
            errorMessage={errorMessage}
            onRetry={refetch}
            onOpen={openIndex}
            onActiveIndexChange={setActiveIndex}
            onPageChange={setPage}
            onToggleFavorite={handleToggleFavorite}
            onDeleteMany={handleDeleteMany}
          />
        </section>

        {/* Drag handle between the two panes (desktop, expanded only). */}
        {!isMobile && !desktopCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize message list"
            aria-controls="mail-list-pane"
            aria-valuemin={MIN_LIST_WIDTH}
            aria-valuemax={MAX_LIST_WIDTH}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={onSeparatorKeyDown}
            className={cn(
              'w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/50 focus:outline-none focus-visible:bg-primary',
              resizing && 'bg-primary',
            )}
          />
        )}

        <section
          aria-label="Reading pane"
          className={cn(
            'min-h-0 flex-1',
            showDetail ? 'flex' : 'hidden',
            resizing && 'pointer-events-none',
          )}
        >
          <div className="min-h-0 flex-1">
            <MailDetailPane
              id={selectedId}
              showRemoteImages={settings.showRemoteImages}
              isMobile={isMobile}
              onBack={() => setMobileView('list')}
              onFavoriteChanged={refetch}
              onDeleted={handleDeleted}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
