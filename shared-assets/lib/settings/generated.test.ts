import { describe, expect, it } from 'vitest';

import { GENERATED_CONFIG } from './generated';
import { settingFallback, STORE_SETTING_SCHEMAS } from './schema';

/**
 * This shop's own generated files, against the schemas that fall back to
 * them. A shop runs on these until its owner saves a setting, and a
 * mismatch would be silent: the setting would quietly become the shipped
 * default instead of what the shop was generated with — a store built
 * with --shipping=stripe would collect the address on its own page.
 */
describe('the generated configuration', () => {
  it('holds a checkout setting the schema accepts', () => {
    const parsed = STORE_SETTING_SCHEMAS.checkout.safeParse(GENERATED_CONFIG.checkout);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('holds an auth setting the schema accepts', () => {
    const parsed = STORE_SETTING_SCHEMAS.auth.safeParse(GENERATED_CONFIG.auth);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('is what the auth setting falls back to', () => {
    const generated = GENERATED_CONFIG.auth as { customerSignIn: string; adminMfa: string };
    expect(settingFallback('auth', { generated: GENERATED_CONFIG })).toEqual(generated);
  });

  it('is what the checkout setting falls back to', () => {
    const generated = GENERATED_CONFIG.checkout as { shippingAddress: string; allowedCountries: string[] };
    const fallback = settingFallback('checkout', { generated: GENERATED_CONFIG });
    expect(fallback.shippingAddress).toBe(generated.shippingAddress);
    expect([...fallback.allowedCountries]).toEqual([...generated.allowedCountries].sort());
  });
});
