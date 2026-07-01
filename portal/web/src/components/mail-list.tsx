import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MailListItem } from '@mailhub/shared';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { MailListRow } from '@/components/mail-list-item';
import { EmptyInboxState, ErrorState, ListSkeleton, NoResultsState } from '@/components/states';

interface Props {
  items: MailListItem[];
  total: number;
  page: number;
  pageSize: number;
  selectedId: string | null;
  activeIndex: number;
  query: string;
  hasQuery: boolean;
  includeSpam: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onOpen: (index: number) => void;
  onActiveIndexChange: (index: number) => void;
  onPageChange: (page: number) => void;
  onIncludeSpamChange: (value: boolean) => void;
}

export function MailList(props: Props) {
  const {
    items,
    total,
    page,
    pageSize,
    selectedId,
    activeIndex,
    query,
    hasQuery,
    includeSpam,
    isLoading,
    isError,
    errorMessage,
    onRetry,
    onOpen,
    onActiveIndexChange,
    onPageChange,
    onIncludeSpamChange,
  } = props;

  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items]);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (items.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        onActiveIndexChange(Math.min(items.length - 1, activeIndex + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        onActiveIndexChange(Math.max(0, activeIndex - 1));
        break;
      case 'Home':
        e.preventDefault();
        onActiveIndexChange(0);
        break;
      case 'End':
        e.preventDefault();
        onActiveIndexChange(items.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        onOpen(activeIndex);
        break;
      default:
        break;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(total, page * pageSize);
  const activeDescId = items[activeIndex] ? `mail-opt-${items[activeIndex].id}` : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {isLoading && items.length === 0
            ? 'Loading…'
            : hasQuery
              ? `${total} result${total === 1 ? '' : 's'}`
              : `${total} message${total === 1 ? '' : 's'}`}
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <span>Show spam</span>
          <Switch
            checked={includeSpam}
            onCheckedChange={onIncludeSpamChange}
            aria-label="Show spam messages"
          />
        </label>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {isError ? (
          <ErrorState message={errorMessage} onRetry={onRetry} />
        ) : isLoading && items.length === 0 ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          hasQuery ? (
            <NoResultsState query={query} />
          ) : (
            <EmptyInboxState />
          )
        ) : (
          <ScrollArea className="h-full">
            <div
              ref={listRef}
              role="listbox"
              aria-label="Messages"
              aria-activedescendant={activeDescId}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              className="divide-y outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {items.map((item, index) => (
                <div key={item.id} data-index={index}>
                  <MailListRow
                    item={item}
                    optionId={`mail-opt-${item.id}`}
                    isSelected={item.id === selectedId}
                    isActive={index === activeIndex}
                    query={query}
                    onClick={() => onOpen(index)}
                  />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Pagination */}
      {!isError && items.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            {startIdx}–{endIdx} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-1 tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
