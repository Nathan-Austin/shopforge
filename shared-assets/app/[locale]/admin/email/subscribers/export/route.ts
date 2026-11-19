import { toSubscriberCsv, type ExportRow } from '@/lib/email/subscribers/csv';
import { SUBSCRIBER_STATUSES } from '@/lib/email/subscribers/rules';
import { SUBSCRIBER_COLUMNS, type SubscriberRow } from '@/lib/email/subscribers/service';
import { ensureShopOwner } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * The list as CSV, everyone or one status. A route handler is not wrapped
 * by the admin layout's guard, so it checks the owner itself; the rows are
 * read with the owner's own session, through RLS.
 */
export async function GET(request: Request) {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return new Response('Forbidden', { status: 403 });

  const requested = new URL(request.url).searchParams.get('status') ?? '';
  // Only a known status reaches the query and the file name (a header).
  const status = (SUBSCRIBER_STATUSES as string[]).includes(requested) ? requested : null;
  const rows: SubscriberRow[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from('email_subscribers').select(SUBSCRIBER_COLUMNS).order('created_at').range(from, from + 999);
    if (status) query = query.eq('status', status);
    const { data, error: readError } = await query;
    if (readError) return new Response('Could not read the list', { status: 500 });
    rows.push(...((data ?? []) as SubscriberRow[]));
    if (!data || data.length < 1000) break;
  }

  const csv = toSubscriberCsv(
    rows.map(
      (row): ExportRow => ({
        email: row.email,
        firstName: row.first_name,
        locale: row.locale,
        status: row.status,
        source: row.source,
        consentedAt: row.consented_at,
        confirmedAt: row.confirmed_at,
        unsubscribedAt: row.unsubscribed_at
      })
    )
  );
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="subscribers-${status ?? 'all'}-${day}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
