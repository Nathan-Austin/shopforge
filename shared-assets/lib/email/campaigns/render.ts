/**
 * Renders a campaign document into an email: subject, preheader, HTML and
 * plain text.
 *
 * Pure, like the order emails: products, discount codes, wording and the
 * recipient come in through the context, so this runs the same in the
 * designer preview, a test send and a unit test.
 *
 * It degrades instead of failing. A stored campaign can go stale (a
 * product is archived, a code retired, a block saved by an older version
 * no longer validates); each of those drops the one block and adds a
 * warning, and the rest of the email still renders. Only a document with
 * no usable subject, or nothing left to show, is refused.
 *
 * The HTML is a 600px table layout with inline styles, the form every mail
 * client agrees on. One media query, for clients that support it, stacks
 * columns and widens the content on phones.
 */

import { formatPrice } from '../../format';
import { directionOf, hreflangOf } from '../../i18n/locales';
import { escapeHtml } from '../orderConfirmation';
import { isBlankString, pickLocalized, type Localized } from './localize';
import { interpolateMergeTags, type MergeTagKey, type MergeValues } from './mergeTags';
import { renderRichTextHtml, renderRichTextPlain, type RichTextRenderOptions } from './richText';
import {
  campaignDocumentSchema,
  campaignEnvelopeSchema,
  columnWidths,
  isRichDocEmpty,
  lenientBlockSchema,
  lenientLeafBlockSchema,
  toCampaignIssues,
  type CampaignBlock,
  type CampaignDocument,
  type CampaignIssue,
  type CampaignTheme,
  type ColumnsBlock,
  type LeafBlock,
  type RichDoc
} from './schema';

// --- Context -----------------------------------------------------------------

/** A product as a product block shows it, looked up by the caller. */
export interface CampaignProduct {
  id: string;
  name: string;
  /** Absolute link to the product page in the recipient's locale. */
  url: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  currency: string;
  imageUrl?: string | null;
  /** Extra lines under the name, e.g. a chilli shop's heat ("Hot · 7/10"). */
  extras?: string[];
}

/** A discount code that is live, with how the shop describes it. */
export interface CampaignDiscount {
  code: string;
  /** "15% off", "Free shipping", already in the recipient's language. */
  label: string;
}

/** The fixed wording around the owner's content, from `Email.campaign`. */
export interface CampaignStrings {
  /** "You are receiving this because you subscribed to news from My Shop." */
  footerReason: string;
  unsubscribe: string;
  viewProduct: string;
  discountTitle: string;
  discountHint: string;
}

export interface CampaignRenderContext {
  locale: string;
  strings: CampaignStrings;
  shop: { name: string; url: string | null };
  recipient: { email: string; firstName?: string | null } | null;
  /** Null in a preview; a campaign send must have one. */
  unsubscribeUrl: string | null;
  products: Record<string, CampaignProduct | undefined>;
  discounts: Record<string, CampaignDiscount | undefined>;
  /** Fixed in tests so `{{current_year}}` is predictable. */
  now?: Date;
  /** Overrides for merge values, e.g. the preview's sample subscriber. */
  mergeValues?: MergeValues;
}

export type CampaignWarningCode =
  | 'invalid-block'
  | 'block-failed'
  | 'missing-translation'
  | 'empty-block'
  | 'missing-product'
  | 'missing-discount'
  | 'unknown-merge-tag'
  | 'unsafe-url'
  | 'missing-unsubscribe';

export interface CampaignWarning {
  code: CampaignWarningCode;
  blockId?: string;
  detail?: string;
}

export interface RenderedCampaign {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  warnings: CampaignWarning[];
}

export type CampaignRenderResult =
  | { ok: true; email: RenderedCampaign }
  | { ok: false; error: 'invalid-document' | 'empty'; issues: CampaignIssue[]; warnings: CampaignWarning[] };

// --- Layout constants --------------------------------------------------------

