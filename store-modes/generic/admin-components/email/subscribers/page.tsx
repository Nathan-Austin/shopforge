import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { newsletterStatus } from '@/lib/email/subscribers/config';
import { SUBSCRIBER_STATUSES, type SubscriberStatus } from '@/lib/email/subscribers/rules';
import { SUBSCRIBER_COLUMNS, type SubscriberRow } from '@/lib/email/subscribers/service';
import { LOCALES } from '@/i18n/config';
import {
  deleteSubscriber,
  editSubscriber,
  importSubscriberCsv,
  resendSubscriberConfirmation,
  unsubscribeSubscriber,
  type SubscriberActionResult
} from '../../actions/subscribers';
import ConfirmSubmitButton from '../../components/ConfirmSubmitButton';
import EmailTabs from '../../components/EmailTabs';
import SubscriberImportForm from '../../components/SubscriberImportForm';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const NOTICES = ['unsubscribed', 'deleted', 'resent', 'updated', 'not_authorized', 'not_found', 'not_pending', 'invalid', 'failed'];

/** The newsletter list: who is on it, how they got there, and the owner's tools for it. */
export default async function AdminSubscribersPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string; notice?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email.subscribers' });

  const status = (SUBSCRIBER_STATUSES as string[]).includes(query.status ?? '') ? (query.status as SubscriberStatus) : null;
  const search = query.q?.trim().slice(0, 100) ?? '';
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);

  const count = (value: SubscriberStatus) =>
    supabase.from('email_subscribers').select('id', { count: 'exact', head: true }).eq('status', value);
  let list = supabase
    .from('email_subscribers')
    .select(SUBSCRIBER_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) list = list.eq('status', status);
  // % and _ are wildcards in ilike: searched for as themselves.
  if (search) list = list.ilike('email', `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);

  const [pending, subscribed, unsubscribed, rows] = await Promise.all([count('pending'), count('subscribed'), count('unsubscribed'), list]);
  const subscribers = (rows.data ?? []) as SubscriberRow[];
  const total = rows.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts: Record<SubscriberStatus, number> = { pending: pending.count ?? 0, subscribed: subscribed.count ?? 0, unsubscribed: unsubscribed.count ?? 0 };

  const setup = newsletterStatus();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const filterHref = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged = { status, q: search || null, page: null as string | null, ...changes };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return `/${locale}/admin/email/subscribers${qs ? `?${qs}` : ''}`;
  };

  const act = (run: (context: { locale: string }, formData: FormData) => Promise<SubscriberActionResult>) => {
    const back = filterHref({ page: page > 1 ? String(page) : null });
    return async (formData: FormData) => {
      'use server';
      const result = await run({ locale }, formData);
      redirect(`${back}${back.includes('?') ? '&' : '?'}notice=${result.ok ? result.action : result.error}`);
    };
  };
  const unsubscribe = act(unsubscribeSubscriber);
  const remove = act(deleteSubscriber);
  const resend = act(resendSubscriberConfirmation);
  const edit = act(editSubscriber);

  const notice = query.notice && NOTICES.includes(query.notice) ? query.notice : null;
  const badge: Record<SubscriberStatus, string> = {
    pending: 'bg-amber-100 text-amber-900',
    subscribed: 'bg-emerald-100 text-emerald-800',
    unsubscribed: 'bg-stone-100 text-stone-700'
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="text-sm text-stone-600">{t('subheading')}</p>
      </div>
      <EmailTabs locale={locale} current="subscribers" />

      {!setup.enabled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t(`disabled.${setup.reason}`)}</p>
      )}
      {notice && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${['unsubscribed', 'deleted', 'resent', 'updated'].includes(notice) ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}
        >
          {t(`notices.${notice}`)}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {SUBSCRIBER_STATUSES.map((value) => (
          <Link
            key={value}
            href={filterHref({ status: status === value ? null : value })}
            aria-current={status === value ? 'true' : undefined}
            className={`rounded-lg border bg-white p-4 ${status === value ? 'border-emerald-700' : 'border-border hover:border-emerald-700'}`}
          >
            <span className="block text-sm text-stone-600">{t(`status.${value}`)}</span>
            <span className="block text-2xl font-bold">{counts[value]}</span>
          </Link>
        ))}
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex items-end gap-2" action={`/${locale}/admin/email/subscribers`}>
          {status && <input type="hidden" name="status" value={status} />}
          <label className="block text-sm font-medium">
            {t('search')}
            <input
              type="search"
              name="q"
              defaultValue={search}
              className="mt-1 block w-64 rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </label>
          <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm hover:border-emerald-700">
            {t('searchButton')}
          </button>
        </form>
        <a
          href={`/${locale}/admin/email/subscribers/export${status ? `?status=${status}` : ''}`}
          className="rounded-md border border-border px-4 py-2 text-sm hover:border-emerald-700 hover:text-emerald-700"
        >
          {status ? t('exportFiltered', { status: t(`status.${status}`) }) : t('exportAll')}
        </a>
      </div>

      {subscribers.length === 0 ? (
        <p className="rounded-lg border border-border bg-white p-6 text-center text-stone-600">{search || status ? t('noMatches') : t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-600">
              <tr>
                <th className="px-3 py-2 text-start">{t('columns.email')}</th>
                <th className="px-3 py-2 text-start">{t('columns.language')}</th>
                <th className="px-3 py-2 text-start">{t('columns.status')}</th>
                <th className="px-3 py-2 text-start">{t('columns.source')}</th>
                <th className="px-3 py-2 text-start">{t('columns.dates')}</th>
                <th className="px-3 py-2 text-start">{t('columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {subscribers.map((subscriber) => (
                <tr key={subscriber.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{subscriber.email}</span>
                    {subscriber.first_name && <span className="block text-stone-600">{subscriber.first_name}</span>}
                  </td>
                  <td className="px-3 py-2 uppercase">{subscriber.locale}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[subscriber.status]}`}>{t(`status.${subscriber.status}`)}</span>
                  </td>
                  <td className="px-3 py-2 text-stone-600">{t(`sources.${subscriber.source}`)}</td>
                  <td className="px-3 py-2 text-xs text-stone-600">
                    <span className="block">{t('signedUp', { date: dateFormat.format(new Date(subscriber.consented_at)) })}</span>
                    {subscriber.confirmed_at && <span className="block">{t('confirmedOn', { date: dateFormat.format(new Date(subscriber.confirmed_at)) })}</span>}
                    {subscriber.status === 'unsubscribed' && subscriber.unsubscribed_at && (
                      <span className="block">{t('unsubscribedOn', { date: dateFormat.format(new Date(subscriber.unsubscribed_at)) })}</span>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer">{t('consentShown')}</summary>
                      <p className="mt-1 max-w-xs whitespace-normal text-stone-700">{subscriber.consent_text}</p>
                    </details>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-3">
                      {subscriber.status === 'pending' && (
                        <form action={resend}>
                          <input type="hidden" name="id" value={subscriber.id} />
                          <button type="submit" className="underline hover:text-emerald-700">
                            {t('resend')}
                          </button>
                        </form>
                      )}
                      {subscriber.status !== 'unsubscribed' && (
                        <form action={unsubscribe}>
                          <input type="hidden" name="id" value={subscriber.id} />
                          <ConfirmSubmitButton message={t('confirmUnsubscribe', { email: subscriber.email })} className="underline hover:text-emerald-700">
                            {t('unsubscribe')}
                          </ConfirmSubmitButton>
                        </form>
                      )}
                      <form action={remove}>
                        <input type="hidden" name="id" value={subscriber.id} />
                        <ConfirmSubmitButton message={t('confirmDelete', { email: subscriber.email })} className="text-red-700 underline">
                          {t('delete')}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs underline">{t('edit')}</summary>
                      <form action={edit} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={subscriber.id} />
                        <label className="block text-xs font-medium">
                          {t('editName')}
                          <input type="text" name="first_name" defaultValue={subscriber.first_name ?? ''} maxLength={100} className="mt-1 block w-36 rounded-md border border-border bg-white px-2 py-1 text-sm" />
                        </label>
                        <label className="block text-xs font-medium">
                          {t('editLanguage')}
                          <select name="locale" defaultValue={subscriber.locale} className="mt-1 block rounded-md border border-border bg-white px-2 py-1 text-sm">
                            {(LOCALES as readonly string[]).map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="submit" className="rounded-md border border-border px-3 py-1 text-sm hover:border-emerald-700">
                          {t('editSave')}
                        </button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center gap-3 text-sm" aria-label={t('pagination')}>
          {page > 1 && <Link href={filterHref({ page: String(page - 1) })} className="underline">{t('previous')}</Link>}
          <span>{t('pageOf', { page, pages })}</span>
          {page < pages && <Link href={filterHref({ page: String(page + 1) })} className="underline">{t('next')}</Link>}
        </nav>
      )}

      <SubscriberImportForm action={importSubscriberCsv.bind(null, { locale })} />
    </div>
  );
}
