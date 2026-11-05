/**
 * The campaign document: what the designer edits, the database stores and
 * the renderer turns into an email.
 *
 * A document is a list of blocks plus a subject, a preheader and a brand
 * theme. Wording is stored per locale (see ./localize). Rich text is a
 * subset of Tiptap's JSON, so the editor's output is stored as it is and
 * no HTML written by anyone ever reaches an inbox: the renderer builds
 * every tag itself from this validated shape.
 *
 * The limits are generous for a newsletter and small enough that one bad
 * paste cannot produce an email Gmail clips (at about 100 KB) or a row
 * that slows the admin down.
 */

import { z } from 'zod';

import { CODE_PATTERN as DISCOUNT_CODE_PATTERN } from '../../discounts/rules';
import { LOCALE_CODE_PATTERN } from '../../i18n/locales';
import { mergeTagProblems, startsWithUrlTag, type MergeTagProblem } from './mergeTags';

export const CAMPAIGN_LIMITS = {
  name: 120,
  subject: 150,
  preheader: 200,
  heading: 200,
  label: 80,
  alt: 200,
  note: 300,
  footer: 500,
  url: 2048,
  /** Blocks in the whole document, column contents included. */
  blocks: 60,
  blocksPerColumn: 12,
  /** Characters of text in one rich-text block. */
  richTextChars: 10000,
  richTextBlocks: 100,
  inlineNodes: 200,
  listItems: 50,
  locales: 20
} as const;

export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'] as const;
export const FONT_FAMILIES = ['system', 'sans', 'serif'] as const;
export const BLOCK_ALIGNS = ['start', 'center', 'end'] as const;
export const COLUMN_LAYOUTS = ['1-1', '1-2', '2-1', '1-1-1'] as const;

// --- Primitives --------------------------------------------------------------

function describeMergeTagProblem(problem: MergeTagProblem): string {
  switch (problem.code) {
    case 'unknown':
      return `Unknown merge tag {{${problem.key}}}`;
    case 'fallback-too-long':
      return `The fallback for {{${problem.key}}} is too long`;
    case 'malformed':
      return 'A merge tag is missing a brace: write {{tag}}';
  }
}

/**
 * Text that may contain merge tags, every one of them known. With
 * `checkTags` off (the renderer's fallback, see buildSchemas) the tags are
 * left for the renderer, which warns about unknown ones and uses their
 * fallback text.
 */
export function taggedText(max: number, checkTags = true) {
  const text = z.string().max(max);
  if (!checkTags) return text;
  return text.superRefine((value, ctx) => {
      for (const problem of mergeTagProblems(value)) {
      ctx.addIssue({ code: 'custom', message: describeMergeTagProblem(problem), params: { mergeTag: problem } });
    }
  });
}

const SAFE_SCHEME = /^(https?:\/\/|mailto:)/i;

/**
 * A link address: http(s) or mailto, or one that starts with a URL merge
 * tag (`{{shop.url}}/shop`). Anything else, `javascript:` included, is
 * refused.
 */
function hrefSchemaFor(checkTags: boolean) {
  return taggedText(CAMPAIGN_LIMITS.url, checkTags)
    .transform((value) => value.trim())
    .refine((value) => SAFE_SCHEME.test(value) || startsWithUrlTag(value), {
      message: 'Links must start with https://, http:// or mailto:'
    });
}

export const hrefSchema = hrefSchemaFor(true);

