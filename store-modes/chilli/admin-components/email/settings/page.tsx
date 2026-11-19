import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { loadEmailBrand } from '@/lib/email/brandStore';
import { getEmailConfig, resolveEmailConfig } from '@/lib/email/config';
import { renderOrderConfirmation } from '@/lib/email/orderConfirmation';
import { activeCampaignProviderName, isCampaignProviderName } from '@/lib/email/providers/registry';
import type { CampaignProviderName } from '@/lib/email/providers/types';
import { saveEmailBrand } from '../../actions/emailBrand';
import {
  chooseEmailProvider,
  clearEmailProviderKey,
  saveEmailProviderKey
} from '../../actions/emailProviderKey';
import EmailBrandForm from '../../components/EmailBrandForm';
import EmailPreview from '../../components/EmailPreview';
import EmailTabs from '../../components/EmailTabs';
import ProviderChoiceForm from '../../components/ProviderChoiceForm';
import ProviderKeyForm, { type StoredProviderKey } from '../../components/ProviderKeyForm';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

interface ProviderKeyRow {
  provider: string;
  last_four: string | null;
  set_at: string;
  verified_at: string | null;
  is_active: boolean;
}

const PROVIDERS = ['resend', 'mailchimp'] as const;

/**
 * Which provider sends what, the keys, and the brand every email wears.
 *
 * No key is ever read here. All this page knows is what email_provider_keys
 * holds — that one is set, when, and its last four characters — because
 * get_email_provider_key is the server's alone.
 */
export default async function AdminEmailSettingsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.email.settings' });

  const { data } = await supabase
    .from('email_provider_keys')
    .select('provider, last_four, set_at, verified_at, is_active');
  const rows = ((data as ProviderKeyRow[] | null) ?? []).filter((row) => isCampaignProviderName(row.provider));
  const byProvider = new Map(rows.map((row) => [row.provider as CampaignProviderName, row]));

  // The environment wins at send time, so say so rather than letting the
  // owner wonder why a key they stored is not the one being used.
  const envKeys: Record<CampaignProviderName, boolean> = {
    resend: Boolean(getEmailConfig().apiKey),
    mailchimp: Boolean(process.env.MAILCHIMP_API_KEY?.trim())
  };
  const lockedByEnvironment = isCampaignProviderName(
    process.env.EMAIL_CAMPAIGN_PROVIDER?.trim().toLowerCase()
  );

  const activeProvider = await activeCampaignProviderName();
  const transactional = await resolveEmailConfig();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const available = PROVIDERS.filter((provider) => byProvider.has(provider) || envKeys[provider]);

  const stored = (provider: CampaignProviderName): StoredProviderKey | null => {
    const row = byProvider.get(provider);
    if (!row) return null;
    return {
      provider,
      lastFour: row.last_four,
      setAt: dateFormat.format(new Date(row.set_at)),
      isActive: row.is_active,
      fromEnvironment: envKeys[provider]
    };
  };

  const { brand } = await loadEmailBrand(supabase);
  const samplePreview = await sampleReceipt(locale, brand);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="mt-1 text-sm text-stone-600">{t('subheading')}</p>
      </div>

      <EmailTabs locale={locale} current="settings" />

      <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-semibold">{t('campaignProviderLabel')}</dt>
          <dd className="text-stone-700">{t(`providers.${activeProvider}`)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('transactionalLabel')}</dt>
          <dd className="text-stone-700">
            {transactional.provider === 'none' ? t('providerNone') : t('providers.resend')}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t('senderLabel')}</dt>
          <dd className="text-stone-700">{transactional.from ?? t('senderMissing')}</dd>
        </div>
      </dl>

      <p className="rounded-md border border-border bg-stone-50 px-3 py-2 text-sm text-stone-700">
        {t('transactionalNote')}
      </p>

      {!transactional.from && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('senderRequired')}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <EmailBrandForm save={saveEmailBrand.bind(null, { locale })} brand={brand} locales={LOCALES} />
        <div className="space-y-2">
          <h3 className="font-semibold">{t('brand.previewHeading')}</h3>
          <p className="text-sm text-stone-600">{t('brand.previewHint')}</p>
          <EmailPreview html={samplePreview} />
        </div>
      </div>

      <ProviderChoiceForm
        choose={chooseEmailProvider.bind(null, { locale })}
        active={activeProvider}
        available={available}
        lockedByEnvironment={lockedByEnvironment}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <ProviderKeyForm
            key={provider}
            provider={provider}
            save={saveEmailProviderKey.bind(null, { locale })}
            clear={clearEmailProviderKey.bind(null, { locale })}
            stored={stored(provider)}
            fromEnvironment={envKeys[provider]}
            canSend={provider === activeProvider}
          />
        ))}
      </div>

      {activeProvider === 'mailchimp' && (
        <p className="rounded-md border border-border bg-stone-50 px-3 py-2 text-sm text-stone-700">
          {t('mailchimpListNote')}
        </p>
      )}
    </div>
  );
}

/**
 * A receipt for an imaginary order, in the admin's language and the saved
 * brand, so the owner sees what a customer will get before anyone buys.
 */
async function sampleReceipt(locale: string, brand: Awaited<ReturnType<typeof loadEmailBrand>>['brand']): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'Email.confirmation' });
  const ts = await getTranslations({ locale, namespace: 'Admin.email.settings.brand' });
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || null;
  const reference = 'A1B2C3D4';
  const email = renderOrderConfirmation(
    {
      reference,
      currency: 'EUR',
      subtotalCents: 3400,
      shippingCents: 490,
      totalCents: 3890,
      shopName,
      items: [
        { productName: ts('sampleProductOne'), unitPriceCents: 1200, quantity: 2 },
        { productName: ts('sampleProductTwo'), unitPriceCents: 1000, quantity: 1 }
      ],
      shipping: { name: ts('sampleCustomer'), line1: ts('sampleStreet'), postalCode: '10115', city: 'Berlin', country: 'DE' },
      orderUrl: siteUrl ? `${siteUrl}/${locale}/account/orders` : 'https://example.com/account/orders'
    },
    {
      subject: t('subject', { shop: shopName, reference }),
      headline: t('headline'),
      orderLabel: t('order', { reference }),
      subtotal: t('subtotal'),
      shipping: t('shipping'),
      discount: t('discount'),
      total: t('total'),
      addressHeading: t('address'),
      viewOrder: t('viewOrder'),
      footer: t('footer')
    },
    locale,
    { brand, shopUrl: siteUrl, defaultLocale: DEFAULT_LOCALE }
  );
  return email.html;
}
