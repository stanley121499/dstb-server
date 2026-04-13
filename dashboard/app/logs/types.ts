/**
 * Shared view type for a bot_logs row, used by both the server page (LogsPage)
 * and the client component (LogsPageClient). Defined here to avoid importing
 * from a server page file into a client component, which Next.js rejects.
 */
export type LogRowView = Readonly<{
  id: number;
  bot_id: string | null;
  level: string;
  event: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
  bot_label: string;
}>;
