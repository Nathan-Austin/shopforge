import { describe, expect, it } from 'vitest';

import { nearestFontSize, normalizeColor, plainTextDoc, sanitizeRichDoc } from './richTextSanitize';
import { richDocSchema } from './schema';

/** What Tiptap 3 produced for pasted HTML with a nested list, a quote and an h4. */
const FROM_TIPTAP = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'Hi ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
        { type: 'text', text: ' ' },
        { type: 'text', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '24px' } }], text: 'big' },
        { type: 'text', text: ' ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://a.example', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }],
          text: 'link'
        }
      ]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'one' }] },
            {
              type: 'bulletList',
              content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'nested' }] }] }]
            }
          ]
        }
      ]
    },
    { type: 'blockquote', content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'quote' }] }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'h4' }] }
  ]
};

describe('sanitizeRichDoc', () => {
  it('turns real Tiptap output into a document the schema accepts', () => {
    const doc = sanitizeRichDoc(FROM_TIPTAP);
    expect(richDocSchema.safeParse(FROM_TIPTAP).success).toBe(false);
    expect(richDocSchema.safeParse(doc).success).toBe(true);
  });

  it('keeps alignment, marks and links, dropping Tiptap\'s extra link attributes', () => {
    const [first] = sanitizeRichDoc(FROM_TIPTAP).content;
    expect(first).toEqual({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'Hi ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'big', marks: [{ type: 'textStyle', attrs: { fontSize: '24px', color: '#ff0000' } }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://a.example' } }] }
      ]
    });
  });

  it('lifts nested list items to the same level, in order', () => {
    const list = sanitizeRichDoc(FROM_TIPTAP).content[1];
    expect(list).toEqual({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }
      ]
    });
  });

  it('unwraps a quote and turns a fourth-level heading into a bold paragraph', () => {
    const [, , quote, heading] = sanitizeRichDoc(FROM_TIPTAP).content;
    expect(quote).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] });
    expect(heading).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'h4', marks: [{ type: 'bold' }] }] });
  });

  it('keeps an ordered list\'s start and drops a silly one', () => {
    const list = (start: unknown) =>
      sanitizeRichDoc({ type: 'doc', content: [{ type: 'orderedList', attrs: { start }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] })
        .content[0];
    expect(list(3)).toMatchObject({ attrs: { start: 3 } });
    expect(list(1)).not.toHaveProperty('attrs');
    expect(list(99999)).not.toHaveProperty('attrs');
  });

  it('drops unknown marks, duplicate marks and empty links', () => {
    const doc = sanitizeRichDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'code' }, { type: 'bold' }, { type: 'bold' }, { type: 'link', attrs: { href: '  ' } }, { type: 'highlight' }] }
          ]
        }
      ]
    });
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] });
  });

  it('leaves judging a link to the schema', () => {
    const doc = sanitizeRichDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }]
    });
    expect(richDocSchema.safeParse(doc).success).toBe(false);
  });

  it('keeps the text of unknown inline nodes and empty paragraphs as blank lines', () => {
    const doc = sanitizeRichDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', content: [{ type: 'text', text: '@sam' }] }, { type: 'hardBreak' }] }, { type: 'paragraph' }]
    });
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '@sam' }, { type: 'hardBreak' }] },
      { type: 'paragraph' }
    ]);
  });

  it.each([null, 'text', 42, [], { type: 'doc' }, { type: 'doc', content: 'no' }])('gives an empty document for %j', (raw) => {
    expect(sanitizeRichDoc(raw)).toEqual({ type: 'doc', content: [] });
  });
});

describe('normalizeColor', () => {
  it.each([
    ['#B91C1C', '#b91c1c'],
    ['#abc', '#aabbcc'],
    ['rgb(185, 28, 28)', '#b91c1c'],
    ['rgba(0,0,0,0.5)', '#000000'],
    ['rgb(300, 0, 0)', null],
    ['red', null],
    ['url(x)', null],
    [null, null]
  ])('%j -> %j', (input, expected) => {
    expect(normalizeColor(input)).toBe(expected);
  });
});

describe('nearestFontSize', () => {
  it.each([
    ['16px', '16px'],
    ['17px', '16px'],
    ['23px', '24px'],
    ['100px', '32px'],
    ['1.5rem', '12px'],
    ['0', null],
    ['big', null]
  ])('%j -> %j', (input, expected) => {
    expect(nearestFontSize(input)).toBe(expected);
  });
});

describe('plainTextDoc', () => {
  it('makes one paragraph per line', () => {
    expect(plainTextDoc('One\n\nTwo')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }
      ]
    });
  });
});
