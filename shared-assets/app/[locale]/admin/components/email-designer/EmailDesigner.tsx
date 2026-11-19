'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useState, useTransition, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Redo2, Save, Settings2, Undo2 } from 'lucide-react';

import { designerPreviewContext, type CatalogProduct, type DesignerData } from '@/lib/email/campaigns/context';
import { MERGE_TAGS } from '@/lib/email/campaigns/mergeTags';
import { historyReducer, initHistory, issueBlockId, missingTranslations, type History, type HistoryAction } from '@/lib/email/campaigns/editor';
import { renderCampaign, type CampaignWarning } from '@/lib/email/campaigns/render';
import { validateCampaignDocument, type CampaignDocument, type CampaignIssue } from '@/lib/email/campaigns/schema';
import type { EmailTemplateActionResult } from '../../actions/emailTemplates';
import EmailPreview from '../EmailPreview';
import { actionErrorText } from '../emailTemplateErrors';
import { warningText } from '../emailWarnings';
import BlockCanvas, { AddBlockMenu } from './BlockCanvas';
import { DesignerProvider, type DesignerState } from './DesignerContext';
import DocumentSettings from './DocumentSettings';
import LocaleBar from './LocaleBar';
import { inputClass } from './fields';

type Action = HistoryAction<CampaignDocument> | { type: 'apply'; update: (doc: CampaignDocument) => CampaignDocument; key?: string; at: number };

function reducer(state: History<CampaignDocument>, action: Action): History<CampaignDocument> {
  if (action.type === 'apply') {
    return historyReducer(state, { type: 'edit', next: action.update(state.present), key: action.key, at: action.at });
  }
  return historyReducer(state, action);
}

const SETTINGS = '__settings';

interface EmailDesignerProps {
  initialName: string;
  initialDocument: CampaignDocument;
  /** Blocks dropped when a stale document was loaded. */
  dropped: CampaignWarning[];
  /** True when the stored document could not be read at all. */
  reset: boolean;
  locales: readonly string[];
  data: DesignerData;
  save: (previous: EmailTemplateActionResult | null, formData: FormData) => Promise<EmailTemplateActionResult>;
  searchProducts: (query: string) => Promise<CatalogProduct[]>;
  /** Shown under the preview: the test-send form. */
  aside?: ReactNode;
}

