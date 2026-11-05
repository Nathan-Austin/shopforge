'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoaderCircle, RefreshCw } from 'lucide-react';

import type { LocaleReadiness } from '@/lib/email/campaigns/send';
import type { SyncProgress } from '@/lib/email/subscribers/sync';

interface AudienceSyncProps {
  readiness: LocaleReadiness[];
  sync: (locale: string, forcePull: boolean) => Promise<SyncProgress>;
  configured: boolean;
}

/**
 * The list at the provider, per language: how many will receive the
 * campaign, how many changes still need pushing, and a button that keeps
 * calling the sync until nothing is left (Resend takes one contact per
 * request, so a first sync of a big list runs for a while).
 */
export default function AudienceSync({ readiness, sync, configured }: AudienceSyncProps) {
  const t = useTranslations('Admin.email.campaigns.sync');
  const [state, setState] = useState<Record<string, { running: boolean; progress: SyncProgress | null; pushedTotal: number }>>({});
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (locales: string[]) => {
      setRunning(true);
      try {
        for (const locale of locales) {
          let pushedTotal = 0;
          let forcePull = true;
          for (let round = 0; round < 500; round++) {
            setState((current) => ({ ...current, [locale]: { running: true, progress: current[locale]?.progress ?? null, pushedTotal } }));
            const progress = await sync(locale, forcePull);
            forcePull = false;
            pushedTotal += progress.pushed;
            setState((current) => ({ ...current, [locale]: { running: progress.remaining > 0 && !progress.error, progress, pushedTotal } }));
            if (progress.error || progress.remaining === 0) break;
            // A rate limit: wait a little before the next round.
            await new Promise((resolve) => setTimeout(resolve, progress.rateLimited ? 5000 : 250));
          }
        }
      } finally {
        setRunning(false);
      }
    },
    [sync]
  );

  const due = readiness.reduce((sum, entry) => sum + entry.due, 0);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t('heading')}</h3>
          <p className="text-sm text-stone-600">{t('intro')}</p>
        </div>
        <button
          type="button"
          disabled={running || !configured}
          onClick={() => void run(readiness.filter((entry) => entry.subscribed > 0 || entry.due > 0).map((entry) => entry.locale))}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {running ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          {running ? t('running') : due > 0 ? t('syncNow', { count: due }) : t('syncAgain')}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-stone-600">
          <tr>
            <th className="py-1 text-start">{t('language')}</th>
            <th className="py-1 text-start">{t('recipients')}</th>
            <th className="py-1 text-start">{t('toSync')}</th>
            <th className="py-1 text-start">{t('state')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {readiness.map((entry) => {
            const row = state[entry.locale];
            const remaining = row?.progress ? row.progress.remaining : entry.due;
            const audienceId = row?.progress?.audienceId ?? entry.audienceId;
            return (
              <tr key={entry.locale}>
                <td className="py-1.5 uppercase">{entry.locale}</td>
                <td className="py-1.5">{entry.subscribed}</td>
                <td className="py-1.5">{remaining}</td>
                <td className="py-1.5 text-stone-600">
                  {row?.running
                    ? t('pushing', { count: row.pushedTotal })
                    : row?.progress?.error
                      ? <span className="text-red-700">{t('error', { message: row.progress.error })}</span>
                      : row?.progress
                        ? t('done', { pushed: row.pushedTotal, pulled: row.progress.pulledUnsubscribes })
                        : entry.subscribed === 0 && entry.due === 0
                          ? t('nobody')
                          : !audienceId
                            ? t('noAudience')
                            : remaining > 0
                              ? t('outOfDate')
                              : t('upToDate')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
