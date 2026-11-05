/**
 * Rich text (the Tiptap JSON subset in ./schema) to email HTML and plain
 * text.
 *
 * Every tag is written here from the validated shape, with inline styles,
 * because many mail clients drop <style> rules. Text is interpolated
 * first and escaped after, so a merge value can never become markup.
 */

import { escapeHtml } from '../orderConfirmation';
import type { RichBlock, RichDoc, RichMark, RichParagraph } from './schema';

export interface RichTextRenderOptions {
  /** Merge tags in, safe-to-escape text out. */
  interpolate: (text: string) => string;
  /** Interpolates a link and returns it, or null when it is not safe to send. */
  resolveHref: (href: string) => string | null;
  linkColor: string;
  textColor: string;
}

const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 28, 2: 22, 3: 18 };

function alignStyle(align: string | null | undefined): string {
  return align && align !== 'left' ? `text-align:${align};` : '';
}

function openMark(mark: RichMark, options: RichTextRenderOptions): { open: string; close: string } | null {
  switch (mark.type) {
    case 'bold':
      return { open: '<strong>', close: '</strong>' };
    case 'italic':
      return { open: '<em>', close: '</em>' };
    case 'underline':
      return { open: '<u>', close: '</u>' };
    case 'strike':
      return { open: '<s>', close: '</s>' };
    case 'link': {
      const href = options.resolveHref(mark.attrs.href);
      if (!href) return null;
      return {
        open: `<a href="${escapeHtml(href)}" style="color:${options.linkColor};text-decoration:underline;">`,
        close: '</a>'
      };
    }
    case 'textStyle': {
      // Both values are from fixed lists or #rrggbb, so they are safe in CSS.
      const style = [
        mark.attrs.fontSize ? `font-size:${mark.attrs.fontSize};` : '',
        mark.attrs.color ? `color:${mark.attrs.color};` : ''
      ].join('');
      return style ? { open: `<span style="${style}">`, close: '</span>' } : null;
    }
  }
}

// Links go outermost so the link colour does not override a chosen colour.
const MARK_ORDER: RichMark['type'][] = ['link', 'textStyle', 'bold', 'italic', 'underline', 'strike'];

function inlineHtml(content: RichParagraph['content'], options: RichTextRenderOptions): string {
  return (content ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '<br>';
      let html = escapeHtml(options.interpolate(node.text));
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type)
      );
      for (const mark of marks) {
        const wrap = openMark(mark, options);
        if (wrap) html = `${wrap.open}${html}${wrap.close}`;
      }
      return html;
    })
    .join('');
}

function blockHtml(block: RichBlock, options: RichTextRenderOptions): string {
  const base = `margin:0 0 12px;color:${options.textColor};`;
  switch (block.type) {
    case 'paragraph': {
      const inner = inlineHtml(block.content, options);
      // An empty paragraph is a blank line the owner typed on purpose.
      return `<p style="${base}font-size:16px;line-height:1.5;${alignStyle(block.attrs?.textAlign)}">${inner || '&nbsp;'}</p>`;
    }
    case 'heading': {
      const level = block.attrs.level;
      return `<h${level} style="${base}font-size:${HEADING_SIZES[level]}px;line-height:1.3;font-weight:700;${alignStyle(block.attrs.textAlign)}">${inlineHtml(block.content, options)}</h${level}>`;
    }
    case 'bulletList':
    case 'orderedList': {
      const tag = block.type === 'bulletList' ? 'ul' : 'ol';
      const start = block.type === 'orderedList' && block.attrs?.start && block.attrs.start > 1 ? ` start="${block.attrs.start}"` : '';
      const items = block.content
        .map(
          (item) =>
            `<li style="margin:0 0 4px;">${item.content
              .map((paragraph) => inlineHtml(paragraph.content, options))
              .join('<br>')}</li>`
        )
        .join('');
      return `<${tag}${start} style="${base}padding-inline-start:24px;font-size:16px;line-height:1.5;">${items}</${tag}>`;
    }
  }
}

export function renderRichTextHtml(doc: RichDoc, options: RichTextRenderOptions): string {
  return doc.content.map((block) => blockHtml(block, options)).join('\n');
}

function inlineText(content: RichParagraph['content'], options: RichTextRenderOptions): string {
  return (content ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '\n';
      const text = options.interpolate(node.text);
      const link = node.marks?.find((mark) => mark.type === 'link');
      const href = link?.type === 'link' ? options.resolveHref(link.attrs.href) : null;
      // "Shop now (https://...)" unless the text already is the address.
      return href && href !== text ? `${text} (${href})` : text;
    })
    .join('');
}

export function renderRichTextPlain(doc: RichDoc, options: RichTextRenderOptions): string {
  return doc.content
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          return inlineText(block.content, options);
        case 'bulletList':
        case 'orderedList': {
          const start = block.type === 'orderedList' ? (block.attrs?.start ?? 1) : 1;
          return block.content
            .map((item, index) => {
              const bullet = block.type === 'bulletList' ? '-' : `${start + index}.`;
              return `${bullet} ${item.content.map((paragraph) => inlineText(paragraph.content, options)).join(' ')}`;
            })
            .join('\n');
        }
      }
    })
    .join('\n\n')
    .trim();
}
