import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SearchField } from '@mailhub/shared';
import { ApiError, api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { useIsMobile } from '@/hooks/use-media-query';
import { useMailSearch } from '@/hooks/use-mail-search';
import { useSettings } from '@/hooks/use-settings';
import { AppHeader } from '@/components/app-header';
import { MailDetailPane } from '@/components/mail-detail';
import { MailList } from '@/components/mail-list';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

export default function App() {
  const [rawQuery, setRawQuery] = useState('');
  const [field, setField] = useState<SearchField>('all');
  const [includeSpam, setIncludeSpam] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [isFetching, setIsFetching] = useState(false);

  const isMobile = useIsMobile();
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), 300);
  const { settings, setShowRemoteImages } = useSettings();

  const params = useMemo(
    () => ({ q: debouncedQuery || undefined, field, page, pageSize: PAGE_SIZE, includeSpam }),
    [debouncedQuery, field, page, includeSpam],
  );

  const { data, isLoading, isError, errorMessage, refetch } = useMailSearch(params);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Reset to the first page whenever the query or filters change.
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, field, includeSpam]);

  // Clamp the keyboard-active row to the current result set.
  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(0, i), Math.max(0, items.length - 1)));
  }, [items.length]);

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

  const showList = !isMobile || mobileView === 'list';
  const showDetail = !isMobile || mobileView === 'detail';

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <AppHeader
        query={rawQuery}
        onQueryChange={setRawQuery}
        field={field}
        onFieldChange={setField}
        onFetchNow={handleFetchNow}
        isFetching={isFetching}
        showRemoteImages={settings.showRemoteImages}
        onShowRemoteImagesChange={setShowRemoteImages}
      />

      <main className="flex min-h-0 flex-1">
        <section
          aria-label="Message list"
          className={cn(
            'min-h-0 flex-col border-r',
            'w-full lg:w-[380px] lg:shrink-0 xl:w-[420px]',
            showList ? 'flex' : 'hidden',
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
            hasQuery={debouncedQuery.length > 0}
            includeSpam={includeSpam}
            isLoading={isLoading}
            isError={isError}
            errorMessage={errorMessage}
            onRetry={refetch}
            onOpen={openIndex}
            onActiveIndexChange={setActiveIndex}
            onPageChange={setPage}
            onIncludeSpamChange={setIncludeSpam}
          />
        </section>

        <section
          aria-label="Reading pane"
          className={cn('min-h-0 flex-1', showDetail ? 'flex' : 'hidden')}
        >
          <div className="min-h-0 flex-1">
            <MailDetailPane
              id={selectedId}
              showRemoteImages={settings.showRemoteImages}
              isMobile={isMobile}
              onBack={() => setMobileView('list')}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
