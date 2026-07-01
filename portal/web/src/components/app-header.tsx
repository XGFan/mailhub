import { Mail, RefreshCw, Search } from 'lucide-react';
import type { SearchField } from '@mailhub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SettingsDialog } from '@/components/settings-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const FIELDS: { value: SearchField; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'to', label: 'To' },
  { value: 'from', label: 'From' },
  { value: 'subject', label: 'Subject' },
];

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  field: SearchField;
  onFieldChange: (field: SearchField) => void;
  onFetchNow: () => void;
  isFetching: boolean;
  showRemoteImages: boolean;
  onShowRemoteImagesChange: (value: boolean) => void;
}

export function AppHeader(props: Props) {
  const {
    query,
    onQueryChange,
    field,
    onFieldChange,
    onFetchNow,
    isFetching,
    showRemoteImages,
    onShowRemoteImagesChange,
  } = props;

  const searchControls = (
    <div className="flex w-full items-center gap-2">
      <div className="relative flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search mail…"
          aria-label="Search mail"
          className="pl-9"
        />
      </div>
      <ToggleGroup
        type="single"
        value={field}
        onValueChange={(value) => value && onFieldChange(value as SearchField)}
        variant="outline"
        size="sm"
        aria-label="Search field"
        className="shrink-0"
      >
        {FIELDS.map((f) => (
          <ToggleGroupItem key={f.value} value={f.value} aria-label={`Search ${f.label}`} className="px-2.5 text-xs">
            {f.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Mail className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">MailHub</span>
        </div>

        {/* Desktop: inline centered search */}
        <div className="mx-auto hidden max-w-2xl flex-1 lg:block">{searchControls}</div>

        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
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

      {/* Mobile / tablet: search on its own row */}
      <div className="px-4 pb-2.5 lg:hidden">{searchControls}</div>
    </header>
  );
}
