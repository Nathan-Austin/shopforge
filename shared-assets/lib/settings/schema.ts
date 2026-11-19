/**
 * Store settings: the typed shape of each `store_settings` row, and what a
 * shop uses before its owner has saved one.
 *
 * Pure, so it is unit tested. ./store reads and writes the rows; this file
 * only says what a row may contain and how a missing or broken one falls
 * back to the shop's generated configuration and environment, so a freshly
 * generated shop works before anyone opens /admin/settings.
 *
 * Adding a setting: a schema here, its fallback, and a section on the
 * settings page. Plan: docs/single-codebase-plan.md.
 */

import { z } from 'zod';

/** Shown wherever a shop has no name at all. */
export const DEFAULT_SHOP_NAME = 'Our shop';

export const SHOP_NAME_MAX = 80;

export const STORE_SETTING_SCHEMAS = {
  shop: z.object({
    name: z.string().trim().min(1, { message: 'Enter a name' }).max(SHOP_NAME_MAX)
  })
};

export type StoreSettingKey = keyof typeof STORE_SETTING_SCHEMAS;
export type StoreSettings = { [K in StoreSettingKey]: z.infer<(typeof STORE_SETTING_SCHEMAS)[K]> };

/** The environment a fallback may read; process.env in the shop, a fixture in tests. */
export type SettingsEnv = Partial<Record<string, string | undefined>>;

const FALLBACKS: { [K in StoreSettingKey]: (env: SettingsEnv) => StoreSettings[K] } = {
  shop: (env) => ({ name: env.NEXT_PUBLIC_SHOP_NAME?.trim() || DEFAULT_SHOP_NAME })
};

export function settingFallback<K extends StoreSettingKey>(key: K, env: SettingsEnv): StoreSettings[K] {
  return FALLBACKS[key](env);
}

/**
 * The setting in effect: the stored value where it is valid, the fallback
 * where it is missing or broken, field by field, so one bad field never
 * takes the others down with it.
 */
export function resolveSetting<K extends StoreSettingKey>(key: K, stored: unknown, env: SettingsEnv): StoreSettings[K] {
  const fallback = settingFallback(key, env);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return fallback;

  const schema = STORE_SETTING_SCHEMAS[key];
  const whole = schema.safeParse({ ...fallback, ...(stored as object) });
  if (whole.success) return whole.data as StoreSettings[K];

  const result: Record<string, unknown> = { ...fallback };
  for (const [field, fieldSchema] of Object.entries(schema.shape)) {
    const value = (stored as Record<string, unknown>)[field];
    const parsed = (fieldSchema as z.ZodType).safeParse(value);
    if (parsed.success) result[field] = parsed.data;
  }
  return result as StoreSettings[K];
}

export type SettingIssue = { path: string; message: string };

/** Strict: the admin's save path. */
export function parseSetting<K extends StoreSettingKey>(
  key: K,
  input: unknown
): { ok: true; value: StoreSettings[K] } | { ok: false; issues: SettingIssue[] } {
  const parsed = STORE_SETTING_SCHEMAS[key].safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as StoreSettings[K] };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
  };
}

/** The cache tag a setting is read under and revalidated by. */
export function storeSettingTag(key: StoreSettingKey): string {
  return `store-settings:${key}`;
}
