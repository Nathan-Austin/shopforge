/**
 * What the designer does to a campaign document: add, move, copy and
 * remove blocks, change a column layout, set text for one language, and
 * undo it all. Pure functions over immutable documents, so React state
 * stays simple and every operation is tested without a browser.
 *
 * Blocks are found by id (ids are unique across the document, columns
 * included). An operation that makes no sense (columns inside columns, an
 * unknown id) returns the document unchanged rather than throwing: the UI
 * should not offer it, and if it does, nothing breaks.
 */

import { isBlankString, pickLocalized, type Localized } from './localize';
import { parseCampaignLenient, type CampaignWarning } from './render';
import { plainTextDoc } from './richTextSanitize';
import {
  isRichDocEmpty,
  type BlockType,
  type CampaignBlock,
  type CampaignDocument,
  type ColumnsBlock,
  type LeafBlock,
  type RichDoc
} from './schema';

export const BLOCK_TYPES: BlockType[] = ['heading', 'text', 'image', 'button', 'product', 'discount', 'divider', 'spacer', 'columns'];
export const LEAF_BLOCK_TYPES = BLOCK_TYPES.filter((type) => type !== 'columns') as LeafBlock['type'][];

/** Where a block goes: the top level, or a column of a columns block. */
export type BlockTarget = { parentId: null; index: number } | { parentId: string; column: number; index: number };

