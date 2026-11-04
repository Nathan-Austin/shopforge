import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  renderOrderConfirmation,
  type ConfirmationEmailStrings,
  type ConfirmationOrder
} from './orderConfirmation';

/**
 * The confirmation email carries a customer's own address and product names
 * straight into HTML, so these tests pin the escaping as well as the
 * arithmetic a customer would check against their bank statement. The
 * wording comes in as strings (Email.confirmation in the shop), so a fixture
 * stands in for the translations here.
 */

const strings: ConfirmationEmailStrings = {
  subject: 'Test Shop: order A1B2C3D4 confirmed',
  headline: 'Thank you for your order',
  orderLabel: 'Order A1B2C3D4',
  subtotal: 'Subtotal',
  shipping: 'Shipping',
  discount: 'Discount',
  total: 'Total',
  addressHeading: 'Delivery address',
  viewOrder: 'View your order',
  footer: 'We will email you again when your order ships.'
};

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
  it('uses the translated wording as given', () => {
    const email = renderOrderConfirmation(baseOrder, strings);
    expect(email.subject).toBe('Test Shop: order A1B2C3D4 confirmed');
    expect(email.html).toContain('Thank you for your order');
    expect(email.text).toContain('Order A1B2C3D4');
    expect(email.text).toContain('We will email you again when your order ships.');
  });

  it('lists every item with its line total and variant', () => {
    const email = renderOrderConfirmation(baseOrder, strings);
    expect(email.text).toContain('2 x Ghost Pepper Sauce  €20.00');
    expect(email.text).toContain('1 x Apron (L / Red)  €5.00');
    expect(email.html).toContain('L / Red');
  });

  it('shows subtotal, shipping and total', () => {
    const email = renderOrderConfirmation(baseOrder, strings);
    expect(email.text).toContain('Subtotal: €25.00');
    expect(email.text).toContain('Shipping: €5.00');
    expect(email.text).toContain('Total: €30.00');
    expect(email.html).not.toContain('Discount');
  });

  it('adds a discount line, with the code, when one was applied', () => {
    const email = renderOrderConfirmation(
      { ...baseOrder, discountCents: 250, discountCode: 'WELCOME10', totalCents: 2750 },
      strings
    );
    expect(email.text).toContain('Discount (WELCOME10): -€2.50');
    expect(email.html).toContain('Discount (WELCOME10)');
    expect(email.html).toContain('−€2.50');
  });

  it('includes the delivery address and the order link when given', () => {
    const email = renderOrderConfirmation(
      { ...baseOrder, orderUrl: 'https://shop.example/en/account/orders' },
      strings
    );
    expect(email.text).toContain('Jo Smith');
    expect(email.text).toContain('10115 Berlin');
    expect(email.text).toContain('View your order: https://shop.example/en/account/orders');
    expect(email.html).toContain('href="https://shop.example/en/account/orders"');
  });

  it('leaves the address and link out when there are none', () => {
    const email = renderOrderConfirmation({ ...baseOrder, shipping: null }, strings);
    expect(email.html).not.toContain('Delivery address');
    expect(email.html).not.toContain('href=');
  });

  it('escapes product names and address lines in the HTML', () => {
    const email = renderOrderConfirmation(
      {
        ...baseOrder,
        items: [{ productName: '<img src=x onerror=alert(1)>', unitPriceCents: 100, quantity: 1 }],
        shipping: { name: 'Jo "The Hammer" <Smith>', line1: 'Street & Co' }
      },
      strings
    );
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('Jo &quot;The Hammer&quot; &lt;Smith&gt;');
    expect(email.html).toContain('Street &amp; Co');
    expect(email.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('formats money in the locale and sets the document direction', () => {
    const de = renderOrderConfirmation(baseOrder, strings, 'de');
    expect(de.text).toMatch(/Total: 30,00\s€/);
    expect(de.html).toContain('<html dir="ltr" lang="de">');
    expect(renderOrderConfirmation(baseOrder, strings, 'ar').html).toContain('dir="rtl"');
  });
});
