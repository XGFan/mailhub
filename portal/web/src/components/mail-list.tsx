import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  ListFilter,
  PanelLeftClose,
  Search,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import type { MailListItem, MailSort, SearchField } from '@mailhub/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MailListRow } from '@/components/mail-list-item';
import { EmptyInboxState, ErrorState, ListSkeleton, NoResultsState } from '@/components/states';
import { cn } from '@/lib/utils';

const FIELDS: { value: SearchField; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'to', label: 'To' },
  { value: 'from', label: 'From' },
  { value: 'subject', label: 'Subject' },
];

interface Props {
  items: MailListItem[];
  total: number;
  page: number;
  pageSize: number;
  selectedId: string | null;
  activeIndex: number;
  // Search (lives above the list, Outlook-style).
  query: string;
  rawQuery: string;
  onQueryChange: (value: string) => void;
  field: SearchField;
  onFieldChange: (field: SearchField) => void;
  hasQuery: boolean;
  // Filter.
  favoriteOnly: boolean;
  onFavoriteOnlyChange: (value: boolean) => void;
  includeSpam: boolean;
  onIncludeSpamChange: (value: boolean) => void;
  // Sort.
  sort: MailSort;
  onSortChange: (sort: MailSort) => void;
  // Multi-select.
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchFavorite: (ids: string[], next: boolean) => void;
  // Collapse (desktop two-pane only).
  canCollapse: boolean;
  onCollapse: () => void;
  // Status / data.
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onOpen: (index: number) => void;
  onActiveIndexChange: (index: number) => void;
  onPageChange: (page: number) => void;
  onToggleFavorite: (id: string, next: boolean) => void;
  /** Delete one or many mails (already confirmed). Resolves when done. */
  onDeleteMany: (ids: string[]) => Promise<void>;
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
    rawQuery,
    onQueryChange,
    field,
    onFieldChange,
    hasQuery,
    favoriteOnly,
    onFavoriteOnlyChange,
    includeSpam,
    onIncludeSpamChange,
    sort,
    onSortChange,
    selectionMode,
    onToggleSelectionMode,
    selectedIds,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    onBatchFavorite,
    canCollapse,
    onCollapse,
    isLoading,
    isError,
    errorMessage,
    onRetry,
    onOpen,
    onActiveIndexChange,
    onPageChange,
    onToggleFavorite,
    onDeleteMany,
  } = props;

  const listRef = useRef<HTMLDivElement>(null);
  // Mails queued for the confirm dialog (one from a row menu, or the selection).
  const [pendingDelete, setPendingDelete] = useState<MailListItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      case 'Enter': {
        e.preventDefault();
        const item = items[activeIndex];
        if (selectionMode && item) onToggleSelect(item.id);
        else onOpen(activeIndex);
        break;
      }
      case ' ':
        if (selectionMode) {
          e.preventDefault();
          const item = items[activeIndex];
          if (item) onToggleSelect(item.id);
        }
        break;
      case 'Delete':
      case 'Backspace': {
        // Only fires while the listbox itself has focus, so typing in the
        // search input is never intercepted. Opens the shared confirm dialog.
        e.preventDefault();
        if (selectionMode && selectedIds.size > 0) setPendingDelete(selectedItems);
        else if (items[activeIndex]) setPendingDelete([items[activeIndex]]);
        break;
      }
      default:
        break;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDeleteMany(pendingDelete.map((m) => m.id));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(total, page * pageSize);
  const activeDescId = items[activeIndex] ? `mail-opt-${items[activeIndex].id}` : undefined;

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const allChecked = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  const filterActive = favoriteOnly || includeSpam || field !== 'all';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Search + toolbar (Outlook-style, single row above the list) */}
      <div className="flex items-center gap-1 border-b px-3 py-2.5">
        {selectionMode ? (
          <>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={() => (allChecked ? onClearSelection() : onSelectAll())}
              aria-label="Select all on this page"
              className="ml-1 size-4 accent-primary"
            />
            <span className="ml-1 text-xs font-medium" aria-live="polite">
              {selectedIds.size} selected
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Star selected"
                title="Star selected"
                disabled={selectedItems.length === 0}
                onClick={() => onBatchFavorite(selectedItems.map((m) => m.id), true)}
              >
                <Star className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Unstar selected"
                title="Unstar selected"
                disabled={selectedItems.length === 0}
                onClick={() => onBatchFavorite(selectedItems.map((m) => m.id), false)}
              >
                <StarOff className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete selected"
                title="Delete selected"
                disabled={selectedItems.length === 0}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setPendingDelete(selectedItems)}
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Cancel selection"
                title="Cancel selection"
                onClick={onToggleSelectionMode}
              >
                <X className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={rawQuery}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search mail…"
                aria-label="Search mail"
                className="pl-9"
              />
            </div>

            {/* Filter — search scope + view filters (search-type folded in here) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Filter"
                  title="Filter"
                  className={cn(filterActive && 'text-primary')}
                >
                  <ListFilter className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Search in</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={field}
                  onValueChange={(v) => onFieldChange(v as SearchField)}
                >
                  {FIELDS.map((f) => (
                    <DropdownMenuRadioItem key={f.value} value={f.value}>
                      {f.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Show</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={favoriteOnly ? 'favorites' : 'all'}
                  onValueChange={(v) => onFavoriteOnlyChange(v === 'favorites')}
                >
                  <DropdownMenuRadioItem value="all">All mail</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="favorites">Starred</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={includeSpam}
                  onCheckedChange={onIncludeSpamChange}
                >
                  Show spam
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sort */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Sort" title="Sort">
                  <ArrowUpDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Sort by date</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(v) => onSortChange(v as MailSort)}
                >
                  <DropdownMenuRadioItem value="date-desc">Newest first</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="date-asc">Oldest first</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Multi-select */}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Select messages"
              title="Select messages"
              onClick={onToggleSelectionMode}
            >
              <ListChecks className="size-4" />
            </Button>
          </>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {isError ? (
          <ErrorState message={errorMessage} onRetry={onRetry} />
        ) : isLoading && items.length === 0 ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          hasQuery || favoriteOnly ? (
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
                    selectionMode={selectionMode}
                    isChecked={selectedIds.has(item.id)}
                    onClick={() => onOpen(index)}
                    onToggleSelect={() => onToggleSelect(item.id)}
                    onToggleFavorite={onToggleFavorite}
                    onRequestDelete={(m) => setPendingDelete([m])}
                  />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Footer: collapse control (always, desktop) + pagination (when results exist) */}
      {(canCollapse || (!isError && items.length > 0)) && (
        <div className="flex items-center gap-2 border-t px-2 py-2 text-xs text-muted-foreground">
          {canCollapse && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse list"
              title="Collapse list"
              onClick={onCollapse}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          )}
          {!isError && items.length > 0 && (
            <>
              <span className={cn('tabular-nums', !canCollapse && 'pl-2')}>
                {startIdx}–{endIdx} of {total}
              </span>
              <div className="ml-auto flex items-center gap-1">
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
            </>
          )}
        </div>
      )}

      {/* Shared delete confirmation (row menu or batch selection) */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !deleting && !open && setPendingDelete(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {pendingDelete && pendingDelete.length > 1
                ? `Delete ${pendingDelete.length} messages?`
                : 'Delete this message?'}
            </DialogTitle>
            <DialogDescription>
              This permanently removes the {pendingDelete && pendingDelete.length > 1 ? 'messages' : 'message'},
              their attachments, and the archived originals from the server. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
