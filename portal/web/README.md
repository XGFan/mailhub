# @mailhub/web — MailHub portal UI

A modern, responsive React mail client UI (Tailwind v4 + shadcn/ui) that:

1. **Lists mail** with search/filter
2. **Displays detail** with sanitized HTML in a sandboxed iframe
3. **Downloads attachments** and raw `.eml`
4. **Configures settings** (show remote images)
5. **Manual refresh** via "Fetch now" button

Built with **Vite** for fast dev server and optimized production builds.

## Quick start (local dev)

### Prerequisites

- Node.js ≥ 20
- pnpm
- Portal server running on `http://localhost:8787` (see `portal/server/README.md`)

### 1. Install & start dev server

```bash
cd portal/web

pnpm install

# Start Vite dev server (listens on port 5173, proxies /api to :8787)
pnpm dev
```

Open http://localhost:5173 in your browser.

The dev server proxies `/api/*` requests to the backend (configured in `vite.config.ts`).

### 2. Build for production

```bash
pnpm build
# Output: dist/

# Preview the production build locally:
pnpm preview
```

## Development

### TypeScript & type-checking

```bash
pnpm typecheck   # runs tsc (no emit)
```

All components and hooks are fully typed via the `@mailhub/shared` package.

### Project structure

```
src/
├── components/          # React components (mail list, detail, etc.)
│   ├── mail-list.tsx
│   ├── mail-detail.tsx
│   ├── mail-html-view.tsx
│   ├── mail-attachments.tsx
│   └── ...
├── hooks/               # Custom hooks
│   ├── use-mail-search.ts       # fetches /api/mails
│   ├── use-settings.ts          # fetches /api/settings
│   ├── use-debounce.ts
│   └── use-media-query.ts
├── lib/                 # Utilities & API client
│   ├── api.ts           # HTTP client (fetch-based)
│   ├── utils.ts         # shadcn className utilities
│   └── sanitize-html.ts # client-side HTML sanitization (defense-in-depth)
├── App.tsx              # Root component (two-pane layout)
└── main.tsx             # React entrypoint
```

### Component highlights

**Mail list (`components/mail-list.tsx`)**
- Virtualized scrolling (for large lists)
- Click to open detail pane
- Keyboard navigation (↑/↓ move, Enter opens)
- Loading skeleton state
- Empty/error states

**Mail detail (`components/mail-detail.tsx`)**
- Displays headers (From, To, Subject, Date)
- Sanitized HTML body in iframe (see `mail-html-view.tsx`)
- Attachment list (download links)
- Raw `.eml` download
- Spam badge if `is_spam=true`

**HTML view (`components/mail-html-view.tsx`)**
- Renders `htmlSanitized` in `<iframe sandbox srcdoc=...>`
- Injects CSP: `default-src 'none'; img-src data: style-src 'unsafe-inline'`
- Remote images blocked by default; opt-in via settings
- Inline images converted to `data:` URIs by backend

**Settings panel**
- Toggle `showRemoteImages` (calls `PUT /api/settings`)
- Persists to server

### Styling

Uses **Tailwind CSS v4** with **shadcn/ui** components (button, input, card, etc.). Dark/light mode via CSS variables.

Key files:
- `src/index.css` — global Tailwind + custom CSS variables
- `tailwind.config.js` — Tailwind configuration (shadcn preset)
- `components.json` — shadcn component scaffold config

### API client (`lib/api.ts`)

Thin fetch-based HTTP client with:
- Error handling (network errors → `ApiError`)
- Type-safe request/response (via `@mailhub/shared` types)
- `baseUrl` set to `/api` (dev server proxies to `:8787`, production uses same-origin)

Example:
```typescript
import { api } from '@/lib/api';

const response = await api.getMailList({ q: 'test', field: 'subject', page: 1 });
```

## Testing

E2E tests (Playwright) cover:
- Mail list rendering
- Search (case-insensitive, by To/From/Subject)
- Mail detail open/close
- Attachment download
- HTML rendering (no script execution, inline images)
- UI states (empty, loading, error)
- Keyboard navigation
- Accessibility (Lighthouse a11y ≥ 90)

```bash
# Install browsers (one-time)
pnpm exec playwright install

# Run E2E tests
pnpm test:e2e

# Run a specific test
pnpm test:e2e -- mail-search.spec.ts
```

