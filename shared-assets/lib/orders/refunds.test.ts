import { describe, expect, it } from 'vitest';

import {
  isRefundConfirmed,
  parseMajorAmount,
  planRefund,
  refundedQuantities,
  refundRequestFromForm,
  remainingRefundableCents,
  type RefundableOrder
} from './refunds';

const order: RefundableOrder = {
  totalCents: 3000, // 2500 of items + 500 shipping
  refundedCents: 0,
  items: [
    { id: 'sauce', productName: 'Ghost Pepper Sauce', unitPriceCents: 1000, quantity: 2 },
    { id: 'apron', productName: 'Apron', unitPriceCents: 500, quantity: 1 }
  ]
};

describe('remainingRefundableCents', () => {
  it('is the total less what has gone back already, never negative', () => {
    expect(remainingRefundableCents(order)).toBe(3000);
    expect(remainingRefundableCents({ totalCents: 3000, refundedCents: 1200 })).toBe(1800);
    expect(remainingRefundableCents({ totalCents: 3000, refundedCents: 9999 })).toBe(0);
  });
});

describe('planRefund: full', () => {
  it('refunds everything that is left, shipping included', () => {
    expect(planRefund(order, { kind: 'full' })).toEqual({
      ok: true,
      kind: 'full',
      amountCents: 3000,
      items: [],
      percent: null
    });
    expect(planRefund({ ...order, refundedCents: 1000 }, { kind: 'full' })).toMatchObject({
      ok: true,
      amountCents: 2000
    });
  });

  it('refuses when nothing is left', () => {
    expect(planRefund({ ...order, refundedCents: 3000 }, { kind: 'full' })).toEqual({
      ok: false,
      error: 'nothing_left'
    });
  });
});

describe('planRefund: items', () => {
  it('prices the chosen units and snapshots the lines', () => {
    expect(
      planRefund(order, {
        kind: 'items',
        items: [
          { orderItemId: 'sauce', quantity: 1 },
          { orderItemId: 'apron', quantity: 1 }
        ]
      })
    ).toEqual({
      ok: true,
      kind: 'items',
      amountCents: 1500,
      percent: null,
      items: [
        { orderItemId: 'sauce', productName: 'Ghost Pepper Sauce', quantity: 1, amountCents: 1000 },
        { orderItemId: 'apron', productName: 'Apron', quantity: 1, amountCents: 500 }
      ]
    });
  });

  it('ignores lines left at zero and needs at least one', () => {
    expect(
      planRefund(order, {
        kind: 'items',
        items: [
          { orderItemId: 'sauce', quantity: 0 },
          { orderItemId: 'apron', quantity: 1 }
        ]
      })
    ).toMatchObject({ ok: true, amountCents: 500 });
    expect(
      planRefund(order, { kind: 'items', items: [{ orderItemId: 'sauce', quantity: 0 }] })
    ).toEqual({ ok: false, error: 'no_items' });
    expect(planRefund(order, { kind: 'items' })).toEqual({ ok: false, error: 'no_items' });
  });

  it('rejects unknown lines and quantities beyond the line', () => {
    expect(
      planRefund(order, { kind: 'items', items: [{ orderItemId: 'nope', quantity: 1 }] })
    ).toEqual({ ok: false, error: 'unknown_item' });
    expect(
      planRefund(order, { kind: 'items', items: [{ orderItemId: 'sauce', quantity: 3 }] })
    ).toEqual({ ok: false, error: 'item_quantity' });
    expect(
      planRefund(order, { kind: 'items', items: [{ orderItemId: 'sauce', quantity: 1.5 }] })
    ).toMatchObject({ ok: true, amountCents: 1000 });
  });

  it('counts units refunded by earlier refunds against the line', () => {
    const partlyRefunded: RefundableOrder = {
      ...order,
      refundedCents: 1000,
      items: [{ ...order.items[0], refundedQuantity: 1 }, order.items[1]]
    };
    expect(
      planRefund(partlyRefunded, { kind: 'items', items: [{ orderItemId: 'sauce', quantity: 2 }] })
    ).toEqual({ ok: false, error: 'item_quantity' });
    expect(
      planRefund(partlyRefunded, { kind: 'items', items: [{ orderItemId: 'sauce', quantity: 1 }] })
    ).toMatchObject({ ok: true, amountCents: 1000 });
  });

  it('cannot push the order past its total after an amount refund', () => {
    expect(
      planRefund(
        { ...order, refundedCents: 2000 },
        { kind: 'items', items: [{ orderItemId: 'sauce', quantity: 2 }] }
      )
    ).toEqual({ ok: false, error: 'exceeds_remaining' });
  });
});

describe('planRefund: percent', () => {
  it('takes a share of the order total, rounded to the cent', () => {
    expect(planRefund(order, { kind: 'percent', percent: 10 })).toMatchObject({
      ok: true,
      amountCents: 300,
      percent: 10
    });
    expect(planRefund({ ...order, totalCents: 1001 }, { kind: 'percent', percent: 33.3 })).toMatchObject({
      ok: true,
      amountCents: 333
    });
    expect(planRefund(order, { kind: 'percent', percent: 100 })).toMatchObject({
      ok: true,
      amountCents: 3000
    });
  });

  it('rejects percentages outside 0 to 100', () => {
    expect(planRefund(order, { kind: 'percent', percent: 0 })).toEqual({ ok: false, error: 'bad_percent' });
    expect(planRefund(order, { kind: 'percent', percent: 101 })).toEqual({ ok: false, error: 'bad_percent' });
    expect(planRefund(order, { kind: 'percent', percent: -5 })).toEqual({ ok: false, error: 'bad_percent' });
    expect(planRefund(order, { kind: 'percent' })).toEqual({ ok: false, error: 'bad_percent' });
  });

  it('is a share of the total, so it can exceed what is left after earlier refunds', () => {
    expect(planRefund({ ...order, refundedCents: 2000 }, { kind: 'percent', percent: 50 })).toEqual({
      ok: false,
      error: 'exceeds_remaining'
    });
  });
});

