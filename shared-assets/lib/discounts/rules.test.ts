import { describe, expect, it } from 'vitest';

import {
  applyDiscount,
  checkDiscount,
  discountStatus,
  isWellFormedCode,
  noDiscount,
  normalizeCode,
  planNewDiscount,
  type DiscountCode
} from './rules';

const now = new Date('2026-11-04T12:00:00Z');

const base: DiscountCode = {
  id: 'd1',
  code: 'WELCOME10',
  kind: 'percent',
  percentOff: 10,
  amountOffCents: null,
  currency: null,
  minSubtotalCents: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  redemptionCount: 0,
  active: true
};

const cart = { subtotalCents: 2500, shippingCents: 500, currency: 'EUR' };

describe('normalizeCode / isWellFormedCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeCode('  welcome10 ')).toBe('WELCOME10');
    expect(normalizeCode(null)).toBe('');
  });

  it('accepts letters, digits, dash and underscore from 3 to 32 characters', () => {
    expect(isWellFormedCode('ABC')).toBe(true);
    expect(isWellFormedCode('SPRING-2026_X')).toBe(true);
    expect(isWellFormedCode('AB')).toBe(false);
    expect(isWellFormedCode('HAS SPACE')).toBe(false);
    expect(isWellFormedCode('A'.repeat(33))).toBe(false);
    expect(isWellFormedCode('ÜBER')).toBe(false);
  });
});

describe('checkDiscount', () => {
  it('accepts a live code with no restrictions', () => {
    expect(checkDiscount(base, cart, now)).toEqual({ ok: true });
  });

  it('reports a missing or retired code', () => {
    expect(checkDiscount(null, cart, now)).toEqual({ ok: false, error: 'not_found' });
    expect(checkDiscount({ ...base, active: false }, cart, now)).toEqual({ ok: false, error: 'inactive' });
  });

  it('respects the date window, start inclusive and end exclusive', () => {
    expect(
      checkDiscount({ ...base, startsAt: '2026-12-01T00:00:00Z' }, cart, now)
    ).toEqual({ ok: false, error: 'not_started' });
    expect(
      checkDiscount({ ...base, startsAt: '2026-11-04T12:00:00Z' }, cart, now)
    ).toEqual({ ok: true });
    expect(
      checkDiscount({ ...base, endsAt: '2026-11-04T12:00:00Z' }, cart, now)
    ).toEqual({ ok: false, error: 'expired' });
    expect(
      checkDiscount({ ...base, endsAt: '2026-11-04T12:00:01Z' }, cart, now)
    ).toEqual({ ok: true });
  });

  it('stops at the redemption limit', () => {
    expect(
      checkDiscount({ ...base, maxRedemptions: 3, redemptionCount: 3 }, cart, now)
    ).toEqual({ ok: false, error: 'exhausted' });
    expect(
      checkDiscount({ ...base, maxRedemptions: 3, redemptionCount: 2 }, cart, now)
    ).toEqual({ ok: true });
  });

  it('refuses a code in another currency', () => {
    expect(checkDiscount({ ...base, currency: 'usd' }, cart, now)).toEqual({
      ok: false,
      error: 'currency_mismatch'
    });
    expect(checkDiscount({ ...base, currency: 'eur' }, cart, now)).toEqual({ ok: true });
  });

  it('tells the customer the minimum they are short of', () => {
    expect(
      checkDiscount({ ...base, currency: 'EUR', minSubtotalCents: 3000 }, cart, now)
    ).toEqual({ ok: false, error: 'min_subtotal', minimumCents: 3000 });
    expect(
      checkDiscount({ ...base, currency: 'EUR', minSubtotalCents: 2500 }, cart, now)
    ).toEqual({ ok: true });
  });

  it('refuses free shipping when shipping is already free', () => {
    const free = { ...base, kind: 'free_shipping' as const, percentOff: null };
    expect(checkDiscount(free, { ...cart, shippingCents: 0 }, now)).toEqual({
      ok: false,
      error: 'nothing_to_discount'
    });
    expect(checkDiscount(free, cart, now)).toEqual({ ok: true });
  });

  it('checks in a sensible order: retired before expired before minimum', () => {
    expect(
      checkDiscount(
        { ...base, active: false, endsAt: '2020-01-01T00:00:00Z', minSubtotalCents: 99999 },
        cart,
        now
      )
    ).toEqual({ ok: false, error: 'inactive' });
  });
});

