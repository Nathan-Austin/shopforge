import { describe, expect, it } from 'vitest';

import { renderSubscriptionConfirmation, type SubscribeEmailStrings } from './confirmationEmail';

const strings: SubscribeEmailStrings = {
  subject: 'Test Shop: please confirm your subscription',
  headline: 'One more step',
  intro: 'Please confirm that you want news and offers from Test Shop.',
  button: 'Confirm my subscription',
  expires: 'The link works for 7 days.',
  ignore: 'If you did not sign up, ignore this email.'
};
const URL = 'https://shop.example/de/newsletter/confirm?t=v1.abc.def';

describe('renderSubscriptionConfirmation', () => {
  it('has one confirm button and says what happens otherwise', () => {
    const email = renderSubscriptionConfirmation(URL, 'Test Shop', strings, 'de');
    expect(email.subject).toBe(strings.subject);
    expect(email.html.match(/<a /g)).toHaveLength(1);
    expect(email.html).toContain(`href="${URL}"`);
    expect(email.html).toContain('If you did not sign up, ignore this email.');
    expect(email.text).toContain(`Confirm my subscription: ${URL}`);
    expect(email.html).toContain('lang="de"');
  });

  it('escapes the shop name and lays Arabic out right to left', () => {
    const email = renderSubscriptionConfirmation(URL, 'A & <B>', strings, 'ar');
    expect(email.html).toContain('A &amp; &lt;B&gt;');
    expect(email.html).toContain('dir="rtl"');
  });

  it('refuses a relative or odd link', () => {
    expect(() => renderSubscriptionConfirmation('/de/newsletter/confirm', 'S', strings)).toThrow();
    expect(() => renderSubscriptionConfirmation('javascript:alert(1)', 'S', strings)).toThrow();
  });
});
