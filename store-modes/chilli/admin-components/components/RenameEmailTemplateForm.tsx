'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { EmailTemplateActionResult } from '../actions/emailTemplates';
import { actionErrorText } from './emailTemplateErrors';

interface RenameEmailTemplateFormProps {
  action: (previous: EmailTemplateActionResult | null, formData: FormData) => Promise<EmailTemplateActionResult>;
  name: string;
}

export default function RenameEmailTemplateForm({ action, name }: RenameEmailTemplateFormProps) {
  const t = useTranslations('Admin.email');
  const [result, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="block text-sm font-medium">
        {t('name')}
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          defaultValue={name}
          className="mt-1 block w-72 max-w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-4 py-2 text-sm hover:border-emerald-700 hover:text-emerald-700 disabled:opacity-60"
      >
        {pending ? t('saving') : t('save')}
      </button>
      {result && (
        <p role="status" className={`w-full text-sm ${result.ok ? 'text-emerald-800' : 'text-red-800'}`}>
          {result.ok ? t('notices.saved') : actionErrorText(t, result)}
        </p>
      )}
    </form>
  );
}
