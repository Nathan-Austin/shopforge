/**
 * Saved campaign templates: the `email_templates` row, what a save is
 * allowed to write, and the starter documents a new template begins from.
 *
 * Pure, like the renderer; the admin actions do the database work.
 */

import { languageOf } from '../../i18n/locales';
import type { Localized } from './localize';
import {
  validateCampaignDocument,
  type CampaignDocument,
  type CampaignDocumentInput,
  type CampaignIssue,
  type RichDoc
} from './schema';

export const TEMPLATE_NAME_MAX = 120;

/**
 * Bytes of JSON a document may take. The database refuses rows over 256 KB
 * (pg_column_size); this stays well under it, and a document anywhere near
 * it would render an email Gmail clips anyway.
 */
export const TEMPLATE_DOCUMENT_MAX_BYTES = 200_000;

export const TEMPLATE_COLUMNS = 'id, name, kind, document, last_test_sent_at, created_at, updated_at';

export interface EmailTemplateRow {
  id: string;
  name: string;
  kind: 'campaign';
  /** As stored: validated on save, but read leniently (see renderCampaign). */
  document: unknown;
  last_test_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  kind: 'campaign';
  document: unknown;
  lastTestSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toEmailTemplate(row: EmailTemplateRow): EmailTemplate {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    document: row.document,
    lastTestSentAt: row.last_test_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// --- Saving ------------------------------------------------------------------

export type TemplateSaveError = 'name' | 'document' | 'too-large';

export type TemplateSavePlan =
  | { ok: true; name: string; document: CampaignDocument | null }
  | { ok: false; error: TemplateSaveError; issues: CampaignIssue[] };

/** A trimmed name of 1 to TEMPLATE_NAME_MAX characters, or null. */
export function cleanTemplateName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= TEMPLATE_NAME_MAX ? name : null;
}

/**
 * What a save writes: the cleaned name, and the document after the strict
 * schema (defaults applied), or null when only the name changes. The
 * document may arrive as an object or as the JSON a form field carries.
 */
export function planTemplateSave(input: { name: unknown; document?: unknown }): TemplateSavePlan {
  const name = cleanTemplateName(input.name);
  if (!name) {
    return {
      ok: false,
      error: 'name',
      issues: [{ path: 'name', message: `A name of 1 to ${TEMPLATE_NAME_MAX} characters` }]
    };
  }
  if (input.document === undefined || input.document === null || input.document === '') {
    return { ok: true, name, document: null };
  }

  let raw = input.document;
  if (typeof raw === 'string') {
    if (byteLength(raw) > TEMPLATE_DOCUMENT_MAX_BYTES) return tooLarge();
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'document', issues: [{ path: '', message: 'Not valid JSON' }] };
    }
  }

  const validation = validateCampaignDocument(raw);
  if (!validation.ok) return { ok: false, error: 'document', issues: validation.issues };
  if (byteLength(JSON.stringify(validation.document)) > TEMPLATE_DOCUMENT_MAX_BYTES) return tooLarge();
  return { ok: true, name, document: validation.document };
}

