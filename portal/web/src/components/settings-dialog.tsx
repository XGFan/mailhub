import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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

/** Gear button opening portal settings (the "show remote images" toggle). */
export function SettingsDialog({ showRemoteImages, onShowRemoteImagesChange }: Props) {
  return (
    <Dialog>
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
      </DialogContent>
    </Dialog>
  );
}
