import { describe, expect, it } from 'vitest';

import {
  hasTracking,
  normalizeTracking,
  notificationForStatusChange,
  safeTrackingUrl,
  trackingUrlFor
} from './notifications';

describe('notificationForStatusChange', () => {
  it('emails when an order is marked shipped for the first time', () => {
    expect(
      notificationForStatusChange({ from: 'paid', to: 'fulfilled', shippingNotifiedAt: null })
    ).toBe('shipped');
    expect(
      notificationForStatusChange({ from: 'pending', to: 'fulfilled', shippingNotifiedAt: null })
    ).toBe('shipped');
  });

  it('does not email again once the customer has been told', () => {
    expect(
      notificationForStatusChange({
        from: 'paid',
        to: 'fulfilled',
        shippingNotifiedAt: '2026-11-04T09:00:00Z'
      })
    ).toBeNull();
  });

  it('is silent when the status is saved unchanged', () => {
    expect(
      notificationForStatusChange({ from: 'fulfilled', to: 'fulfilled', shippingNotifiedAt: null })
    ).toBeNull();
    expect(
      notificationForStatusChange({ from: 'paid', to: 'paid', shippingNotifiedAt: null })
    ).toBeNull();
  });

  it('flipping back and forth emails at most once', () => {
    // fulfilled -> paid -> fulfilled, after the first email went out.
    expect(
      notificationForStatusChange({ from: 'fulfilled', to: 'paid', shippingNotifiedAt: '2026-11-04T09:00:00Z' })
    ).toBeNull();
    expect(
      notificationForStatusChange({ from: 'paid', to: 'fulfilled', shippingNotifiedAt: '2026-11-04T09:00:00Z' })
    ).toBeNull();
  });

  it('retries on the next arrival if the first email never went out', () => {
    // fulfilled (send failed, nothing recorded) -> paid -> fulfilled
    expect(
      notificationForStatusChange({ from: 'paid', to: 'fulfilled', shippingNotifiedAt: null })
    ).toBe('shipped');
  });

  it('stays quiet for cancellations and other statuses', () => {
    for (const to of ['pending', 'paid', 'cancelled', 'refunded']) {
      expect(notificationForStatusChange({ from: 'paid', to, shippingNotifiedAt: null })).toBeNull();
    }
  });
});

describe('trackingUrlFor', () => {
  it('builds a link for a known carrier, whatever the casing', () => {
    expect(trackingUrlFor('DHL', '1234567890')).toBe(
      'https://www.dhl.com/en/express/tracking.html?AWB=1234567890'
    );
    expect(trackingUrlFor(' royal mail ', 'AB123456789GB')).toContain('AB123456789GB');
  });

  it('encodes the number', () => {
    expect(trackingUrlFor('ups', '1Z 999 AA1')).toBe('https://www.ups.com/track?tracknum=1Z%20999%20AA1');
  });

  it('is null for an unknown carrier or a missing number', () => {
    expect(trackingUrlFor('Pigeon Post', '123')).toBeNull();
    expect(trackingUrlFor('dhl', '')).toBeNull();
    expect(trackingUrlFor(null, '123')).toBeNull();
  });
});

describe('safeTrackingUrl', () => {
  it('accepts http and https only', () => {
    expect(safeTrackingUrl('https://example.com/t/1')).toBe('https://example.com/t/1');
    expect(safeTrackingUrl(' http://example.com ')).toBe('http://example.com');
    expect(safeTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(safeTrackingUrl('example.com/track')).toBeNull();
    expect(safeTrackingUrl('')).toBeNull();
    expect(safeTrackingUrl(null)).toBeNull();
  });
});

describe('normalizeTracking', () => {
  it('trims and nulls blanks', () => {
    expect(normalizeTracking({ carrier: '  ', number: ' 123 ', url: '' })).toEqual({
      carrier: null,
      number: '123',
      url: null
    });
  });

  it('prefers an explicit link over a derived one', () => {
    expect(
      normalizeTracking({ carrier: 'dhl', number: '1', url: 'https://my.link/x' }).url
    ).toBe('https://my.link/x');
  });

  it('derives a link from a known carrier when none is given', () => {
    expect(normalizeTracking({ carrier: 'fedex', number: '777' }).url).toBe(
      'https://www.fedex.com/fedextrack/?trknbr=777'
    );
  });

  it('drops an unsafe explicit link rather than falling back to it', () => {
    expect(
      normalizeTracking({ carrier: 'Pigeon', number: '1', url: 'javascript:alert(1)' }).url
    ).toBeNull();
  });
});

describe('hasTracking', () => {
  it('is true with any detail and false with none', () => {
    expect(hasTracking({ carrier: null, number: null, url: null })).toBe(false);
    expect(hasTracking({ carrier: 'DHL', number: null, url: null })).toBe(true);
  });
});
