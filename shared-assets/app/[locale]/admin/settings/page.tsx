import { getTranslations } from 'next-intl/server';

import { countriesByName } from '@/lib/checkout/countries';
import { availableProductFields, PRODUCT_FIELD_GROUPS } from '@/lib/products/catalogue';
import { STORE_SETTING_SCHEMAS, type StoreSettingKey } from '@/lib/settings/schema';
import { getHeatScale, getStoreSetting } from '@/lib/settings/store';
import {
  saveAuthSettings,
  saveCheckoutSettings,
  saveHeatSettings,
  saveProductFieldSettings,
  saveShippingSettings,
  saveShopSettings
} from '../actions/storeSettings';
import AuthSettingsForm from '../components/AuthSettingsForm';
import CheckoutSettingsForm from '../components/CheckoutSettingsForm';
import HeatSettingsForm from '../components/HeatSettingsForm';
import ProductFieldsForm from '../components/ProductFieldsForm';
import ShippingSettingsForm from '../components/ShippingSettingsForm';
import ShopSettingsForm from '../components/ShopSettingsForm';
import { requireShopOwner } from '../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Store settings, one section per area (decided 2026-11-19). "Shop",
 * "Checkout" and "Sign-in and security" so far; the order in which the
 * rest arrive is in docs/single-codebase-plan.md. Email has its own
 * settings under /admin/email/settings.
 */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.settings' });

  // Which sections have a row of their own, read fresh (not through the
  // cache) so each hint is right straight after a save.
  const keys: StoreSettingKey[] = ['shop', 'checkout', 'auth', 'product_fields', 'heat', 'shipping'];
  const { data: rows } = await supabase.from('store_settings').select('key, value').in('key', keys);
  const isSaved = (key: StoreSettingKey) => {
    const row = rows?.find((candidate) => candidate.key === key);
    return row ? STORE_SETTING_SCHEMAS[key].safeParse(row.value).success : false;
  };

  const shop = await getStoreSetting('shop');
  const checkout = await getStoreSetting('checkout');
  const auth = await getStoreSetting('auth');
  const productFields = await getStoreSetting('product_fields');
  // Null in a shop whose store mode does not track heat; it gets no section.
  const heat = await getHeatScale();
  const shipping = await getStoreSetting('shipping');

  // Every field this shop could offer, grouped for the picker.
  const available = availableProductFields(shop.mode);
  const fieldGroups = PRODUCT_FIELD_GROUPS.map((group) => ({
    group,
    fields: available.filter((field) => field.group === group.key)
  })).filter((entry) => entry.fields.length > 0);

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
        currency={shop.currency}
        mode={shop.mode}
        logoUrl={shop.logoUrl}
        locale={locale}
        fromDefault={!isSaved('shop')}
      />
      <CheckoutSettingsForm
        save={saveCheckoutSettings.bind(null, { locale })}
        shippingAddress={checkout.shippingAddress}
        allowedCountries={checkout.allowedCountries}
        countries={countriesByName(locale)}
        fromDefault={!isSaved('checkout')}
      />
      <ShippingSettingsForm
        save={saveShippingSettings.bind(null, { locale })}
        shipping={shipping}
        countries={countriesByName(locale)}
        currency={shop.currency}
        fromDefault={!isSaved('shipping')}
      />
      <AuthSettingsForm
        save={saveAuthSettings.bind(null, { locale })}
        customerSignIn={auth.customerSignIn}
        adminMfa={auth.adminMfa}
        fromDefault={!isSaved('auth')}
      />
      <ProductFieldsForm
        save={saveProductFieldSettings.bind(null, { locale })}
        groups={fieldGroups}
        keys={productFields.keys}
        fromDefault={!isSaved('product_fields')}
      />
      {heat && (
        <HeatSettingsForm
          save={saveHeatSettings.bind(null, { locale })}
          scale={heat}
          fromDefault={!isSaved('heat')}
        />
      )}
    </div>
  );
}
