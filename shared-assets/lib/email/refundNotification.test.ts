import { describe, expect, it } from 'vitest';

import {
  renderRefundNotification,
  type RefundEmailStrings,
  type RefundNotification
} from './refundNotification';

/** Stands in for the Email.refund translations; the caller fills placeholders. */
const strings: RefundEmailStrings = {
  subject: 'Test Shop: refund of €10.00 for order A1B2C3D4',
  headlineFull: 'Your order has been refunded',
  headlinePartial: 'A refund is on its way',
  summaryFull: 'We have refunded the full €30.00 for order A1B2C3D4.',
  summaryPartial: 'We have refunded €10.00 of order A1B2C3D4.',
  refundedSoFar: 'Refunded so far: €10.00 of €30.00.',
  viewOrders: 'View your orders',
  footer: 'The money goes back to the card you paid with. Banks usually show it within 5 to 10 working days.'
};

const partial: RefundNotification = {
  reference: 'A1B2C3D4',
  shopName: 'Test Shop',
  currency: 'EUR',
  amountCents: 1000,
  totalCents: 3000,
  refundedCents: 1000,
  items: [{ productName: 'Ghost Pepper Sauce', quantity: 1, amountCents: 1000 }],
  reason: 'Bottle arrived cracked',
  orderUrl: 'https://shop.example/en/account/orders'
};

describe('renderRefundNotification', () => {
  it('names the amount, the order and the shop in the subject', () => {
    const email = renderRefundNotification(partial, strings);
    expect(email.subject).toBe('Test Shop: refund of €10.00 for order A1B2C3D4');
  });

  it('tells a partial refund apart from a full one', () => {
    const part = renderRefundNotification(partial, strings);
    expect(part.text).toContain('A refund is on its way');
    expect(part.text).toContain('We have refunded €10.00 of order A1B2C3D4.');
    expect(part.text).toContain('Refunded so far: €10.00 of €30.00.');

    const full = renderRefundNotification(
      { ...partial, amountCents: 2000, refundedCents: 3000, items: [] },
      strings
    );
    expect(full.text).toContain('Your order has been refunded');
    expect(full.text).toContain('We have refunded the full €30.00 for order A1B2C3D4.');
    expect(full.text).not.toContain('Refunded so far');
    expect(full.html).toContain('Your order has been refunded');
  });

  it('lists refunded lines, the reason and the link', () => {
    const email = renderRefundNotification(partial, strings);
    expect(email.text).toContain('1 x Ghost Pepper Sauce  €10.00');
    expect(email.text).toContain('Bottle arrived cracked');
    expect(email.text).toContain('View your orders: https://shop.example/en/account/orders');
    expect(email.html).toContain('href="https://shop.example/en/account/orders"');
  });

  it('leaves out what it does not have', () => {
    const email = renderRefundNotification(
      { ...partial, items: [], reason: '  ', orderUrl: null },
      strings
    );
    expect(email.html).not.toContain('<table');
    expect(email.html).not.toContain('href=');
    expect(email.text).not.toContain('View your orders');
  });

  it('escapes the owner\'s note and product names in the HTML', () => {
    const email = renderRefundNotification(
      {
        ...partial,
        shopName: 'Shop & <Co>',
        reason: '<img src=x onerror=alert(1)>',
        items: [{ productName: '"Hot" <Sauce>', quantity: 1, amountCents: 1000 }]
      },
      strings
    );
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('Shop &amp; &lt;Co&gt;');
    expect(email.html).toContain('&quot;Hot&quot; &lt;Sauce&gt;');
    // Plain text is not HTML, so it keeps the original characters.
    expect(email.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('formats item amounts in the locale and sets the direction', () => {
    const email = renderRefundNotification(partial, strings, 'de');
    // Intl puts a non-breaking space before the euro sign in German.
    expect(email.text).toMatch(/1 x Ghost Pepper Sauce  10,00\s€/);
    expect(renderRefundNotification(partial, strings, 'ar').html).toContain('dir="rtl"');
  });
});
