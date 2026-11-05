import { describe, expect, it } from 'vitest';

import { paragraph, sampleDocument } from './fixtures';
import { CAMPAIGN_LIMITS, validateCampaignDocument, type CampaignDocumentInput } from './schema';

type Blocks = CampaignDocumentInput['blocks'];

function withBlocks(blocks: Blocks): CampaignDocumentInput {
  return { ...sampleDocument(), blocks };
}

function heading(id: string, text = 'Hello') {
  return { id, type: 'heading' as const, text: { en: text } };
}

/** The issue paths, so a test can say exactly which field was refused. */
function issuePaths(input: unknown): string[] {
  const result = validateCampaignDocument(input);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

function issueMessages(input: unknown): string[] {
  const result = validateCampaignDocument(input);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
}

describe('validateCampaignDocument', () => {
  it('accepts the sample, every block type included', () => {
    const result = validateCampaignDocument(sampleDocument());
    expect(result.ok).toBe(true);
  });

  it('applies defaults: theme, alignment, image width', () => {
    const result = validateCampaignDocument(withBlocks([{ id: 'i', type: 'image', src: 'https://cdn.example/a.png' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.theme.fontFamily).toBe('system');
    expect(result.document.theme.brandColor).toBe('#b91c1c');
    expect(result.document.blocks[0]).toMatchObject({ width: 100, align: 'center', href: null, alt: {} });
  });

  it('fills a missing theme with every default', () => {
    const { theme: _theme, ...rest } = sampleDocument();
    void _theme;
    const result = validateCampaignDocument(rest);
    expect(result.ok && result.document.theme).toEqual({
      brandColor: '#111111',
      textColor: '#1c1917',
      backgroundColor: '#f5f5f4',
      contentColor: '#ffffff',
      fontFamily: 'system',
      logoUrl: null,
      logoWidth: 140
    });
  });

  it('refuses something that is not a document', () => {
    expect(validateCampaignDocument(null).ok).toBe(false);
    expect(validateCampaignDocument('hello').ok).toBe(false);
    expect(validateCampaignDocument({ ...sampleDocument(), version: 2 }).ok).toBe(false);
  });
});

describe('text length boundaries', () => {
  it(`subject: ${CAMPAIGN_LIMITS.subject} characters pass, one more fails`, () => {
    const at = { ...sampleDocument(), subject: { en: 'x'.repeat(CAMPAIGN_LIMITS.subject) } };
    const over = { ...sampleDocument(), subject: { en: 'x'.repeat(CAMPAIGN_LIMITS.subject + 1) } };
    expect(validateCampaignDocument(at).ok).toBe(true);
    expect(issuePaths(over)).toEqual(['subject.en']);
  });

  it(`preheader: ${CAMPAIGN_LIMITS.preheader} characters pass, one more fails`, () => {
    expect(validateCampaignDocument({ ...sampleDocument(), preheader: { en: 'x'.repeat(CAMPAIGN_LIMITS.preheader) } }).ok).toBe(true);
    expect(issuePaths({ ...sampleDocument(), preheader: { en: 'x'.repeat(CAMPAIGN_LIMITS.preheader + 1) } })).toEqual([
      'preheader.en'
    ]);
  });

  it('button labels are capped', () => {
    const label = (length: number) => withBlocks([{ id: 'b', type: 'button', label: { en: 'x'.repeat(length) }, href: 'https://a.example' }]);
    expect(validateCampaignDocument(label(CAMPAIGN_LIMITS.label)).ok).toBe(true);
    expect(issuePaths(label(CAMPAIGN_LIMITS.label + 1))).toEqual(['blocks.0.label.en']);
  });

  it('rich text is capped across the whole block, not per text run', () => {
    const half = 'x'.repeat(CAMPAIGN_LIMITS.richTextChars / 2);
    const doc = (extra: string) => ({
      type: 'doc' as const,
      content: [
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: half }] },
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: half + extra }] }
      ]
    });
    expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: doc('') } }])).ok).toBe(true);
    expect(issuePaths(withBlocks([{ id: 't', type: 'text', content: { en: doc('x') } }]))).toEqual(['blocks.0.content.en']);
  });
});

