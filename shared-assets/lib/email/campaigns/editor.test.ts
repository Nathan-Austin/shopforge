import { describe, expect, it } from 'vitest';

import {
  allBlockIds,
  createBlock,
  duplicateBlock,
  emptyDocument,
  findBlock,
  historyReducer,
  initHistory,
  insertBlock,
  issueBlockId,
  loadForEditing,
  missingTranslations,
  moveBlock,
  moveBlockBy,
  newBlockId,
  removeBlock,
  setColumnsLayout,
  setLocalizedDoc,
  setLocalizedText,
  updateBlock,
  BLOCK_TYPES,
  COALESCE_MS
} from './editor';
import { sampleDocument } from './fixtures';
import { plainTextDoc } from './richTextSanitize';
import { validateCampaignDocument, type CampaignDocument } from './schema';

const TEXT = { heading: 'New heading', text: 'New text', button: 'Click here' };

function sample(): CampaignDocument {
  const result = validateCampaignDocument(sampleDocument());
  if (!result.ok) throw new Error('fixture invalid');
  return result.document;
}

/** Top-level ids, with column contents in brackets: `h1 cols[c1|c2] sp`. */
function layout(doc: CampaignDocument): string {
  return doc.blocks
    .map((block) => (block.type === 'columns' ? `${block.id}[${block.columns.map((c) => c.map((b) => b.id).join(',')).join('|')}]` : block.id))
    .join(' ');
}

describe('finding and naming blocks', () => {
  it('finds top-level and column blocks', () => {
    const doc = sample();
    expect(findBlock(doc, 'h1')).toMatchObject({ parentId: null, column: null, index: 0 });
    expect(findBlock(doc, 'c2')).toMatchObject({ parentId: 'cols', column: 1, index: 0 });
    expect(findBlock(doc, 'nope')).toBeNull();
  });

  it('gives new blocks the lowest free number', () => {
    const doc = insertBlock(sample(), { id: 'heading-1', type: 'heading', level: 2, text: { en: 'x' }, align: 'start' }, { parentId: null, index: 0 });
    expect(newBlockId(doc, 'heading')).toBe('heading-2');
    expect(newBlockId(doc, 'spacer')).toBe('spacer-1');
  });
});

describe('createBlock', () => {
  it.each(BLOCK_TYPES)('makes a %s block with a fresh id', (type) => {
    const block = createBlock(sample(), type, ['en'], TEXT);
    expect(block.type).toBe(type);
    expect(allBlockIds(sample())).not.toContain(block.id);
  });

  it('puts placeholder text in the default and the edited language, valid at once', () => {
    const doc = sample();
    for (const type of ['heading', 'text', 'button', 'divider', 'spacer', 'columns'] as const) {
      const block = createBlock(doc, type, ['en', 'de'], TEXT);
      expect(validateCampaignDocument({ ...doc, blocks: [block] }).ok, type).toBe(true);
    }
    expect(createBlock(doc, 'heading', ['en', 'de'], TEXT)).toMatchObject({ text: { en: 'New heading', de: 'New heading' } });
  });

  it('leaves image, product and discount blocks to be filled in, which validation flags', () => {
    const doc = sample();
    for (const type of ['image', 'product', 'discount'] as const) {
      const result = validateCampaignDocument({ ...doc, blocks: [createBlock(doc, type, ['en'], TEXT)] });
      expect(result.ok, type).toBe(false);
      if (!result.ok) expect(issueBlockId(doc, result.issues[0].path)).toBe(doc.blocks[0].id);
    }
  });
});

