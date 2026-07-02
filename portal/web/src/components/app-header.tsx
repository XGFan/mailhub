import { Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsDialog } from '@/components/settings-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

interface Props {
  onFetchNow: () => void;
  isFetching: boolean;
  showRemoteImages: boolean;
  onShowRemoteImagesChange: (value: boolean) => void;
}

/**
 * The top app bar: branding plus the global actions (fetch, settings, theme).
 * Search now lives above the mail list (Outlook-style), so it's no longer here.
 */
export function AppHeader({
  onFetchNow,
  isFetching,
  showRemoteImages,
  onShowRemoteImagesChange,
}: Props) {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Mail className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">MailHub</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onFetchNow}
            disabled={isFetching}
            aria-label="Fetch now"
            className="gap-1.5"
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
            <span className="hidden sm:inline">Fetch now</span>
          </Button>
          <SettingsDialog
            showRemoteImages={showRemoteImages}
            onShowRemoteImagesChange={onShowRemoteImagesChange}
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
