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

  it('holds a heat scale the schema accepts, in a shop that tracks heat', () => {
    // A generic shop has no scale at all, and getHeatScale() answers null
    // for it without ever reading the setting.
    if (!GENERATED_CONFIG.heat) {
      expect(GENERATED_CONFIG.heat).toBeNull();
      return;
    }
    const parsed = STORE_SETTING_SCHEMAS.heat.safeParse(GENERATED_CONFIG.heat);
    expect(parsed.error?.issues ?? []).toEqual([]);

    // The shop's own scale, not the shipped ten-point default: a shop
    // generated with SHOPFORGE_HEAT_MAX=20 must come up on twenty.
    const generated = GENERATED_CONFIG.heat as { max: number; display: string };
    const fallback = settingFallback('heat', { generated: GENERATED_CONFIG });
    expect(fallback.max).toBe(generated.max);
    expect(fallback.display).toBe(generated.display);
  });

  it('is what the shipping setting falls back to', () => {
    const generated = GENERATED_CONFIG.shipping as {
      flatRateCents: number;
      label: string;
      box: { weightGrams: number };
    };
    const fallback = settingFallback('shipping', { generated: GENERATED_CONFIG });
    expect(fallback.flatRateCents).toBe(generated.flatRateCents);
    expect(fallback.label).toBe(generated.label);
    expect(fallback.boxWeightGrams).toBe(generated.box.weightGrams);
  });

  it('is what the checkout setting falls back to', () => {
    const generated = GENERATED_CONFIG.checkout as { shippingAddress: string; allowedCountries: string[] };
    const fallback = settingFallback('checkout', { generated: GENERATED_CONFIG });
    expect(fallback.shippingAddress).toBe(generated.shippingAddress);
    expect([...fallback.allowedCountries]).toEqual([...generated.allowedCountries].sort());
  });
});
