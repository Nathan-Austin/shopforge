/**
 * The result of a test send, as the admin shows it and as one JSON line in
 * `$EMAIL_TMP_DIR/logs/test-sends-<date>.jsonl`.
 *
 * Recipients are masked in both: the log sits in /tmp, and the owner
 * knows which address they typed.
 */

import type { CampaignIssue } from './schema';
import type { CampaignWarning } from './render';

export type TestSendStatus =
  | 'sent'
  | 'not-configured'
  | 'provider-error'
  | 'invalid-template'
  | 'empty'
  | 'invalid-recipient'
  | 'invalid-locale'
  | 'too-soon'
  | 'not-found'
  | 'not-authorized'
  | 'failed';

export interface TestSendResult {
  ok: boolean;
  status: TestSendStatus;
  /** ISO time the send was attempted. */
  at: string;
  templateId: string;
  locale: string;
  /** Masked: `o***@shop.test`. */
  to: string | null;
  provider: 'resend';
  subject?: string;
  messageId?: string | null;
  durationMs?: number;
  warnings: CampaignWarning[];
  issues?: CampaignIssue[];
  error?: string;
  /** Where the line was written, or why it was not. */
  log: { file: string | null; error?: string };
}

/** `owner@shop.test` -> `o***@shop.test`; anything else -> `***`. */
export function maskEmail(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/** One file per UTC day. */
export function testSendLogFile(at: Date): string {
  return `test-sends-${at.toISOString().slice(0, 10)}.jsonl`;
}

/** The line written for a result: everything but where it was written. */
export function testSendLogEntry(result: TestSendResult): Omit<TestSendResult, 'log'> & { event: 'test-send' } {
  const { log: _log, ...entry } = result;
  void _log;
  return {
    event: 'test-send',
    ...entry,
    // Provider errors can echo the request back; keep the line short.
    ...(entry.error ? { error: entry.error.slice(0, 500) } : {})
  };
}