## Production build & deployment

### Build output

```bash
pnpm build
# Outputs to dist/
#   dist/index.html  (SPA entrypoint)
#   dist/assets/     (JS, CSS, images)
```

**The production API server (portal/server) serves this SPA as static files:**

```typescript
// portal/server/src/api/index.ts
app.get('*', async (c) => {
  // Serves dist/index.html for SPA routes
  // Routes /api/* to the API
});
```

### Environment variables (production)

The web app is **fully client-side** — no backend env vars needed at build time. The dev server proxies `/api` to the backend via `vite.config.ts`:

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8787',
  },
},
```

In production, the API server serves the SPA and handles `/api/*` in the same process — no proxy needed.

### Deployment checklist

✅ Built and bundled (no external JS dependencies)
✅ CSP-compliant (no inline scripts, only `src="..."`)
✅ Responsive (mobile ≤640px, tablet 640–1024px, desktop ≥1024px)
✅ Dark/light mode support
✅ Keyboard navigable
✅ All UI states rendered (empty, loading, error, search results)
✅ No remote resource fetches (images opt-in via settings, remote only client-side)

## Performance

- **Lighthouse:**
  - Performance ≥ 90 (lazy-load images, code-split routes)
  - Accessibility ≥ 90 (ARIA labels, keyboard nav, semantic HTML)
  - Best Practices ≥ 85
  - SEO ≥ 90

- **Bundle size:** ~150 KB (gzipped) including React + Tailwind + shadcn
- **Time to interactive:** <1s (Vite fast refresh, lazy routes)

## Security highlights

- **CSP:** Restricts to same-origin only (no external scripts/styles)
- **iframe sandbox:** HTML mail rendered in sandboxed iframe with CSP
- **Attachment downloads:** Forced-download headers, no inline SVG/HTML
- **Search validation:** All query params validated server-side (no client-side SQL injection, but backend enforces)
- **No auth:** Portal is cluster-internal only; access controlled at network level

See [`docs/SECURITY.md`](../../docs/SECURITY.md) for details.

## Troubleshooting

**Blank page, console errors about `/api`:**
- Is the backend running on `:8787`? (Check `pnpm --filter @mailhub/portal-server dev`)
- Is Vite proxy working? (Check `vite.config.ts` — should have `/api` proxy)
- Fallback: manually set `VITE_API_BASE=http://localhost:8787` before build

**Hydration mismatch (SSR issue):**
- MailHub is client-side only (no SSR). If you see hydration errors, check for `useEffect` mismatches between server and client rendering.
- Likely fix: ensure state is initialized to the same value on client as server.

**Tailwind classes not applying:**
- Rebuild: `pnpm build`
- Check `tailwind.config.js` has the right content paths (`src/**/*.{js,ts,jsx,tsx}`)

**Dark mode toggle not working:**
- Tailwind v4 requires `@layer` CSS. Check `src/index.css` has `@layer` declarations.

## See also

- **Portal server:** `portal/server/`
- **Shared types:** `shared/`
- **Full plan:** [`.omc/plans/mailhub-cf-worker-portal-plan.md`](.omc/plans/mailhub-cf-worker-portal-plan.md)
- **API reference:** [`docs/API.md`](../../docs/API.md)
- **Setup guide:** [`docs/SETUP.md`](../../docs/SETUP.md)
- **Security:** [`docs/SECURITY.md`](../../docs/SECURITY.md)

---

## Component library (shadcn/ui)

Pre-installed shadcn components:
- Button, Input, Card, Badge, Skeleton
- Select, Checkbox, Toggle
- Dialog, Popover, Sheet
- AlertDialog (for destructive actions)
- Toast (via Sonner)

To add more components:
```bash
pnpm exec shadcn-ui add <component-name>
```

---

## Tailwind v4 migration notes

This project uses **Tailwind CSS v4** (latest). Key changes from v3:

- CSS-in-CSS `@layer` directives (no PostCSS plugin changes needed)
- `@theme` for customizing design tokens
- Shorter build times (Rust implementation)
- No `tailwindcss/forms` — use plain HTML + Tailwind classes

See [Tailwind v4 upgrade guide](https://tailwindcss.com/docs/upgrade-guide).