export interface BlockLocation {
  block: CampaignBlock;
  parentId: string | null;
  column: number | null;
  index: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function findBlock(doc: CampaignDocument, id: string): BlockLocation | null {
  for (const [index, block] of doc.blocks.entries()) {
    if (block.id === id) return { block, parentId: null, column: null, index };
    if (block.type === 'columns') {
      for (const [column, children] of block.columns.entries()) {
        const childIndex = children.findIndex((child) => child.id === id);
        if (childIndex >= 0) return { block: children[childIndex], parentId: block.id, column, index: childIndex };
      }
    }
  }
  return null;
}

export function allBlockIds(doc: CampaignDocument): string[] {
  return doc.blocks.flatMap((block) => [block.id, ...(block.type === 'columns' ? block.columns.flat().map((child) => child.id) : [])]);
}

/** `heading-3`: the type and the lowest number not taken. */
export function newBlockId(doc: CampaignDocument, type: BlockType, taken: Set<string> = new Set(allBlockIds(doc))): string {
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/** The array a location points into, in a (cloned) document. */
function container(doc: CampaignDocument, parentId: string | null, column: number | null): CampaignBlock[] | null {
  if (parentId === null) return doc.blocks;
  const parent = doc.blocks.find((block) => block.id === parentId);
  if (!parent || parent.type !== 'columns' || column === null || !parent.columns[column]) return null;
  return parent.columns[column];
}

/** Placeholder wording for new blocks, in the admin's language. */
export interface NewBlockText {
  heading: string;
  text: string;
  button: string;
}

/**
 * A new block. Text goes into each of `locales` (the default language and
 * the one being edited), so the block is valid at once. Image, product and
 * discount blocks start empty and are flagged until something is chosen.
 */
export function createBlock(doc: CampaignDocument, type: BlockType, locales: string[], text: NewBlockText): CampaignBlock {
  const id = newBlockId(doc, type);
  const each = <T,>(value: T) => Object.fromEntries(locales.map((locale) => [locale, clone(value)])) as Record<string, T>;
  switch (type) {
    case 'heading':
      return { id, type, level: 2, text: each(text.heading), align: 'start' };
    case 'text':
      return { id, type, content: each(plainTextDoc(text.text)) };
    case 'image':
      return { id, type, src: '', alt: {}, href: null, width: 100, align: 'center' };
    case 'button':
      return { id, type, label: each(text.button), href: '{{shop.locale_url}}', color: null, fullWidth: false, align: 'center' };
    case 'product':
      return { id, type, productId: '', showPrice: true, buttonLabel: {}, align: 'center' };
    case 'discount':
      return { id, type, code: '', title: {}, note: {} };
    case 'divider':
      return { id, type, color: null };
    case 'spacer':
      return { id, type, height: 24 };
    case 'columns':
      return { id, type, layout: '1-1', columns: [[], []], stackOnMobile: true };
  }
}

export function insertBlock(doc: CampaignDocument, block: CampaignBlock, target: BlockTarget): CampaignDocument {
  if (target.parentId !== null && block.type === 'columns') return doc;
  const next = clone(doc);
  const list = container(next, target.parentId, target.parentId === null ? null : target.column);
  if (!list) return doc;
  list.splice(Math.max(0, Math.min(target.index, list.length)), 0, clone(block));
  return next;
}

export function removeBlock(doc: CampaignDocument, id: string): CampaignDocument {
  const location = findBlock(doc, id);
  if (!location) return doc;
  const next = clone(doc);
  container(next, location.parentId, location.column)?.splice(location.index, 1);
  return next;
}

export function updateBlock<T extends CampaignBlock>(doc: CampaignDocument, id: string, update: (block: T) => T): CampaignDocument {
  const location = findBlock(doc, id);
  if (!location) return doc;
  const next = clone(doc);
  const list = container(next, location.parentId, location.column);
  if (!list) return doc;
  const updated = update(list[location.index] as T);
  // An update may not change a block's identity or turn a child into columns.
  if (updated.id !== id || (location.parentId !== null && updated.type === 'columns')) return doc;
  list[location.index] = updated;
  return next;
}

export function moveBlock(doc: CampaignDocument, id: string, target: BlockTarget): CampaignDocument {
  const location = findBlock(doc, id);
  if (!location) return doc;
  if (target.parentId !== null && (location.block.type === 'columns' || target.parentId === id)) return doc;
  const sameContainer =
    location.parentId === target.parentId && (target.parentId === null || location.column === target.column);
  // Removing the block first shifts later positions in its own container up by one.
  const index = sameContainer && location.index < target.index ? target.index - 1 : target.index;
  if (sameContainer && index === location.index) return doc;
  const without = removeBlock(doc, id);
  const moved = insertBlock(without, location.block, { ...target, index } as BlockTarget);
  return moved === without ? doc : moved;
}

/**
 * One step up or down. At the edge of a column the block steps out of the
 * columns, just before or after them, so the arrows alone can take a block
 * out of a column.
 */
export function moveBlockBy(doc: CampaignDocument, id: string, delta: -1 | 1): CampaignDocument {
  const location = findBlock(doc, id);
  if (!location) return doc;
  const list = container(doc, location.parentId, location.column);
  if (!list) return doc;
  const index = location.index + delta;
  if (index >= 0 && index < list.length) {
    return moveBlock(doc, id, { ...targetOf(location), index: delta > 0 ? index + 1 : index } as BlockTarget);
  }
  if (location.parentId === null) return doc;
  const parentIndex = doc.blocks.findIndex((block) => block.id === location.parentId);
  return moveBlock(doc, id, { parentId: null, index: delta > 0 ? parentIndex + 1 : parentIndex });
}

function targetOf(location: BlockLocation): BlockTarget {
  return location.parentId === null
    ? { parentId: null, index: location.index }
    : { parentId: location.parentId, column: location.column ?? 0, index: location.index };
}

/** A copy right after the original, with fresh ids for it and its children. */
export function duplicateBlock(doc: CampaignDocument, id: string): CampaignDocument {
  const location = findBlock(doc, id);
  if (!location) return doc;
  const taken = new Set(allBlockIds(doc));
  const fresh = (block: LeafBlock): LeafBlock => {
    const blockId = newBlockId(doc, block.type, taken);
    taken.add(blockId);
    return { ...clone(block), id: blockId };
  };
  let copy: CampaignBlock;
  if (location.block.type === 'columns') {
    const columnsId = newBlockId(doc, 'columns', taken);
    taken.add(columnsId);
    copy = { ...clone(location.block), id: columnsId, columns: location.block.columns.map((column) => column.map(fresh)) };
  } else {
    copy = fresh(location.block);
  }
  return insertBlock(doc, copy, { ...targetOf(location), index: location.index + 1 } as BlockTarget);
}

/**
 * Two or three columns. Going from three to two moves the third column's
 * blocks to the end of the second, so nothing is lost.
 */
export function setColumnsLayout(doc: CampaignDocument, id: string, layout: ColumnsBlock['layout']): CampaignDocument {
  return updateBlock<CampaignBlock>(doc, id, (block) => {
    if (block.type !== 'columns') return block;
    const count = layout === '1-1-1' ? 3 : 2;
    const columns = block.columns.map((column) => [...column]);
    while (columns.length < count) columns.push([]);
    while (columns.length > count) {
      const extra = columns.pop() ?? [];
      columns[columns.length - 1].push(...extra);
    }
    return { ...block, layout, columns };
  });
}

// --- Text per language -----------------------------------------------------------

/** Sets one language's text; an emptied field is removed so it falls back. */
export function setLocalized<T>(value: Localized<T> | undefined, locale: string, entry: T, isEmpty: (entry: T) => boolean): Record<string, T> {
  const next = { ...(value ?? {}) } as Record<string, T>;
  if (isEmpty(entry)) delete next[locale];
  else next[locale] = entry;
  return next;
}

export const setLocalizedText = (value: Localized<string> | undefined, locale: string, text: string) =>
  setLocalized(value, locale, text, isBlankString);

export const setLocalizedDoc = (value: Localized<RichDoc> | undefined, locale: string, doc: RichDoc) =>
  setLocalized(value, locale, doc, isRichDocEmpty);

export interface MissingTranslation {
  /** Null for the subject, preview text and footer. */
  blockId: string | null;
  field: string;
}

/**
 * Fields that have text in the default language but not in `locale` (its
 * language counting: `de` text serves `de-at`). The default language
 * itself never "misses" anything here; empty required text there is a
 * validation issue instead.
 */
export function missingTranslations(doc: CampaignDocument, locale: string): MissingTranslation[] {
  if (locale === doc.defaultLocale) return [];
  const missing: MissingTranslation[] = [];
  const checkText = (blockId: string | null, field: string, value: Localized<string> | undefined) => {
    if (!value?.[doc.defaultLocale]?.trim()) return;
    const picked = pickLocalized(value, locale, doc.defaultLocale, isBlankString);
    if (!picked || picked.fellBack) missing.push({ blockId, field });
  };
  const checkDoc = (blockId: string, value: Localized<RichDoc>) => {
    const own = value[doc.defaultLocale];
    if (!own || isRichDocEmpty(own)) return;
    const picked = pickLocalized(value, locale, doc.defaultLocale, isRichDocEmpty);
    if (!picked || picked.fellBack) missing.push({ blockId, field: 'content' });
  };
  checkText(null, 'subject', doc.subject);
  checkText(null, 'preheader', doc.preheader);
  checkText(null, 'footer', doc.footer);
  const visit = (block: CampaignBlock) => {
    switch (block.type) {
      case 'heading':
        return checkText(block.id, 'text', block.text);
      case 'text':
        return checkDoc(block.id, block.content);
      case 'image':
        return checkText(block.id, 'alt', block.alt);
      case 'button':
        return checkText(block.id, 'label', block.label);
      case 'product':
        return checkText(block.id, 'buttonLabel', block.buttonLabel);
      case 'discount':
        checkText(block.id, 'title', block.title);
        return checkText(block.id, 'note', block.note);
      case 'columns':
        return block.columns.flat().forEach(visit);
      default:
        return undefined;
    }
  };
  doc.blocks.forEach(visit);
  return missing;
}

/** The block a validation issue's path points into, or null for the document itself. */
export function issueBlockId(doc: CampaignDocument, path: string): string | null {
  const parts = path.split('.');
  if (parts[0] !== 'blocks' || parts.length < 2) return null;
  const block = doc.blocks[Number(parts[1])];
  if (!block) return null;
  if (block.type === 'columns' && parts[2] === 'columns' && parts.length >= 5) {
    return block.columns[Number(parts[3])]?.[Number(parts[4])]?.id ?? block.id;
  }
  return block.id;
}

// --- Loading ----------------------------------------------------------------------

/**
 * A stored document for editing. One that fails the strict schema is read
 * leniently: blocks that cannot be read are dropped (and listed), and the
 * designer shows what is left. With no usable subject either, the owner
 * starts from an empty document in the shop's default language.
 */
export function loadForEditing(raw: unknown, fallbackLocale: string): { document: CampaignDocument; dropped: CampaignWarning[]; reset: boolean } {
  const parsed = parseCampaignLenient(raw);
  if (parsed.ok) return { document: parsed.parsed.document, dropped: parsed.parsed.warnings, reset: false };
  return { document: emptyDocument(fallbackLocale), dropped: [], reset: true };
}

export function emptyDocument(defaultLocale: string): CampaignDocument {
  return {
    version: 1,
    defaultLocale,
    subject: {},
    preheader: {},
    footer: {},
    theme: {
      brandColor: '#111111',
      textColor: '#1c1917',
      backgroundColor: '#f5f5f4',
      contentColor: '#ffffff',
      fontFamily: 'system',
      logoUrl: null,
      logoWidth: 140
    },
    blocks: []
  };
}

// --- Undo and redo ----------------------------------------------------------------

export const HISTORY_LIMIT = 100;
/** Edits to the same field within this window are one undo step, not one per keystroke. */
export const COALESCE_MS = 1000;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export type HistoryAction<T> =
  | { type: 'edit'; next: T; key?: string; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; present: T };

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case 'edit': {
      if (action.next === state.present) return state;
      const coalesce = action.key !== undefined && action.key === state.lastKey && action.at - state.lastAt < COALESCE_MS;
      return {
        past: coalesce ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: action.next,
        future: [],
        lastKey: action.key ?? null,
        lastAt: action.at
      };
    }
    case 'undo': {
      if (!state.past.length) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        lastKey: null,
        lastAt: 0
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        lastKey: null,
        lastAt: 0
      };
    }
    case 'reset':
      return initHistory(action.present);
  }
}