export default function EmailDesigner({ initialName, initialDocument, dropped, reset, locales, data, save, searchProducts, aside }: EmailDesignerProps) {
  const t = useTranslations('Admin.email');
  const [history, dispatch] = useReducer(reducer, initialDocument, initHistory);
  const doc = history.present;
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(() => ({ name: initialName, json: reset ? '' : JSON.stringify(initialDocument) }));
  const [locale, setLocale] = useState(initialDocument.defaultLocale);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState(data.catalog);
  const [result, setResult] = useState<EmailTemplateActionResult | null>(null);
  const [saving, startSaving] = useTransition();

  const edit = useCallback<DesignerState['edit']>((update, key) => dispatch({ type: 'apply', update, key, at: Date.now() }), []);
  const addToCatalog = useCallback((products: CatalogProduct[]) => {
    setCatalog((current) => {
      const known = new Set(current.map((product) => product.id));
      const fresh = products.filter((product) => !known.has(product.id));
      return fresh.length ? [...current, ...fresh] : current;
    });
  }, []);

  const json = useMemo(() => JSON.stringify(doc), [doc]);
  const dirty = json !== saved.json || name !== saved.name;

  const validation = useMemo(() => validateCampaignDocument(doc), [doc]);
  const issues: CampaignIssue[] = useMemo(() => (validation.ok ? [] : validation.issues), [validation]);
  const issuesByBlock = useMemo(() => {
    const map = new Map<string, CampaignIssue[]>();
    for (const issue of issues) {
      // '' collects the issues of the email itself: subject, preview text, footer, look.
      const id = issueBlockId(doc, issue.path) ?? '';
      map.set(id, [...(map.get(id) ?? []), issue]);
    }
    return map;
  }, [doc, issues]);
  const untranslated = useMemo(
    () => new Set(missingTranslations(doc, locale).flatMap((missing) => (missing.blockId ? [missing.blockId] : []))),
    [doc, locale]
  );

  // The preview may lag a keystroke behind; typing never waits for it.
  const previewDoc = useDeferredValue(doc);
  const preview = useMemo(
    () => renderCampaign(previewDoc, designerPreviewContext({ ...data, catalog }, locale, previewDoc.defaultLocale)),
    [previewDoc, data, catalog, locale]
  );

  const submit = useCallback(() => {
    if (!validation.ok || saving) return;
    const formData = new FormData();
    formData.set('name', name);
    formData.set('document', json);
    startSaving(async () => {
      const outcome = await save(null, formData);
      setResult(outcome);
      if (outcome.ok) setSaved({ name: outcome.name, json });
    });
  }, [validation.ok, saving, name, json, save]);

  // Undo, redo and save from the keyboard. Inside a text field or the text
  // editor, undo is that field's own, as people expect.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        submit();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  // The browser's own "leave this page?" question when there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const state: DesignerState = {
    doc,
    locale,
    edit,
    data,
    catalog,
    addToCatalog,
    searchProducts,
    selectedId,
    select: setSelectedId,
    draggingId,
    setDraggingId,
    issuesByBlock,
    untranslated
  };

  // New blocks go after the selected top-level block, or at the end.
  const selectedIndex = doc.blocks.findIndex((block) => block.id === selectedId);
  const addTarget = { parentId: null, index: selectedIndex >= 0 ? selectedIndex + 1 : doc.blocks.length } as const;
  const warnings = preview.ok ? preview.email.warnings : preview.warnings;
  const settingsOpen = selectedId === SETTINGS;
  const settingsProblems = issuesByBlock.get('')?.length ?? 0;
  const iconButton = 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-white hover:border-emerald-700 disabled:opacity-40';

  return (
    <DesignerProvider value={state}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-3">
          <label className="block min-w-48 flex-1 text-sm font-medium">
            {t('name')}
            <input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </label>
          <button type="button" title={t('designer.undo')} aria-label={t('designer.undo')} className={iconButton} disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}>
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" title={t('designer.redo')} aria-label={t('designer.redo')} className={iconButton} disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}>
            <Redo2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!validation.ok || saving || !dirty}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden />
            {saving ? t('saving') : t('save')}
          </button>
          <p role="status" className="w-full text-sm sm:w-auto">
            {!validation.ok ? (
              <span className="text-red-800">{t('designer.saveBlocked', { count: issues.length })}</span>
            ) : dirty ? (
              <span className="text-amber-800">{t('designer.unsaved')}</span>
            ) : result && !result.ok ? null : (
              <span className="text-emerald-800">{t('designer.saved')}</span>
            )}
            {result && !result.ok && <span className="text-red-800"> {actionErrorText(t, result)}</span>}
          </p>
        </div>

        {(reset || dropped.length > 0) && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {reset ? t('designer.reset') : t('designer.dropped', { count: dropped.length })}
          </p>
        )}

        <LocaleBar doc={doc} locales={locales} value={locale} onChange={setLocale} />

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div className={`rounded-lg border bg-white ${settingsOpen ? 'border-emerald-600' : settingsProblems ? 'border-red-300' : 'border-border'}`}>
              <button
                type="button"
                aria-expanded={settingsOpen}
                onClick={() => setSelectedId(settingsOpen ? null : SETTINGS)}
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm font-medium"
              >
                {settingsOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                <Settings2 className="h-4 w-4 text-stone-500" aria-hidden />
                {t('designer.settingsHeading')}
                <span className="truncate font-normal text-stone-500">{doc.subject[locale] ?? doc.subject[doc.defaultLocale] ?? ''}</span>
                {settingsProblems > 0 && (
                  <span className="ms-auto rounded-full bg-red-100 px-2 text-xs text-red-800">{t('designer.problems', { count: settingsProblems })}</span>
                )}
              </button>
              {settingsOpen && (
                <div className="border-t border-border p-3">
                  <DocumentSettings />
                </div>
              )}
            </div>
            <BlockCanvas />
            <AddBlockMenu target={addTarget} types={['heading', 'text', 'image', 'button', 'product', 'discount', 'divider', 'spacer', 'columns']} label={t('designer.addBlock')} />
          </div>

          <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
            <h3 className="font-semibold">{t('preview.heading')}</h3>
            {preview.ok ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-white p-3 text-sm">
                  <dt className="font-medium">{t('subject')}</dt>
                  <dd dir={preview.email.dir}>{preview.email.subject}</dd>
                  <dt className="font-medium">{t('preheader')}</dt>
                  <dd dir={preview.email.dir} className="text-stone-600">
                    {preview.email.preheader || t('noPreheader')}
                  </dd>
                </dl>
                <EmailPreview html={preview.email.html} />
                <p className="text-xs text-stone-500">{t('preview.sampleNote', { name: MERGE_TAGS['subscriber.first_name'].sample })}</p>
              </>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {preview.error === 'empty' ? t('renderFailed.empty') : t('designer.previewWaiting')}
              </p>
            )}
            <div className="space-y-2 rounded-lg border border-border bg-white p-4">
              <h3 className="font-semibold">{t('warningsHeading')}</h3>
              {warnings.length === 0 ? (
                <p className="text-sm text-stone-600">{t('noWarnings')}</p>
              ) : (
                <ul className="list-disc space-y-1 ps-5 text-sm">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warningText(t, warning)}</li>
                  ))}
                </ul>
              )}
            </div>
            {aside && (
              <div className="space-y-2">
                {dirty && <p className="text-sm text-amber-800">{t('designer.testUsesSaved')}</p>}
                {aside}
              </div>
            )}
          </div>
        </div>
      </div>
    </DesignerProvider>
  );
}