describe('insert, remove, update', () => {
  it('inserts at a position, at the top level or in a column', () => {
    let doc = sample();
    doc = insertBlock(doc, createBlock(doc, 'divider', ['en'], TEXT), { parentId: null, index: 1 });
    doc = insertBlock(doc, createBlock(doc, 'spacer', ['en'], TEXT), { parentId: 'cols', column: 0, index: 1 });
    expect(layout(doc)).toBe('h1 divider-1 t1 img p1 d1 div cols[c1,spacer-1|c2] sp btn');
  });

  it('never puts columns inside columns', () => {
    const doc = sample();
    const columns = createBlock(doc, 'columns', ['en'], TEXT);
    expect(insertBlock(doc, columns, { parentId: 'cols', column: 0, index: 0 })).toBe(doc);
  });

  it('leaves the original untouched', () => {
    const doc = sample();
    const before = JSON.stringify(doc);
    removeBlock(doc, 'c1');
    updateBlock(doc, 'h1', (block) => ({ ...block, level: 3 }) as never);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('removes from anywhere, ignoring unknown ids', () => {
    const doc = sample();
    expect(layout(removeBlock(doc, 'c1'))).toBe('h1 t1 img p1 d1 div cols[|c2] sp btn');
    expect(removeBlock(doc, 'nope')).toBe(doc);
  });

  it('updates a block in place but refuses to change its id or nest columns', () => {
    const doc = sample();
    const updated = updateBlock(doc, 'c1', (block) => ({ ...block, level: 1 }) as never);
    expect(findBlock(updated, 'c1')?.block).toMatchObject({ level: 1 });
    expect(updateBlock(doc, 'c1', (block) => ({ ...block, id: 'other' }))).toBe(doc);
    expect(updateBlock(doc, 'c1', () => ({ id: 'c1', type: 'columns', layout: '1-1', columns: [[], []], stackOnMobile: true }))).toBe(doc);
  });
});

describe('moving', () => {
  it('moves down and up within the top level, counting positions before the move', () => {
    const doc = sample();
    expect(layout(moveBlock(doc, 'h1', { parentId: null, index: 2 }))).toBe('t1 h1 img p1 d1 div cols[c1|c2] sp btn');
    expect(layout(moveBlock(doc, 'btn', { parentId: null, index: 0 }))).toBe('btn h1 t1 img p1 d1 div cols[c1|c2] sp');
    expect(moveBlock(doc, 'h1', { parentId: null, index: 1 })).toBe(doc);
  });

  it('moves into a column, between columns and back out', () => {
    let doc = moveBlock(sample(), 'img', { parentId: 'cols', column: 1, index: 1 });
    expect(layout(doc)).toBe('h1 t1 p1 d1 div cols[c1|c2,img] sp btn');
    doc = moveBlock(doc, 'img', { parentId: 'cols', column: 0, index: 0 });
    expect(layout(doc)).toBe('h1 t1 p1 d1 div cols[img,c1|c2] sp btn');
    doc = moveBlock(doc, 'img', { parentId: null, index: 0 });
    expect(layout(doc)).toBe('img h1 t1 p1 d1 div cols[c1|c2] sp btn');
  });

  it('refuses to move columns into a column', () => {
    const doc = sample();
    expect(moveBlock(doc, 'cols', { parentId: 'cols', column: 0, index: 0 })).toBe(doc);
  });

  it('steps with the arrows, leaving a column at its edge', () => {
    const doc = sample();
    expect(layout(moveBlockBy(doc, 't1', 1))).toBe('h1 img t1 p1 d1 div cols[c1|c2] sp btn');
    expect(layout(moveBlockBy(doc, 't1', -1))).toBe('t1 h1 img p1 d1 div cols[c1|c2] sp btn');
    expect(moveBlockBy(doc, 'h1', -1)).toBe(doc);
    expect(moveBlockBy(doc, 'btn', 1)).toBe(doc);
    expect(layout(moveBlockBy(doc, 'c1', -1))).toBe('h1 t1 img p1 d1 div c1 cols[|c2] sp btn');
    expect(layout(moveBlockBy(doc, 'c2', 1))).toBe('h1 t1 img p1 d1 div cols[c1|] c2 sp btn');
  });
});

describe('duplicateBlock', () => {
  it('copies a block right after itself with a new id', () => {
    const doc = duplicateBlock(sample(), 'h1');
    expect(layout(doc)).toBe('h1 heading-1 t1 img p1 d1 div cols[c1|c2] sp btn');
    expect(findBlock(doc, 'heading-1')?.block).toMatchObject({ text: { en: 'Hi {{subscriber.first_name|there}}!' } });
  });

  it('gives a copied columns block and all its children fresh ids', () => {
    const doc = duplicateBlock(sample(), 'cols');
    expect(layout(doc)).toBe('h1 t1 img p1 d1 div cols[c1|c2] columns-1[heading-1|button-1] sp btn');
    expect(validateCampaignDocument(doc).ok).toBe(true);
  });

  it('copies inside a column', () => {
    expect(layout(duplicateBlock(sample(), 'c1'))).toBe('h1 t1 img p1 d1 div cols[c1,heading-1|c2] sp btn');
  });
});

describe('setColumnsLayout', () => {
  it('adds a column for three and folds the third back into the second', () => {
    let doc = setColumnsLayout(sample(), 'cols', '1-1-1');
    doc = insertBlock(doc, createBlock(doc, 'spacer', ['en'], TEXT), { parentId: 'cols', column: 2, index: 0 });
    expect(layout(doc)).toBe('h1 t1 img p1 d1 div cols[c1|c2|spacer-1] sp btn');
    doc = setColumnsLayout(doc, 'cols', '2-1');
    expect(layout(doc)).toBe('h1 t1 img p1 d1 div cols[c1|c2,spacer-1] sp btn');
    expect(findBlock(doc, 'cols')?.block).toMatchObject({ layout: '2-1' });
    expect(validateCampaignDocument(doc).ok).toBe(true);
  });
});

describe('text per language', () => {
  it('sets and clears one language', () => {
    expect(setLocalizedText({ en: 'Hi' }, 'de', 'Hallo')).toEqual({ en: 'Hi', de: 'Hallo' });
    expect(setLocalizedText({ en: 'Hi', de: 'Hallo' }, 'de', '  ')).toEqual({ en: 'Hi' });
    expect(setLocalizedDoc({ en: plainTextDoc('Hi') }, 'de', plainTextDoc(''))).toEqual({ en: plainTextDoc('Hi') });
  });

  it('lists fields with default-language text but none in the language asked for', () => {
    const missing = missingTranslations(sample(), 'de');
    expect(missing).toEqual([
      { blockId: null, field: 'footer' },
      { blockId: 'img', field: 'alt' },
      { blockId: 'c1', field: 'text' },
      { blockId: 'c2', field: 'label' }
    ]);
  });

  it('counts a market\'s language as translated and the default as never missing', () => {
    expect(missingTranslations(sample(), 'de-at')).toEqual(missingTranslations(sample(), 'de'));
    expect(missingTranslations(sample(), 'en')).toEqual([]);
    expect(missingTranslations(sample(), 'fr').length).toBeGreaterThan(4);
  });
});

describe('issueBlockId', () => {
  it('points issues at blocks, column children included', () => {
    const doc = sample();
    expect(issueBlockId(doc, 'blocks.1.content.en')).toBe('t1');
    expect(issueBlockId(doc, 'blocks.6.columns.1.0.label.en')).toBe('c2');
    expect(issueBlockId(doc, 'blocks.6.columns')).toBe('cols');
    expect(issueBlockId(doc, 'subject.en')).toBeNull();
    expect(issueBlockId(doc, 'blocks.99.text')).toBeNull();
  });
});

describe('loadForEditing', () => {
  it('loads a valid document as it is', () => {
    expect(loadForEditing(sampleDocument(), 'en')).toMatchObject({ dropped: [], reset: false });
  });

  it('drops unreadable blocks and says which', () => {
    const raw = { ...sampleDocument(), blocks: [...sampleDocument().blocks, { id: 'bad', type: 'carousel' }] };
    const { document, dropped } = loadForEditing(raw, 'en');
    expect(allBlockIds(document)).not.toContain('bad');
    expect(dropped).toEqual([expect.objectContaining({ code: 'invalid-block', blockId: 'bad' })]);
  });

  it('starts from an empty document when nothing is usable', () => {
    const { document, reset } = loadForEditing(null, 'de');
    expect(reset).toBe(true);
    expect(document).toEqual(emptyDocument('de'));
  });
});

describe('historyReducer', () => {
  it('undoes and redoes', () => {
    let state = initHistory(1);
    state = historyReducer(state, { type: 'edit', next: 2, at: 0 });
    state = historyReducer(state, { type: 'edit', next: 3, at: 5000 });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present).toBe(2);
    state = historyReducer(state, { type: 'undo' });
    expect(state.present).toBe(1);
    expect(historyReducer(state, { type: 'undo' })).toBe(state);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present).toBe(2);
  });

  it('makes typing in one field one step, but not across fields or pauses', () => {
    let state = initHistory('');
    for (const [next, at] of [['H', 0], ['He', 200], ['Hel', 400]] as const) {
      state = historyReducer(state, { type: 'edit', next, key: 'h1.text', at });
    }
    state = historyReducer(state, { type: 'edit', next: 'Hel!', key: 'h1.text', at: 400 + COALESCE_MS + 1 });
    state = historyReducer(state, { type: 'edit', next: 'Hel!?', key: 'btn.label', at: 400 + COALESCE_MS + 2 });
    expect(state.past).toEqual(['', 'Hel', 'Hel!']);
  });

  it('forgets redo after a new edit and caps the history', () => {
    let state = initHistory(0);
    for (let i = 1; i <= 150; i++) state = historyReducer(state, { type: 'edit', next: i, at: i * 10_000 });
    expect(state.past).toHaveLength(100);
    state = historyReducer(state, { type: 'undo' });
    state = historyReducer(state, { type: 'edit', next: -1, at: 0 });
    expect(state.future).toEqual([]);
  });
});
