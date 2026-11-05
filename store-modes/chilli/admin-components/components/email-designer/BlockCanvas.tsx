'use client';

import { useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  GripVertical,
  Heading2,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  ShoppingBag,
  Ticket,
  Trash,
  Type,
  type LucideIcon
} from 'lucide-react';

import { isBlankString, pickLocalized } from '@/lib/email/campaigns/localize';
import {
  createBlock,
  duplicateBlock,
  insertBlock,
  moveBlock,
  moveBlockBy,
  removeBlock,
  LEAF_BLOCK_TYPES,
  type BlockTarget
} from '@/lib/email/campaigns/editor';
import { isRichDocEmpty, type BlockType, type CampaignBlock, type ColumnsBlock, type LeafBlock } from '@/lib/email/campaigns/schema';
import { ColumnsSettings, LeafFields } from './BlockFields';
import { useDesigner } from './DesignerContext';

export const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  heading: Heading2,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  product: ShoppingBag,
  discount: Ticket,
  divider: Minus,
  spacer: MoveVertical,
  columns: Columns2
};

const DRAG_TYPE = 'application/x-shopforge-block';

/** A one-line description of a block for its collapsed card. */
function useSummary(block: CampaignBlock): string {
  const { doc, locale, catalog } = useDesigner();
  const t = useTranslations('Admin.email.designer');
  const text = (value: Partial<Record<string, string>>) =>
    pickLocalized(value, locale, doc.defaultLocale, isBlankString)?.value ?? '';
  switch (block.type) {
    case 'heading':
      return text(block.text);
    case 'text': {
      const picked = pickLocalized(block.content, locale, doc.defaultLocale, isRichDocEmpty);
      const first = picked?.value.content.find((node) => 'content' in node && node.content?.length);
      const runs = first && 'content' in first ? (first.content as { type: string; text?: string }[]) : [];
      return runs.map((run) => run.text ?? '').join('').slice(0, 80);
    }
    case 'image':
      return block.src ? block.src.split('/').pop() ?? '' : t('fields.chooseImage');
    case 'button':
      return text(block.label);
    case 'product':
      return catalog.find((product) => product.id === block.productId)?.name ?? t('fields.chooseProduct');
    case 'discount':
      return block.code || t('fields.chooseDiscount');
    case 'spacer':
      return `${block.height}px`;
    case 'columns':
      return t(`fields.layouts.${block.layout}`);
    default:
      return '';
  }
}

/** A thin line that becomes a target while a block is being dragged. */
function DropZone({ target, accepts }: { target: BlockTarget; accepts: 'any' | 'leaf' }) {
  const t = useTranslations('Admin.email.designer');
  const { doc, draggingId, setDraggingId, edit } = useDesigner();
  const [over, setOver] = useState(false);
  if (!draggingId) return <div className="h-2" aria-hidden />;
  const dragged = doc.blocks.find((block) => block.id === draggingId);
  if (accepts === 'leaf' && dragged?.type === 'columns') return <div className="h-2" aria-hidden />;
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const id = event.dataTransfer.getData(DRAG_TYPE) || draggingId;
    edit((current) => moveBlock(current, id, target));
    setDraggingId(null);
  };
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`my-1 flex h-8 items-center justify-center rounded border-2 border-dashed text-xs transition-colors ${over ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-stone-300 text-stone-400'}`}
    >
      {t('dropHere')}
    </div>
  );
}

