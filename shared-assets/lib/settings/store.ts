import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { unstable_cache, updateTag } from 'next/cache';

import { GENERATED_CONFIG } from './generated';
import {
  parseSetting,
  resolveSetting,
  settingFallback,
  storeSettingTag,
  type SettingIssue,
  type SettingsSources,
  type StoreSettingKey,
  type StoreSettings
} from './schema';

/**
 * Reading and writing store settings.
 *
 * Reads are cached: settings are read on nearly every page (the shop name
 * is in the header and the page title), and the locale routing will read
 * them before any page runs, so a database round trip per request is not
 * an option. Each key is cached under its own tag and the tag is
 * expired when the owner saves, so a change shows on the next request.
 * The time limit is a safety net for a row edited outside the admin (the
 * SQL editor), not the way changes normally arrive.
 *
 * The read uses the anon key with no cookies: store_settings is readable by
 * everyone (0012), and a cached function must not depend on who is asking.
 *
 * Nothing here throws to the page. A database that cannot be reached, or a
 * shop with placeholder Supabase settings, gets the fallback from ./schema.
 */

const SAFETY_NET_SECONDS = 300;

function anonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The raw stored value, or null for no row. Throws on a read error so the error is not cached. */
async function readRow(key: StoreSettingKey): Promise<unknown> {
  const client = anonClient();
  if (!client) return null;
  const { data, error } = await client.from('store_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? null;
}

/** What a setting falls back to in this shop: its environment and its generated files. */
const SOURCES: SettingsSources = { env: process.env, generated: GENERATED_CONFIG };

export async function getStoreSetting<K extends StoreSettingKey>(key: K): Promise<StoreSettings[K]> {
  if (!anonClient()) return settingFallback(key, SOURCES);
  try {
    const cached = unstable_cache(() => readRow(key), ['store-settings', key], {
      tags: [storeSettingTag(key)],
      revalidate: SAFETY_NET_SECONDS
    });
    return resolveSetting(key, await cached(), SOURCES);
  } catch (error) {
    console.error(`Could not read the ${key} settings; using the shop's defaults:`, error instanceof Error ? error.message : error);
    return settingFallback(key, SOURCES);
  }
}

/** The shop's name, as customers see it. */
export async function getShopName(): Promise<string> {
  return (await getStoreSetting('shop')).name;
}

/** 'single': a product may carry no brand; 'multi': every product needs one. */
export async function getBrandMode(): Promise<StoreSettings['shop']['brands']> {
  return (await getStoreSetting('shop')).brands;
}

/** Who collects the delivery address, and where the shop delivers. */
export async function getCheckoutSettings(): Promise<StoreSettings['checkout']> {
  return getStoreSetting('checkout');
}

/** How customers sign in, and whether the admin asks for a second factor. */
export async function getAuthSettings(): Promise<StoreSettings['auth']> {
  return getStoreSetting('auth');
}

/** The catalogue keys this shop's admin manages. */
export async function getProductFieldKeys(): Promise<string[]> {
  return (await getStoreSetting('product_fields')).keys;
}

export type SaveSettingResult<K extends StoreSettingKey> =
  | { ok: true; value: StoreSettings[K] }
  | { ok: false; error: 'invalid'; issues: SettingIssue[] }
  | { ok: false; error: 'failed'; message: string };

/**
 * Validates and stores a setting as the signed-in owner (RLS refuses
 * anyone else), then drops the cached copy so the next request sees it.
 */
export async function saveStoreSetting<K extends StoreSettingKey>(
  supabase: SupabaseClient,
  key: K,
  input: unknown,
  userId: string | null
): Promise<SaveSettingResult<K>> {
  const parsed = parseSetting(key, input);
  if (!parsed.ok) return { ok: false, error: 'invalid', issues: parsed.issues };

  const { error } = await supabase
    .from('store_settings')
    .upsert({ key, value: parsed.value, updated_by: userId }, { onConflict: 'key' });
  if (error) return { ok: false, error: 'failed', message: error.message };

  // updateTag, not revalidateTag: this runs in a server action, and the
  // owner should see the new value on the very next page, not a stale one
  // while it refreshes in the background.
  updateTag(storeSettingTag(key));
  return { ok: true, value: parsed.value };
}
