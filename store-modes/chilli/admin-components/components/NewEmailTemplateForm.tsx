'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { EmailTemplateActionResult } from '../actions/emailTemplates';
import { actionErrorText } from './emailTemplateErrors';

interface NewEmailTemplateFormProps {
  action: (previous: EmailTemplateActionResult | null, formData: FormData) => Promise<EmailTemplateActionResult>;
  starters: readonly string[];
}

/** Name and starting layout; success opens the new template. */
export default function NewEmailTemplateForm({ action, starters }: NewEmailTemplateFormProps) {
  const t = useTranslations('Admin.email');
  const [result, formAction, pending] = useActionState(action, null);
  const input =
    'mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <h3 className="font-semibold">{t('newHeading')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t('name')}
          <input type="text" name="name" required maxLength={120} className={input} />
        </label>
        <label className="block text-sm font-medium">
          {t('starter')}
          <select name="starter" defaultValue={starters[starters.length - 1]} className={input}>
            {starters.map((starter) => (
              <option key={starter} value={starter}>
                {t(`starters.${starter}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result && !result.ok && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {actionErrorText(t, result)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? t('creating') : t('create')}
      </button>
    </form>
  );
}
