'use client';

import { useTranslations } from 'next-intl';

import { missingTranslations } from '@/lib/email/campaigns/editor';
import type { CampaignDocument } from '@/lib/email/campaigns/schema';

/**
 * Which language is being edited and previewed, with a count of the fields
 * still waiting for a translation in each.
 */
export default function LocaleBar({
  doc,
  locales,
  value,
  onChange
}: {
  doc: CampaignDocument;
  locales: readonly string[];
  value: string;
  onChange: (locale: string) => void;
}) {
  const t = useTranslations('Admin.email.designer');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="tablist" aria-label={t('editingLanguage')}>
      <span className="font-medium">{t('editingLanguage')}:</span>
      {locales.map((locale) => {
        const missing = missingTranslations(doc, locale).length;
        const active = locale === value;
        return (
          <button
            key={locale}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(locale)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${active ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-border bg-white hover:border-emerald-700'}`}
          >
            {locale === doc.defaultLocale ? t('defaultLanguage', { locale: locale.toUpperCase() }) : locale.toUpperCase()}
            {missing > 0 && (
              <span className={`rounded-full px-1.5 text-xs ${active ? 'bg-white/20' : 'bg-amber-100 text-amber-900'}`} title={t('missingCount', { count: missing })}>
                {missing}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
