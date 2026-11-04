import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { formatPrice } from '@/lib/format';
import { discountStatus } from '@/lib/discounts/rules';
import { DISCOUNT_COLUMNS, toDiscountCode, type DiscountRow } from '@/lib/discounts/service';
import {
  createDiscount,
  deleteDiscount,
  setDiscountActive,
  type DiscountActionResult
} from '../actions/discounts';
import DiscountForm from '../components/DiscountForm';
import { requireShopOwner } from '../lib/auth';

export const dynamic = 'force-dynamic';

/** Promo codes: create, see how they are doing, retire or delete them. */
export default async function AdminDiscountsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string; code?: string; detail?: string }>;
}) {
  const { locale } = await params;
  const { notice, code: noticeCode, detail } = await searchParams;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });

  // Owner's RLS: every code.
  const [{ data: rows }, { data: anyProduct }] = await Promise.all([
    supabase.from('discount_codes').select(DISCOUNT_COLUMNS).order('created_at', { ascending: false }),
    supabase.from('products').select('currency').limit(1).maybeSingle()
  ]);
  const codes = ((rows ?? []) as DiscountRow[]).map(toDiscountCode);
  const defaultCurrency = anyProduct?.currency ?? 'EUR';
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const create = createDiscount.bind(null, { locale });
  // These two are plain form actions; their outcome travels in the URL.
  async function toggle(formData: FormData) {
    'use server';
    const result: DiscountActionResult = await setDiscountActive({ locale }, formData);
    redirect(`/${locale}/admin/discounts?${noticeParams(result)}`);
  }
  async function remove(formData: FormData) {
    'use server';
    const result: DiscountActionResult = await deleteDiscount({ locale }, formData);
    redirect(`/${locale}/admin/discounts?${noticeParams(result)}`);
  }

  const banner = (() => {
    if (!notice) return null;
    if (notice === 'retired' || notice === 'reactivated' || notice === 'deleted') {
      return { ok: true, text: t(`discounts.${notice}`, { code: noticeCode ?? '' }) };
    }
    return { ok: false, text: t(`discounts.errors.${notice}`, { message: detail ?? '' }) };
  })();

  const describeValue = (code: (typeof codes)[number]) => {
    switch (code.kind) {
      case 'percent':
        return `${code.percentOff}%`;
      case 'amount':
        return `−${formatPrice(code.amountOffCents ?? 0, code.currency ?? defaultCurrency, locale)}`;
      case 'free_shipping':
        return t('discounts.kinds.free_shipping');
    }
  };

  const describeRestrictions = (code: (typeof codes)[number]) => {
    const parts: string[] = [];
    if (code.minSubtotalCents) {
      parts.push(
        t('discounts.minLabel', {
          amount: formatPrice(code.minSubtotalCents, code.currency ?? defaultCurrency, locale)
        })
      );
    }
    if (code.startsAt) parts.push(t('discounts.from', { date: dateFormat.format(new Date(code.startsAt)) }));
    if (code.endsAt) parts.push(t('discounts.until', { date: dateFormat.format(new Date(code.endsAt)) }));
    return parts.length ? parts.join(' · ') : t('discounts.noRestrictions');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('discounts.heading')}</h2>
        <p className="text-sm text-stone-600">{t('discounts.subheading')}</p>
      </div>

      {banner && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            banner.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {banner.text}
        </p>
      )}

      <DiscountForm action={create} defaultCurrency={defaultCurrency} />

      {codes.length === 0 ? (
        <p className="rounded-lg border border-border bg-white p-6 text-center text-stone-600">
          {t('discounts.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-600">
              <tr>
                <th className="px-3 py-2">{t('discounts.columns.code')}</th>
                <th className="px-3 py-2">{t('discounts.columns.value')}</th>
                <th className="px-3 py-2">{t('discounts.columns.restrictions')}</th>
                <th className="px-3 py-2">{t('discounts.columns.uses')}</th>
                <th className="px-3 py-2">{t('discounts.columns.status')}</th>
                <th className="px-3 py-2">{t('discounts.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {codes.map((code) => {
                const status = discountStatus(code);
                return (
                  <tr key={code.id}>
                    <td className="px-3 py-2 font-mono font-semibold">{code.code}</td>
                    <td className="px-3 py-2">{describeValue(code)}</td>
                    <td className="px-3 py-2 text-stone-600">{describeRestrictions(code)}</td>
                    <td className="px-3 py-2">
                      {code.maxRedemptions
                        ? t('discounts.usesOf', { count: code.redemptionCount, max: code.maxRedemptions })
                        : code.redemptionCount}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : status === 'scheduled'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-stone-100 text-stone-700'
                        }`}
                      >
                        {t(`discounts.status.${status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-3">
                        <form action={toggle}>
                          <input type="hidden" name="id" value={code.id} />
                          <input type="hidden" name="active" value={code.active ? 'false' : 'true'} />
                          <button type="submit" className="underline hover:text-emerald-700">
                            {code.active ? t('discounts.retire') : t('discounts.reactivate')}
                          </button>
                        </form>
                        {code.redemptionCount === 0 && (
                          <form action={remove}>
                            <input type="hidden" name="id" value={code.id} />
                            <button type="submit" className="text-red-700 underline">
                              {t('discounts.delete')}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function noticeParams(result: DiscountActionResult): string {
  const params = new URLSearchParams();
  if (result.ok) {
    params.set('notice', result.action);
    params.set('code', result.code);
  } else {
    params.set('notice', result.error);
    if (result.message) params.set('detail', result.message.slice(0, 200));
  }
  return params.toString();
}
