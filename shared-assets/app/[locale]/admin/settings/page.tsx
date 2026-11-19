import { getTranslations } from 'next-intl/server';

import { STORE_SETTING_SCHEMAS } from '@/lib/settings/schema';
import { getStoreSetting } from '@/lib/settings/store';
import { saveShopSettings } from '../actions/storeSettings';
import ShopSettingsForm from '../components/ShopSettingsForm';
import { requireShopOwner } from '../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Store settings, one section per area (decided 2026-11-19). Only "Shop"
 * so far; the order in which the rest arrive is in
 * docs/single-codebase-plan.md. Email has its own settings under
 * /admin/email/settings.
 */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.settings' });

  // Whether a row exists, read fresh (not through the cache) so the hint
  // is right straight after a save.
  const { data: row } = await supabase.from('store_settings').select('value').eq('key', 'shop').maybeSingle();
  const saved = row ? STORE_SETTING_SCHEMAS.shop.safeParse(row.value).success : false;
  const shop = await getStoreSetting('shop');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="mt-1 text-sm text-stone-600">{t('subheading')}</p>
      </div>
      <ShopSettingsForm save={saveShopSettings.bind(null, { locale })} name={shop.name} fromDefault={!saved} />
    </div>
  );
}
