'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { CampaignActionResult } from '../actions/campaigns';

interface NewCampaignFormProps {
  action: (previous: CampaignActionResult | null, formData: FormData) => Promise<CampaignActionResult>;
  templates: { id: string; name: string }[];
}

/** A name and a template; success opens the new draft. */
export default function NewCampaignForm({ action, templates }: NewCampaignFormProps) {
  const t = useTranslations('Admin.email.campaigns');
  const [result, formAction, pending] = useActionState(action, null);
  const input = 'mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <h3 className="font-semibold">{t('newHeading')}</h3>
      {templates.length === 0 ? (
        <p className="text-sm text-stone-600">{t('noTemplates')}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {t('name')}
              <input type="text" name="name" required maxLength={120} className={input} />
            </label>
            <label className="block text-sm font-medium">
              {t('template')}
              <select name="template_id" required defaultValue={templates[0].id} className={input}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {result && !result.ok && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {t(`errors.${result.error}`, { message: result.message ?? '' })}
            </p>
          )}
          <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
            {pending ? t('creating') : t('create')}
          </button>
        </>
      )}
    </form>
  );
}
