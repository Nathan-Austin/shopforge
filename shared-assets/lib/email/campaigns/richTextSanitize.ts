/**
 * Tiptap's JSON, made to fit the campaign schema's rich-text subset.
 *
 * The editor is configured to offer only what an email can show, but
 * Tiptap still produces things the schema refuses: a nested list when the
 * owner presses Tab in a list, a quote or a fourth-level heading pasted
 * from a web page, a colour written as rgb(), a font size typed by hand.
 * Rather than refuse the save, this folds them into the nearest thing the
 * schema allows, so what the owner typed is kept and still validates.
 */

import { FONT_SIZES, type RichDoc, type RichMark } from './schema';

type Json = Record<string, unknown>;
type Inline = { type: 'text'; text: string; marks?: RichMark[] } | { type: 'hardBreak' };
type Paragraph = { type: 'paragraph'; attrs?: { textAlign?: Align }; content?: Inline[] };
type Align = 'left' | 'center' | 'right' | 'justify' | null;

const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const FONT_SIZE_PX = FONT_SIZES.map((size) => Number.parseInt(size, 10));

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function children(node: Json): Json[] {
  return Array.isArray(node.content) ? node.content.filter(isObject) : [];
}

function align(node: Json): Align {
  const value = isObject(node.attrs) ? node.attrs.textAlign : null;
  return typeof value === 'string' && ALIGNS.has(value) ? (value as Align) : null;
}

/** `#abc`, `#aabbcc` or `rgb(1, 2, 3)` as `#rrggbb`; anything else is dropped. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  const short = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number);
    if (parts.every((part) => part <= 255)) return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

/** The offered size closest to the one given (`17px` -> `16px`), or null. */
export function nearestFontSize(value: unknown): (typeof FONT_SIZES)[number] | null {
  if (typeof value !== 'string') return null;
  const px = Number.parseFloat(value);
  if (!Number.isFinite(px) || px <= 0) return null;
  let best = 0;
  FONT_SIZE_PX.forEach((size, index) => {
    if (Math.abs(size - px) < Math.abs(FONT_SIZE_PX[best] - px)) best = index;
  });
  return FONT_SIZES[best];
}

function cleanMarks(raw: unknown): RichMark[] {
  if (!Array.isArray(raw)) return [];
  const marks: RichMark[] = [];
  const seen = new Set<string>();
  for (const mark of raw.filter(isObject)) {
    const type = mark.type;
    if (typeof type !== 'string' || seen.has(type)) continue;
    if (type === 'bold' || type === 'italic' || type === 'underline' || type === 'strike') {
      marks.push({ type });
    } else if (type === 'link') {
      const href = isObject(mark.attrs) && typeof mark.attrs.href === 'string' ? mark.attrs.href.trim() : '';
      // The schema decides whether the address is acceptable; an empty one is no link.
      if (href) marks.push({ type: 'link', attrs: { href } });
    } else if (type === 'textStyle' && isObject(mark.attrs)) {
      const fontSize = nearestFontSize(mark.attrs.fontSize);
      const color = normalizeColor(mark.attrs.color);
      if (fontSize || color) marks.push({ type: 'textStyle', attrs: { fontSize, color } });
    } else {
      continue;
    }
    seen.add(type);
  }
  return marks;
}

function inline(nodes: Json[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && typeof node.text === 'string' && node.text) {
      const marks = cleanMarks(node.marks);
      out.push(marks.length ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text });
    } else if (node.type === 'hardBreak') {
      out.push({ type: 'hardBreak' });
    } else if (Array.isArray(node.content)) {
      // An inline node we don't know (a mention, an emoji node): keep its text.
      out.push(...inline(children(node)));
    }
  }
  return out;
}

function paragraph(content: Inline[], textAlign: Align = null): Paragraph {
  return {
    type: 'paragraph',
    ...(textAlign ? { attrs: { textAlign } } : {}),
    ...(content.length ? { content } : {})
  };
}

/** A list item's non-list child as paragraphs (a quote inside an item gives its own). */
function itemParagraphs(child: Json): Paragraph[] {
  const nested = children(child).filter((node) => node.type !== 'text' && node.type !== 'hardBreak');
  if (nested.length) return nested.flatMap(itemParagraphs);
  return [paragraph(inline(children(child)))];
}

/** Every item of a list, nested lists lifted to the same level, in reading order. */
function flattenListItems(list: Json): Paragraph[][] {
  const items: Paragraph[][] = [];
  for (const item of children(list)) {
    let own: Paragraph[] = [];
    for (const child of children(item)) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (own.length) items.push(own);
        own = [];
        items.push(...flattenListItems(child));
      } else {
        own.push(...itemParagraphs(child));
      }
    }
    if (own.length) items.push(own);
  }
  // The schema allows ten paragraphs per item.
  return items.map((paragraphs) => paragraphs.slice(0, 10));
}

type Block = RichDoc['content'][number];

function blocks(nodes: Json[]): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        out.push(paragraph(inline(children(node)), align(node)));
        break;
      case 'heading': {
        const level = isObject(node.attrs) ? Number(node.attrs.level) : 1;
        const content = inline(children(node));
        // Levels beyond 3 read as a bold paragraph.
        if (level >= 1 && level <= 3) {
          out.push({ type: 'heading', attrs: { level: level as 1 | 2 | 3, textAlign: align(node) }, ...(content.length ? { content } : {}) });
        } else {
          const bold = content.map((piece): Inline =>
            piece.type === 'text'
              ? { ...piece, marks: [...(piece.marks ?? []).filter((mark) => mark.type !== 'bold'), { type: 'bold' }] }
              : piece
          );
          out.push(paragraph(bold, align(node)));
        }
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = flattenListItems(node).filter((item) => item.length > 0).slice(0, 50);
        if (!items.length) break;
        const content = items.map((paragraphs) => ({ type: 'listItem' as const, content: paragraphs }));
        if (node.type === 'bulletList') {
          out.push({ type: 'bulletList', content });
        } else {
          const start = isObject(node.attrs) ? Number(node.attrs.start) : 1;
          out.push({
            type: 'orderedList',
            ...(Number.isInteger(start) && start > 1 && start <= 1000 ? { attrs: { start } } : {}),
            content
          });
        }
        break;
      }
      default:
        // Quotes, code blocks, tables, anything else: their blocks, or their text.
        if (children(node).some((child) => child.type !== 'text' && child.type !== 'hardBreak')) {
          out.push(...blocks(children(node)));
        } else {
          const content = inline(children(node));
          if (content.length) out.push(paragraph(content));
        }
    }
  }
  return out;
}

export function sanitizeRichDoc(raw: unknown): RichDoc {
  const content = isObject(raw) ? blocks(children(raw)) : [];
  return { type: 'doc', content: content.slice(0, 100) };
}

/** A document of plain paragraphs, one per line of text. */
export function plainTextDoc(text: string): RichDoc {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => paragraph(line ? [{ type: 'text', text: line }] : []))
  };
}
