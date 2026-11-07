import { getTranslations } from 'next-intl/server';

import { getEmailConfig, resolveEmailConfig } from '@/lib/email/config';
import { clearEmailProviderKey, saveEmailProviderKey } from '../../actions/emailProviderKey';
import EmailTabs from '../../components/EmailTabs';
import ProviderKeyForm from '../../components/ProviderKeyForm';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

interface ProviderKeyRow {
  provider: string;
  last_four: string | null;
  set_at: string;
  verified_at: string | null;
}

/**
 * Which email provider is active, and the form for its key.
 *
 * The key itself is never read here. All this page knows is what
 * email_provider_keys holds — that one is set, when, and its last four
 * characters — because get_email_provider_key is the server's alone.
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
    .select('provider, last_four, set_at, verified_at')
    .eq('provider', 'resend')
    .maybeSingle();
  const row = (data as ProviderKeyRow | null) ?? null;

  // The environment wins at send time, so say so rather than letting the
  // owner wonder why a key they stored is not the one being used.
  const fromEnvironment = Boolean(getEmailConfig().apiKey);
  const resolved = await resolveEmailConfig();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="mt-1 text-sm text-stone-600">{t('subheading')}</p>
      </div>

      <EmailTabs locale={locale} current="settings" />

      <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t('providerLabel')}</dt>
          <dd className="text-stone-700">
            {resolved.provider === 'none' ? t('providerNone') : t('providerResend')}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t('senderLabel')}</dt>
          <dd className="text-stone-700">{resolved.from ?? t('senderMissing')}</dd>
        </div>
      </dl>

      {!resolved.from && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('senderRequired')}
        </p>
      )}

      <ProviderKeyForm
        save={saveEmailProviderKey.bind(null, { locale })}
        clear={clearEmailProviderKey.bind(null, { locale })}
        stored={row ? { lastFour: row.last_four, setAt: row.set_at } : null}
        fromEnvironment={fromEnvironment}
        formattedSetAt={row ? dateFormat.format(new Date(row.set_at)) : null}
      />
    </div>
  );
}
