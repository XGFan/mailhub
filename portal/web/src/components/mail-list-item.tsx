import { Ban, Download, MoreVertical, Paperclip, ShieldAlert, Star, Trash2 } from 'lucide-react';
import type { MailListItem } from '@mailhub/shared';
import { Highlight } from '@/components/highlight';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { blockAndToast } from '@/lib/block-actions';
import { colorFromString, formatListDate, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  item: MailListItem;
  optionId: string;
  isSelected: boolean;
  isActive: boolean;
  query: string;
  /** When true the row toggles its checkbox instead of opening the mail. */
  selectionMode: boolean;
  /** Whether this row is checked in multi-select mode. */
  isChecked: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
  onToggleFavorite: (id: string, next: boolean) => void;
  /** Ask the list to confirm+delete this single mail (via the shared dialog). */
  onRequestDelete: (item: MailListItem) => void;
}

/**
 * A single row in the message list. Rendered as a `role="option"` element (a div,
 * not a button, so the star toggle, checkbox, and the actions menu can nest
 * without invalid nested interactives). The overflow (⋯) menu sits at the
 * bottom-right, Outlook-style, and pops per-row actions.
 */
export function MailListRow({
  item,
  optionId,
  isSelected,
  isActive,
  query,
  selectionMode,
  isChecked,
  onClick,
  onToggleSelect,
  onToggleFavorite,
  onRequestDelete,
}: Props) {
  const display = item.fromName?.trim() || item.fromAddr;
  const when = item.date ?? item.receivedAt;

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={selectionMode ? onToggleSelect : onClick}
      className={cn(
        'group/row flex w-full cursor-pointer gap-3 border-l-2 px-4 py-3 text-left transition-colors focus:outline-none',
        isSelected ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-muted/60',
        isActive && 'ring-1 ring-ring/50 ring-inset',
        selectionMode && isChecked && 'bg-primary/5',
      )}
    >
      {selectionMode && (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select mail from ${display}`}
          className="mt-2.5 size-4 shrink-0 accent-primary"
        />
      )}

      <span
        aria-hidden
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: colorFromString(item.fromAddr) }}
      >
        {initials(item.fromName, item.fromAddr)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm', isSelected ? 'font-semibold' : 'font-medium')}>
            <Highlight text={display} query={query} />
          </span>
          <time dateTime={when} className="shrink-0 text-xs text-muted-foreground">
            {formatListDate(when)}
          </time>
        </span>

        <span className="mt-0.5 block truncate text-sm text-foreground/90">
          {item.subject ? (
            <Highlight text={item.subject} query={query} />
          ) : (
            <span className="italic text-muted-foreground">(no subject)</span>
          )}
        </span>

        <span className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{item.snippet || ' '}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {item.hasAttachments && (
              <Paperclip aria-label="Has attachments" className="size-3.5 text-muted-foreground" />
            )}
            {item.isSpam && (
              <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                <ShieldAlert className="size-3" aria-hidden /> Spam
              </span>
            )}
          </span>
        </span>
      </span>

      {/* Right action column: star (top), overflow menu (bottom-right). */}
      <span className="flex shrink-0 flex-col items-center justify-between self-stretch">
        <button
          type="button"
          aria-label={item.isFavorite ? 'Unstar' : 'Star'}
          aria-pressed={item.isFavorite}
          title={item.isFavorite ? 'Remove from Starred' : 'Add to Starred'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item.id, !item.isFavorite);
          }}
          className={cn(
            'rounded p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            item.isFavorite
              ? 'text-amber-500'
              : 'text-muted-foreground/40 opacity-0 hover:text-amber-500 group-hover/row:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Star className={cn('size-4', item.isFavorite && 'fill-current')} aria-hidden />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 text-muted-foreground/60 opacity-0 transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onToggleFavorite(item.id, !item.isFavorite)}>
              <Star className={cn('size-4', item.isFavorite && 'fill-current text-amber-500')} />
              {item.isFavorite ? 'Remove star' : 'Star'}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={api.rawUrl(item.id)} download>
                <Download className="size-4" /> Download .eml
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!item.fromAddr}
              onSelect={() => void blockAndToast('address', item.fromAddr)}
            >
              <Ban className="size-4" /> Block sender
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onRequestDelete(item)}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
