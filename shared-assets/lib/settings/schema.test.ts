import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALLOWED_COUNTRIES,
  DEFAULT_SHOP_NAME,
  parseSetting,
  resolveSetting,
  settingFallback,
  storeSettingTag
} from './schema';

describe('settingFallback', () => {
  it('takes the shop name and brand mode from the generated environment', () => {
    expect(settingFallback('shop', { env: { NEXT_PUBLIC_SHOP_NAME: ' Test Shop ' } })).toEqual({
      name: 'Test Shop',
      brands: 'single'
    });
    expect(settingFallback('shop', { env: { NEXT_PUBLIC_STORE_MODE: 'multi' } }).brands).toBe('multi');
    // Anything but 'multi' means single, as the product actions always read it.
    expect(settingFallback('shop', { env: { NEXT_PUBLIC_STORE_MODE: 'Multi' } }).brands).toBe('single');
  });

  it('has a name even with nothing configured', () => {
    expect(settingFallback('shop', {}).name).toBe(DEFAULT_SHOP_NAME);
    expect(settingFallback('shop', { env: { NEXT_PUBLIC_SHOP_NAME: '  ' } }).name).toBe(DEFAULT_SHOP_NAME);
  });

  it('takes the checkout settings from the generated config', () => {
    const generated = { checkout: { shippingAddress: 'stripe', allowedCountries: ['NL', 'BE'] } };
    expect(settingFallback('checkout', { generated })).toEqual({
      shippingAddress: 'stripe',
      allowedCountries: ['BE', 'NL']
    });
  });

  it('takes the sign-in method and MFA mode from the generated config', () => {
    const generated = { auth: { customerSignIn: 'otp', adminMfa: 'off' } };
    expect(settingFallback('auth', { generated })).toEqual({ customerSignIn: 'otp', adminMfa: 'off' });
  });

  it('falls back to a password and a second factor when the generated auth config is unusable', () => {
    const safe = { customerSignIn: 'password', adminMfa: 'required' };
    expect(settingFallback('auth', {})).toEqual(safe);
    expect(settingFallback('auth', { generated: { auth: { customerSignIn: 'magic-link' } } })).toEqual(safe);
  });

  it('ships a checkout default when the generated config is missing or unusable', () => {
    const shipped = { shippingAddress: 'form', allowedCountries: [...DEFAULT_ALLOWED_COUNTRIES].sort() };
    expect(settingFallback('checkout', {})).toEqual(shipped);
    expect(settingFallback('checkout', { generated: { checkout: { shippingAddress: 'post' } } })).toEqual(shipped);
    expect(settingFallback('checkout', { generated: { checkout: { allowedCountries: [] } } })).toEqual(shipped);
  });
});

describe('resolveSetting', () => {
  const sources = { env: { NEXT_PUBLIC_SHOP_NAME: 'From Env' } };

  it('prefers a saved value over the environment', () => {
    expect(resolveSetting('shop', { name: 'Saved Name', brands: 'multi' }, sources)).toEqual({
      name: 'Saved Name',
      brands: 'multi'
    });
  });

  it('falls back when nothing is saved', () => {
    expect(resolveSetting('shop', null, sources)).toEqual({ name: 'From Env', brands: 'single' });
    expect(resolveSetting('shop', undefined, sources)).toEqual({ name: 'From Env', brands: 'single' });
  });

  it('completes a shop row saved before the brand mode existed', () => {
    expect(resolveSetting('shop', { name: 'Saved Name' }, sources)).toEqual({ name: 'Saved Name', brands: 'single' });
  });

  it('falls back field by field when a saved value is broken', () => {
    expect(resolveSetting('shop', { name: '' }, sources).name).toBe('From Env');
    expect(resolveSetting('shop', { name: 42, brands: 'multi' }, sources)).toEqual({
      name: 'From Env',
      brands: 'multi'
    });
    expect(resolveSetting('shop', ['not', 'an', 'object'], sources).name).toBe('From Env');
  });

  it('ignores fields it does not know', () => {
    expect(resolveSetting('shop', { name: 'Saved', extra: true }, sources).name).toBe('Saved');
  });

  it('prefers the saved checkout settings over the generated ones', () => {
    const generated = { checkout: { shippingAddress: 'form', allowedCountries: ['DE'] } };
    expect(
      resolveSetting('checkout', { shippingAddress: 'stripe', allowedCountries: ['fr', 'ES', 'FR'] }, { generated })
    ).toEqual({ shippingAddress: 'stripe', allowedCountries: ['ES', 'FR'] });
  });

  it('keeps the good half of a half-broken checkout row', () => {
    const generated = { checkout: { shippingAddress: 'form', allowedCountries: ['DE'] } };
    // An unknown collector falls back; the countries beside it still stand.
    expect(resolveSetting('checkout', { shippingAddress: 'carrier', allowedCountries: ['NL'] }, { generated })).toEqual({
      shippingAddress: 'form',
      allowedCountries: ['NL']
    });
    // One bad code takes the whole list down to the generated one, rather
    // than silently delivering to a shorter list than the owner saved.
    expect(resolveSetting('checkout', { shippingAddress: 'stripe', allowedCountries: ['NL', 'ZZ'] }, { generated })).toEqual(
      { shippingAddress: 'stripe', allowedCountries: ['DE'] }
    );
  });
});

