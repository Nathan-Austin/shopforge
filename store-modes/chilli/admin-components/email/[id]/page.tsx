import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { getEmailConfig } from '@/lib/email/config';
import { MERGE_TAGS } from '@/lib/email/campaigns/mergeTags';
import { renderCampaignPreview } from '@/lib/email/campaigns/server';
import { TEMPLATE_COLUMNS, toEmailTemplate, type EmailTemplateRow } from '@/lib/email/campaigns/templates';
import { saveEmailTemplate, sendTestEmail } from '../../actions/emailTemplates';
import EmailPreview from '../../components/EmailPreview';
import RenameEmailTemplateForm from '../../components/RenameEmailTemplateForm';
import TestSendForm from '../../components/TestSendForm';
import { warningText } from '../../components/emailWarnings';
import { CAMPAIGN_MODE } from '../mode';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * One template: its preview in each of the shop's languages, at desktop
 * and phone width, what to check, and a test send. The designer (roadmap
 * phase C) adds editing here.
 */
export default async function AdminEmailTemplatePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ preview?: string; notice?: string }>;
}) {
  const { locale, id } = await params;
  const { preview, notice } = await searchParams;
  const { supabase, user } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email' });

  const { data: row } = await supabase.from('email_templates').select(TEMPLATE_COLUMNS).eq('id', id).maybeSingle();
  if (!row) notFound();
  const template = toEmailTemplate(row as EmailTemplateRow);

  const shopLocales = LOCALES as readonly string[];
  const previewLocale = preview && shopLocales.includes(preview) ? preview : DEFAULT_LOCALE;
  const rendered = await renderCampaignPreview(supabase, template.document, previewLocale, CAMPAIGN_MODE);
  const warnings = rendered.ok ? rendered.email.warnings : rendered.warnings;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href={`/${locale}/admin/email`} className="text-sm underline hover:text-emerald-700">
          ← {t('back')}
        </Link>
        <h2 className="text-xl font-bold">{template.name}</h2>
        {notice === 'created' && (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {t('notices.created', { name: template.name })}
          </p>
        )}
        <RenameEmailTemplateForm action={saveEmailTemplate.bind(null, { locale, id })} name={template.name} />
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t('language')}:</span>
            {shopLocales.map((code) => (
              <Link
                key={code}
                href={`/${locale}/admin/email/${id}?preview=${code}`}
                aria-current={code === previewLocale ? 'true' : undefined}
                className={`rounded-full border px-3 py-1 ${
                  code === previewLocale ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-border hover:border-emerald-700'
                }`}
              >
                {code}
              </Link>
            ))}
          </div>

          {rendered.ok ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-white p-3 text-sm">
                <dt className="font-medium">{t('subject')}</dt>
                <dd dir={rendered.email.dir}>{rendered.email.subject}</dd>
                <dt className="font-medium">{t('preheader')}</dt>
                <dd dir={rendered.email.dir} className="text-stone-600">
                  {rendered.email.preheader || t('noPreheader')}
                </dd>
              </dl>
              <EmailPreview html={rendered.email.html} />
              <p className="text-xs text-stone-500">
                {t('preview.sampleNote', { name: MERGE_TAGS['subscriber.first_name'].sample })}
              </p>
            </>
          ) : (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {rendered.error === 'empty'
                ? t('renderFailed.empty')
                : t('renderFailed.invalidDocument', {
                    issues: rendered.issues.map((issue) => `${issue.path} ${issue.message}`.trim()).join('; ')
                  })}
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border bg-white p-4">
            <h3 className="font-semibold">{t('warningsHeading')}</h3>
            {warnings.length === 0 ? (
              <p className="text-sm text-stone-600">{t('noWarnings')}</p>
            ) : (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {warnings.map((warning, index) => (
                  <li key={index}>{warningText(t, warning)}</li>
                ))}
              </ul>
            )}
          </div>

          <TestSendForm
            action={sendTestEmail.bind(null, { locale, id })}
            defaultTo={user.email ?? ''}
            defaultLocale={previewLocale}
            locales={shopLocales}
            configured={getEmailConfig().provider !== 'none'}
          />
        </aside>
      </section>
    </div>
  );
}