describe('block count and nesting boundaries', () => {
  it(`${CAMPAIGN_LIMITS.blocks} blocks pass, one more fails`, () => {
    const blocks = (count: number) => Array.from({ length: count }, (_, i) => heading(`h${i}`));
    expect(validateCampaignDocument(withBlocks(blocks(CAMPAIGN_LIMITS.blocks))).ok).toBe(true);
    expect(issueMessages(withBlocks(blocks(CAMPAIGN_LIMITS.blocks + 1)))).toEqual([
      `At most ${CAMPAIGN_LIMITS.blocks} blocks, counting those inside columns`
    ]);
  });

  it('counts blocks inside columns towards the limit', () => {
    const columns = {
      id: 'cols',
      type: 'columns' as const,
      columns: [[heading('a'), heading('b')], [heading('c')]]
    };
    // 1 columns block + 3 children + 57 headings = 61
    const blocks = [columns, ...Array.from({ length: CAMPAIGN_LIMITS.blocks - 3 }, (_, i) => heading(`h${i}`))];
    expect(issuePaths(withBlocks(blocks))).toEqual(['blocks']);
  });

  it('refuses columns inside columns', () => {
    const inner = { id: 'inner', type: 'columns', columns: [[], []] };
    const outer = { id: 'outer', type: 'columns', columns: [[inner], []] };
    expect(validateCampaignDocument(withBlocks([outer as never])).ok).toBe(false);
  });

  it('needs 2 or 3 columns, matching the layout', () => {
    const cols = (layout: string, count: number) =>
      withBlocks([{ id: 'c', type: 'columns', layout: layout as '1-1', columns: Array.from({ length: count }, () => []) }]);
    expect(validateCampaignDocument(cols('1-1', 2)).ok).toBe(true);
    expect(validateCampaignDocument(cols('1-1-1', 3)).ok).toBe(true);
    expect(issueMessages(cols('1-1', 3))).toContain('The number of columns does not match the layout');
    expect(validateCampaignDocument(cols('1-1', 1)).ok).toBe(false);
    expect(validateCampaignDocument(cols('1-1-1', 4)).ok).toBe(false);
  });

  it(`a column holds at most ${CAMPAIGN_LIMITS.blocksPerColumn} blocks`, () => {
    const column = (count: number) => Array.from({ length: count }, (_, i) => heading(`x${i}`));
    const at = withBlocks([{ id: 'c', type: 'columns', columns: [column(CAMPAIGN_LIMITS.blocksPerColumn), []] }]);
    const over = withBlocks([{ id: 'c', type: 'columns', columns: [column(CAMPAIGN_LIMITS.blocksPerColumn + 1), []] }]);
    expect(validateCampaignDocument(at).ok).toBe(true);
    expect(issuePaths(over)).toEqual(['blocks.0.columns.0']);
  });

  it('refuses two blocks with the same id, inside columns too', () => {
    const blocks = [heading('same'), { id: 'c', type: 'columns' as const, columns: [[heading('same')], []] }];
    expect(issueMessages(withBlocks(blocks))).toEqual(['Two blocks share an id']);
  });

  it('spacer height stays between 8 and 80', () => {
    const spacer = (height: number) => withBlocks([{ id: 's', type: 'spacer', height }]);
    expect(validateCampaignDocument(spacer(8)).ok).toBe(true);
    expect(validateCampaignDocument(spacer(80)).ok).toBe(true);
    expect(validateCampaignDocument(spacer(7)).ok).toBe(false);
    expect(validateCampaignDocument(spacer(81)).ok).toBe(false);
    expect(validateCampaignDocument(spacer(12.5)).ok).toBe(false);
  });
});

describe('links, images and colours', () => {
  it.each(['https://shop.example', 'http://shop.example', 'mailto:hi@shop.example', '{{shop.url}}/en/shop', '{{unsubscribe_url}}'])(
    'accepts the link %s',
    (href) => {
      expect(validateCampaignDocument(withBlocks([{ id: 'b', type: 'button', label: { en: 'Go' }, href }])).ok).toBe(true);
    }
  );

  it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', '/relative', 'shop.example', '{{shop.name}}/x', 'vbscript:x'])(
    'refuses the link %s',
    (href) => {
      expect(validateCampaignDocument(withBlocks([{ id: 'b', type: 'button', label: { en: 'Go' }, href }])).ok).toBe(false);
    }
  );

  it('refuses unsafe links inside rich text too', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'Click', marks: [{ type: 'link' as const, attrs: { href: 'javascript:x' } }] }]
        }
      ]
    };
    expect(issuePaths(withBlocks([{ id: 't', type: 'text', content: { en: doc } }]))).toEqual([
      'blocks.0.content.en.content.0.content.0.marks.0.attrs.href'
    ]);
  });

  it('images must be https', () => {
    expect(validateCampaignDocument(withBlocks([{ id: 'i', type: 'image', src: 'http://cdn.example/a.png' }])).ok).toBe(false);
    expect(validateCampaignDocument(withBlocks([{ id: 'i', type: 'image', src: 'https://cdn.example/a b.png' }])).ok).toBe(false);
    expect(validateCampaignDocument({ ...sampleDocument(), theme: { logoUrl: 'http://cdn.example/l.png' } }).ok).toBe(false);
  });

  it('image width is a whole percent between 10 and 100', () => {
    const image = (width: number) => withBlocks([{ id: 'i', type: 'image', src: 'https://cdn.example/a.png', width }]);
    expect(validateCampaignDocument(image(10)).ok).toBe(true);
    expect(validateCampaignDocument(image(9)).ok).toBe(false);
    expect(validateCampaignDocument(image(101)).ok).toBe(false);
  });

  it.each(['red', '#fff', '#12345g', 'rgb(0,0,0)', '#1234567'])('refuses the colour %s', (brandColor) => {
    expect(issuePaths({ ...sampleDocument(), theme: { brandColor } })).toEqual(['theme.brandColor']);
  });

  it('only offers the listed font sizes in rich text', () => {
    // Typed loosely on purpose: the point is what the schema does with bad sizes.
    const doc = (fontSize: string) =>
      ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Big', marks: [{ type: 'textStyle', attrs: { fontSize } }] }] }]
      }) as never;
    expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: doc('24px') } }])).ok).toBe(true);
    expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: doc('25px') } }])).ok).toBe(false);
    expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: doc('1px;background:url(x)') } }])).ok).toBe(false);
  });
});

