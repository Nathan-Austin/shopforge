import { getTranslations } from 'next-intl/server';

import { countriesByName } from '@/lib/checkout/countries';
import { STORE_SETTING_SCHEMAS, type StoreSettingKey } from '@/lib/settings/schema';
import { getStoreSetting } from '@/lib/settings/store';
import { saveCheckoutSettings, saveShopSettings } from '../actions/storeSettings';
import CheckoutSettingsForm from '../components/CheckoutSettingsForm';
import ShopSettingsForm from '../components/ShopSettingsForm';
import { requireShopOwner } from '../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Store settings, one section per area (decided 2026-11-19). "Shop" and
 * "Checkout" so far; the order in which the rest arrive is in
 * docs/single-codebase-plan.md. Email has its own settings under
 * /admin/email/settings.
 */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.settings' });

  // Which sections have a row of their own, read fresh (not through the
  // cache) so each hint is right straight after a save.
  const keys: StoreSettingKey[] = ['shop', 'checkout'];
  const { data: rows } = await supabase.from('store_settings').select('key, value').in('key', keys);
  const isSaved = (key: StoreSettingKey) => {
    const row = rows?.find((candidate) => candidate.key === key);
    return row ? STORE_SETTING_SCHEMAS[key].safeParse(row.value).success : false;
  };

  const shop = await getStoreSetting('shop');
  const checkout = await getStoreSetting('checkout');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="mt-1 text-sm text-stone-600">{t('subheading')}</p>
      </div>
      <ShopSettingsForm
        save={saveShopSettings.bind(null, { locale })}
        name={shop.name}
        brands={shop.brands}
        fromDefault={!isSaved('shop')}
      />
      <CheckoutSettingsForm
        save={saveCheckoutSettings.bind(null, { locale })}
        shippingAddress={checkout.shippingAddress}
        allowedCountries={checkout.allowedCountries}
        countries={countriesByName(locale)}
        fromDefault={!isSaved('checkout')}
      />
    </div>
  );
}
