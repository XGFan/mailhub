import { Paperclip, ShieldAlert, Star } from 'lucide-react';
import type { MailListItem } from '@mailhub/shared';
import { Highlight } from '@/components/highlight';
import { colorFromString, formatListDate, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  item: MailListItem;
  optionId: string;
  isSelected: boolean;
  isActive: boolean;
  query: string;
  onClick: () => void;
  onToggleFavorite: (id: string, next: boolean) => void;
}

/**
 * A single row in the message list. Rendered as a `role="option"` element (a div,
 * not a button, so the star toggle can nest without invalid nested interactives).
 */
export function MailListRow({
  item,
  optionId,
  isSelected,
  isActive,
  query,
  onClick,
  onToggleFavorite,
}: Props) {
  const display = item.fromName?.trim() || item.fromAddr;
  const when = item.date ?? item.receivedAt;

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer gap-3 border-l-2 px-4 py-3 text-left transition-colors focus:outline-none',
        isSelected
          ? 'border-l-primary bg-accent'
          : 'border-l-transparent hover:bg-muted/60',
        isActive && 'ring-1 ring-ring/50 ring-inset',
      )}
    >
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
          <span className="truncate text-xs text-muted-foreground">{item.snippet || ' '}</span>
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
          'mt-0.5 shrink-0 self-start rounded p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          item.isFavorite
            ? 'text-amber-500'
            : 'text-muted-foreground/40 hover:text-amber-500',
        )}
      >
        <Star className={cn('size-4', item.isFavorite && 'fill-current')} aria-hidden />
      </button>
    </div>
  );
}