describe('settingFallback, shipping', () => {
  it('maps the generated config onto the setting, with no home country', () => {
    const generated = {
      shipping: {
        box: { length: 300, width: 200, height: 100, weightGrams: 250 },
        itemWeightGrams: 400,
        flatRateCents: 700,
        currency: 'EUR',
        freeShippingThresholdCents: 6000,
        label: 'Post'
      }
    };
    expect(settingFallback('shipping', { generated })).toEqual({
      flatRateCents: 700,
      freeShippingThresholdCents: 6000,
      label: 'Post',
      itemWeightGrams: 400,
      boxWeightGrams: 250,
      homeCountry: null
    });
  });

  it('keeps free shipping off when the generated config turned it off', () => {
    const generated = {
      shipping: {
        box: { weightGrams: 200 },
        itemWeightGrams: 500,
        flatRateCents: 500,
        freeShippingThresholdCents: null,
        label: 'Standard Shipping'
      }
    };
    expect(settingFallback('shipping', { generated }).freeShippingThresholdCents).toBeNull();
  });

  it('ships a default when the generated config is missing or unusable', () => {
    expect(settingFallback('shipping', {})).toEqual({
      flatRateCents: 500,
      freeShippingThresholdCents: 5000,
      label: 'Standard Shipping',
      itemWeightGrams: 500,
      boxWeightGrams: 200,
      homeCountry: null
    });
    expect(settingFallback('shipping', { generated: { shipping: 'nonsense' } }).flatRateCents).toBe(500);
  });
});

describe('parseSetting, shipping', () => {
  const good = {
    flatRateCents: 500,
    freeShippingThresholdCents: null,
    label: 'Standard Shipping',
    itemWeightGrams: 500,
    boxWeightGrams: 200,
    homeCountry: 'de'
  };

  it('accepts a sensible document and tidies the home country', () => {
    const parsed = parseSetting('shipping', good);
    expect(parsed).toEqual({ ok: true, value: { ...good, homeCountry: 'DE' } });
  });

  it('refuses a negative rate, an unknown country and a missing label', () => {
    expect(parseSetting('shipping', { ...good, flatRateCents: -1 }).ok).toBe(false);
    expect(parseSetting('shipping', { ...good, homeCountry: 'XX' }).ok).toBe(false);
    expect(parseSetting('shipping', { ...good, label: '  ' }).ok).toBe(false);
  });
});

describe('resolveSetting, auth', () => {
  const generated = { auth: { customerSignIn: 'otp', adminMfa: 'off' } };

  it('prefers the saved pair', () => {
    expect(resolveSetting('auth', { customerSignIn: 'password', adminMfa: 'required' }, { generated })).toEqual({
      customerSignIn: 'password',
      adminMfa: 'required'
    });
  });

  it('never leaves the admin unprotected because of a broken field', () => {
    // A row that says nothing usable about MFA keeps the generated answer,
    // rather than quietly reading as 'off'.
    expect(resolveSetting('auth', { customerSignIn: 'password', adminMfa: 'maybe' }, {}).adminMfa).toBe('required');
    expect(resolveSetting('auth', null, {}).adminMfa).toBe('required');
  });
});

describe('parseSetting', () => {
  it('trims and accepts a good name', () => {
    expect(parseSetting('shop', { name: '  Ann & Co  ', brands: 'single' })).toEqual({
      ok: true,
      value: { name: 'Ann & Co', brands: 'single' }
    });
  });

  it('refuses an empty or overlong name and says where', () => {
    const empty = parseSetting('shop', { name: '   ', brands: 'single' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues[0].path).toBe('name');
    expect(parseSetting('shop', { name: 'x'.repeat(81), brands: 'single' }).ok).toBe(false);
  });

  it('refuses a brand mode it does not know', () => {
    const bad = parseSetting('shop', { name: 'Ann & Co', brands: 'several' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0].path).toBe('brands');
  });

  it('tidies the countries it accepts', () => {
    expect(parseSetting('checkout', { shippingAddress: 'form', allowedCountries: [' de ', 'at', 'DE'] })).toEqual({
      ok: true,
      value: { shippingAddress: 'form', allowedCountries: ['AT', 'DE'] }
    });
  });

  it('accepts a sign-in method and MFA mode it knows, and no others', () => {
    expect(parseSetting('auth', { customerSignIn: 'otp', adminMfa: 'off' })).toEqual({
      ok: true,
      value: { customerSignIn: 'otp', adminMfa: 'off' }
    });
    const bad = parseSetting('auth', { customerSignIn: 'otp', adminMfa: 'optional' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0].path).toBe('adminMfa');
  });

  it('refuses no countries, an unknown code and an unknown collector', () => {
    const none = parseSetting('checkout', { shippingAddress: 'form', allowedCountries: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.issues[0].path).toBe('allowedCountries');

    const unknown = parseSetting('checkout', { shippingAddress: 'form', allowedCountries: ['DE', 'XX'] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues[0].path).toBe('allowedCountries.1');

    expect(parseSetting('checkout', { shippingAddress: 'post', allowedCountries: ['DE'] }).ok).toBe(false);
  });
});

describe('storeSettingTag', () => {
  it('is one tag per key', () => {
    expect(storeSettingTag('shop')).toBe('store-settings:shop');
    expect(storeSettingTag('checkout')).toBe('store-settings:checkout');
  });
});
