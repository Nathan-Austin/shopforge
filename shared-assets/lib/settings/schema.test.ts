import { describe, expect, it } from 'vitest';

import { DEFAULT_SHOP_NAME, parseSetting, resolveSetting, settingFallback, storeSettingTag } from './schema';

describe('settingFallback', () => {
  it('takes the shop name from the generated environment', () => {
    expect(settingFallback('shop', { NEXT_PUBLIC_SHOP_NAME: ' Test Shop ' })).toEqual({ name: 'Test Shop' });
  });

  it('has a name even with nothing configured', () => {
    expect(settingFallback('shop', {})).toEqual({ name: DEFAULT_SHOP_NAME });
    expect(settingFallback('shop', { NEXT_PUBLIC_SHOP_NAME: '  ' })).toEqual({ name: DEFAULT_SHOP_NAME });
  });
});

describe('resolveSetting', () => {
  const env = { NEXT_PUBLIC_SHOP_NAME: 'From Env' };

  it('prefers a saved value over the environment', () => {
    expect(resolveSetting('shop', { name: 'Saved Name' }, env)).toEqual({ name: 'Saved Name' });
  });

  it('falls back when nothing is saved', () => {
    expect(resolveSetting('shop', null, env)).toEqual({ name: 'From Env' });
    expect(resolveSetting('shop', undefined, env)).toEqual({ name: 'From Env' });
  });

  it('falls back field by field when a saved value is broken', () => {
    expect(resolveSetting('shop', { name: '' }, env)).toEqual({ name: 'From Env' });
    expect(resolveSetting('shop', { name: 42 }, env)).toEqual({ name: 'From Env' });
    expect(resolveSetting('shop', ['not', 'an', 'object'], env)).toEqual({ name: 'From Env' });
  });

  it('ignores fields it does not know', () => {
    expect(resolveSetting('shop', { name: 'Saved', extra: true }, env)).toEqual({ name: 'Saved' });
  });
});

describe('parseSetting', () => {
  it('trims and accepts a good name', () => {
    expect(parseSetting('shop', { name: '  Ann & Co  ' })).toEqual({ ok: true, value: { name: 'Ann & Co' } });
  });

  it('refuses an empty or overlong name and says where', () => {
    const empty = parseSetting('shop', { name: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues[0].path).toBe('name');
    expect(parseSetting('shop', { name: 'x'.repeat(81) }).ok).toBe(false);
  });
});

describe('storeSettingTag', () => {
  it('is one tag per key', () => {
    expect(storeSettingTag('shop')).toBe('store-settings:shop');
  });
});