describe('rich text shape', () => {
  it('accepts what Tiptap writes, extra attributes included', () => {
    const tiptap = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', attrs: { textAlign: 'center' } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Link',
              marks: [{ type: 'link', attrs: { href: 'https://a.example', target: '_blank', rel: 'noopener', class: null } }]
            },
            { type: 'hardBreak' }
          ]
        }
      ]
    };
    expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: tiptap as never } }])).ok).toBe(true);
  });

  it('refuses nested lists, unknown nodes and raw HTML nodes', () => {
    const nested = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [] }] }]
        }
      ]
    };
    const html = { type: 'doc', content: [{ type: 'html', content: '<script>alert(1)</script>' }] };
    const image = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://a.example/x.png' } }] };
    for (const doc of [nested, html, image]) {
      expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: doc as never } }])).ok).toBe(false);
    }
  });

  it('refuses heading levels beyond 3', () => {
    const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'x' }] }] };
    expect(validateCampaignDocument(withBlocks([{ id: 't', type: 'text', content: { en: doc as never } }])).ok).toBe(false);
  });
});

describe('merge tags and locales', () => {
  it('names the field holding an unknown merge tag', () => {
    const doc = { ...sampleDocument(), subject: { en: 'Hi {{subscriber.frist_name}}' } };
    const result = validateCampaignDocument(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([{ path: 'subject.en', message: 'Unknown merge tag {{subscriber.frist_name}}' }]);
  });

  it('checks merge tags inside rich text and columns', () => {
    const blocks: Blocks = [
      { id: 't', type: 'text', content: { en: paragraph('Hi {{nope}}') } },
      { id: 'c', type: 'columns', columns: [[heading('h', '{{shop.name}')], []] }
    ];
    expect(issuePaths(withBlocks(blocks))).toEqual([
      'blocks.0.content.en.content.0.content.0.text',
      'blocks.1.columns.0.0.text.en'
    ]);
  });

  it('needs the subject and required block text in the default locale', () => {
    const doc = {
      ...sampleDocument(),
      subject: { de: 'Nur Deutsch' },
      blocks: [
        { id: 'h', type: 'heading' as const, text: { de: 'Nur Deutsch' } },
        { id: 'b', type: 'button' as const, label: { en: '   ' }, href: 'https://a.example' },
        { id: 't', type: 'text' as const, content: { en: { type: 'doc' as const, content: [{ type: 'paragraph' as const }] } } }
      ]
    };
    expect(issuePaths(doc)).toEqual(['subject.en', 'blocks.0.text.en', 'blocks.1.label.en', 'blocks.2.content.en']);
  });

  it('accepts market locales and refuses malformed locale keys', () => {
    expect(validateCampaignDocument({ ...sampleDocument(), preheader: { en: 'x', 'de-at': 'y' } }).ok).toBe(true);
    expect(validateCampaignDocument({ ...sampleDocument(), preheader: { en: 'x', 'de-AT': 'y' } }).ok).toBe(false);
    expect(validateCampaignDocument({ ...sampleDocument(), preheader: { en: 'x', german: 'y' } }).ok).toBe(false);
    expect(validateCampaignDocument({ ...sampleDocument(), defaultLocale: 'EN' }).ok).toBe(false);
  });

  it(`allows at most ${CAMPAIGN_LIMITS.locales} languages per field`, () => {
    const codes = 'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br'.split(' ');
    const many = Object.fromEntries(['en', ...codes].map((code) => [code, 'x']));
    expect(validateCampaignDocument({ ...sampleDocument(), preheader: many }).ok).toBe(false);
    const enough = Object.fromEntries(['en', ...codes.slice(0, CAMPAIGN_LIMITS.locales - 1)].map((code) => [code, 'x']));
    expect(validateCampaignDocument({ ...sampleDocument(), preheader: enough }).ok).toBe(true);
  });

  it('normalises discount codes and refuses malformed ones', () => {
    const result = validateCampaignDocument(withBlocks([{ id: 'd', type: 'discount', code: ' spring15 ' }]));
    expect(result.ok && result.document.blocks[0]).toMatchObject({ code: 'SPRING15' });
    expect(validateCampaignDocument(withBlocks([{ id: 'd', type: 'discount', code: 'NO WAY' }])).ok).toBe(false);
  });

  it('refuses a product block without a well-formed id', () => {
    expect(validateCampaignDocument(withBlocks([{ id: 'p', type: 'product', productId: 'ghost-pepper' }])).ok).toBe(false);
    expect(
      validateCampaignDocument(withBlocks([{ id: 'p', type: 'product', productId: '00000000-0000-0000-0000-000000000001' }])).ok
    ).toBe(true);
  });
});
