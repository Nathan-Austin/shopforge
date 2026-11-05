import { describe, expect, it } from 'vitest';

import {
  findMergeTags,
  interpolateMergeTags,
  mergeTagProblems,
  sampleMergeValues,
  startsWithUrlTag
} from './mergeTags';

describe('findMergeTags', () => {
  it('reads keys, fallbacks and positions', () => {
    expect(findMergeTags('Hi {{subscriber.first_name|there}}, from {{ shop.name }}')).toEqual([
      { key: 'subscriber.first_name', fallback: 'there', raw: '{{subscriber.first_name|there}}', index: 3 },
      { key: 'shop.name', fallback: null, raw: '{{ shop.name }}', index: 41 }
    ]);
  });
});

describe('mergeTagProblems', () => {
  it('accepts known tags', () => {
    expect(mergeTagProblems('{{shop.name}} {{current_year}} {{unsubscribe_url}}')).toEqual([]);
  });

  it('names an unknown tag', () => {
    expect(mergeTagProblems('Hi {{subscriber.frist_name}}')).toEqual([{ code: 'unknown', key: 'subscriber.frist_name' }]);
  });

  it.each(['Hi {{shop.name}', 'Hi {shop.name}}', 'Hi {{Shop Name}}', 'Hi {{}}'])('flags %s as malformed', (text) => {
    expect(mergeTagProblems(text)).toContainEqual({ code: 'malformed' });
  });

  it('caps the fallback length', () => {
    expect(mergeTagProblems(`{{shop.name|${'x'.repeat(101)}}}`)).toEqual([{ code: 'fallback-too-long', key: 'shop.name' }]);
    expect(mergeTagProblems(`{{shop.name|${'x'.repeat(100)}}}`)).toEqual([]);
  });

  it('leaves single braces alone', () => {
    expect(mergeTagProblems('Prices {from} 5 euros')).toEqual([]);
  });
});

describe('interpolateMergeTags', () => {
  it('fills values', () => {
    expect(interpolateMergeTags('Hi {{subscriber.first_name}}', { 'subscriber.first_name': 'Sam' })).toBe('Hi Sam');
  });

  it('uses the fallback for an empty or missing value', () => {
    expect(interpolateMergeTags('Hi {{subscriber.first_name|there}}', { 'subscriber.first_name': '  ' })).toBe('Hi there');
    expect(interpolateMergeTags('Hi {{subscriber.first_name|there}}', {})).toBe('Hi there');
  });

  it('renders an empty value with no fallback as nothing, never the raw tag', () => {
    expect(interpolateMergeTags('Hi {{subscriber.first_name}}!', {})).toBe('Hi !');
  });

  it('reports unknown tags and renders their fallback', () => {
    const unknown: string[] = [];
    expect(interpolateMergeTags('{{old.tag|Hello}} there', {}, (key) => unknown.push(key))).toBe('Hello there');
    expect(unknown).toEqual(['old.tag']);
  });

  it('does not escape: the renderer escapes after interpolating', () => {
    expect(interpolateMergeTags('{{shop.name}}', { 'shop.name': 'A & B' })).toBe('A & B');
  });
});

describe('sampleMergeValues and startsWithUrlTag', () => {
  it('gives every tag a sample, overridable', () => {
    const values = sampleMergeValues({ 'shop.name': 'Chilli Corner' });
    expect(values['subscriber.first_name']).toBe('Alex');
    expect(values['shop.name']).toBe('Chilli Corner');
  });

  it('only counts URL tags at the very start', () => {
    expect(startsWithUrlTag('{{shop.url}}/shop')).toBe(true);
    expect(startsWithUrlTag('{{shop.name}}/shop')).toBe(false);
    expect(startsWithUrlTag('x{{shop.url}}')).toBe(false);
  });
});
