import { Paperclip, ShieldAlert } from 'lucide-react';
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
}

/** A single row in the message list. Rendered as a `role="option"` button. */
export function MailListRow({ item, optionId, isSelected, isActive, query, onClick }: Props) {
  const display = item.fromName?.trim() || item.fromAddr;
  const when = item.date ?? item.receivedAt;

  return (
    <button
      type="button"
      id={optionId}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        'flex w-full gap-3 border-l-2 px-4 py-3 text-left transition-colors focus:outline-none',
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
    </button>
  );
}
