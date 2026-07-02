import { Inbox, PanelLeftClose, PanelLeftOpen, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Which mailbox view the list is showing. */
export type MailFolder = 'all' | 'favorites';

const ITEMS: { folder: MailFolder; label: string; Icon: typeof Inbox }[] = [
  { folder: 'all', label: 'Inbox', Icon: Inbox },
  { folder: 'favorites', label: 'Starred', Icon: Star },
];

interface Props {
  folder: MailFolder;
  onFolderChange: (folder: MailFolder) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** On mobile the rail is forced to icon-only so it can't eat the narrow screen. */
  isMobile?: boolean;
}

/**
 * The left navigation rail: switch between Inbox and Starred, and collapse to an
 * icon-only rail. Always rendered (a slim rail on mobile) so the folder switch is
 * reachable at every breakpoint without disturbing the list/reading two-pane.
 */
export function AppSidebar({
  folder,
  onFolderChange,
  collapsed,
  onToggleCollapsed,
  isMobile = false,
}: Props) {
  // On a narrow screen an expanded (w-48) rail would eat half the viewport, so
  // force the icon-only rail there regardless of the persisted preference.
  const showCollapsed = collapsed || isMobile;
  return (
    <aside
      aria-label="Folders"
      className={cn(
        'flex shrink-0 flex-col border-r bg-muted/20 transition-[width] duration-200',
        showCollapsed ? 'w-14' : 'w-48',
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {ITEMS.map(({ folder: f, label, Icon }) => {
          const active = folder === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onFolderChange(f)}
              aria-current={active ? 'page' : undefined}
              aria-label={label}
              title={showCollapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                showCollapsed && 'justify-center px-0',
                active
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!showCollapsed && <span className="truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* The collapse toggle is desktop-only — on mobile the rail is always compact. */}
      {!isMobile && (
        <div className="p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4 shrink-0" aria-hidden />
                <span className="truncate">Collapse</span>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