/** Images must be https: mail clients block or warn about plain http. */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(CAMPAIGN_LIMITS.url)
  .refine((value) => /^https:\/\/[^\s"'<>]+$/i.test(value), { message: 'Image addresses must start with https://' });

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Colours are written #rrggbb' });

export const localeCodeSchema = z.string().regex(LOCALE_CODE_PATTERN, { message: 'Not a locale code' });

/** One value per locale; at most CAMPAIGN_LIMITS.locales of them. */
export function localized<T extends z.ZodType>(value: T) {
  return z
    .record(localeCodeSchema, value)
    .refine((record) => Object.keys(record).length <= CAMPAIGN_LIMITS.locales, {
      message: `At most ${CAMPAIGN_LIMITS.locales} languages`
    });
}

const blockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, { message: 'Block ids are 1-40 letters, digits, - or _' });
const alignSchema = z.enum(BLOCK_ALIGNS).default('start');

/**
 * The rich-text and block schemas, built twice. The strict set (merge tags
 * checked against the registry) guards every save; the lenient set lets
 * the renderer keep a stored block whose tag has since been retired, and
 * render it with the tag's fallback and a warning instead of dropping it.
 * Everything else, links and limits included, is checked the same way.
 */
function buildSchemas(checkTags: boolean) {
  const href = hrefSchemaFor(checkTags);

  // --- Rich text (a Tiptap JSON subset) -----------------------------------------
  // z.object strips keys it does not know, so the extra attributes Tiptap
  // writes (a link's target and rel, a null class) pass through harmlessly.

  const textAlignSchema = z.enum(['left', 'center', 'right', 'justify']).nullish();

  const richMarkSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('bold') }),
    z.object({ type: z.literal('italic') }),
    z.object({ type: z.literal('underline') }),
    z.object({ type: z.literal('strike') }),
    z.object({ type: z.literal('link'), attrs: z.object({ href: href }) }),
    z.object({
      type: z.literal('textStyle'),
      attrs: z.object({
        fontSize: z.enum(FONT_SIZES).nullish(),
        color: hexColorSchema.nullish()
      })
    })
  ]);

  const richTextNodeSchema = z.object({
    type: z.literal('text'),
    text: taggedText(CAMPAIGN_LIMITS.richTextChars, checkTags).min(1),
    marks: z.array(richMarkSchema).max(6).optional()
  });

  const inlineSchema = z.discriminatedUnion('type', [richTextNodeSchema, z.object({ type: z.literal('hardBreak') })]);
  const inlineContent = z.array(inlineSchema).max(CAMPAIGN_LIMITS.inlineNodes).optional();

  const richParagraphSchema = z.object({
    type: z.literal('paragraph'),
    attrs: z.object({ textAlign: textAlignSchema }).optional(),
    content: inlineContent
  });

  const richHeadingSchema = z.object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), textAlign: textAlignSchema }),
    content: inlineContent
  });

  // List items hold paragraphs only: no nested lists, which render
  // unpredictably across mail clients.
  const richListItemSchema = z.object({
    type: z.literal('listItem'),
    content: z.array(richParagraphSchema).min(1).max(10)
  });

  const richBulletListSchema = z.object({
    type: z.literal('bulletList'),
    content: z.array(richListItemSchema).min(1).max(CAMPAIGN_LIMITS.listItems)
  });

  const richOrderedListSchema = z.object({
    type: z.literal('orderedList'),
    attrs: z.object({ start: z.number().int().min(1).max(1000).nullish() }).optional(),
    content: z.array(richListItemSchema).min(1).max(CAMPAIGN_LIMITS.listItems)
  });

  const richBlockSchema = z.discriminatedUnion('type', [
    richParagraphSchema,
    richHeadingSchema,
    richBulletListSchema,
    richOrderedListSchema
  ]);

  const richDocSchema = z
    .object({
      type: z.literal('doc'),
      content: z.array(richBlockSchema).max(CAMPAIGN_LIMITS.richTextBlocks)
    })
    .refine((doc) => richTextLength(doc) <= CAMPAIGN_LIMITS.richTextChars, {
      message: `At most ${CAMPAIGN_LIMITS.richTextChars} characters of text in one block`
    });

  // --- Blocks ------------------------------------------------------------------

  const headingBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    text: localized(taggedText(CAMPAIGN_LIMITS.heading, checkTags)),
    align: alignSchema
  });

  const textBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('text'),
    content: localized(richDocSchema)
  });

  const imageBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('image'),
    src: imageUrlSchema,
    alt: localized(taggedText(CAMPAIGN_LIMITS.alt, checkTags)).default({}),
    href: href.nullable().default(null),
    /** Percent of the space it sits in: the email's width or its column's. */
    width: z.number().int().min(10).max(100).default(100),
    align: z.enum(BLOCK_ALIGNS).default('center')
  });

  const buttonBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('button'),
    label: localized(taggedText(CAMPAIGN_LIMITS.label, checkTags)),
    href: href,
    /** Null uses the theme's brand colour. */
    color: hexColorSchema.nullable().default(null),
    fullWidth: z.boolean().default(false),
    align: z.enum(BLOCK_ALIGNS).default('center')
  });

  const productBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('product'),
    /** z.guid, not z.uuid: seed rows use ids that are not RFC 4122 v4. */
    productId: z.guid(),
    showPrice: z.boolean().default(true),
    /** Empty uses the shop's "View product" wording. */
    buttonLabel: localized(taggedText(CAMPAIGN_LIMITS.label, checkTags)).default({}),
    align: z.enum(BLOCK_ALIGNS).default('center')
  });

  const discountBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('discount'),
    code: z.string().trim().toUpperCase().regex(DISCOUNT_CODE_PATTERN, { message: 'Not a discount code' }),
    title: localized(taggedText(CAMPAIGN_LIMITS.heading, checkTags)).default({}),
    note: localized(taggedText(CAMPAIGN_LIMITS.note, checkTags)).default({})
  });

  const dividerBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('divider'),
    color: hexColorSchema.nullable().default(null)
  });

  const spacerBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('spacer'),
    height: z.number().int().min(8).max(80).default(24)
  });

  /** Everything that may sit inside a column. */
  const LEAF_BLOCK_SCHEMAS = [
    headingBlockSchema,
    textBlockSchema,
    imageBlockSchema,
    buttonBlockSchema,
    productBlockSchema,
    discountBlockSchema,
    dividerBlockSchema,
    spacerBlockSchema
  ] as const;

  const leafBlockSchema = z.discriminatedUnion('type', LEAF_BLOCK_SCHEMAS);

  const COLUMN_COUNTS: Record<(typeof COLUMN_LAYOUTS)[number], number> = { '1-1': 2, '1-2': 2, '2-1': 2, '1-1-1': 3 };

  /** Columns hold leaf blocks only: one level of nesting, never columns in columns. */
  const columnsBlockSchema = z
    .object({
      id: blockIdSchema,
      type: z.literal('columns'),
      layout: z.enum(COLUMN_LAYOUTS).default('1-1'),
      columns: z.array(z.array(leafBlockSchema).max(CAMPAIGN_LIMITS.blocksPerColumn)).min(2).max(3),
      /** Phones get one column under the other; off keeps them side by side. */
      stackOnMobile: z.boolean().default(true)
    })
    .refine((block) => block.columns.length === COLUMN_COUNTS[block.layout], {
      message: 'The number of columns does not match the layout',
      path: ['columns']
    });

  const blockSchema = z.discriminatedUnion('type', [...LEAF_BLOCK_SCHEMAS, columnsBlockSchema]);

  return { richMarkSchema, richTextNodeSchema, richParagraphSchema, richBlockSchema, richDocSchema, leafBlockSchema, columnsBlockSchema, blockSchema };
}

