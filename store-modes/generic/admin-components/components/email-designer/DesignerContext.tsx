'use client';

import { createContext, useContext } from 'react';

import type { CatalogProduct, DesignerData } from '@/lib/email/campaigns/context';
import type { CampaignIssue, CampaignDocument } from '@/lib/email/campaigns/schema';

/** What every part of the designer reads and how it changes the document. */
export interface DesignerState {
  doc: CampaignDocument;
  /** The language whose text is being edited and previewed. */
  locale: string;
  /**
   * Applies a change. Changes sharing a `key` within a second are one undo
   * step, so typing a word is undone in one go.
   */
  edit: (update: (doc: CampaignDocument) => CampaignDocument, key?: string) => void;
  data: DesignerData;
  /** Products seen so far: the first page, the document's own, search results. */
  catalog: CatalogProduct[];
  addToCatalog: (products: CatalogProduct[]) => void;
  searchProducts: (query: string) => Promise<CatalogProduct[]>;
  selectedId: string | null;
  select: (id: string | null) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  issuesByBlock: Map<string, CampaignIssue[]>;
  /** Block ids with a field missing in the edited language. */
  untranslated: Set<string>;
}

const DesignerContext = createContext<DesignerState | null>(null);

export const DesignerProvider = DesignerContext.Provider;

export function useDesigner(): DesignerState {
  const state = useContext(DesignerContext);
  if (!state) throw new Error('useDesigner outside the email designer');
  return state;
}
