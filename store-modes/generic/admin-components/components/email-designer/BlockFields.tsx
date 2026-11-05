'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

import { directionOf } from '@/lib/i18n/locales';
import { formatPrice } from '@/lib/format';
import { isBlankString, pickLocalized, type Localized } from '@/lib/email/campaigns/localize';
import { isRichDocEmpty, COLUMN_LAYOUTS, type CampaignBlock, type ColumnsBlock, type LeafBlock, type RichDoc } from '@/lib/email/campaigns/schema';
import { setColumnsLayout, setLocalizedDoc, setLocalizedText, updateBlock } from '@/lib/email/campaigns/editor';
import type { CatalogProduct } from '@/lib/email/campaigns/context';
import { useDesigner } from './DesignerContext';
import ImageField from './ImageField';
import RichTextField from './RichTextField';
import { AlignField, ColorField, Field, LinkField, TaggedInput, inputClass } from './fields';

type Of<T extends CampaignBlock['type']> = Extract<CampaignBlock, { type: T }>;

/** Shortcuts every editor below uses: the block, a typed updater, the language. */
function useBlock<T extends CampaignBlock['type']>(block: Of<T>) {
  const { doc, locale, edit } = useDesigner();
  const update = (change: Partial<Of<T>>, key?: string) =>
    edit((current) => updateBlock<CampaignBlock>(current, block.id, (existing) => ({ ...existing, ...change }) as CampaignBlock), key);
  /** The text readers in this language get when the field is empty: the fallback. */
  const fallback = (value: Localized<string> | undefined) => {
    const picked = pickLocalized(value, locale, doc.defaultLocale, isBlankString);
    return picked && picked.locale !== locale ? picked.value : undefined;
  };
  return { doc, locale, update, fallback, dir: directionOf(locale), key: (field: string) => `${block.id}.${field}.${locale}` };
}

function HeadingFields({ block }: { block: Of<'heading'> }) {
  const t = useTranslations('Admin.email.designer.fields');
  const { locale, update, fallback, dir, key } = useBlock(block);
  return (
    <div className="space-y-3">
      <TaggedInput
        label={t('headingText')}
        value={block.text[locale] ?? ''}
        placeholder={fallback(block.text)}
        dir={dir}
        maxLength={200}
        onChange={(value) => update({ text: setLocalizedText(block.text, locale, value) }, key('text'))}
      />
      <div className="flex flex-wrap gap-4">
        <Field label={t('level')}>
          <select value={block.level} onChange={(event) => update({ level: Number(event.target.value) as 1 | 2 | 3 })} className={inputClass}>
            {([1, 2, 3] as const).map((level) => (
              <option key={level} value={level}>
                {t(`levels.${level}`)}
              </option>
            ))}
          </select>
        </Field>
        <AlignField value={block.align} onChange={(align) => update({ align })} />
      </div>
    </div>
  );
}

function TextFields({ block }: { block: Of<'text'> }) {
  const t = useTranslations('Admin.email.designer');
  const { doc, locale, update, dir, key } = useBlock(block);
  const own = block.content[locale];
  const picked = pickLocalized(block.content, locale, doc.defaultLocale, isRichDocEmpty);
  const showingFallback = (!own || isRichDocEmpty(own)) && picked && picked.locale !== locale;
  return (
    <div className="space-y-2">
      {showingFallback && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>{t('notTranslated', { language: picked.locale.toUpperCase() })}</span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => update({ content: setLocalizedDoc(block.content, locale, picked.value) })}
          >
            {t('copyFrom', { language: picked.locale.toUpperCase() })}
          </button>
        </div>
      )}
      <RichTextField
        key={`${block.id}-${locale}`}
        label={t('blocks.text')}
        value={own ?? null}
        dir={dir}
        brandColor={doc.theme.brandColor}
        onChange={(next: RichDoc) => update({ content: setLocalizedDoc(block.content, locale, next) }, key('content'))}
      />
    </div>
  );
}

