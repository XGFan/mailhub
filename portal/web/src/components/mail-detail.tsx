import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, ImageIcon, ImageOff, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useMailDetail } from '@/hooks/use-mail-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MailAttachments } from '@/components/mail-attachments';
import { MailHtmlView } from '@/components/mail-html-view';
import { DetailPlaceholder, DetailSkeleton, ErrorState } from '@/components/states';
import { colorFromString, formatFullDate, initials } from '@/lib/format';

interface Props {
  id: string | null;
  /** Global "show remote images" setting; per-mail override is additive. */
  showRemoteImages: boolean;
  isMobile: boolean;
  onBack: () => void;
}

export function MailDetailPane({ id, showRemoteImages, isMobile, onBack }: Props) {
  const { data, isLoading, isError, errorMessage, reload } = useMailDetail(id);
  const [remoteOverride, setRemoteOverride] = useState(false);

  // Reset the one-off remote-image override whenever a new message opens.
  useEffect(() => {
    setRemoteOverride(false);
  }, [id]);

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
            <a href={api.rawUrl(data.id)} download className="shrink-0" aria-label="Download original .eml">
              <Button variant="outline" size="sm" aria-label="Download original .eml">
                <Download className="size-4" />
                <span className="hidden sm:inline">Download .eml</span>
              </Button>
            </a>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: colorFromString(data.fromAddr) }}
            >
              {initials(data.fromName, data.fromAddr)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{display}</span>
                {data.isSpam && (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="size-3" aria-hidden /> Spam
                  </Badge>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {data.fromName ? `${data.fromAddr} · ` : ''}to {data.toAddr}
              </div>
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
