import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { resolveEmailConfig } from '@/lib/email/config';
import { CAMPAIGN_COLUMNS, campaignProvider, campaignReadiness, type CampaignRow } from '@/lib/email/campaigns/send';
import { designerPreviewContext } from '@/lib/email/campaigns/context';
import { renderCampaign } from '@/lib/email/campaigns/render';
import { loadDesignerData } from '@/lib/email/campaigns/server';
import { refreshCampaignAction, sendCampaignAction, syncAudience } from '../../../actions/campaigns';
import AudienceSync from '../../../components/AudienceSync';
import EmailPreview from '../../../components/EmailPreview';
import SendCampaignForm from '../../../components/SendCampaignForm';
import { warningText } from '../../../components/emailWarnings';
import { CAMPAIGN_MODE } from '../../mode';
import { requireShopOwner } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * One campaign: who will get it per language and whether the list is
 * synced, a preview, the send or schedule form, and, once sent, each
 * language's status at the provider.
 */
export default async function AdminCampaignPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { locale, id } = await params;
  const { preview } = await searchParams;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email.campaigns' });
  const tEmail = await getTranslations({ locale, namespace: 'Admin.email' });

  const { data: row } = await supabase.from('email_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle();
  if (!row) notFound();
  const campaign = row as CampaignRow;
  const locales = Array.from(new Set([...(LOCALES as readonly string[]), DEFAULT_LOCALE]));
  const readiness = await campaignReadiness(supabase, locales);
  const configured = Boolean(await campaignProvider()) && Boolean((await resolveEmailConfig()).from);
  const recipients = readiness.reduce((sum, entry) => sum + entry.subscribed, 0);
  const ready = configured && recipients > 0 && readiness.every((entry) => entry.subscribed === 0 || (entry.due === 0 && entry.audienceId));

  const previewLocale = preview && locales.includes(preview) ? preview : DEFAULT_LOCALE;
  const data = await loadDesignerData(supabase, campaign.document, locales, CAMPAIGN_MODE);
  const rendered = renderCampaign(campaign.document, designerPreviewContext(data, previewLocale, DEFAULT_LOCALE));
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  async function refresh(formData: FormData) {
    'use server';
    await refreshCampaignAction({ locale }, formData);
    redirect(`/${locale}/admin/email/campaigns/${id}`);
  }

  const localeBadge: Record<string, string> = {
    sent: 'bg-emerald-100 text-emerald-800',
    queued: 'bg-amber-100 text-amber-900',
    scheduled: 'bg-blue-100 text-blue-800',
    pending: 'bg-amber-100 text-amber-900',
    failed: 'bg-red-100 text-red-800',
    skipped: 'bg-stone-100 text-stone-700'
  };

  return (
    <div className="space-y-6">
      <Link href={`/${locale}/admin/email/campaigns`} className="text-sm underline hover:text-emerald-700">
        ← {t('back')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{campaign.name}</h2>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold">{t(`status.${campaign.status}`)}</span>
      </div>
      {!configured && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('notConfigured')}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {campaign.status === 'draft' ? (
            <>
              <AudienceSync readiness={readiness} sync={syncAudience} configured={configured} />
              <SendCampaignForm action={sendCampaignAction.bind(null, { locale, id })} recipients={recipients} ready={ready} />
            </>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{t('progressHeading')}</h3>
                <form action={refresh}>
                  <input type="hidden" name="id" value={campaign.id} />
                  <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-emerald-700">
                    {t('refresh')}
                  </button>
                </form>
              </div>
              <p className="text-sm text-stone-600">
                {campaign.sent_at
                  ? t('sentOn', { date: dateFormat.format(new Date(campaign.sent_at)) })
                  : campaign.scheduled_at
                    ? t('scheduledFor', { date: dateFormat.format(new Date(campaign.scheduled_at)) })
                    : t('recipientsTotal', { count: campaign.recipient_count })}
              </p>
              {campaign.error && <p className="text-sm text-red-700">{campaign.error}</p>}
              <ul className="divide-y divide-stone-100 text-sm">
                {Object.entries(campaign.locales).map(([code, state]) => (
                  <li key={code} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-12 uppercase">{code}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${localeBadge[state.status] ?? ''}`}>{t(`localeStatus.${state.status}`)}</span>
                    <span className="text-stone-600">{t('recipientsCount', { count: state.recipients })}</span>
                    {state.error && <span className="text-red-700">{state.error}</span>}
                    {state.warnings && state.warnings.length > 0 && (
                      <details className="w-full text-xs text-stone-600">
                        <summary className="cursor-pointer">{tEmail('warningsHeading')}</summary>
                        <ul className="list-disc ps-5">
                          {state.warnings.map((warning, index) => (
                            <li key={index}>{warningText(tEmail, warning)}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {campaign.status === 'scheduled' && <p className="text-xs text-stone-500">{t('cancelHint')}</p>}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{tEmail('language')}:</span>
            {locales.map((code) => (
              <Link
                key={code}
                href={`/${locale}/admin/email/campaigns/${id}?preview=${code}`}
                aria-current={code === previewLocale ? 'true' : undefined}
                className={`rounded-full border px-3 py-1 ${code === previewLocale ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-border hover:border-emerald-700'}`}
              >
                {code}
              </Link>
            ))}
          </div>
          {rendered.ok ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-white p-3 text-sm">
                <dt className="font-medium">{tEmail('subject')}</dt>
                <dd dir={rendered.email.dir}>{rendered.email.subject}</dd>
                <dt className="font-medium">{tEmail('preheader')}</dt>
                <dd dir={rendered.email.dir} className="text-stone-600">{rendered.email.preheader || tEmail('noPreheader')}</dd>
              </dl>
              <EmailPreview html={rendered.email.html} />
              {rendered.email.warnings.length > 0 && (
                <ul className="list-disc space-y-1 rounded-lg border border-border bg-white p-4 ps-9 text-sm">
                  {rendered.email.warnings.map((warning, index) => (
                    <li key={index}>{warningText(tEmail, warning)}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{tEmail('renderFailed.empty')}</p>
          )}
          <p className="text-xs text-stone-500">{t('snapshotNote')}</p>
        </div>
      </div>
    </div>
  );
}
