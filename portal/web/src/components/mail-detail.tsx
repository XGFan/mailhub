import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Download,
  ImageIcon,
  ImageOff,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api';
import { useMailDetail } from '@/hooks/use-mail-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MailAttachments } from '@/components/mail-attachments';
import { MailHtmlView } from '@/components/mail-html-view';
import { DetailPlaceholder, DetailSkeleton, ErrorState } from '@/components/states';
import { cn } from '@/lib/utils';
import { colorFromString, formatFullDate, initials } from '@/lib/format';

interface Props {
  id: string | null;
  /** Global "show remote images" setting; per-mail override is additive. */
  showRemoteImages: boolean;
  isMobile: boolean;
  onBack: () => void;
  /** Called after a star toggle succeeds so the list can resync. */
  onFavoriteChanged: () => void;
  /** Called after a successful delete so the caller can clear selection + resync. */
  onDeleted: (id: string) => void;
}

export function MailDetailPane({
  id,
  showRemoteImages,
  isMobile,
  onBack,
  onFavoriteChanged,
  onDeleted,
}: Props) {
  const { data, isLoading, isError, errorMessage, reload } = useMailDetail(id);
  const [remoteOverride, setRemoteOverride] = useState(false);
  // Optimistic star state so the toggle feels instant; null ⇒ use server value.
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset per-message overrides whenever a new message opens.
  useEffect(() => {
    setRemoteOverride(false);
    setFavoriteOverride(null);
    setConfirmOpen(false);
  }, [id]);

  async function handleToggleFavorite() {
    if (!data) return;
    const next = !(favoriteOverride ?? data.isFavorite);
    setFavoriteOverride(next);
    try {
      await api.setFavorite(data.id, next);
      onFavoriteChanged();
    } catch (err) {
      setFavoriteOverride(!next); // revert
      toast.error(err instanceof ApiError ? err.message : 'Failed to update star');
    }
  }

  async function handleDelete() {
    if (!data) return;
    setDeleting(true);
    try {
      await api.deleteMail(data.id);
      toast.success('Message deleted');
      onDeleted(data.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete message');
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  if (!id) return <DetailPlaceholder />;

  if (isLoading) {
    return (
      <Frame isMobile={isMobile} onBack={onBack}>
        <DetailSkeleton />
      </Frame>
    );
  }

  if (isError || !data) {
    return (
      <Frame isMobile={isMobile} onBack={onBack}>
        <ErrorState message={errorMessage} onRetry={reload} />
      </Frame>
    );
  }

  const allowRemote = showRemoteImages || remoteOverride;
  const display = data.fromName?.trim() || data.fromAddr;
  const isFavorite = favoriteOverride ?? data.isFavorite;
  const when = data.date ?? data.receivedAt;
  const hasHtml = Boolean(data.htmlSanitized);

  return (
    <Frame isMobile={isMobile} onBack={onBack}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Header */}
        <div className="space-y-3 border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-lg font-semibold leading-snug">
              {data.subject || <span className="italic text-muted-foreground">(no subject)</span>}
            </h1>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleToggleFavorite}
                aria-label={isFavorite ? 'Unstar' : 'Star'}
                aria-pressed={isFavorite}
                title={isFavorite ? 'Remove from Starred' : 'Add to Starred'}
                className={cn(isFavorite && 'text-amber-500')}
              >
                <Star className={cn('size-4', isFavorite && 'fill-current')} />
              </Button>
              <a href={api.rawUrl(data.id)} download aria-label="Download original .eml">
                <Button variant="outline" size="sm" aria-label="Download original .eml">
                  <Download className="size-4" />
                  <span className="hidden sm:inline">Download .eml</span>
                </Button>
              </a>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirmOpen(true)}
                aria-label="Delete message"
                title="Delete message"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: colorFromString(data.fromAddr) }}
            >
              {initials(data.fromName, data.fromAddr)}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{display}</span>
                {isFavorite && (
                  <Star
                    className="size-3.5 shrink-0 fill-current text-amber-500"
                    aria-label="Starred"
                  />
                )}
                {data.isSpam && (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="size-3" aria-hidden /> Spam
                  </Badge>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {data.fromName ? `${data.fromAddr} · ` : ''}to {data.toAddr}
              </div>
              {data.replyToAddr && (
                <div className="truncate text-xs text-muted-foreground">
                  Reply-To:{' '}
                  {data.replyToName
                    ? `${data.replyToName} <${data.replyToAddr}>`
                    : data.replyToAddr}
                </div>
              )}
              {data.envelopeFrom && (
                <div className="truncate text-xs text-muted-foreground/80">
                  Return-Path: {data.envelopeFrom}
                </div>
              )}
            </div>
            <time dateTime={when} className="shrink-0 text-right text-xs text-muted-foreground">
              {formatFullDate(when)}
            </time>
          </div>
        </div>

        {/* Remote-image notice */}
        {hasHtml && !allowRemote && (
          <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-5 py-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <ImageOff className="size-4 shrink-0" aria-hidden />
              Remote images are blocked to protect your privacy.
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => setRemoteOverride(true)}
            >
              <ImageIcon className="size-3.5" aria-hidden /> Load images
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1">
          {hasHtml ? (
            <MailHtmlView html={data.htmlSanitized as string} allowRemote={allowRemote} subject={data.subject} />
          ) : (
            <ScrollArea className="h-full">
              <div className="px-5 py-4">
                {data.textBody ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
                    {data.textBody}
                  </pre>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    This message has no readable content.
                  </p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Attachments */}
        {data.attachments.some((a) => !a.isInline) && (
          <div className="border-t px-5 py-3">
            <MailAttachments attachments={data.attachments} />
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !deleting && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>
              This permanently removes the message, its attachments, and the archived
              original from the server. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Frame>
  );
}

function Frame({
  children,
  isMobile,
  onBack,
}: {
  children: ReactNode;
  isMobile: boolean;
  onBack: () => void;
}) {
  return (
    <article className="flex h-full min-h-0 flex-col" aria-label="Message">
      {isMobile && (
        <div className="flex items-center border-b px-2 py-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </article>
  );
}