describe('planRefund: amount', () => {
  it('refunds exactly the figure', () => {
    expect(planRefund(order, { kind: 'amount', amountCents: 1234 })).toMatchObject({
      ok: true,
      amountCents: 1234
    });
  });

  it('never more than what is left', () => {
    expect(planRefund(order, { kind: 'amount', amountCents: 3001 })).toEqual({
      ok: false,
      error: 'exceeds_remaining'
    });
    expect(planRefund({ ...order, refundedCents: 2500 }, { kind: 'amount', amountCents: 500 })).toMatchObject({
      ok: true,
      amountCents: 500
    });
    expect(planRefund({ ...order, refundedCents: 2500 }, { kind: 'amount', amountCents: 501 })).toEqual({
      ok: false,
      error: 'exceeds_remaining'
    });
  });

  it('rejects nothing, zero and negatives', () => {
    expect(planRefund(order, { kind: 'amount' })).toEqual({ ok: false, error: 'bad_amount' });
    expect(planRefund(order, { kind: 'amount', amountCents: 0 })).toEqual({ ok: false, error: 'bad_amount' });
    expect(planRefund(order, { kind: 'amount', amountCents: -100 })).toEqual({ ok: false, error: 'bad_amount' });
    expect(planRefund(order, { kind: 'amount', amountCents: Number.NaN })).toEqual({ ok: false, error: 'bad_amount' });
  });
});

describe('parseMajorAmount', () => {
  it('reads dot or comma decimals as cents', () => {
    expect(parseMajorAmount('12.50')).toBe(1250);
    expect(parseMajorAmount('12,50')).toBe(1250);
    expect(parseMajorAmount(' 7 ')).toBe(700);
    expect(parseMajorAmount('0.1')).toBe(10);
  });

  it('rejects anything that is not a plain positive number', () => {
    expect(parseMajorAmount('')).toBeNull();
    expect(parseMajorAmount('0')).toBeNull();
    expect(parseMajorAmount('-5')).toBeNull();
    expect(parseMajorAmount('12.345')).toBeNull();
    expect(parseMajorAmount('1e3')).toBeNull();
    expect(parseMajorAmount('abc')).toBeNull();
    expect(parseMajorAmount(null)).toBeNull();
  });
});

describe('isRefundConfirmed', () => {
  it('needs the exact word', () => {
    expect(isRefundConfirmed('REFUND')).toBe(true);
    expect(isRefundConfirmed('  REFUND ')).toBe(true);
    expect(isRefundConfirmed('refund')).toBe(false);
    expect(isRefundConfirmed('REFUND!')).toBe(false);
    expect(isRefundConfirmed('')).toBe(false);
    expect(isRefundConfirmed(null)).toBe(false);
  });
});

describe('refundedQuantities', () => {
  it('sums units per line across successful refunds only', () => {
    const totals = refundedQuantities([
      { status: 'succeeded', items: [{ orderItemId: 'sauce', quantity: 1 }] },
      { status: 'succeeded', items: [{ orderItemId: 'sauce', quantity: 1 }, { orderItemId: 'apron', quantity: 1 }] },
      { status: 'failed', items: [{ orderItemId: 'apron', quantity: 1 }] },
      { status: 'pending', items: [{ orderItemId: 'apron', quantity: 1 }] }
    ]);
    expect(totals.get('sauce')).toBe(2);
    expect(totals.get('apron')).toBe(1);
    expect(totals.get('other')).toBeUndefined();
  });
});

describe('refundRequestFromForm', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    return data;
  };

  it('defaults to a full refund', () => {
    expect(refundRequestFromForm(form({}))).toEqual({ kind: 'full' });
    expect(refundRequestFromForm(form({ kind: 'bogus' }))).toEqual({ kind: 'full' });
  });

  it('collects per-line quantities for an item refund, ignoring other fields', () => {
    expect(
      refundRequestFromForm(
        form({ kind: 'items', item_sauce: '2', item_apron: '0', item_x: 'abc', percent: '50' })
      )
    ).toEqual({
      kind: 'items',
      items: [
        { orderItemId: 'sauce', quantity: 2 },
        { orderItemId: 'apron', quantity: 0 },
        { orderItemId: 'x', quantity: 0 }
      ]
    });
  });

  it('parses the percentage, comma decimals included', () => {
    expect(refundRequestFromForm(form({ kind: 'percent', percent: '12,5' }))).toEqual({
      kind: 'percent',
      percent: 12.5
    });
    expect(refundRequestFromForm(form({ kind: 'percent', percent: '' }))).toEqual({
      kind: 'percent',
      percent: null
    });
    expect(refundRequestFromForm(form({ kind: 'percent', percent: 'lots' }))).toEqual({
      kind: 'percent',
      percent: null
    });
  });

  it('parses the amount as cents', () => {
    expect(refundRequestFromForm(form({ kind: 'amount', amount: '12.50' }))).toEqual({
      kind: 'amount',
      amountCents: 1250
    });
    expect(refundRequestFromForm(form({ kind: 'amount', amount: '-1' }))).toEqual({
      kind: 'amount',
      amountCents: null
    });
  });
});
