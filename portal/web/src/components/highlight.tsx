import { Fragment, type ReactNode } from 'react';
import { escapeRegExp } from '@/lib/format';

/**
 * Render `text` with case-insensitive matches of `query` wrapped in <mark>.
 * The query is regex-escaped — a RegExp is never built from raw input.
 */
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim();
  if (!q || !text) return text;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-[2px] bg-yellow-200 px-0.5 text-yellow-950 dark:bg-yellow-400/30 dark:text-yellow-100"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
