import { describe, expect, it } from 'vitest';

import {
  renderShippingNotification,
  type ShippingEmailStrings,
  type ShippingNotification
} from './shippingNotification';

const strings: ShippingEmailStrings = {
  subject: 'Test Shop: order A1B2C3D4 has shipped',
  headline: 'Your order is on its way',
  intro: 'Order A1B2C3D4 has been handed to the carrier.',
  trackingHeading: 'Tracking',
  carrierLabel: 'Carrier',
  numberLabel: 'Tracking number',
  trackButton: 'Track your parcel',
  itemsHeading: 'In the parcel',
  addressHeading: 'Delivering to',
  viewOrders: 'View your orders',
  footer: 'Questions? Just reply to this email.'
};

const order: ShippingNotification = {
  reference: 'A1B2C3D4',
  shopName: 'Test Shop',
  currency: 'EUR',
  items: [
    { productName: 'Ghost Pepper Sauce', quantity: 2 },
    { productName: 'Apron', quantity: 1, selectedSize: 'L', selectedColor: 'Red' }
  ],
  shipping: { name: 'Jo Smith', line1: '1 High Street', city: 'Berlin', postalCode: '10115', country: 'DE' },
  tracking: { carrier: 'DHL', number: '1234567890', url: 'https://www.dhl.com/track?AWB=1234567890' },
  orderUrl: 'https://shop.example/en/account/orders'
};

describe('renderShippingNotification', () => {
  it('uses the translated wording as given', () => {
    const email = renderShippingNotification(order, strings);
    expect(email.subject).toBe('Test Shop: order A1B2C3D4 has shipped');
    expect(email.html).toContain('Your order is on its way');
    expect(email.text).toContain('Order A1B2C3D4 has been handed to the carrier.');
  });

  it('shows carrier, number and a tracking button', () => {
    const email = renderShippingNotification(order, strings);
    expect(email.html).toContain('Carrier: DHL');
    expect(email.html).toContain('<strong>1234567890</strong>');
    expect(email.html).toContain('href="https://www.dhl.com/track?AWB=1234567890"');
    expect(email.text).toContain('Track your parcel: https://www.dhl.com/track?AWB=1234567890');
  });

  it('lists the items with variants and the delivery address', () => {
    const email = renderShippingNotification(order, strings);
    expect(email.text).toContain('2 x Ghost Pepper Sauce');
    expect(email.text).toContain('1 x Apron (L / Red)');
    expect(email.text).toContain('10115 Berlin');
    expect(email.html).toContain('1 High Street');
  });

  it('omits the tracking section entirely when there is nothing to track', () => {
    const email = renderShippingNotification({ ...order, tracking: null }, strings);
    expect(email.html).not.toContain('Tracking');
    expect(email.text).not.toContain('Tracking');
    expect(email.html).toContain('In the parcel');
  });

  it('shows a number without a link when the carrier is unknown', () => {
    const email = renderShippingNotification(
      { ...order, tracking: { carrier: 'Pigeon Post', number: '77', url: null } },
      strings
    );
    expect(email.html).toContain('Pigeon Post');
    expect(email.html).toContain('<strong>77</strong>');
    expect(email.html).not.toContain('Track your parcel');
  });

  it('never renders a non-http tracking link', () => {
    const email = renderShippingNotification(
      { ...order, tracking: { carrier: 'X', number: '1', url: 'javascript:alert(1)' } },
      strings
    );
    expect(email.html).not.toContain('javascript:');
    expect(email.text).not.toContain('javascript:');
  });

  it('escapes names, addresses and tracking values in the HTML', () => {
    const email = renderShippingNotification(
      {
        ...order,
        shopName: 'Shop & <Co>',
        items: [{ productName: '<b>Sauce</b>', quantity: 1 }],
        shipping: { name: '"Jo" <jo@example.com>', line1: '1 High Street' },
        tracking: { carrier: '<img src=x>', number: '1"onmouseover="x', url: null }
      },
      strings
    );
    expect(email.html).not.toContain('<b>Sauce</b>');
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;b&gt;Sauce&lt;/b&gt;');
    expect(email.html).toContain('&quot;Jo&quot; &lt;jo@example.com&gt;');
    expect(email.html).toContain('Shop &amp; &lt;Co&gt;');
  });

  it('sets the document direction for right-to-left locales', () => {
    expect(renderShippingNotification(order, strings, 'ar').html).toContain('<html dir="rtl" lang="ar">');
    expect(renderShippingNotification(order, strings, 'de').html).toContain('<html dir="ltr" lang="de">');
  });
});