function ImageFields({ block }: { block: Of<'image'> }) {
  const t = useTranslations('Admin.email.designer');
  const { locale, update, fallback, dir, key } = useBlock(block);
  return (
    <div className="space-y-3">
      <ImageField label={t('fields.imageUrl')} hint={block.src ? undefined : t('fields.chooseImage')} value={block.src} onChange={(src) => update({ src })} />
      <TaggedInput
        label={t('fields.alt')}
        hint={t('fields.altHint')}
        value={block.alt[locale] ?? ''}
        placeholder={fallback(block.alt)}
        dir={dir}
        maxLength={200}
        onChange={(value) => update({ alt: setLocalizedText(block.alt, locale, value) }, key('alt'))}
      />
      <LinkField label={t('fields.linkOptional')} optional value={block.href ?? ''} onChange={(href) => update({ href: href || null }, `${block.id}.href`)} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label={`${t('fields.width')}: ${block.width}%`}>
          <input type="range" min={10} max={100} step={5} value={block.width} onChange={(event) => update({ width: Number(event.target.value) }, `${block.id}.width`)} className="mt-2 w-48" />
        </Field>
        <AlignField value={block.align} onChange={(align) => update({ align })} />
      </div>
    </div>
  );
}

function ButtonFields({ block }: { block: Of<'button'> }) {
  const t = useTranslations('Admin.email.designer.fields');
  const { doc, locale, update, fallback, dir, key } = useBlock(block);
  return (
    <div className="space-y-3">
      <TaggedInput
        label={t('label')}
        value={block.label[locale] ?? ''}
        placeholder={fallback(block.label)}
        dir={dir}
        maxLength={80}
        onChange={(value) => update({ label: setLocalizedText(block.label, locale, value) }, key('label'))}
      />
      <LinkField label={t('link')} value={block.href} onChange={(href) => update({ href }, `${block.id}.href`)} />
      <div className="flex flex-wrap items-center gap-4">
        <ColorField label={t('color')} value={block.color} fallback={doc.theme.brandColor} onChange={(color) => update({ color })} resetLabel={t('useBrandColor')} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={block.fullWidth} onChange={(event) => update({ fullWidth: event.target.checked })} />
          {t('fullWidth')}
        </label>
        <AlignField value={block.align} onChange={(align) => update({ align })} />
      </div>
    </div>
  );
}

function ProductSummary({ product, locale }: { product: CatalogProduct; locale: string }) {
  return (
    <span className="flex items-center gap-3">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a thumbnail from the shop's own storage
        <img src={product.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
      ) : (
        <span className="h-10 w-10 rounded bg-stone-200" aria-hidden />
      )}
      <span>
        <span className="block font-medium">{product.name}</span>
        <span className="block text-xs text-stone-600">
          {formatPrice(product.priceCents, product.currency, locale)}
          {product.extras.length ? ` · ${product.extras.join(' · ')}` : ''}
        </span>
      </span>
    </span>
  );
}

