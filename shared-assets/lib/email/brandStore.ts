import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_LOCALE } from '@/i18n/config';
import { DEFAULT_EMAIL_BRAND, EMAIL_BRAND_KEY, emailBrandOrDefault, type EmailBrand } from './brand';
import type { TransactionalOptions } from './layout';

/**
 * The email brand in the database: one row of store_settings. Reading is
 * lenient on purpose (see emailBrandOrDefault) and never throws — a receipt
 * must go out even if the brand row is missing or broken — so a read
 * failure means the default brand, with the error in the server log.
 */

export interface LoadedEmailBrand {
  brand: EmailBrand;
  /** False when the shop has never saved a brand: the defaults are in use. */
  stored: boolean;
}

export async function loadEmailBrand(supabase: SupabaseClient): Promise<LoadedEmailBrand> {
  const { data, error } = await supabase.from('store_settings').select('value').eq('key', EMAIL_BRAND_KEY).maybeSingle();
  if (error) {
    console.error('Could not read the email brand; sending with the defaults:', error.message);
    return { brand: DEFAULT_EMAIL_BRAND, stored: false };
  }
  if (!data) return { brand: DEFAULT_EMAIL_BRAND, stored: false };
  return { brand: emailBrandOrDefault(data.value), stored: true };
}

/** Everything a transactional renderer wants besides the order: the brand, the shop's address, the fallback locale. */
export async function transactionalOptions(supabase: SupabaseClient): Promise<TransactionalOptions> {
  const { brand } = await loadEmailBrand(supabase);
  return {
    brand,
    shopUrl: process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || null,
    defaultLocale: DEFAULT_LOCALE
  };
}

export type SaveEmailBrandResult = { ok: true } | { ok: false; message: string };

/** Writes the brand as the signed-in owner; RLS refuses anyone else. */
export async function saveEmailBrand(supabase: SupabaseClient, brand: EmailBrand, userId: string | null): Promise<SaveEmailBrandResult> {
  const { error } = await supabase
    .from('store_settings')
    .upsert({ key: EMAIL_BRAND_KEY, value: brand, updated_by: userId }, { onConflict: 'key' });
  return error ? { ok: false, message: error.message } : { ok: true };
}
