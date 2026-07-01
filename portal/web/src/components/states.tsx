import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, MailOpen, RefreshCw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function CenteredState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyInboxState() {
  return (
    <CenteredState
      icon={<Inbox className="size-6" />}
      title="Your inbox is empty"
      description="New mail appears here as soon as it's ingested. Use “Fetch now” to pull the latest."
    />
  );
}

export function NoResultsState({ query }: { query: string }) {
  return (
    <CenteredState
      icon={<SearchX className="size-6" />}
      title="No messages found"
      description={
        query ? `Nothing matched “${query}”. Try a different term or field.` : 'Try a different term or field.'
      }
    />
  );
}

export function ErrorState({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  return (
    <CenteredState
      icon={<AlertTriangle className="size-6 text-destructive" />}
      title="Something went wrong"
      description={message || 'Could not reach the portal. Check your connection and try again.'}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-4" /> Try again
          </Button>
        ) : undefined
      }
    />
  );
}

export function DetailPlaceholder() {
  return (
    <CenteredState
      icon={<MailOpen className="size-6" />}
      title="No message selected"
      description="Choose a message from the list to read it here."
    />
  );
}

export function ListSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div className="divide-y" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6 p-6" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3.5', i % 3 === 2 ? 'w-1/2' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}