function ProductFields({ block }: { block: Of<'product'> }) {
  const t = useTranslations('Admin.email.designer');
  const tCampaign = useTranslations('Email.campaign');
  const { catalog, addToCatalog, searchProducts } = useDesigner();
  const { locale, update, fallback, dir, key } = useBlock(block);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogProduct[] | null>(null);
  const chosen = catalog.find((product) => product.id === block.productId);
  const text = query.trim();

  // Search as the owner types, a moment after they stop.
  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchProducts(text);
      if (cancelled) return;
      addToCatalog(found);
      setResults(found);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, searchProducts, addToCatalog]);

  // An empty search box shows the first page of the catalog again.
  const list = text ? (results ?? catalog) : catalog;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-sm font-medium">{t('fields.product')}</span>
        {chosen ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm">
            <ProductSummary product={chosen} locale={locale} />
          </div>
        ) : (
          <p className="text-xs text-amber-800">{block.productId ? t('fields.productMissing') : t('fields.chooseProduct')}</p>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <input type="search" value={query} placeholder={t('fields.searchProducts')} aria-label={t('fields.searchProducts')} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} ps-8`} />
        </div>
        <ul className="max-h-56 divide-y divide-stone-100 overflow-y-auto rounded-md border border-border bg-white text-sm">
          {list.length === 0 && <li className="px-3 py-2 text-stone-500">{t('fields.noProducts')}</li>}
          {list.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                aria-pressed={product.id === block.productId}
                onClick={() => update({ productId: product.id })}
                className={`block w-full px-3 py-2 text-start hover:bg-stone-50 ${product.id === block.productId ? 'bg-emerald-50' : ''}`}
              >
                <ProductSummary product={product} locale={locale} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={block.showPrice} onChange={(event) => update({ showPrice: event.target.checked })} />
        {t('fields.showPrice')}
      </label>
      <TaggedInput
        label={t('fields.buttonLabel')}
        hint={t('fields.leaveEmptyFor', { text: tCampaign('viewProduct') })}
        value={block.buttonLabel[locale] ?? ''}
        placeholder={fallback(block.buttonLabel) ?? tCampaign('viewProduct')}
        dir={dir}
        maxLength={80}
        onChange={(value) => update({ buttonLabel: setLocalizedText(block.buttonLabel, locale, value) }, key('buttonLabel'))}
      />
      <AlignField value={block.align} onChange={(align) => update({ align })} />
    </div>
  );
}

function DiscountFields({ block }: { block: Of<'discount'> }) {
  const t = useTranslations('Admin.email.designer');
  const tCampaign = useTranslations('Email.campaign');
  const { data } = useDesigner();
  const { locale, update, fallback, dir, key } = useBlock(block);
  const known = data.discounts.some((discount) => discount.code === block.code);
  return (
    <div className="space-y-3">
      {data.discounts.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('fields.noDiscounts')}</p>
      ) : (
        <Field label={t('fields.discount')}>
          <select value={known ? block.code : ''} onChange={(event) => update({ code: event.target.value })} className={inputClass}>
            <option value="" disabled>
              {t('fields.chooseDiscount')}
            </option>
            {data.discounts.map((discount) => (
              <option key={discount.code} value={discount.code}>
                {discount.status === 'scheduled' ? t('fields.discountScheduled', { code: discount.code }) : discount.code}
                {data.locales[locale]?.discountLabels[discount.code] ? ` · ${data.locales[locale].discountLabels[discount.code]}` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      {block.code && !known && <p className="text-xs text-amber-800">{t('fields.discountMissing', { code: block.code })}</p>}
      <TaggedInput
        label={t('fields.title')}
        hint={t('fields.leaveEmptyFor', { text: tCampaign('discountTitle') })}
        value={block.title[locale] ?? ''}
        placeholder={fallback(block.title) ?? tCampaign('discountTitle')}
        dir={dir}
        maxLength={200}
        onChange={(value) => update({ title: setLocalizedText(block.title, locale, value) }, key('title'))}
      />
      <TaggedInput
        label={t('fields.note')}
        hint={t('fields.leaveEmptyFor', { text: tCampaign('discountHint') })}
        value={block.note[locale] ?? ''}
        placeholder={fallback(block.note) ?? tCampaign('discountHint')}
        dir={dir}
        maxLength={300}
        multiline
        onChange={(value) => update({ note: setLocalizedText(block.note, locale, value) }, key('note'))}
      />
    </div>
  );
}

function DividerFields({ block }: { block: Of<'divider'> }) {
  const t = useTranslations('Admin.email.designer.fields');
  const { update } = useBlock(block);
  return <ColorField label={t('color')} value={block.color} fallback="#e7e5e4" onChange={(color) => update({ color })} resetLabel={t('defaultColor')} />;
}

function SpacerFields({ block }: { block: Of<'spacer'> }) {
  const t = useTranslations('Admin.email.designer.fields');
  const { update } = useBlock(block);
  return (
    <Field label={`${t('height')}: ${block.height}px`}>
      <input type="range" min={8} max={80} step={4} value={block.height} onChange={(event) => update({ height: Number(event.target.value) }, `${block.id}.height`)} className="mt-2 w-48" />
    </Field>
  );
}

/** Layout and phone behaviour; the columns' own blocks are edited in the canvas. */
export function ColumnsSettings({ block }: { block: ColumnsBlock }) {
  const t = useTranslations('Admin.email.designer.fields');
  const { edit } = useDesigner();
  const { update } = useBlock(block as Of<'columns'>);
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Field label={t('layout')}>
        <select value={block.layout} onChange={(event) => edit((doc) => setColumnsLayout(doc, block.id, event.target.value as ColumnsBlock['layout']))} className={inputClass}>
          {COLUMN_LAYOUTS.map((layout) => (
            <option key={layout} value={layout}>
              {t(`layouts.${layout}`)}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={block.stackOnMobile} onChange={(event) => update({ stackOnMobile: event.target.checked })} />
        {t('stackOnMobile')}
      </label>
    </div>
  );
}

/** The editor for one leaf block. */
export function LeafFields({ block }: { block: LeafBlock }) {
  switch (block.type) {
    case 'heading':
      return <HeadingFields block={block} />;
    case 'text':
      return <TextFields block={block} />;
    case 'image':
      return <ImageFields block={block} />;
    case 'button':
      return <ButtonFields block={block} />;
    case 'product':
      return <ProductFields block={block} />;
    case 'discount':
      return <DiscountFields block={block} />;
    case 'divider':
      return <DividerFields block={block} />;
    case 'spacer':
      return <SpacerFields block={block} />;
  }
}