describe('applyDiscount', () => {
  it('takes a percentage off the goods, rounded to the cent, shipping untouched', () => {
    expect(applyDiscount(base, cart)).toEqual({
      discountCents: 250,
      shippingCents: 500,
      shippingDiscountCents: 0,
      totalCents: 2750
    });
    expect(applyDiscount({ ...base, percentOff: 12.5 }, { ...cart, subtotalCents: 1001 }).discountCents).toBe(125);
  });

  it('takes a fixed amount off, never more than the goods are worth', () => {
    const five = { ...base, kind: 'amount' as const, percentOff: null, amountOffCents: 500, currency: 'EUR' };
    expect(applyDiscount(five, cart)).toMatchObject({ discountCents: 500, totalCents: 2500 });
    expect(applyDiscount({ ...five, amountOffCents: 99999 }, cart)).toMatchObject({
      discountCents: 2500,
      totalCents: 500
    });
  });

  it('zeroes shipping for a free-shipping code and records what was saved', () => {
    const free = { ...base, kind: 'free_shipping' as const, percentOff: null };
    expect(applyDiscount(free, cart)).toEqual({
      discountCents: 0,
      shippingCents: 0,
      shippingDiscountCents: 500,
      totalCents: 2500
    });
  });

  it('matches noDiscount when nothing applies', () => {
    expect(noDiscount(cart)).toEqual({
      discountCents: 0,
      shippingCents: 500,
      shippingDiscountCents: 0,
      totalCents: 3000
    });
  });
});

describe('discountStatus', () => {
  it('names the state the admin sees', () => {
    expect(discountStatus(base, now)).toBe('active');
    expect(discountStatus({ ...base, active: false }, now)).toBe('retired');
    expect(discountStatus({ ...base, startsAt: '2027-01-01T00:00:00Z' }, now)).toBe('scheduled');
    expect(discountStatus({ ...base, endsAt: '2026-01-01T00:00:00Z' }, now)).toBe('expired');
    expect(discountStatus({ ...base, maxRedemptions: 1, redemptionCount: 1 }, now)).toBe('exhausted');
  });
});

describe('planNewDiscount', () => {
  it('shapes a percent code', () => {
    expect(planNewDiscount({ code: ' welcome10 ', kind: 'percent', percent: '10' })).toEqual({
      ok: true,
      row: {
        code: 'WELCOME10',
        kind: 'percent',
        percent_off: 10,
        amount_off_cents: null,
        currency: null,
        min_subtotal_cents: null,
        starts_at: null,
        ends_at: null,
        max_redemptions: null
      }
    });
  });

  it('shapes an amount code with its currency and minimum', () => {
    const plan = planNewDiscount({
      code: 'FIVER',
      kind: 'amount',
      amount: '5,00',
      currency: 'eur',
      minSubtotal: '20',
      maxRedemptions: '100'
    });
    expect(plan).toMatchObject({
      ok: true,
      row: { amount_off_cents: 500, currency: 'EUR', min_subtotal_cents: 2000, max_redemptions: 100 }
    });
  });

  it('shapes a free-shipping code with a date window', () => {
    const plan = planNewDiscount({
      code: 'SHIPFREE',
      kind: 'free_shipping',
      startsAt: '2026-11-01T00:00',
      endsAt: '2026-12-01T00:00'
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.row.starts_at).toMatch(/^2026-1[01]-/);
      expect(Date.parse(plan.row.ends_at ?? '')).toBeGreaterThan(Date.parse(plan.row.starts_at ?? ''));
    }
  });

  it('names the field that is wrong', () => {
    expect(planNewDiscount({ code: 'a b', kind: 'percent', percent: '10' })).toEqual({ ok: false, error: 'code_format' });
    expect(planNewDiscount({ code: 'ABC', kind: 'percent', percent: '0' })).toEqual({ ok: false, error: 'percent' });
    expect(planNewDiscount({ code: 'ABC', kind: 'percent', percent: '101' })).toEqual({ ok: false, error: 'percent' });
    expect(planNewDiscount({ code: 'ABC', kind: 'amount', amount: '0', currency: 'EUR' })).toEqual({ ok: false, error: 'amount' });
    expect(planNewDiscount({ code: 'ABC', kind: 'amount', amount: '5' })).toEqual({ ok: false, error: 'currency' });
    expect(planNewDiscount({ code: 'ABC', kind: 'amount', amount: '5', currency: 'euros' })).toEqual({ ok: false, error: 'currency' });
    expect(planNewDiscount({ code: 'ABC', kind: 'free_shipping', minSubtotal: '20' })).toEqual({ ok: false, error: 'currency' });
    expect(planNewDiscount({ code: 'ABC', kind: 'free_shipping', minSubtotal: 'lots' })).toEqual({ ok: false, error: 'min_subtotal' });
    expect(planNewDiscount({ code: 'ABC', kind: 'free_shipping', startsAt: 'yesterday' })).toEqual({ ok: false, error: 'dates' });
    expect(
      planNewDiscount({ code: 'ABC', kind: 'free_shipping', startsAt: '2026-12-01T00:00', endsAt: '2026-11-01T00:00' })
    ).toEqual({ ok: false, error: 'dates' });
    expect(planNewDiscount({ code: 'ABC', kind: 'free_shipping', maxRedemptions: '2.5' })).toEqual({ ok: false, error: 'max_redemptions' });
    expect(planNewDiscount({ code: 'ABC', kind: 'bogus' as never })).toEqual({ ok: false, error: 'kind' });
  });
});
