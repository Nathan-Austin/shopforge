import { describe, expect, it } from 'vitest';

import {
  renderDisputeNotification,
  type DisputeEmailStrings,
  type DisputeNotification
} from './disputeNotification';

/** Stands in for the Email.dispute translations; the caller fills placeholders. */
const strings: DisputeEmailStrings = {
  subject: 'Test Shop: €40.00 charged back on order A1B2C3D4',
  headline: 'A customer has disputed a payment',
  summary: '€40.00 on order A1B2C3D4 has been charged back.',
  reasonLabel: 'Reason given:',
  deadline: 'Respond by 13 November 2026.',
  deadlineWarning: 'If you do not send evidence to Stripe by then, the dispute is lost automatically.',
  viewOrder: 'Open the order',
  footer: 'Answer the dispute from the Stripe dashboard.'
};

const opened: DisputeNotification = {
  reference: 'A1B2C3D4',
  shopName: 'Test Shop',
  reason: 'fraudulent',
  evidenceDueAt: new Date('2026-11-13T12:00:00Z'),
  orderUrl: 'https://shop.example/en/admin/orders/abc',
  outcome: 'opened'
};

describe('renderDisputeNotification', () => {
  it('leads with the subject the caller built', () => {
    const email = renderDisputeNotification(opened, strings);
    expect(email.subject).toBe('Test Shop: €40.00 charged back on order A1B2C3D4');
  });

  it('puts the deadline in both the HTML and the text while the dispute is open', () => {
    const email = renderDisputeNotification(opened, strings);
    expect(email.html).toContain('Respond by 13 November 2026.');
    expect(email.html).toContain('If you do not send evidence to Stripe by then');
    expect(email.text).toContain('Respond by 13 November 2026.');
  });

  it('drops the deadline once the dispute is closed, in either direction', () => {
    for (const outcome of ['won', 'lost'] as const) {
      const email = renderDisputeNotification({ ...opened, outcome }, strings);
      expect(email.html).not.toContain('Respond by');
      expect(email.text).not.toContain('Respond by');
    }
  });

  it('drops the deadline when Stripe gave no due date', () => {
    const email = renderDisputeNotification({ ...opened, evidenceDueAt: null }, strings);
    expect(email.html).not.toContain('Respond by');
  });

  it('shows a won dispute in green and a lost one in red', () => {
    expect(renderDisputeNotification({ ...opened, outcome: 'won' }, strings).html).toContain('#067647');
    expect(renderDisputeNotification({ ...opened, outcome: 'lost' }, strings).html).toContain('#b42318');
  });

  it('omits the reason line when Stripe gave none', () => {
    const email = renderDisputeNotification({ ...opened, reason: null }, strings);
    expect(email.html).not.toContain('Reason given:');
    expect(email.text).not.toContain('Reason given:');
  });

  it('omits the button when the shop does not know its own address', () => {
    const email = renderDisputeNotification({ ...opened, orderUrl: null }, strings);
    expect(email.html).not.toContain('<a href');
    expect(email.text).not.toContain('Open the order');
  });

  it('escapes anything Stripe or the customer supplied', () => {
    const email = renderDisputeNotification(
      { ...opened, reason: '<script>alert(1)</script>', shopName: 'A & B "Shop"' },
      strings
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; B &quot;Shop&quot;');
  });

  it('marks the document right-to-left for Arabic', () => {
    expect(renderDisputeNotification(opened, strings, 'ar').html).toContain('dir="rtl"');
    expect(renderDisputeNotification(opened, strings, 'de').html).toContain('dir="ltr"');
  });
});
