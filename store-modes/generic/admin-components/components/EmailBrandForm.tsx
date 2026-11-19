'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import { FONT_FAMILIES } from '@/lib/email/campaigns/schema';
import type { EmailBrand } from '@/lib/email/brand';
import type { EmailBrandActionResult } from '../actions/emailBrand';
import ImageField from './email-designer/ImageField';
import { Field, inputClass } from './email-designer/fields';

interface EmailBrandFormProps {
  save: (previous: EmailBrandActionResult | null, formData: FormData) => Promise<EmailBrandActionResult>;
  brand: EmailBrand;
  /** The shop's locales, one footer each. */
  locales: readonly string[];
}

const COLOURS = ['brandColor', 'textColor', 'backgroundColor', 'contentColor'] as const;
const FIELD_NAMES: Record<(typeof COLOURS)[number], string> = {
  brandColor: 'brand_color',
  textColor: 'text_color',
  backgroundColor: 'background_color',
  contentColor: 'content_color'
};

/**
 * The logo, colours, font and footer address of the shop's email. A plain
 * form: colours are a picker beside a typed value, the logo is an upload or
 * an https address, and the footer is one text box per language.
 */
export default function EmailBrandForm({ save, brand, locales }: EmailBrandFormProps) {
  const t = useTranslations('Admin.email.settings.brand');
  const [result, action, pending] = useActionState(save, null);
  const [colours, setColours] = useState<Record<(typeof COLOURS)[number], string>>({
    brandColor: brand.brandColor,
    textColor: brand.textColor,
    backgroundColor: brand.backgroundColor,
    contentColor: brand.contentColor
  });
  const [logoUrl, setLogoUrl] = useState(brand.logoUrl ?? '');

  const setColour = (key: (typeof COLOURS)[number], value: string) => setColours((current) => ({ ...current, [key]: value }));

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{t('hint')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {COLOURS.map((key) => (
          <div key={key} className="text-sm font-medium">
            <span>{t(`colours.${key}`)}</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                aria-label={t(`colours.${key}`)}
                value={/^#[0-9a-fA-F]{6}$/.test(colours[key]) ? colours[key] : '#000000'}
                onChange={(event) => setColour(key, event.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-white p-0.5"
              />
              <input
                type="text"
                name={FIELD_NAMES[key]}
                value={colours[key]}
                onChange={(event) => setColour(key, event.target.value.trim())}
                pattern="#[0-9a-fA-F]{6}"
                maxLength={7}
                spellCheck={false}
                className="block w-28 rounded-md border border-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>
            <span className="mt-1 block text-xs font-normal text-stone-500">{t(`colourHints.${key}`)}</span>
          </div>
        ))}
      </div>

      <Field label={t('font')}>
        <select name="font_family" defaultValue={brand.fontFamily} className={inputClass}>
          {FONT_FAMILIES.map((family) => (
            <option key={family} value={family}>
              {t(`fonts.${family}`)}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <ImageField label={t('logo')} value={logoUrl} onChange={setLogoUrl} hint={t('logoHint')} />
        <input type="hidden" name="logo_url" value={logoUrl} />
        <Field label={t('logoWidth')} hint={t('logoWidthHint')}>
          <input type="number" name="logo_width" min={40} max={300} step={10} defaultValue={brand.logoWidth} className={inputClass} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t('footer')}</legend>
        <p className="text-xs text-stone-500">{t('footerHint')}</p>
        {locales.map((locale) => (
          <Field key={locale} label={locale.toUpperCase()}>
            <textarea
              name={`footer_${locale}`}
              rows={2}
              maxLength={600}
              defaultValue={brand.footer[locale] ?? ''}
              dir="auto"
              className={inputClass}
            />
          </Field>
        ))}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? t('saving') : t('save')}
      </button>

      {result?.ok && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('savedNotice')}</p>
      )}
      {result && !result.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p>{t(`errors.${result.error}`)}</p>
          {result.issues && (
            <ul className="mt-1 list-disc ps-5 text-xs">
              {result.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
