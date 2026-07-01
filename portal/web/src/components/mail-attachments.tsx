import { Download, File as FileIcon, FileArchive, FileText, ImageIcon } from 'lucide-react';
import type { Attachment } from '@mailhub/shared';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) return FileArchive;
  if (mime.startsWith('text/') || mime.includes('pdf')) return FileText;
  return FileIcon;
}

/** Downloadable attachment chips (inline `cid:` parts are excluded). */
export function MailAttachments({ attachments }: { attachments: Attachment[] }) {
  const files = attachments.filter((a) => !a.isInline);
  if (files.length === 0) return null;

  return (
    <div>
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">
        {files.length} attachment{files.length === 1 ? '' : 's'}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {files.map((a) => {
          const Icon = iconFor(a.mimeType);
          return (
            <li key={a.id}>
              <a
                href={api.attachmentUrl(a.id)}
                download
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="max-w-[220px] truncate">{a.filename || 'attachment'}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                <Download aria-hidden className="size-3.5 text-muted-foreground" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
