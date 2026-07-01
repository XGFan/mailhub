/**
 * Minimal local mirror of the portal's @mailhub/shared API contract. Kept here
 * (rather than importing the workspace package) so this E2E project stays fully
 * self-contained. Only the fields the specs assert on are declared.
 */
export interface MailListItem {
  id: string;
  fromAddr: string;
  fromName?: string;
  toAddr: string;
  subject: string;
  snippet: string;
  date: string | null;
  receivedAt: string;
  hasAttachments: boolean;
  isSpam: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isInline: boolean;
}

export interface MailDetail extends MailListItem {
  htmlSanitized: string | null;
  textBody: string | null;
  attachments: Attachment[];
  authResults?: string;
}

export interface SearchResponse {
  items: MailListItem[];
  page: number;
  pageSize: number;
  total: number;
}
