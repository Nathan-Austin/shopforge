/**
 * The frame around a transactional email: the same table layout, logo,
 * colours and font as a campaign (see ./campaigns/render), so a receipt and
 * a newsletter from the same shop look like they came from the same shop.
 *
 * The three transactional renderers produce their body with the helpers
 * here and hand it to renderTransactionalEmail(), which adds the outer
 * tables, the logo, the brand footer and the plain-text tail. Pure, and
 * everything that came from a customer or a product is escaped by the
 * caller before it gets here.
 */

import { directionOf, hreflangOf } from '../i18n/locales';
import { DEFAULT_EMAIL_BRAND, brandFooterFor, transactionalCopyFor, type EmailBrand, type TransactionalCopy, type TransactionalKind } from './brand';
import { EMAIL_WIDTH, FONT_STACKS, contrastingText } from './campaigns/render';
import { escapeHtml } from './escape';
import { interpolateWording, type WordingValues } from './wordingTags';

const SIDE_PADDING = 32;
const RULE_COLOR = '#e5e5e5';

export interface TransactionalFrameInput {
  /** The brand; a shop that has set none sends with the defaults. */
  brand?: EmailBrand;
  locale: string;
  /** `<title>` and the logo's alt text. */
  subject: string;
  shopName: string;
  /** Where the logo links to, if the shop knows its own address. */
  shopUrl?: string | null;
  /** Already-escaped HTML for the card, and its plain-text counterpart. */
  body: { html: string; text: string };
  /** The email's own last line ("Questions? Just reply to this email."). */
  footerNote?: string | null;
  /** The brand's footer for this locale: the postal address, a legal line. */
  footerAddress?: string | null;
}

export interface TransactionalFrame {
  html: string;
  text: string;
}

/**
 * What a caller passes a transactional renderer besides the order and the
 * wording. All optional: with none of it the email looks like the shop's
 * default brand and links nowhere but the order.
 */
export interface TransactionalOptions {
  brand?: EmailBrand;
  /** The shop's own address, for the logo link. */
  shopUrl?: string | null;
  /** The shop's default locale, the last fallback for the brand footer. */
  defaultLocale?: string;
}

/** The owner's intro and footer wording for this email and recipient, from the options. */
export function copyFor(
  options: TransactionalOptions | undefined,
  kind: TransactionalKind,
  locale: string,
  values: WordingValues = {}
): TransactionalCopy {
  const brand = options?.brand ?? DEFAULT_EMAIL_BRAND;
  const copy = transactionalCopyFor(brand, kind, locale, options?.defaultLocale ?? 'en');
  // Tags filled in; a text that comes out empty counts as not written.
  const fill = (text: string | null) => (text === null ? null : interpolateWording(text, values).trim() || null);
  return { intro: fill(copy.intro), footer: fill(copy.footer) };
}

/** A paragraph of the owner's wording; line breaks kept. */
export function emailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;white-space:pre-line;">${escapeHtml(text)}</p>`;
}

/** The brand footer for this recipient, from the options. */
export function footerAddressFor(options: TransactionalOptions | undefined, locale: string): string | null {
  const brand = options?.brand ?? DEFAULT_EMAIL_BRAND;
  return brandFooterFor(brand, locale, options?.defaultLocale ?? 'en');
}

/** CSS fragments a body shares with the frame, derived from the brand. */
export interface EmailStyles {
  font: string;
  text: string;
  muted: string;
  /** Section heading: small caps-style label above a block. */
  heading: string;
  /** A hairline between rows. A fixed light grey: Outlook for Windows drops colours with alpha. */
  rule: string;
  /** The hairline's colour on its own, for a border on a box. */
  ruleColor: string;
  /** A filled button in the brand colour; the label colour is picked for contrast. */
  button: string;
  link: string;
}

export function emailStyles(brand: EmailBrand = DEFAULT_EMAIL_BRAND): EmailStyles {
  const font = FONT_STACKS[brand.fontFamily];
  return {
    font,
    text: `font-family:${font};color:${brand.textColor};`,
    muted: `color:${brand.textColor};opacity:0.7;`,
    heading: `font-family:${font};font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:${brand.textColor};opacity:0.7;margin:24px 0 8px;`,
    rule: `border-bottom:1px solid ${RULE_COLOR};`,
    ruleColor: RULE_COLOR,
    button: `display:inline-block;background:${brand.brandColor};color:${contrastingText(brand.brandColor)};font-family:${font};font-size:15px;font-weight:600;padding:12px 20px;border-radius:6px;text-decoration:none;`,
    link: `color:${brand.brandColor};text-decoration:underline;`
  };
}

/** A filled button. `href` must already be a safe, absolute URL. */
export function emailButton(label: string, href: string, styles: EmailStyles): string {
  return `<p style="margin:24px 0 0;"><a href="${escapeHtml(href)}" style="${styles.button}">${escapeHtml(label)}</a></p>`;
}

export function emailHeading(text: string, styles: EmailStyles): string {
  return `<h2 style="${styles.heading}">${escapeHtml(text)}</h2>`;
}

function logoRow(brand: EmailBrand, shopName: string, shopUrl: string | null | undefined): string {
  if (!brand.logoUrl) return '';
  const img = `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(shopName)}" width="${brand.logoWidth}" style="display:block;width:${brand.logoWidth}px;max-width:100%;height:auto;border:0;margin:0 auto;">`;
  const href = shopUrl && /^https?:\/\/[^\s"'<>]+$/i.test(shopUrl) ? shopUrl : null;
  return `<tr><td align="center" class="sf-pad" style="padding:24px ${SIDE_PADDING}px 8px;">${href ? `<a href="${escapeHtml(href)}">${img}</a>` : img}</td></tr>`;
}

export function renderTransactionalEmail(input: TransactionalFrameInput): TransactionalFrame {
  const brand = input.brand ?? DEFAULT_EMAIL_BRAND;
  const styles = emailStyles(brand);
  const dir = directionOf(input.locale);
  const lang = hreflangOf(input.locale);
  const note = input.footerNote?.trim() || null;
  const address = input.footerAddress?.trim() || null;

  const footerLines = [
    note ? `<p style="margin:0 0 8px;">${escapeHtml(note)}</p>` : '',
    address ? `<p style="margin:0;white-space:pre-line;">${escapeHtml(address)}</p>` : ''
  ].join('');

  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  @media only screen and (max-width:620px) {
    .sf-container { width:100% !important; }
    .sf-pad { padding-left:16px !important; padding-right:16px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${brand.backgroundColor};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${brand.backgroundColor}" style="background:${brand.backgroundColor};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="sf-container" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;background:${brand.contentColor};border-radius:8px;">
${logoRow(brand, input.shopName, input.shopUrl)}
<tr><td class="sf-pad" style="padding:24px ${SIDE_PADDING}px;${styles.text}font-size:15px;line-height:1.5;">
${input.body.html}
</td></tr>
</table>
${
  footerLines
    ? `<table role="presentation" class="sf-container" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;">
<tr><td align="center" class="sf-pad" style="padding:24px ${SIDE_PADDING}px;font-family:${styles.font};font-size:12px;line-height:1.5;${styles.muted}">${footerLines}</td></tr>
</table>`
    : ''
}
</td></tr>
</table>
</body>
</html>`;

  const text = [input.body.text.trimEnd(), note, address].filter((part): part is string => Boolean(part)).join('\n\n');

  return { html, text };
}