function tooLarge(): TemplateSavePlan {
  return {
    ok: false,
    error: 'too-large',
    issues: [{ path: '', message: `The template is larger than ${TEMPLATE_DOCUMENT_MAX_BYTES / 1000} KB` }]
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** "Spring sale (copy)", shortened so it still fits the name limit. */
export function duplicateName(name: string, suffix: string): string {
  const tail = ` ${suffix.trim()}`;
  const room = TEMPLATE_NAME_MAX - tail.length;
  const head = name.length > room ? `${name.slice(0, Math.max(0, room - 1)).trimEnd()}…` : name;
  return `${head}${tail}`;
}

// --- What a document refers to ------------------------------------------------

/**
 * Product ids and discount codes used anywhere in a stored document, read
 * without validating it, so the lookups before rendering also cover a
 * block the strict schema would refuse.
 */
export function documentReferences(document: unknown): { productIds: string[]; discountCodes: string[] } {
  const productIds = new Set<string>();
  const discountCodes = new Set<string>();
  const visit = (block: unknown) => {
    if (!block || typeof block !== 'object') return;
    const record = block as Record<string, unknown>;
    if (record.type === 'product' && typeof record.productId === 'string') productIds.add(record.productId);
    if (record.type === 'discount' && typeof record.code === 'string') discountCodes.add(record.code.trim().toUpperCase());
    if (record.type === 'columns' && Array.isArray(record.columns)) {
      record.columns.forEach((column) => (Array.isArray(column) ? column.forEach(visit) : undefined));
    }
  };
  const blocks = document && typeof document === 'object' ? (document as { blocks?: unknown }).blocks : null;
  if (Array.isArray(blocks)) blocks.forEach(visit);
  return { productIds: [...productIds], discountCodes: [...discountCodes] };
}

// --- Starters -----------------------------------------------------------------

/** Text in the languages a starter ships with; `en` is required. */
export type StarterText = { en: string } & Partial<Record<string, string>>;

export type StarterBlock =
  | { type: 'heading'; level?: 1 | 2 | 3; text: StarterText }
  | { type: 'text'; paragraphs: StarterText[] }
  | { type: 'button'; label: StarterText; href: string }
  | { type: 'divider' }
  | { type: 'spacer'; height?: number };

export interface StarterDefinition {
  subject: StarterText;
  preheader?: StarterText;
  brandColor?: string;
  blocks: StarterBlock[];
}

/**
 * A starter's text for the shop's own locales. Each locale gets its
 * language's text when the starter has it; the default locale always gets
 * something (English if nothing closer), so the result validates. Other
 * locales without text are left out and fall back when rendered.
 */
function localizeStarter(text: StarterText, locales: readonly string[], defaultLocale: string): Localized<string> {
  const out: Localized<string> = {};
  for (const locale of locales) {
    const value = text[locale] ?? text[languageOf(locale)];
    if (value) out[locale] = value;
  }
  if (!out[defaultLocale]) out[defaultLocale] = text[languageOf(defaultLocale)] ?? text.en;
  return out;
}

function paragraphsDoc(paragraphs: string[]): RichDoc {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph' as const, content: text ? [{ type: 'text' as const, text }] : [] }))
  };
}

/** A starter definition as a document for this shop's locales. */
export function buildStarterDocument(
  starter: StarterDefinition,
  locales: readonly string[],
  defaultLocale: string
): CampaignDocumentInput {
  const localize = (text: StarterText) => localizeStarter(text, locales, defaultLocale);
  const blocks = starter.blocks.map((block, index): CampaignDocumentInput['blocks'][number] => {
    const id = `${block.type}-${index + 1}`;
    switch (block.type) {
      case 'heading':
        return { id, type: 'heading', level: block.level ?? 1, text: localize(block.text) as Record<string, string> };
      case 'text': {
        const perLocale = block.paragraphs.map(localize);
        const content: Record<string, RichDoc> = {};
        for (const locale of Object.keys(perLocale[0] ?? {})) {
          content[locale] = paragraphsDoc(perLocale.map((paragraph) => paragraph[locale] ?? ''));
        }
        return { id, type: 'text', content };
      }
      case 'button':
        return { id, type: 'button', label: localize(block.label) as Record<string, string>, href: block.href };
      case 'divider':
        return { id, type: 'divider' };
      case 'spacer':
        return { id, type: 'spacer', height: block.height ?? 24 };
    }
  });
  return {
    version: 1,
    defaultLocale,
    subject: localize(starter.subject) as Record<string, string>,
    preheader: starter.preheader ? (localize(starter.preheader) as Record<string, string>) : {},
    theme: starter.brandColor ? { brandColor: starter.brandColor } : {},
    blocks
  };
}
