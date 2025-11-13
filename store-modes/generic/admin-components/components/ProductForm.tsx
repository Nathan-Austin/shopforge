'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { StoreProduct, Category, StoreBrand } from '@/components/store/types';
import ImageUploader from './ImageUploader';

interface ProductFormProps {
  product?: StoreProduct & { id?: string | number };
  categories: Category[];
  brands: StoreBrand[];
  onSubmit: (formData: FormData) => Promise<{ error?: string; success?: string; productId?: string }>;
  onDelete?: (formData: FormData) => Promise<{ error?: string; success?: string }>;
  successRedirectPath: string;
}

const CURRENCIES = ['GBP', 'EUR', 'USD'];

export default function ProductForm({
  product,
  categories,
  brands,
  onSubmit,
  onDelete,
  successRedirectPath
}: ProductFormProps) {
  const t = useTranslations('Admin');
  const router = useRouter();
  const [imageUrl, setImageUrl] = useState(product?.image_url || '');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const storeMode = process.env.NEXT_PUBLIC_STORE_MODE === 'multi' ? 'multi' : 'single';
  const defaultBrandId = product?.brand?.id ?? brands[0]?.id;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    const formData = new FormData(event.currentTarget);
    formData.set('image_url', imageUrl || '');
    if (storeMode === 'single' && defaultBrandId) {
      formData.set('brand_id', String(defaultBrandId));
    }

    startTransition(async () => {
      const result = await onSubmit(formData);
      if (result?.error) {
        setMessage({ type: 'error', text: result.error });
      } else {
        setMessage({ type: 'success', text: t('form.saved') });
        router.push(successRedirectPath);
      }
    });
  };

  const handleDelete = () => {
    if (!onDelete || !product?.id) return;
    if (!confirm(t('form.deleteConfirm'))) return;
    const formData = new FormData();
    formData.set('product_id', String(product.id));
    startTransition(async () => {
      const result = await onDelete(formData);
      if (result?.error) {
        setMessage({ type: 'error', text: result.error });
      } else {
        router.push(successRedirectPath);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="product_id" value={product?.id ?? ''} />
      <input type="hidden" name="image_url" value={imageUrl} readOnly />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-secondary">{t('form.name')}</label>
            <input
              name="name"
              defaultValue={product?.name}
              className="w-full rounded-xl border border-border bg-white px-4 py-2"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-secondary">{t('form.slug')}</label>
            <input
              name="slug"
              defaultValue={product?.slug}
              className="w-full rounded-xl border border-border bg-white px-4 py-2"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">{t('form.price')}</label>
              <input
                name="price_cents"
                type="number"
                min={0}
                defaultValue={product?.price_cents ?? 0}
                className="w-full rounded-xl border border-border bg-white px-4 py-2"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">{t('form.currency')}</label>
              <select
                name="currency"
                className="w-full rounded-xl border border-border bg-white px-4 py-2"
                defaultValue={product?.currency ?? 'GBP'}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-secondary">{t('form.description')}</label>
            <textarea
              name="description"
              defaultValue={product?.description}
              rows={5}
              className="w-full rounded-xl border border-border bg-white px-4 py-2"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-secondary">{t('form.category')}</label>
            <select
              name="category_id"
              defaultValue={product?.category?.id ?? ''}
              className="w-full rounded-xl border border-border bg-white px-4 py-2"
            >
              <option value="">{t('form.selectCategory')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          {storeMode === 'multi' ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">{t('form.brand')}</label>
              <select
                name="brand_id"
                defaultValue={product?.brand?.id ?? ''}
                className="w-full rounded-xl border border-border bg-white px-4 py-2"
              >
                <option value="">{t('form.selectBrand')}</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input type="hidden" name="brand_id" value={defaultBrandId ?? ''} />
          )}
        </div>

        <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-text-secondary">{t('form.images')}</p>
          <ImageUploader value={imageUrl} onChange={setImageUrl} />
        </div>
      </div>

      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-green-200 bg-green-50 text-green-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center rounded-full bg-roh-flag-green px-6 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          {product ? t('form.updateProduct') : t('form.createProduct')}
        </button>

        {onDelete && product?.id && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="text-sm font-semibold text-red-600 hover:underline"
          >
            {t('form.deleteProduct')}
          </button>
        )}
      </div>
    </form>
  );
}
