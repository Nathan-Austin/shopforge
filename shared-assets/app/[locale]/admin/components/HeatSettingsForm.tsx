'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import { formatHeatOn, type HeatScale } from '@/lib/products/heat';
import { HEAT_BAND_WORD_MAX, HEAT_DISPLAYS } from '@/lib/settings/schema';
import type { StoreSettingsActionResult } from '../actions/storeSettings';

interface HeatSettingsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  scale: HeatScale;
  /** True while the scale still comes from the shop's generated configuration. */
  fromDefault: boolean;
}

interface BandRow {
  word: string;
  upTo: string;
}

/**
 * The "Heat" section of /admin/settings, for shops that track it. Levels
 * are stored on the shop's own scale, so changing the top of the scale
 * rewrites the products: the form says so before the owner saves.
 */
export default function HeatSettingsForm({ save, scale, fromDefault }: HeatSettingsFormProps) {
  const t = useTranslations('Admin.settings.heat');
  const [result, action, pending] = useActionState(save, null);

  const [max, setMax] = useState(String(scale.max));
  const [display, setDisplay] = useState(scale.display);
  const [bands, setBands] = useState<BandRow[]>(() =>
    scale.bands.map((band) => ({ word: band.word, upTo: String(band.upTo) }))
  );

  const parsedMax = Number(max);
  const rescaling = Number.isFinite(parsedMax) && parsedMax > 0 && parsedMax !== scale.max;

  // What the owner is about to get, from what is typed rather than saved.
  const preview: HeatScale = {
    max: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : scale.max,
    display,
    bands: bands
      .map((band) => ({ word: band.word.trim(), upTo: Number(band.upTo) }))
      .filter((band) => band.word.length > 0 && Number.isFinite(band.upTo))
      .sort((a, b) => a.upTo - b.upTo)
  };
  const example = Math.round(preview.max * 0.7);

  const setBand = (index: number, changes: Partial<BandRow>) =>
    setBands((current) => current.map((band, i) => (i === index ? { ...band, ...changes } : band)));

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{fromDefault ? t('fromDefault') : t('hint')}</p>
      </div>

      <label className="block text-sm font-medium">
        {t('max')}
        <input
          type="number"
          name="max"
          min={1}
          max={100}
          required
          value={max}
          onChange={(event) => setMax(event.target.value)}
          className="mt-1 block w-28 rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
        />
        <span className="mt-1 block text-xs font-normal text-stone-500">{t('maxHint')}</span>
      </label>

      {rescaling && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          {t('rescaleWarning', { from: scale.max, to: parsedMax })}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('displayHeading')}</legend>
        {HEAT_DISPLAYS.map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm font-normal">
            <input
              type="radio"
              name="display"
              value={option}
              checked={display === option}
              onChange={() => setDisplay(option)}
              className="mt-1"
            />
            <span>
              {t(`display_${option}`)}
              <span className="block text-xs text-stone-500">
                {formatHeatOn(preview, example, option) || t('displayEmpty')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t('bandsHeading')}</div>
        <p className="text-xs text-stone-500">{t('bandsHint')}</p>
        {bands.length === 0 && <p className="text-xs text-stone-500">{t('bandsEmpty')}</p>}
        <ul className="space-y-2">
          {bands.map((band, index) => (
            <li key={index} className="flex items-end gap-2">
              <label className="text-xs font-medium">
                {t('bandWord')}
                <input
                  name="bandWord"
                  value={band.word}
                  maxLength={HEAT_BAND_WORD_MAX}
                  onChange={(event) => setBand(index, { word: event.target.value })}
                  className="mt-1 block w-44 rounded-md border border-border bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-medium">
                {t('bandUpTo')}
                <input
                  name="bandUpTo"
                  type="number"
                  min={0}
                  max={100}
                  value={band.upTo}
                  onChange={(event) => setBand(index, { upTo: event.target.value })}
                  className="mt-1 block w-24 rounded-md border border-border bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => setBands((current) => current.filter((_, i) => i !== index))}
                className="rounded-md border border-border px-2 py-1.5 text-xs hover:border-red-400 hover:text-red-700"
              >
                {t('bandRemove')}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setBands((current) => [...current, { word: '', upTo: String(preview.max) }])}
          className="rounded-md border border-border px-2 py-1.5 text-xs hover:border-emerald-700 hover:text-emerald-700"
        >
          {t('bandAdd')}
        </button>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? t('saving') : t('save')}
      </button>

      {result?.ok && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
          {t('savedNotice')}
        </p>
      )}
      {result && !result.ok && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {t(`errors.${result.error}`)}
        </p>
      )}
    </form>
  );
}
