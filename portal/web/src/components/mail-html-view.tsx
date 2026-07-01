import { useMemo } from 'react';
import { buildMailSrcDoc } from '@/lib/mail-html';

interface Props {
  html: string;
  allowRemote: boolean;
  subject: string;
}

/**
 * Render sanitized HTML mail inside a fully-sandboxed iframe (see mail-html.ts
 * for the CSP / remote-content rationale). No scripts run; remote images are
 * blocked unless `allowRemote` is set.
 */
export function MailHtmlView({ html, allowRemote, subject }: Props) {
  const srcDoc = useMemo(() => buildMailSrcDoc(html, allowRemote), [html, allowRemote]);
  return (
    <iframe
      title={subject ? `Message: ${subject}` : 'Message content'}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="h-full w-full border-0 bg-white"
    />
  );
}
