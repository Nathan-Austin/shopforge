import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  renderOrderConfirmation,
  type ConfirmationOrder
} from './orderConfirmation';

/**
 * The confirmation email carries a customer's own address and product names
 * straight into HTML, so these tests pin the escaping as well as the
 * arithmetic a customer would check against their bank statement.
 */

const baseOrder: ConfirmationOrder = {
  reference: 'A1B2C3D4',
  currency: 'EUR',
  subtotalCents: 2500,
  shippingCents: 500,
  totalCents: 3000,
  shopName: 'Test Shop',
  items: [
    { productName: 'Ghost Pepper Sauce', unitPriceCents: 1000, quantity: 2 },
    {
      productName: 'Apron',
      unitPriceCents: 500,
      quantity: 1,
      selectedSize: 'L',
      selectedColor: 'Red'
    }
  ],
  shipping: {
    name: 'Jo Smith',
    line1: '1 High Street',
    city: 'Berlin',
    postalCode: '10115',
    country: 'DE'
  }
};

describe('escapeHtml', () => {
  it('escapes every character that can break out of markup', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'
    );
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Ghost Pepper Sauce')).toBe('Ghost Pepper Sauce');
  });
});

describe('renderOrderConfirmation', () => {
  it('names the shop and the order in the subject', () => {
    const { subject } = renderOrderConfirmation(baseOrder);
    expect(subject).toBe('Test Shop: order A1B2C3D4 confirmed');
  });

  it('lists every item with its line total', () => {
    const { text } = renderOrderConfirmation(baseOrder);
    expect(text).toContain('2 x Ghost Pepper Sauce');
    expect(text).toContain('1 x Apron (L / Red)');
  });

  it('shows subtotal, shipping and total', () => {
    const { text } = renderOrderConfirmation(baseOrder);
    expect(text).toMatch(/Subtotal: .*25[.,]00/);
    expect(text).toMatch(/Shipping: .*5[.,]00/);
    expect(text).toMatch(/Total: .*30[.,]00/);
  });

  it('includes the delivery address', () => {
    const { text, html } = renderOrderConfirmation(baseOrder);
    expect(text).toContain('1 High Street');
    expect(html).toContain('10115 Berlin');
  });

  it('omits the address block when there is no address', () => {
    const { html } = renderOrderConfirmation({ ...baseOrder, shipping: null });
    expect(html).not.toContain('Delivery address');
  });

  it('omits the button when the shop does not know its own URL', () => {
    const { html } = renderOrderConfirmation(baseOrder);
    expect(html).not.toContain('View your order</a>');
  });

  it('links to the order when a URL is given', () => {
    const { html, text } = renderOrderConfirmation({
      ...baseOrder,
      orderUrl: 'https://shop.example/en/account/orders'
    });
    expect(html).toContain('href="https://shop.example/en/account/orders"');
    expect(text).toContain('https://shop.example/en/account/orders');
  });

  it('escapes a product name that contains markup', () => {
    const { html } = renderOrderConfirmation({
      ...baseOrder,
      items: [
        {
          productName: '<img src=x onerror=alert(1)>',
          unitPriceCents: 100,
          quantity: 1
        }
      ]
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes markup in the delivery address', () => {
    const { html } = renderOrderConfirmation({
      ...baseOrder,
      shipping: { ...baseOrder.shipping, line1: '<b>1 High Street</b>' }
    });
    expect(html).toContain('&lt;b&gt;1 High Street&lt;/b&gt;');
  });

  it('formats money in the given locale', () => {
    const { text } = renderOrderConfirmation(baseOrder, 'de');
    expect(text).toContain('30,00');
  });
});
