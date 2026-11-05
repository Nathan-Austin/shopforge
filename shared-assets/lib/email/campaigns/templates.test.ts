import { describe, expect, it } from 'vitest';

import { sampleDocument } from './fixtures';
import {
  buildStarterDocument,
  cleanTemplateName,
  documentReferences,
  duplicateName,
  planTemplateSave,
  TEMPLATE_DOCUMENT_MAX_BYTES,
  TEMPLATE_NAME_MAX,
  type StarterDefinition
} from './templates';
import { validateCampaignDocument } from './schema';

describe('cleanTemplateName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanTemplateName('  Spring\n  sale  ')).toBe('Spring sale');
  });

  it(`allows 1 to ${TEMPLATE_NAME_MAX} characters`, () => {
    expect(cleanTemplateName('x')).toBe('x');
    expect(cleanTemplateName('x'.repeat(TEMPLATE_NAME_MAX))).toHaveLength(TEMPLATE_NAME_MAX);
    expect(cleanTemplateName('x'.repeat(TEMPLATE_NAME_MAX + 1))).toBeNull();
    expect(cleanTemplateName('   ')).toBeNull();
    expect(cleanTemplateName(42)).toBeNull();
  });
});

describe('planTemplateSave', () => {
  it('saves a rename on its own', () => {
    expect(planTemplateSave({ name: ' Winter ' })).toEqual({ ok: true, name: 'Winter', document: null });
  });

  it('validates the document strictly and applies defaults', () => {
    const plan = planTemplateSave({ name: 'Spring', document: sampleDocument() });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.document?.theme.fontFamily).toBe('system');
  });

  it('accepts the document as JSON from a form field', () => {
    expect(planTemplateSave({ name: 'Spring', document: JSON.stringify(sampleDocument()) }).ok).toBe(true);
  });

  it('refuses a bad name before looking at the document', () => {
    expect(planTemplateSave({ name: '', document: 'not json' })).toMatchObject({ ok: false, error: 'name' });
  });

  it('refuses malformed JSON', () => {
    expect(planTemplateSave({ name: 'X', document: '{"version": 1,' })).toEqual({
      ok: false,
      error: 'document',
      issues: [{ path: '', message: 'Not valid JSON' }]
    });
  });

  it('passes on the schema issues with their paths', () => {
    const plan = planTemplateSave({ name: 'X', document: { ...sampleDocument(), subject: { en: 'Hi {{nope}}' } } });
    expect(plan).toMatchObject({ ok: false, error: 'document', issues: [{ path: 'subject.en' }] });
  });

  it(`refuses more than ${TEMPLATE_DOCUMENT_MAX_BYTES / 1000} KB`, () => {
    expect(planTemplateSave({ name: 'X', document: 'x'.repeat(TEMPLATE_DOCUMENT_MAX_BYTES + 1) })).toMatchObject({
      ok: false,
      error: 'too-large'
    });
    // Valid against the schema, but its rich text adds up past the byte limit.
    const big = 'é'.repeat(9000);
    const blocks = Array.from({ length: 13 }, (_, i) => ({
      id: `t${i}`,
      type: 'text' as const,
      content: { en: { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: big }] }] } }
    }));
    expect(planTemplateSave({ name: 'X', document: { ...sampleDocument(), blocks } })).toMatchObject({ ok: false, error: 'too-large' });
  });
});

describe('duplicateName', () => {
  it('adds the suffix', () => {
    expect(duplicateName('Spring sale', '(copy)')).toBe('Spring sale (copy)');
  });

  it('shortens a long name so the copy still fits', () => {
    const name = duplicateName('x'.repeat(TEMPLATE_NAME_MAX), '(copy)');
    expect(name).toHaveLength(TEMPLATE_NAME_MAX);
    expect(name.endsWith('… (copy)')).toBe(true);
    expect(cleanTemplateName(name)).toBe(name);
  });
});

describe('documentReferences', () => {
  it('finds products and codes, inside columns too, once each', () => {
    const document = {
      blocks: [
        { type: 'product', productId: 'a' },
        { type: 'discount', code: ' spring15 ' },
        { type: 'columns', columns: [[{ type: 'product', productId: 'b' }], [{ type: 'product', productId: 'a' }, { type: 'discount', code: 'SPRING15' }]] }
      ]
    };
    expect(documentReferences(document)).toEqual({ productIds: ['a', 'b'], discountCodes: ['SPRING15'] });
  });

  it.each([null, 'x', {}, { blocks: 'no' }, { blocks: [null, 3, { type: 'columns', columns: 'no' }] }])('copes with %j', (document) => {
    expect(documentReferences(document)).toEqual({ productIds: [], discountCodes: [] });
  });
});

describe('buildStarterDocument', () => {
  const starter: StarterDefinition = {
    subject: { en: 'Hello', de: 'Hallo' },
    blocks: [
      { type: 'heading', text: { en: 'Title', de: 'Titel' } },
      { type: 'text', paragraphs: [{ en: 'One', de: 'Eins' }, { en: 'Two' }] },
      { type: 'button', label: { en: 'Go' }, href: '{{shop.locale_url}}/shop' },
      { type: 'divider' },
      { type: 'spacer' }
    ]
  };

  it('keeps only the shop\'s locales, markets reading their language', () => {
    const doc = buildStarterDocument(starter, ['de', 'de-at', 'en'], 'de');
    expect(doc.subject).toEqual({ de: 'Hallo', 'de-at': 'Hallo', en: 'Hello' });
    expect(doc.defaultLocale).toBe('de');
    expect(validateCampaignDocument(doc).ok).toBe(true);
  });

  it('gives a default language the starters do not speak the English text', () => {
    const doc = buildStarterDocument(starter, ['fr', 'de'], 'fr');
    expect(doc.subject).toEqual({ fr: 'Hello', de: 'Hallo' });
    expect(validateCampaignDocument(doc).ok).toBe(true);
  });

  it('numbers block ids and fills missing paragraphs with blank lines', () => {
    const doc = buildStarterDocument(starter, ['en', 'de'], 'en');
    expect(doc.blocks.map((block) => block.id)).toEqual(['heading-1', 'text-2', 'button-3', 'divider-4', 'spacer-5']);
    const text = doc.blocks[1];
    expect(text.type === 'text' && text.content.de?.content[1]).toEqual({ type: 'paragraph', content: [] });
  });
});
