'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Braces } from 'lucide-react';

import { MERGE_TAGS, type MergeTagKey } from '@/lib/email/campaigns/mergeTags';
import { hrefSchema } from '@/lib/email/campaigns/schema';

export const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-stone-500">{hint}</span>}
    </label>
  );
}

/** The tag as inserted: first names get a friendly fallback for subscribers without one. */
export function mergeTagText(key: MergeTagKey, fallbackName: string): string {
  return key === 'subscriber.first_name' ? `{{${key}|${fallbackName}}}` : `{{${key}}}`;
}

/** A small menu of personal details to insert where the cursor is. */
export function MergeTagMenu({ onInsert, urlOnly = false }: { onInsert: (text: string) => void; urlOnly?: boolean }) {
  const t = useTranslations('Admin.email.designer.mergeTags');
  const [open, setOpen] = useState(false);
  const keys = (Object.keys(MERGE_TAGS) as MergeTagKey[]).filter(
    (key) => !urlOnly || (MERGE_TAGS[key] as { url?: boolean }).url
  );
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={t('button')}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:border-emerald-700 hover:text-emerald-700"
      >
        <Braces className="h-3.5 w-3.5" aria-hidden />
        {t('button')}
      </button>
      {open && (
        <ul className="absolute end-0 z-20 mt-1 w-64 rounded-md border border-border bg-white py-1 text-sm shadow-lg">
          {keys.map((key) => (
            <li key={key}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-start hover:bg-stone-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onInsert(mergeTagText(key, t('fallbackName')));
                  setOpen(false);
                }}
              >
                {t(key.replace('.', '_'))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TaggedInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown greyed when empty: the text readers get from another language. */
  placeholder?: string;
  hint?: ReactNode;
  maxLength?: number;
  multiline?: boolean;
  dir?: 'ltr' | 'rtl';
  invalid?: boolean;
}

/** A text field with the merge-tag menu, inserting at the cursor. */
export function TaggedInput({ label, value, onChange, placeholder, hint, maxLength, multiline, dir, invalid }: TaggedInputProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const insert = (text: string) => {
    const element = ref.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const props = {
    ref,
    id,
    value,
    dir,
    placeholder,
    maxLength,
    'aria-invalid': invalid || undefined,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    className: `${inputClass} ${invalid ? 'border-red-400' : ''}`
  };
  return (
    <div className="space-y-1">
      <div className="flex items-end justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={id}>
          {label}
        </label>
        <MergeTagMenu onInsert={insert} />
      </div>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

/** True for addresses the schema accepts: http(s), mailto or a URL merge tag first. */
export function isAcceptableHref(value: string): boolean {
  return hrefSchema.safeParse(value).success;
}

/** A link address with one-click choices for the common destinations. */
export function LinkField({
  label,
  value,
  onChange,
  optional = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  const t = useTranslations('Admin.email.designer');
  const invalid = value !== '' && !isAcceptableHref(value);
  const presets = [
    { label: t('links.home'), value: '{{shop.locale_url}}' },
    { label: t('links.shop'), value: '{{shop.locale_url}}/shop' }
  ];
  return (
    <div className="space-y-1">
      <Field label={label}>
        <input
          type="text"
          inputMode="url"
          value={value}
          placeholder="https://"
          aria-invalid={invalid || (!optional && !value) || undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} ${invalid ? 'border-red-400' : ''}`}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={`rounded-full border px-2 py-0.5 ${value === preset.value ? 'border-emerald-700 text-emerald-800' : 'border-border hover:border-emerald-700'}`}
          >
            {preset.label}
          </button>
        ))}
        <MergeTagMenu urlOnly onInsert={onChange} />
      </div>
      {invalid && <p className="text-xs text-red-700">{t('linkInvalid')}</p>}
    </div>
  );
}

/** Start / centre / end as three buttons. */
export function AlignField({ value, onChange }: { value: 'start' | 'center' | 'end'; onChange: (value: 'start' | 'center' | 'end') => void }) {
  const t = useTranslations('Admin.email.designer.fields');
  return (
    <div className="text-sm">
      <span className="font-medium">{t('align')}</span>
      <div role="radiogroup" aria-label={t('align')} className="mt-1 inline-flex rounded-md border border-border">
        {(['start', 'center', 'end'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={`px-3 py-1.5 first:rounded-s-md last:rounded-e-md ${value === option ? 'bg-emerald-700 text-white' : 'hover:bg-stone-100'}`}
          >
            {t(`aligns.${option}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A colour swatch with a "use the brand colour" reset when nullable. */
export function ColorField({
  label,
  value,
  onChange,
  fallback,
  resetLabel
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  fallback: string;
  resetLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        type="color"
        aria-label={label}
        value={value ?? fallback}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-border bg-white"
      />
      <span className="font-medium">{label}</span>
      {resetLabel && value !== null && (
        <button type="button" className="text-xs underline" onClick={() => onChange(null)}>
          {resetLabel}
        </button>
      )}
    </div>
  );
}
