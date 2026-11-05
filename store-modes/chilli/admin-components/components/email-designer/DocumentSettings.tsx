'use client';

import { useTranslations } from 'next-intl';

import { directionOf } from '@/lib/i18n/locales';
import { setLocalizedText } from '@/lib/email/campaigns/editor';
import { isBlankString, pickLocalized, type Localized } from '@/lib/email/campaigns/localize';
import { FONT_FAMILIES, type CampaignTheme } from '@/lib/email/campaigns/schema';
import { useDesigner } from './DesignerContext';
import ImageField from './ImageField';
import { ColorField, Field, TaggedInput, inputClass } from './fields';

/** Subject, preview text, footer and the look: everything that is not a block. */
export default function DocumentSettings() {
  const t = useTranslations('Admin.email.designer');
  const { doc, locale, edit, issuesByBlock } = useDesigner();
  const dir = directionOf(locale);
  const issues = issuesByBlock.get('') ?? [];
  const fallback = (value: Localized<string> | undefined) => {
    const picked = pickLocalized(value, locale, doc.defaultLocale, isBlankString);
    return picked && picked.locale !== locale ? picked.value : undefined;
  };
  const setText = (field: 'subject' | 'preheader' | 'footer') => (value: string) =>
    edit((current) => ({ ...current, [field]: setLocalizedText(current[field], locale, value) }), `doc.${field}.${locale}`);
  const setTheme = <K extends keyof CampaignTheme>(field: K, value: CampaignTheme[K], key?: string) =>
    edit((current) => ({ ...current, theme: { ...current.theme, [field]: value } }), key);

  return (
    <div className="space-y-4">
      {issues.length > 0 && (
        <ul className="list-disc rounded-md border border-red-200 bg-red-50 py-2 pe-3 ps-7 text-xs text-red-900">
          {issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
      <TaggedInput
        label={t('fields.subject')}
        hint={t('fields.subjectHint')}
        value={doc.subject[locale] ?? ''}
        placeholder={fallback(doc.subject)}
        dir={dir}
        maxLength={150}
        invalid={issues.some((issue) => issue.path.startsWith('subject'))}
        onChange={setText('subject')}
      />
      <TaggedInput
        label={t('fields.preheader')}
        hint={t('fields.preheaderHint')}
        value={doc.preheader[locale] ?? ''}
        placeholder={fallback(doc.preheader)}
        dir={dir}
        maxLength={200}
        onChange={setText('preheader')}
      />
      <TaggedInput
        label={t('fields.footer')}
        hint={t('fields.footerHint')}
        value={doc.footer[locale] ?? ''}
        placeholder={fallback(doc.footer)}
        dir={dir}
        maxLength={500}
        multiline
        onChange={setText('footer')}
      />

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-semibold">{t('theme.heading')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField label={t('theme.brandColor')} value={doc.theme.brandColor} fallback="#111111" onChange={(value) => setTheme('brandColor', value ?? '#111111', 'theme.brand')} />
          <ColorField label={t('theme.textColor')} value={doc.theme.textColor} fallback="#1c1917" onChange={(value) => setTheme('textColor', value ?? '#1c1917', 'theme.text')} />
          <ColorField label={t('theme.backgroundColor')} value={doc.theme.backgroundColor} fallback="#f5f5f4" onChange={(value) => setTheme('backgroundColor', value ?? '#f5f5f4', 'theme.background')} />
          <ColorField label={t('theme.contentColor')} value={doc.theme.contentColor} fallback="#ffffff" onChange={(value) => setTheme('contentColor', value ?? '#ffffff', 'theme.content')} />
        </div>
        <Field label={t('theme.font')}>
          <select value={doc.theme.fontFamily} onChange={(event) => setTheme('fontFamily', event.target.value as CampaignTheme['fontFamily'])} className={inputClass}>
            {FONT_FAMILIES.map((font) => (
              <option key={font} value={font}>
                {t(`theme.fonts.${font}`)}
              </option>
            ))}
          </select>
        </Field>
        <ImageField label={t('theme.logo')} value={doc.theme.logoUrl ?? ''} onChange={(url) => setTheme('logoUrl', url || null)} />
        {doc.theme.logoUrl && (
          <div className="flex flex-wrap items-end gap-4">
            <Field label={`${t('theme.logoWidth')}: ${doc.theme.logoWidth}px`}>
              <input
                type="range"
                min={40}
                max={300}
                step={10}
                value={doc.theme.logoWidth}
                onChange={(event) => setTheme('logoWidth', Number(event.target.value), 'theme.logoWidth')}
                className="mt-2 w-48"
              />
            </Field>
            <button type="button" className="pb-1 text-sm text-red-700 underline" onClick={() => setTheme('logoUrl', null)}>
              {t('theme.removeLogo')}
            </button>
          </div>
        )}
      </fieldset>
    </div>
  );
}