export const EMAIL_WIDTH = 600;
const SIDE_PADDING = 32;
const CONTENT_WIDTH = EMAIL_WIDTH - SIDE_PADDING * 2;
const COLUMN_GUTTER = 16;

const FONT_STACKS: Record<CampaignTheme['fontFamily'], string> = {
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  sans: 'Helvetica,Arial,sans-serif',
  serif: "Georgia,'Times New Roman',Times,serif"
};

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i;

/** Black or white, whichever reads better on the given background. */
export function contrastingText(hex: string): '#000000' | '#ffffff' {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Where black and white have the same WCAG contrast ratio.
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

// --- Parsing with fallback ---------------------------------------------------

interface ParsedCampaign {
  document: CampaignDocument;
  warnings: CampaignWarning[];
}

function rawBlockId(raw: unknown): string | undefined {
  if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string') return raw.id.slice(0, 40);
  return undefined;
}

/** A columns block whose bad children are dropped instead of the whole row. */
function salvageColumns(raw: Record<string, unknown>, warnings: CampaignWarning[]): ColumnsBlock | null {
  if (!Array.isArray(raw.columns)) return null;
  const columns = raw.columns.map((column) =>
    (Array.isArray(column) ? column : []).flatMap((child): LeafBlock[] => {
      const parsed = lenientLeafBlockSchema.safeParse(child);
      if (parsed.success) return [parsed.data];
      warnings.push({ code: 'invalid-block', blockId: rawBlockId(child), detail: parsed.error.issues[0]?.message });
      return [];
    })
  );
  const parsed = lenientBlockSchema.safeParse({ ...raw, columns });
  return parsed.success && parsed.data.type === 'columns' ? parsed.data : null;
}

/**
 * The strict schema first; if that fails, the envelope on its own and then
 * each block separately against the lenient schemas (merge tags left to
 * the renderer), keeping the ones that pass.
 */
export function parseCampaignLenient(
  input: unknown
): { ok: true; parsed: ParsedCampaign } | { ok: false; issues: CampaignIssue[] } {
  const strict = campaignDocumentSchema.safeParse(input);
  if (strict.success) return { ok: true, parsed: { document: strict.data, warnings: [] } };

  const envelope = campaignEnvelopeSchema.safeParse(input);
  if (!envelope.success) return { ok: false, issues: toCampaignIssues(envelope.error) };

  const warnings: CampaignWarning[] = [];
  const blocks: CampaignBlock[] = [];
  const seen = new Set<string>();
  for (const raw of envelope.data.blocks) {
    const parsed = lenientBlockSchema.safeParse(raw);
    let block: CampaignBlock | null = parsed.success ? parsed.data : null;
    if (!block && raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'columns') {
      block = salvageColumns(raw as Record<string, unknown>, warnings);
    }
    if (!block || seen.has(block.id)) {
      warnings.push({
        code: 'invalid-block',
        blockId: rawBlockId(raw),
        detail: block ? 'Duplicate block id' : parsed.error?.issues[0]?.message
      });
      continue;
    }
    seen.add(block.id);
    blocks.push(block);
  }
  return { ok: true, parsed: { document: { ...envelope.data, blocks }, warnings } };
}

// --- Rendering ---------------------------------------------------------------

interface BlockOutput {
  html: string;
  text: string;
}

class Renderer {
  readonly warnings: CampaignWarning[] = [];
  readonly dir: 'ltr' | 'rtl';
  private readonly values: MergeValues;
  private readonly font: string;
  private currentBlock: string | undefined;

  constructor(
    private readonly document: CampaignDocument,
    private readonly context: CampaignRenderContext
  ) {
    this.dir = directionOf(context.locale);
    this.font = FONT_STACKS[document.theme.fontFamily];
    const shopUrl = context.shop.url?.replace(/\/$/, '') ?? null;
    const base: Record<MergeTagKey, string | null | undefined> = {
      'subscriber.first_name': context.recipient?.firstName ?? null,
      'subscriber.email': context.recipient?.email ?? null,
      'shop.name': context.shop.name,
      'shop.url': shopUrl,
      unsubscribe_url: context.unsubscribeUrl,
      current_year: String((context.now ?? new Date()).getUTCFullYear())
    };
    this.values = { ...base, ...context.mergeValues };
  }

  private warn(code: CampaignWarningCode, detail?: string) {
    const warning: CampaignWarning = { code, ...(this.currentBlock ? { blockId: this.currentBlock } : {}), ...(detail ? { detail } : {}) };
    const duplicate = this.warnings.some(
      (w) => w.code === warning.code && w.blockId === warning.blockId && w.detail === warning.detail
    );
    if (!duplicate) this.warnings.push(warning);
  }

  interpolate = (text: string): string =>
    interpolateMergeTags(text, this.values, (key) => this.warn('unknown-merge-tag', key));

  /** An interpolated link, or null (with a warning) if it is not http(s)/mailto. */
  resolveHref = (href: string): string | null => {
    const resolved = this.interpolate(href).trim();
    if (SAFE_URL.test(resolved)) return resolved;
    this.warn('unsafe-url', resolved.slice(0, 100) || href.slice(0, 100));
    return null;
  };

  /** Text for the recipient's locale, falling back with a warning. */
  private pick(value: Localized<string> | undefined, field: string): string | null {
    const picked = pickLocalized(value, this.context.locale, this.document.defaultLocale, isBlankString);
    if (picked?.fellBack) this.warn('missing-translation', `${field}:${picked.locale}`);
    return picked ? this.interpolate(picked.value) : null;
  }

  private pickDoc(value: Localized<RichDoc>, field: string): RichDoc | null {
    const picked = pickLocalized(value, this.context.locale, this.document.defaultLocale, isRichDocEmpty);
    if (picked?.fellBack) this.warn('missing-translation', `${field}:${picked.locale}`);
    return picked?.value ?? null;
  }

  private richOptions(): RichTextRenderOptions {
    return {
      interpolate: this.interpolate,
      resolveHref: this.resolveHref,
      linkColor: this.document.theme.brandColor,
      textColor: this.document.theme.textColor
    };
  }

  private alignAttr(align: 'start' | 'center' | 'end'): 'left' | 'center' | 'right' {
    if (align === 'center') return 'center';
    const start = this.dir === 'rtl' ? 'right' : 'left';
    const end = this.dir === 'rtl' ? 'left' : 'right';
    return align === 'start' ? start : end;
  }

  private button(label: string, href: string, color: string, align: 'start' | 'center' | 'end', fullWidth: boolean): string {
    const textColor = contrastingText(color);
    const width = fullWidth ? ' width="100%"' : '';
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${this.alignAttr(align)}"${width} style="margin:0 auto;${fullWidth ? 'width:100%;' : ''}">
  <tr><td align="center" bgcolor="${color}" style="border-radius:6px;background:${color};">
    <a href="${escapeHtml(href)}" style="display:${fullWidth ? 'block' : 'inline-block'};padding:12px 24px;font-family:${this.font};font-size:16px;font-weight:600;line-height:1.2;color:${textColor};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
  }

  /** One leaf block; null means "leave it out" (a warning says why). */
  leaf(block: LeafBlock, availableWidth: number): BlockOutput | null {
    const theme = this.document.theme;
    const align = 'align' in block ? this.alignAttr(block.align) : 'left';
    switch (block.type) {
      case 'heading': {
        const text = this.pick(block.text, 'text');
        if (!text) return this.empty();
        const size = { 1: 28, 2: 22, 3: 18 }[block.level];
        return {
          html: `<h${block.level} style="margin:0;font-family:${this.font};font-size:${size}px;line-height:1.3;font-weight:700;color:${theme.textColor};text-align:${align};">${escapeHtml(text)}</h${block.level}>`,
          text: text
        };
      }
      case 'text': {
        const doc = this.pickDoc(block.content, 'content');
        if (!doc) return this.empty();
        const options = this.richOptions();
        return {
          html: `<div style="font-family:${this.font};">${renderRichTextHtml(doc, options)}</div>`,
          text: renderRichTextPlain(doc, options)
        };
      }
      case 'image': {
        const alt = this.pick(block.alt, 'alt') ?? '';
        const href = block.href ? this.resolveHref(block.href) : null;
        const width = Math.round((availableWidth * block.width) / 100);
        const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;${align === 'center' ? 'margin:0 auto;' : ''}">`;
        return {
          html: `<div style="text-align:${align};">${href ? `<a href="${escapeHtml(href)}">${img}</a>` : img}</div>`,
          text: href && alt ? `${alt} (${href})` : alt
        };
      }
      case 'button': {
        const label = this.pick(block.label, 'label');
        const href = this.resolveHref(block.href);
        if (!label || !href) return this.empty();
        return {
          html: this.button(label, href, block.color ?? theme.brandColor, block.align, block.fullWidth),
          text: `${label}: ${href}`
        };
      }
      case 'product': {
        const product = this.context.products[block.productId];
        if (!product) {
          this.warn('missing-product', block.productId);
          return null;
        }
        const href = this.resolveHref(product.url);
        const label = this.pick(block.buttonLabel, 'buttonLabel') ?? this.context.strings.viewProduct;
        const price = formatPrice(product.priceCents, product.currency, this.context.locale);
        const compareAt =
          product.compareAtPriceCents && product.compareAtPriceCents > product.priceCents
            ? formatPrice(product.compareAtPriceCents, product.currency, this.context.locale)
            : null;
        const image =
          product.imageUrl && /^https:\/\//i.test(product.imageUrl)
            ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" width="${Math.min(availableWidth, 400)}" style="display:block;width:100%;max-width:${Math.min(availableWidth, 400)}px;height:auto;border:0;margin:0 auto 12px;border-radius:6px;">`
            : '';
        const extras = (product.extras ?? [])
          .map((line) => `<p style="margin:0 0 4px;font-size:14px;color:${theme.textColor};opacity:0.75;">${escapeHtml(line)}</p>`)
          .join('');
        const priceHtml = block.showPrice
          ? `<p style="margin:4px 0 12px;font-size:16px;color:${theme.textColor};">${compareAt ? `<s style="opacity:0.6;">${escapeHtml(compareAt)}</s> ` : ''}<strong>${escapeHtml(price)}</strong></p>`
          : '<div style="height:12px;line-height:12px;">&nbsp;</div>';
        return {
          html: `<div style="font-family:${this.font};text-align:${align};">
  ${href && image ? `<a href="${escapeHtml(href)}">${image}</a>` : image}
  <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${theme.textColor};">${escapeHtml(product.name)}</p>
  ${extras}
  ${priceHtml}
  ${href ? this.button(label, href, theme.brandColor, block.align, false) : ''}
</div>`,
          text: [
            product.name,
            ...(product.extras ?? []),
            block.showPrice ? (compareAt ? `${price} (${compareAt})` : price) : null,
            href
          ]
            .filter(Boolean)
            .join('\n')
        };
      }
      case 'discount': {
        const discount = this.context.discounts[block.code];
        if (!discount) {
          this.warn('missing-discount', block.code);
          return null;
        }
        const title = this.pick(block.title, 'title') ?? this.context.strings.discountTitle;
        const note = this.pick(block.note, 'note') ?? this.context.strings.discountHint;
        return {
          html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:20px;border:2px dashed ${theme.brandColor};border-radius:8px;font-family:${this.font};color:${theme.textColor};">
    <p style="margin:0 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(title)}</p>
    <p style="margin:0 0 4px;font-size:16px;font-weight:600;">${escapeHtml(discount.label)}</p>
    <p style="margin:8px 0;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;letter-spacing:0.1em;color:${theme.brandColor};">${escapeHtml(discount.code)}</p>
    <p style="margin:0;font-size:14px;opacity:0.8;">${escapeHtml(note)}</p>
  </td></tr>
</table>`,
          text: `${title}\n${discount.label}\n${discount.code}\n${note}`
        };
      }
      case 'divider':
        return {
          html: `<div style="border-top:1px solid ${block.color ?? '#e7e5e4'};height:1px;line-height:1px;font-size:1px;">&nbsp;</div>`,
          text: '----------'
        };
      case 'spacer':
        return { html: `<div style="height:${block.height}px;line-height:${block.height}px;font-size:1px;">&nbsp;</div>`, text: '' };
    }
  }

  private empty(): null {
    this.warn('empty-block');
    return null;
  }

  private columns(block: ColumnsBlock): BlockOutput | null {
    const widths = columnWidths(block.layout);
    const gutters = COLUMN_GUTTER * (widths.length - 1);
    const cells: string[] = [];
    const texts: string[] = [];
    let rendered = 0;
    block.columns.forEach((column, index) => {
      const columnWidth = Math.floor(((CONTENT_WIDTH - gutters) * widths[index]) / 100);
      const children = column
        .map((child) => this.guarded(child.id, () => this.leaf(child, columnWidth)))
        .filter((out): out is BlockOutput => out !== null);
      rendered += children.length;
      const padStart = index === 0 ? 0 : COLUMN_GUTTER / 2;
      const padEnd = index === widths.length - 1 ? 0 : COLUMN_GUTTER / 2;
      cells.push(
        `<td class="${block.stackOnMobile ? 'sf-col' : ''}" width="${widths[index]}%" valign="top" style="width:${widths[index]}%;padding:0 ${this.dir === 'rtl' ? padStart : padEnd}px 0 ${this.dir === 'rtl' ? padEnd : padStart}px;">
${children.map((child) => `<div class="sf-col-item" style="margin:0 0 16px;">${child.html}</div>`).join('\n')}
</td>`
      );
      texts.push(...children.map((child) => child.text).filter(Boolean));
    });
    if (rendered === 0) return null;
    return {
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${this.dir}"><tr>${cells.join('')}</tr></table>`,
      text: texts.join('\n\n')
    };
  }

  /** Runs one block's renderer; a throw drops that block, not the email. */
  guarded(blockId: string, render: () => BlockOutput | null): BlockOutput | null {
    const previous = this.currentBlock;
    this.currentBlock = blockId;
    try {
      return render();
    } catch (error) {
      this.warn('block-failed', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return null;
    } finally {
      this.currentBlock = previous;
    }
  }

  block(block: CampaignBlock): BlockOutput | null {
    return this.guarded(block.id, () => (block.type === 'columns' ? this.columns(block) : this.leaf(block, CONTENT_WIDTH)));
  }

  footer(): BlockOutput {
    const { theme } = this.document;
    const address = this.pick(this.document.footer, 'footer');
    const unsubscribe = this.context.unsubscribeUrl ? this.resolveHref(this.context.unsubscribeUrl) : null;
    if (!unsubscribe) this.warn('missing-unsubscribe');
    const muted = `color:${theme.textColor};opacity:0.7;`;
    const lines = [
      `<p style="margin:0 0 8px;">${escapeHtml(this.context.strings.footerReason)}</p>`,
      address ? `<p style="margin:0 0 8px;white-space:pre-line;">${escapeHtml(address)}</p>` : '',
      unsubscribe
        ? `<p style="margin:0;"><a href="${escapeHtml(unsubscribe)}" style="${muted}text-decoration:underline;">${escapeHtml(this.context.strings.unsubscribe)}</a></p>`
        : ''
    ];
    return {
      html: `<td align="center" class="sf-pad" style="padding:24px ${SIDE_PADDING}px;font-family:${this.font};font-size:12px;line-height:1.5;${muted}">${lines.join('')}</td>`,
      text: [this.context.strings.footerReason, address, unsubscribe ? `${this.context.strings.unsubscribe}: ${unsubscribe}` : null]
        .filter(Boolean)
        .join('\n')
    };
  }

  logo(): string {
    const { theme } = this.document;
    if (!theme.logoUrl) return '';
    const img = `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(this.context.shop.name)}" width="${theme.logoWidth}" style="display:block;width:${theme.logoWidth}px;max-width:100%;height:auto;border:0;margin:0 auto;">`;
    const href = this.values['shop.url'] && SAFE_URL.test(this.values['shop.url']) ? this.values['shop.url'] : null;
    return `<tr><td align="center" class="sf-pad" style="padding:24px ${SIDE_PADDING}px 8px;">${href ? `<a href="${escapeHtml(href)}">${img}</a>` : img}</td></tr>`;
  }

  subject(): string {
    // The envelope schema guarantees default-locale text.
    return this.pick(this.document.subject, 'subject') ?? '';
  }

  preheader(): string {
    return this.pick(this.document.preheader, 'preheader') ?? '';
  }
}

/**
 * Hidden text after the preheader, so the inbox preview does not fill up
 * with the first words of the body.
 */
const PREHEADER_PAD = '&#8199;&#847;'.repeat(60);

export function renderCampaign(input: unknown, context: CampaignRenderContext): CampaignRenderResult {
  const parsed = parseCampaignLenient(input);
  if (!parsed.ok) return { ok: false, error: 'invalid-document', issues: parsed.issues, warnings: [] };

  const { document } = parsed.parsed;
  const renderer = new Renderer(document, context);
  renderer.warnings.push(...parsed.parsed.warnings);

  const blocks = document.blocks.map((block) => renderer.block(block)).filter((out): out is BlockOutput => out !== null);
  if (blocks.length === 0) {
    return { ok: false, error: 'empty', issues: [], warnings: renderer.warnings };
  }

  const subject = renderer.subject();
  const preheader = renderer.preheader();
  const footer = renderer.footer();
  const { theme } = document;
  const dir = renderer.dir;
  const lang = hreflangOf(context.locale);

  const rows = blocks
    .map((block) => `<tr><td class="sf-pad" style="padding:12px ${SIDE_PADDING}px;">${block.html}</td></tr>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  @media only screen and (max-width:620px) {
    .sf-container { width:100% !important; }
    .sf-pad { padding-left:16px !important; padding-right:16px !important; }
    .sf-col { display:block !important; width:100% !important; padding:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${theme.backgroundColor};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${theme.backgroundColor};opacity:0;">${escapeHtml(preheader)}${PREHEADER_PAD}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.backgroundColor}" style="background:${theme.backgroundColor};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="sf-container" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;background:${theme.contentColor};border-radius:8px;">
${renderer.logo()}
${rows}
<tr><td style="height:12px;line-height:12px;font-size:1px;">&nbsp;</td></tr>
</table>
<table role="presentation" class="sf-container" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;">
<tr>${footer.html}</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [...blocks.map((block) => block.text).filter(Boolean), '', '---', footer.text].join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    ok: true,
    email: { subject, preheader, html, text, lang, dir, warnings: renderer.warnings }
  };
}

/** The `Email.campaign` wording, from a next-intl translator for the recipient's locale. */
export function campaignStrings(
  t: (key: string, values?: Record<string, string>) => string,
  shopName: string
): CampaignStrings {
  return {
    footerReason: t('footerReason', { shop: shopName }),
    unsubscribe: t('unsubscribe'),
    viewProduct: t('viewProduct'),
    discountTitle: t('discountTitle'),
    discountHint: t('discountHint')
  };
}