function BlockCard({ block, inColumn = false }: { block: CampaignBlock; inColumn?: boolean }) {
  const t = useTranslations('Admin.email.designer');
  const { selectedId, select, edit, setDraggingId, issuesByBlock, untranslated } = useDesigner();
  const summary = useSummary(block);
  const Icon = BLOCK_ICONS[block.type];
  const open = selectedId === block.id;
  const problems = issuesByBlock.get(block.id)?.length ?? 0;
  const iconButton = 'inline-flex h-7 w-7 items-center justify-center rounded hover:bg-stone-200';

  return (
    <div className={`rounded-lg border bg-white ${open ? 'border-emerald-600 shadow-sm' : problems ? 'border-red-300' : 'border-border'}`}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, block.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingId(block.id);
          }}
          onDragEnd={() => setDraggingId(null)}
          title={t('actions.drag')}
          className="cursor-grab text-stone-400 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </span>
        <button
          type="button"
          onClick={() => select(open ? null : block.id)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
          <Icon className="h-4 w-4 shrink-0 text-stone-500" aria-hidden />
          <span className="font-medium">{t(`blocks.${block.type}`)}</span>
          <span className="truncate text-stone-500">{summary}</span>
        </button>
        {problems > 0 && <span className="rounded-full bg-red-100 px-2 text-xs text-red-800">{t('problems', { count: problems })}</span>}
        {untranslated.has(block.id) && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-900">{t('untranslatedBadge')}</span>}
        <button type="button" title={t('actions.moveUp')} className={iconButton} onClick={() => edit((doc) => moveBlockBy(doc, block.id, -1))}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" title={t('actions.moveDown')} className={iconButton} onClick={() => edit((doc) => moveBlockBy(doc, block.id, 1))}>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" title={t('actions.duplicate')} className={iconButton} onClick={() => edit((doc) => duplicateBlock(doc, block.id))}>
          <Copy className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          title={t('actions.remove')}
          className={`${iconButton} text-red-700`}
          onClick={() => {
            edit((doc) => removeBlock(doc, block.id));
            if (open) select(null);
          }}
        >
          <Trash className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {problems > 0 && (
            <ul className="list-disc rounded-md border border-red-200 bg-red-50 py-2 pe-3 ps-7 text-xs text-red-900">
              {issuesByBlock.get(block.id)?.map((issue, index) => <li key={index}>{issue.message}</li>)}
            </ul>
          )}
          {block.type === 'columns' ? <ColumnsSettings block={block} /> : <LeafFields block={block} />}
        </div>
      )}
      {block.type === 'columns' && !inColumn && <ColumnsBody block={block} />}
    </div>
  );
}

/** The blocks of each column, one column under the other, each with its own add menu. */
function ColumnsBody({ block }: { block: ColumnsBlock }) {
  const t = useTranslations('Admin.email.designer');
  return (
    <div className="space-y-3 border-t border-dashed border-border bg-stone-50 p-3">
      {block.columns.map((column, columnIndex) => (
        <div key={columnIndex} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('fields.column', { number: columnIndex + 1 })}</span>
            <AddBlockMenu target={{ parentId: block.id, column: columnIndex, index: column.length }} types={LEAF_BLOCK_TYPES} label={t('addToColumn', { number: columnIndex + 1 })} compact />
          </div>
          <BlockList blocks={column} container={{ parentId: block.id, column: columnIndex }} inColumn />
          {column.length === 0 && <p className="text-xs text-stone-500">{t('fields.emptyColumn')}</p>}
        </div>
      ))}
    </div>
  );
}

type Container = { parentId: null } | { parentId: string; column: number };

function BlockList({ blocks, container, inColumn = false }: { blocks: (CampaignBlock | LeafBlock)[]; container: Container; inColumn?: boolean }) {
  const target = (index: number): BlockTarget => ({ ...container, index }) as BlockTarget;
  const accepts = container.parentId === null ? 'any' : 'leaf';
  return (
    <div>
      <DropZone target={target(0)} accepts={accepts} />
      {blocks.map((block, index) => (
        <div key={block.id}>
          <BlockCard block={block} inColumn={inColumn} />
          <DropZone target={target(index + 1)} accepts={accepts} />
        </div>
      ))}
    </div>
  );
}

/** A menu of block types; picking one adds it at `target` and opens it. */
export function AddBlockMenu({ target, types, label, compact = false }: { target: BlockTarget; types: BlockType[]; label: string; compact?: boolean }) {
  const t = useTranslations('Admin.email.designer');
  const { doc, locale, edit, select } = useDesigner();
  const [open, setOpen] = useState(false);
  const add = (type: BlockType) => {
    const locales = Array.from(new Set([doc.defaultLocale, locale]));
    const block = createBlock(doc, type, locales, { heading: t('newBlock.heading'), text: t('newBlock.text'), button: t('newBlock.button') });
    edit((current) => insertBlock(current, block, target));
    select(block.id);
    setOpen(false);
  };
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={compact ? 'text-xs font-medium text-emerald-800 underline' : 'rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800'}
      >
        + {label}
      </button>
      {open && (
        <ul className="absolute end-0 z-20 mt-1 w-72 rounded-md border border-border bg-white py-1 shadow-lg">
          {types.map((type) => {
            const Icon = BLOCK_ICONS[type];
            return (
              <li key={type}>
                <button type="button" onClick={() => add(type)} className="flex w-full items-start gap-3 px-3 py-2 text-start hover:bg-stone-100">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">{t(`blocks.${type}`)}</span>
                    <span className="block text-xs text-stone-500">{t(`blockHints.${type}`)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The whole email as a list of blocks. */
export default function BlockCanvas() {
  const t = useTranslations('Admin.email.designer');
  const { doc } = useDesigner();
  return (
    <div className="space-y-2">
      {doc.blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-white p-6 text-center text-sm text-stone-600">{t('empty')}</p>
      ) : (
        <BlockList blocks={doc.blocks} container={{ parentId: null }} />
      )}
    </div>
  );
}
