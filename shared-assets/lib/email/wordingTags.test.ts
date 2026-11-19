import { describe, expect, it } from 'vitest';

import { firstNameOf, interpolateWording, wordingTagProblems } from './wordingTags';

describe('interpolateWording', () => {
  it('fills known tags and falls back for empty ones', () => {
    const text = 'Hi {{customer.first_name|there}}, order {{order.reference}} from {{ shop.name }}.';
    expect(interpolateWording(text, { 'customer.first_name': 'Jo', 'order.reference': 'A1B2', 'shop.name': 'Test Shop' })).toBe(
      'Hi Jo, order A1B2 from Test Shop.'
    );
    expect(interpolateWording(text, { 'customer.first_name': '  ', 'order.reference': 'A1B2' })).toBe('Hi there, order A1B2 from .');
  });

  it('drops an unknown tag to its fallback rather than showing braces', () => {
    expect(interpolateWording('Hello {{subscriber.first_name|friend}}', {})).toBe('Hello friend');
  });

  it('leaves text without tags alone', () => {
    expect(interpolateWording('Thanks for your order.', {})).toBe('Thanks for your order.');
  });
});

describe('wordingTagProblems', () => {
  it('accepts the three known tags', () => {
    expect(wordingTagProblems('{{customer.first_name|there}} {{order.reference}} {{shop.name}}')).toEqual([]);
  });

  it('names an unknown tag, a long fallback and a missing brace', () => {
    expect(wordingTagProblems('{{subscriber.email}}')).toEqual([{ code: 'unknown', key: 'subscriber.email' }]);
    expect(wordingTagProblems(`{{customer.first_name|${'x'.repeat(61)}}}`)).toEqual([
      { code: 'fallback-too-long', key: 'customer.first_name' }
    ]);
    expect(wordingTagProblems('Hi {{customer.first_name')).toEqual([{ code: 'malformed' }]);
  });
});

describe('firstNameOf', () => {
  it('takes the first word of a full name', () => {
    expect(firstNameOf('Jo  Smith')).toBe('Jo');
    expect(firstNameOf(' ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
