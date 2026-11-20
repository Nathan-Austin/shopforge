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

import { COUNTRY_CODES, isCountryCode } from '@/lib/checkout/countries';

/** Shown wherever a shop has no name at all. */
export const DEFAULT_SHOP_NAME = 'Our shop';

export const SHOP_NAME_MAX = 80;

/**
 * Whether the shop sells its own products (single) or carries other
 * makers' (multi). Multi makes a brand required on every product.
 */
export const BRAND_MODES = ['single', 'multi'] as const;

/** Who asks the customer for the delivery address. */
export const CHECKOUT_ADDRESS_COLLECTORS = ['form', 'stripe'] as const;

/** How customers sign in. The shop owner always has a password. */
export const CUSTOMER_SIGN_IN_METHODS = ['password', 'otp'] as const;

/** Whether the admin asks for an authenticator code as well as the password. */
export const ADMIN_MFA_MODES = ['required', 'off'] as const;

/** Where a shop delivers until it says otherwise. */
export const DEFAULT_ALLOWED_COUNTRIES = ['DE', 'AT', 'NL', 'BE', 'FR', 'IE', 'GB'];

export const STORE_SETTING_SCHEMAS = {
  shop: z.object({
    name: z.string().trim().min(1, { message: 'Enter a name' }).max(SHOP_NAME_MAX),
    brands: z.enum(BRAND_MODES)
  }),
  checkout: z.object({
    shippingAddress: z.enum(CHECKOUT_ADDRESS_COLLECTORS),
    // Deduplicated and sorted, so the list a shop stores does not depend on
    // the order the admin's checkboxes happened to be in.
    allowedCountries: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .refine(isCountryCode, { message: 'Not a country code' })
      )
      .min(1, { message: 'Pick at least one country' })
      .max(COUNTRY_CODES.length)
      .transform((codes) => [...new Set(codes)].sort())
  }),
  auth: z.object({
    customerSignIn: z.enum(CUSTOMER_SIGN_IN_METHODS),
    adminMfa: z.enum(ADMIN_MFA_MODES)
  }),
  product_fields: z.object({
    // Catalogue keys. Which keys exist is the product catalogue's business
    // (lib/products/catalogue.ts), not this file's: a key this shop has no
    // field for is simply ignored when the list is read, so a setting saved
    // in a chilli shop cannot break a generic one.
    keys: z
      .array(z.string().trim().regex(/^[a-z][a-z0-9_]*$/, { message: 'Not a field key' }))
      .max(200)
      .transform((keys) => [...new Set(keys)])
  })
};

export type StoreSettingKey = keyof typeof STORE_SETTING_SCHEMAS;
export type StoreSettings = { [K in StoreSettingKey]: z.infer<(typeof STORE_SETTING_SCHEMAS)[K]> };

/** The environment a fallback may read; process.env in the shop, a fixture in tests. */
export type SettingsEnv = Partial<Record<string, string | undefined>>;

/**
 * The shop's generated configuration, as much of it as the fallbacks read.
 * Each entry is whatever the generated file holds and is checked here
 * before it is believed, so this file never has to match the shape of a
 * file a developer may have edited by hand. ./generated wires the real
 * files in; a test passes a fixture.
 */
export type GeneratedConfig = {
  checkout?: unknown;
  auth?: unknown;
  productFields?: unknown;
};

/** Where a fallback may look: the environment and the generated files. */
export type SettingsSources = {
  env?: SettingsEnv;
  generated?: GeneratedConfig;
};

const FALLBACKS: { [K in StoreSettingKey]: (sources: SettingsSources) => StoreSettings[K] } = {
  shop: ({ env = {} }) => ({
    name: env.NEXT_PUBLIC_SHOP_NAME?.trim() || DEFAULT_SHOP_NAME,
    // Exactly the reading the product actions used to do themselves:
    // anything but 'multi', including unset, means single.
    brands: env.NEXT_PUBLIC_STORE_MODE === 'multi' ? 'multi' : 'single'
  }),
  checkout: ({ generated = {} }) => {
    // The generated src/lib/checkout/config.ts, if it still says something
    // this version understands; the shipped defaults if it does not.
    const parsed = STORE_SETTING_SCHEMAS.checkout.safeParse(generated.checkout);
    return parsed.success
      ? parsed.data
      : { shippingAddress: 'form', allowedCountries: [...DEFAULT_ALLOWED_COUNTRIES].sort() };
  },
  auth: ({ generated = {} }) => {
    // The generated src/lib/auth/config.ts. The default when it cannot be
    // read is the safe pair, and the generator's own: a password to sign
    // in with, and a second factor on the admin.
    const parsed = STORE_SETTING_SCHEMAS.auth.safeParse(generated.auth);
    return parsed.success ? parsed.data : { customerSignIn: 'password', adminMfa: 'required' };
  },
  product_fields: ({ generated = {} }) => {
    // PRODUCT_FIELD_KEYS from the generated src/lib/products/config.ts,
    // which the generator already filtered to this shop's store mode.
    const parsed = STORE_SETTING_SCHEMAS.product_fields.safeParse({ keys: generated.productFields });
    return parsed.success ? parsed.data : { keys: [] };
  }
};

export function settingFallback<K extends StoreSettingKey>(key: K, sources: SettingsSources): StoreSettings[K] {
  return FALLBACKS[key](sources);
}

/**
 * The setting in effect: the stored value where it is valid, the fallback
 * where it is missing or broken, field by field, so one bad field never
 * takes the others down with it.
 */
export function resolveSetting<K extends StoreSettingKey>(
  key: K,
  stored: unknown,
  sources: SettingsSources
): StoreSettings[K] {
  const fallback = settingFallback(key, sources);
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
