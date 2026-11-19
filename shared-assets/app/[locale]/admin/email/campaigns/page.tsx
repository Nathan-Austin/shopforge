import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CAMPAIGN_COLUMNS, campaignProvider, type CampaignRow } from '@/lib/email/campaigns/send';
import { createCampaign, deleteCampaign, type CampaignActionResult } from '../../actions/campaigns';
import ConfirmSubmitButton from '../../components/ConfirmSubmitButton';
import EmailTabs from '../../components/EmailTabs';
import NewCampaignForm from '../../components/NewCampaignForm';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<CampaignRow['status'], string> = {
  draft: 'bg-stone-100 text-stone-700',
  scheduled: 'bg-blue-100 text-blue-800',
  sending: 'bg-amber-100 text-amber-900',
  sent: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800'
};

/** Campaigns: a template sent to the list. Drafts, scheduled, sent. */
export default async function AdminCampaignsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { locale } = await params;
  const { notice } = await searchParams;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email.campaigns' });

  const [{ data: rows }, { data: templates }] = await Promise.all([
    supabase.from('email_campaigns').select(CAMPAIGN_COLUMNS).order('created_at', { ascending: false }).limit(100),
    supabase.from('email_templates').select('id, name').order('updated_at', { ascending: false })
  ]);
  const campaigns = (rows ?? []) as CampaignRow[];
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  async function remove(formData: FormData) {
    'use server';
    const result: CampaignActionResult = await deleteCampaign({ locale }, formData);
    redirect(`/${locale}/admin/email/campaigns?notice=${result.ok ? result.action : result.error}`);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="text-sm text-stone-600">{t('subheading')}</p>
      </div>
      <EmailTabs locale={locale} current="campaigns" />
      {!(await campaignProvider()) && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('notConfigured')}</p>}
      {notice && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${notice === 'deleted' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {notice === 'deleted' ? t('notices.deleted') : t(`errors.${['not_authorized', 'not_found', 'not_draft'].includes(notice) ? notice : 'failed'}`, { message: '' })}
        </p>
      )}

      <NewCampaignForm action={createCampaign.bind(null, { locale })} templates={(templates ?? []) as { id: string; name: string }[]} />

      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-border bg-white p-6 text-center text-stone-600">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-600">
              <tr>
                <th className="px-3 py-2 text-start">{t('columns.name')}</th>
                <th className="px-3 py-2 text-start">{t('columns.status')}</th>
                <th className="px-3 py-2 text-start">{t('columns.recipients')}</th>
                <th className="px-3 py-2 text-start">{t('columns.when')}</th>
                <th className="px-3 py-2 text-start">{t('columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/${locale}/admin/email/campaigns/${campaign.id}`} className="underline hover:text-emerald-700">
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[campaign.status]}`}>{t(`status.${campaign.status}`)}</span>
                  </td>
                  <td className="px-3 py-2">{campaign.status === 'draft' ? '—' : campaign.recipient_count}</td>
                  <td className="px-3 py-2 text-stone-600">
                    {campaign.sent_at
                      ? t('sentOn', { date: dateFormat.format(new Date(campaign.sent_at)) })
                      : campaign.scheduled_at
                        ? t('scheduledFor', { date: dateFormat.format(new Date(campaign.scheduled_at)) })
                        : t('createdOn', { date: dateFormat.format(new Date(campaign.created_at)) })}
                  </td>
                  <td className="px-3 py-2">
                    {campaign.status === 'draft' && (
                      <form action={remove}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <ConfirmSubmitButton message={t('confirmDelete', { name: campaign.name })} className="text-red-700 underline">
                          {t('delete')}
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
