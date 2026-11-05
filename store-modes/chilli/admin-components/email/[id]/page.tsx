import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { getEmailConfig } from '@/lib/email/config';
import { loadForEditing } from '@/lib/email/campaigns/editor';
import { loadDesignerData } from '@/lib/email/campaigns/server';
import { TEMPLATE_COLUMNS, toEmailTemplate, type EmailTemplateRow } from '@/lib/email/campaigns/templates';
import { saveEmailTemplate, searchEmailProducts, sendTestEmail } from '../../actions/emailTemplates';
import EmailDesigner from '../../components/email-designer/EmailDesigner';
import TestSendForm from '../../components/TestSendForm';
import { CAMPAIGN_MODE } from '../mode';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * One template in the designer: blocks on the left, the live preview in
 * each of the shop's languages on the right, and a test send under it.
 */
export default async function AdminEmailTemplatePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { locale, id } = await params;
  const { notice } = await searchParams;
  const { supabase, user } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email' });

  const { data: row } = await supabase.from('email_templates').select(TEMPLATE_COLUMNS).eq('id', id).maybeSingle();
  if (!row) notFound();
  const template = toEmailTemplate(row as EmailTemplateRow);

  const loaded = loadForEditing(template.document, DEFAULT_LOCALE);
  // The shop's languages, plus the template's own default if the shop has since dropped it.
  const locales = Array.from(new Set([...(LOCALES as readonly string[]), loaded.document.defaultLocale]));
  const data = await loadDesignerData(supabase, template.document, locales, CAMPAIGN_MODE);

  return (
    <div className="space-y-4">
      <Link href={`/${locale}/admin/email`} className="text-sm underline hover:text-emerald-700">
        ← {t('back')}
      </Link>
      {notice === 'created' && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {t('notices.created', { name: template.name })}
        </p>
      )}
      <EmailDesigner
        initialName={template.name}
        initialDocument={loaded.document}
        dropped={loaded.dropped}
        reset={loaded.reset}
        locales={locales}
        data={data}
        save={saveEmailTemplate.bind(null, { locale, id })}
        searchProducts={searchEmailProducts}
        aside={
          <TestSendForm
            action={sendTestEmail.bind(null, { locale, id })}
            defaultTo={user.email ?? ''}
            defaultLocale={loaded.document.defaultLocale}
            locales={locales}
            configured={getEmailConfig().provider !== 'none'}
          />
        }
      />
    </div>
  );
}
