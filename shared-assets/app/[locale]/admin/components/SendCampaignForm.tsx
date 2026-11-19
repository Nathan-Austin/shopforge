'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { CampaignActionResult } from '../actions/campaigns';

interface SendCampaignFormProps {
  action: (previous: CampaignActionResult | null, formData: FormData) => Promise<CampaignActionResult>;
  recipients: number;
  ready: boolean;
}

/**
 * Send now or at a time. The time is picked in the owner's own time zone
 * and sent to the server as UTC, so a 9:00 in Berlin is 9:00 in Berlin.
 */
export default function SendCampaignForm({ action, recipients, ready }: SendCampaignFormProps) {
  const t = useTranslations('Admin.email.campaigns');
  const [result, formAction, pending] = useActionState(action, null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [local, setLocal] = useState('');
  const iso = local ? new Date(local).toISOString() : '';
  const input = 'mt-1 block rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const message = when === 'later' ? t('send.confirmLater', { count: recipients, time: local ? new Date(local).toLocaleString() : '' }) : t('send.confirmNow', { count: recipients });
        if (!window.confirm(message)) event.preventDefault();
      }}
      className="space-y-3 rounded-lg border border-border bg-white p-4"
    >
      <h3 className="font-semibold">{t('send.heading')}</h3>
      <p className="text-sm text-stone-600">{t('send.intro', { count: recipients })}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
          {t('send.now')}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />
          {t('send.later')}
        </label>
      </div>
      {when === 'later' && (
        <label className="block text-sm font-medium">
          {t('send.time')}
          <input type="datetime-local" required value={local} onChange={(event) => setLocal(event.target.value)} className={input} />
          <span className="mt-1 block text-xs font-normal text-stone-500">{t('send.timeHint', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</span>
        </label>
      )}
      <input type="hidden" name="scheduled_at" value={when === 'later' ? iso : ''} />
      {!ready && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('send.notReady')}</p>}
      <button
        type="submit"
        disabled={pending || !ready || (when === 'later' && !local)}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? t('send.sending') : when === 'later' ? t('send.schedule') : t('send.sendNow')}
      </button>
      {result && !result.ok && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {t(`errors.${result.error}`, { message: result.message ?? '' })}
        </p>
      )}
    </form>
  );
}