const strictSchemas = buildSchemas(true);
const lenientSchemas = buildSchemas(false);

export const {
  richMarkSchema,
  richTextNodeSchema,
  richParagraphSchema,
  richDocSchema,
  leafBlockSchema,
  columnsBlockSchema,
  blockSchema
} = strictSchemas;

/** For the renderer's fallback only; saves always use the strict schemas. */
export const lenientLeafBlockSchema = lenientSchemas.leafBlockSchema;
export const lenientBlockSchema = lenientSchemas.blockSchema;

export type RichMark = z.infer<typeof richMarkSchema>;
export type RichTextNode = z.infer<typeof richTextNodeSchema>;
export type RichParagraph = z.infer<typeof richParagraphSchema>;
export type RichBlock = z.infer<typeof strictSchemas.richBlockSchema>;
export type RichDoc = z.infer<typeof richDocSchema>;

/**
 * Visible characters in rich text: text counts its length, a line break
 * one. Typed by shape rather than from the schema, which calls it.
 */
interface LengthNode {
  type: string;
  text?: string;
  content?: LengthNode[];
}

export function richTextLength(doc: { content?: LengthNode[] }): number {
  return (doc.content ?? []).reduce((sum, node) => {
    if (node.type === 'text') return sum + (node.text?.length ?? 0);
    if (node.type === 'hardBreak') return sum + 1;
    return sum + richTextLength(node);
  }, 0);
}

/** True when a rich-text document has no visible text. */
export function isRichDocEmpty(doc: RichDoc): boolean {
  const hasText = (node: LengthNode): boolean =>
    node.type === 'text' ? Boolean(node.text?.trim()) : (node.content ?? []).some(hasText);
  return !(doc.content as LengthNode[]).some(hasText);
}


export type LeafBlock = z.infer<typeof leafBlockSchema>;
export type ColumnsBlock = z.infer<typeof columnsBlockSchema>;
export type CampaignBlock = z.infer<typeof blockSchema>;
export type BlockType = CampaignBlock['type'];

export function columnWidths(layout: ColumnsBlock['layout']): number[] {
  switch (layout) {
    case '1-1':
      return [50, 50];
    case '1-2':
      return [33, 67];
    case '2-1':
      return [67, 33];
    case '1-1-1':
      return [34, 33, 33];
  }
}

// --- Theme and document ------------------------------------------------------

export const themeSchema = z.object({
  brandColor: hexColorSchema.default('#111111'),
  textColor: hexColorSchema.default('#1c1917'),
  backgroundColor: hexColorSchema.default('#f5f5f4'),
  contentColor: hexColorSchema.default('#ffffff'),
  fontFamily: z.enum(FONT_FAMILIES).default('system'),
  logoUrl: imageUrlSchema.nullable().default(null),
  logoWidth: z.number().int().min(40).max(300).default(140)
});

export type CampaignTheme = z.infer<typeof themeSchema>;

