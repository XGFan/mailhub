import { useEffect, useState, type FormEvent } from 'react';
import { Settings, Trash2 } from 'lucide-react';
import type { BlockRuleType } from '@mailhub/shared';
import { ApiError, getStoredApiKey, setStoredApiKey } from '@/lib/api';
import { normalizeBlockValue, validateBlockValue } from '@/lib/block-rules';
import { useBlockRules, type BlockRulesState } from '@/hooks/use-block-rules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
  showRemoteImages: boolean;
  onShowRemoteImagesChange: (value: boolean) => void;
}

/** Gear button opening portal settings: remote images, blocked senders, API key. */
export function SettingsDialog({ showRemoteImages, onShowRemoteImagesChange }: Props) {
  const [open, setOpen] = useState(false);
  const blockRules = useBlockRules();

  // Load rules when the dialog opens (lazy — not on app mount). `refresh` is a
  // stable useCallback so this only re-runs on open changes.
  useEffect(() => {
    if (open) void blockRules.refresh();
  }, [open, blockRules.refresh]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Preferences are stored on the portal and apply to every message.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <label htmlFor="show-remote-images" className="text-sm font-medium">
              Show remote images
            </label>
            <p className="text-xs text-muted-foreground">
              Load externally-hosted images in HTML mail. This reveals your IP to senders and can
              confirm your address to trackers. Images are fetched by your browser only, never the
              server.
            </p>
          </div>
          <Switch
            id="show-remote-images"
            checked={showRemoteImages}
            onCheckedChange={onShowRemoteImagesChange}
          />
        </div>

        <BlockRulesSection state={blockRules} />

        <ApiKeySection onSaved={() => void blockRules.refresh()} />
      </DialogContent>
    </Dialog>
  );
}

/** "Blocked senders" section: list rules + an inline add form. */
function BlockRulesSection({ state }: { state: BlockRulesState }) {
  const { rules, isLoading, error, add, remove } = state;
  const [ruleType, setRuleType] = useState<BlockRuleType>('address');
  const [value, setValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const validationError = validateBlockValue(ruleType, value);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await add(ruleType, normalizeBlockValue(value));
      setValue('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setFormError('This rule already exists');
      else if (err instanceof ApiError && err.status === 400) setFormError('Invalid value');
      else setFormError(err instanceof ApiError ? err.message : 'Failed to add rule');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await remove(id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to remove rule');
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Blocked senders</h3>
        <p className="text-xs text-muted-foreground">
          Incoming mail from a blocked address or domain is dropped at ingest. Already-archived mail
          is not affected.
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={ruleType}
          onValueChange={(v) => v && setRuleType(v as BlockRuleType)}
          variant="outline"
          size="sm"
          aria-label="Rule type"
          className="shrink-0"
        >
          <ToggleGroupItem value="address">Address</ToggleGroupItem>
          <ToggleGroupItem value="domain">Domain</ToggleGroupItem>
        </ToggleGroup>
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFormError(null);
          }}
          placeholder={ruleType === 'address' ? 'name@example.com' : 'example.com'}
          aria-label="Address or domain to block"
          aria-invalid={formError ? true : undefined}
          className="h-8 flex-1"
        />
        <Button type="submit" size="sm" disabled={submitting || !value.trim()}>
          Add
        </Button>
      </form>
      {formError && <p className="text-xs text-destructive">{formError}</p>}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">No blocked senders yet.</p>
      ) : (
        <ul className="space-y-1">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
            >
              <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
                {rule.ruleType}
              </Badge>
              <span className="min-w-0 flex-1 truncate" title={rule.value}>
                {rule.value}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove block rule ${rule.value}`}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => void handleRemove(rule.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "API key" section: a client-side-only key sent as the X-API-Key header. */
function ApiKeySection({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState(() => getStoredApiKey());
  const [saved, setSaved] = useState(false);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setStoredApiKey(key);
    setKey(getStoredApiKey()); // reflect the trimmed/cleared value
    setSaved(true);
    // Retry the block-rules load — an initial 401 (before a key was saved)
    // recovers here without a page reload.
    onSaved();
  }

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="space-y-1">
        <label htmlFor="api-key" className="text-sm font-medium">
          API key
        </label>
        <p className="text-xs text-muted-foreground">
          Stored only in this browser and sent as the <code>X-API-Key</code> header. Needed only
          when the server has API keys enabled; leave blank otherwise.
        </p>
      </div>
      <form onSubmit={handleSave} className="flex items-center gap-2">
        <Input
          id="api-key"
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setSaved(false);
          }}
          placeholder="Paste your API key"
          autoComplete="off"
          className="h-8 flex-1"
        />
        <Button type="submit" size="sm">
          Save
        </Button>
      </form>
      {saved && <p className="text-xs text-muted-foreground">Saved.</p>}
    </div>
  );
}
