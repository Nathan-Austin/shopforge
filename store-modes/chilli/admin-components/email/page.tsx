import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getEmailConfig } from '@/lib/email/config';
import { TEMPLATE_COLUMNS, toEmailTemplate, type EmailTemplateRow } from '@/lib/email/campaigns/templates';
import {
  createEmailTemplate,
  deleteEmailTemplate,
  duplicateEmailTemplate,
  type EmailTemplateActionResult
} from '../actions/emailTemplates';
import ConfirmSubmitButton from '../components/ConfirmSubmitButton';
import NewEmailTemplateForm from '../components/NewEmailTemplateForm';
import { actionErrorText } from '../components/emailTemplateErrors';
import { STARTER_KEYS } from './mode';
import { requireShopOwner } from '../lib/auth';

export const dynamic = 'force-dynamic';

/** Campaign templates: create from a starter, open, duplicate, delete. */
export default async function AdminEmailPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string; name?: string; error?: string; message?: string }>;
}) {
  const { locale } = await params;
  const notice = await searchParams;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email' });

  const { data: rows } = await supabase.from('email_templates').select(TEMPLATE_COLUMNS).order('updated_at', { ascending: false });
  const templates = ((rows ?? []) as EmailTemplateRow[]).map(toEmailTemplate);
  const configured = getEmailConfig().provider !== 'none';
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const create = createEmailTemplate.bind(null, { locale });
  // Plain form actions; the outcome travels in the URL like on the discounts page.
  async function duplicate(formData: FormData) {
    'use server';
    redirect(`/${locale}/admin/email?${noticeParams(await duplicateEmailTemplate({ locale }, formData))}`);
  }
  async function remove(formData: FormData) {
    'use server';
    redirect(`/${locale}/admin/email?${noticeParams(await deleteEmailTemplate({ locale }, formData))}`);
  }

  const banner = (() => {
    if (notice.notice === 'duplicated' || notice.notice === 'deleted') {
      return { ok: true, text: t(`notices.${notice.notice}`, { name: notice.name ?? '' }) };
    }
    if (notice.error) {
      return {
        ok: false,
        text: actionErrorText(t, { ok: false, error: notice.error as never, message: notice.message })
      };
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="text-sm text-stone-600">{t('subheading')}</p>
        <p className="text-sm text-stone-500">{t('comingSoon')}</p>
      </div>

      {!configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('notConfigured')}</p>
      )}

      {banner && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            banner.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {banner.text}
        </p>
      )}

      <NewEmailTemplateForm action={create} starters={STARTER_KEYS} />

      {templates.length === 0 ? (
        <p className="rounded-lg border border-border bg-white p-6 text-center text-stone-600">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-start text-xs uppercase text-stone-600">
              <tr>
                <th className="px-3 py-2 text-start">{t('columns.name')}</th>
                <th className="px-3 py-2 text-start">{t('columns.updated')}</th>
                <th className="px-3 py-2 text-start">{t('columns.lastTest')}</th>
                <th className="px-3 py-2 text-start">{t('columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {templates.map((template) => (
                <tr key={template.id}>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/${locale}/admin/email/${template.id}`} className="underline hover:text-emerald-700">
                      {template.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-stone-600">{dateFormat.format(new Date(template.updatedAt))}</td>
                  <td className="px-3 py-2 text-stone-600">
                    {template.lastTestSentAt ? dateFormat.format(new Date(template.lastTestSentAt)) : t('never')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-3">
                      <form action={duplicate}>
                        <input type="hidden" name="id" value={template.id} />
                        <button type="submit" className="underline hover:text-emerald-700">
                          {t('duplicate')}
                        </button>
                      </form>
                      <form action={remove}>
                        <input type="hidden" name="id" value={template.id} />
                        <ConfirmSubmitButton message={t('confirmDelete', { name: template.name })} className="text-red-700 underline">
                          {t('delete')}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
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

function noticeParams(result: EmailTemplateActionResult): string {
  const params = new URLSearchParams();
  if (result.ok) {
    params.set('notice', result.action);
    params.set('name', result.name);
  } else {
    params.set('error', result.error);
    if (result.message) params.set('message', result.message.slice(0, 200));
  }
  return params.toString();
}