/** The parts of a document other than its blocks. */
function envelopeShape(checkTags: boolean) {
  return {
    version: z.literal(1),
    defaultLocale: localeCodeSchema,
    subject: localized(taggedText(CAMPAIGN_LIMITS.subject, checkTags)),
    preheader: localized(taggedText(CAMPAIGN_LIMITS.preheader, checkTags)).default({}),
    // prefault, not default: the inner defaults apply to a missing theme too.
    theme: themeSchema.prefault({}),
    /** Postal address and anything else the law asks for under every campaign. */
    footer: localized(taggedText(CAMPAIGN_LIMITS.footer, checkTags)).default({})
  };
}

const strictEnvelope = envelopeShape(true);
const lenientEnvelope = envelopeShape(false);

type Ctx = z.RefinementCtx;

function hasText(value: Partial<Record<string, string>> | undefined, locale: string): boolean {
  return Boolean(value?.[locale]?.trim());
}

/** The default locale is the last fallback, so it must say something. */
function requireDefaultLocale(doc: { defaultLocale: string; subject: Partial<Record<string, string>> }, ctx: Ctx) {
  if (!hasText(doc.subject, doc.defaultLocale)) {
    ctx.addIssue({
      code: 'custom',
      message: `The subject needs text in the default language (${doc.defaultLocale})`,
      path: ['subject', doc.defaultLocale]
    });
  }
}

function requireBlockText(block: CampaignBlock, defaultLocale: string, path: (string | number)[], ctx: Ctx) {
  const missing = (field: string) =>
    ctx.addIssue({
      code: 'custom',
      message: `This block needs text in the default language (${defaultLocale})`,
      path: [...path, field, defaultLocale]
    });
  switch (block.type) {
    case 'heading':
      if (!hasText(block.text, defaultLocale)) missing('text');
      break;
    case 'button':
      if (!hasText(block.label, defaultLocale)) missing('label');
      break;
    case 'text': {
      const doc = block.content[defaultLocale];
      if (!doc || isRichDocEmpty(doc)) missing('content');
      break;
    }
    case 'columns':
      block.columns.forEach((column, columnIndex) =>
        column.forEach((child, childIndex) =>
          requireBlockText(child, defaultLocale, [...path, 'columns', columnIndex, childIndex], ctx)
        )
      );
      break;
    default:
      break;
  }
}

export function countBlocks(blocks: CampaignBlock[]): number {
  return blocks.reduce(
    (sum, block) => sum + 1 + (block.type === 'columns' ? block.columns.reduce((c, column) => c + column.length, 0) : 0),
    0
  );
}

function blockIds(blocks: CampaignBlock[]): string[] {
  return blocks.flatMap((block) => [block.id, ...(block.type === 'columns' ? blockIds(block.columns.flat()) : [])]);
}

export const campaignDocumentSchema = z
  .object({ ...strictEnvelope, blocks: z.array(blockSchema) })
  .superRefine((doc, ctx) => {
    requireDefaultLocale(doc, ctx);
    if (countBlocks(doc.blocks) > CAMPAIGN_LIMITS.blocks) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${CAMPAIGN_LIMITS.blocks} blocks, counting those inside columns`,
        path: ['blocks']
      });
    }
    const ids = blockIds(doc.blocks);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Two blocks share an id', path: ['blocks'] });
    }
    doc.blocks.forEach((block, index) => requireBlockText(block, doc.defaultLocale, ['blocks', index], ctx));
  });

/**
 * The document without its blocks checked, for the renderer's fallback:
 * a stored campaign with one broken block still has a usable subject and
 * theme, and its other blocks can still be sent. Merge tags are left to
 * the renderer, like in the lenient block schemas.
 */
export const campaignEnvelopeSchema = z
  .object({ ...lenientEnvelope, blocks: z.array(z.unknown()).max(CAMPAIGN_LIMITS.blocks * 2) })
  .superRefine((doc, ctx) => requireDefaultLocale(doc, ctx));

/** What the designer holds and the database stores. */
export type CampaignDocument = z.infer<typeof campaignDocumentSchema>;
/** What a caller may hand in: defaults not yet applied. */
export type CampaignDocumentInput = z.input<typeof campaignDocumentSchema>;

export interface CampaignIssue {
  path: string;
  message: string;
}

/** Zod issues as `blocks.2.label.en: message`, for the designer and the logs. */
export function toCampaignIssues(error: z.ZodError): CampaignIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message
  }));
}

export type CampaignValidation =
  | { ok: true; document: CampaignDocument }
  | { ok: false; issues: CampaignIssue[] };

/** The strict check run on every save. */
export function validateCampaignDocument(input: unknown): CampaignValidation {
  const result = campaignDocumentSchema.safeParse(input);
  return result.success ? { ok: true, document: result.data } : { ok: false, issues: toCampaignIssues(result.error) };
}
