'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { Link as LinkIcon, List, ListOrdered, TextAlignCenter, TextAlignEnd, TextAlignStart, Unlink } from 'lucide-react';

import { sanitizeRichDoc } from '@/lib/email/campaigns/richTextSanitize';
import { FONT_SIZES, type RichDoc } from '@/lib/email/campaigns/schema';
import { MergeTagMenu, inputClass, isAcceptableHref } from './fields';

/** A few readable colours, plus the theme's own brand and text colours. */
const PALETTE = ['#1c1917', '#57534e', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#1d4ed8', '#7e22ce'];

interface RichTextFieldProps {
  label: string;
  value: RichDoc | null;
  onChange: (doc: RichDoc) => void;
  dir: 'ltr' | 'rtl';
  brandColor: string;
  invalid?: boolean;
}

/**
 * The word-processor part of the designer. Only what an email can show is
 * on offer (no quotes, code or tables), and whatever comes out, pasted
 * content included, goes through sanitizeRichDoc before it is stored.
 *
 * Mount it with a key per block and language: switching language starts a
 * fresh editor with that language's text.
 */
export default function RichTextField({ label, value, onChange, dir, brandColor, invalid }: RichTextFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
      }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] })
    ],
    content: value ?? '',
    // The admin renders on the server first; Tiptap must wait for the browser.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        dir,
        'aria-label': label,
        class: `min-h-[7rem] rounded-b-md border border-t-0 border-border bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-700 [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-semibold [&_a]:underline [&_p]:my-1 ${invalid ? 'border-red-400' : ''}`
      }
    },
    onUpdate: ({ editor: current }) => onChange(sanitizeRichDoc(current.getJSON()))
  });

  // Undo and redo outside the editor change the value under it: follow them.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = JSON.stringify(sanitizeRichDoc(editor.getJSON()));
    const next = JSON.stringify(value ?? { type: 'doc', content: [] });
    if (current !== next) editor.commands.setContent(value ?? '', { emitUpdate: false });
  }, [editor, value]);

  return (
    <div>
      <Toolbar editor={editor} brandColor={brandColor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/** What the toolbar shows as on: marks at the cursor, the block type, size, colour, alignment. */
function toolbarState(editor: Editor) {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    link: editor.isActive('link'),
    linkHref: (editor.getAttributes('link').href as string | undefined) ?? '',
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    block: editor.isActive('heading', { level: 1 })
      ? 'h1'
      : editor.isActive('heading', { level: 2 })
        ? 'h2'
        : editor.isActive('heading', { level: 3 })
          ? 'h3'
          : 'p',
    fontSize: (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '',
    color: (editor.getAttributes('textStyle').color as string | undefined) ?? '',
    align: ['center', 'right'].find((option) => editor.isActive({ textAlign: option })) ?? 'left'
  };
}

function Toolbar({ editor, brandColor }: { editor: Editor | null; brandColor: string }) {
  const t = useTranslations('Admin.email.designer.toolbar');
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  // useEditorState recomputes on editor transactions only, so right after
  // the editor appears (before the first click) it has nothing yet: read
  // the editor directly then, or the toolbar stays empty until a click.
  const tracked = useEditorState({ editor, selector: ({ editor: current }) => (current ? toolbarState(current) : null) });
  const state = tracked ?? (editor ? toolbarState(editor) : null);
  if (!editor || !state) return <div className="h-10 rounded-t-md border border-border bg-stone-50" />;

  const chain = () => editor.chain().focus();
  const button = (active: boolean) =>
    `inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm ${active ? 'bg-emerald-700 text-white' : 'hover:bg-stone-200'}`;
  const hrefValid = href === '' || isAcceptableHref(href);

  return (
    <div className="space-y-1 rounded-t-md border border-border bg-stone-50 p-1">
      <div className="flex flex-wrap items-center gap-1">
        <select
          aria-label={t('style')}
          value={state.block}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'p') chain().setParagraph().run();
            else chain().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
          }}
          className="h-8 rounded border border-border bg-white px-1 text-sm"
        >
          <option value="p">{t('paragraph')}</option>
          <option value="h1">{t('heading1')}</option>
          <option value="h2">{t('heading2')}</option>
          <option value="h3">{t('heading3')}</option>
        </select>
        <button type="button" title={t('bold')} aria-pressed={state.bold} className={`${button(state.bold)} font-bold`} onClick={() => chain().toggleBold().run()}>
          B
        </button>
        <button type="button" title={t('italic')} aria-pressed={state.italic} className={`${button(state.italic)} italic`} onClick={() => chain().toggleItalic().run()}>
          I
        </button>
        <button type="button" title={t('underline')} aria-pressed={state.underline} className={`${button(state.underline)} underline`} onClick={() => chain().toggleUnderline().run()}>
          U
        </button>
        <button type="button" title={t('strike')} aria-pressed={state.strike} className={`${button(state.strike)} line-through`} onClick={() => chain().toggleStrike().run()}>
          S
        </button>
        <select
          aria-label={t('fontSize')}
          value={state.fontSize}
          onChange={(event) => (event.target.value ? chain().setFontSize(event.target.value).run() : chain().unsetFontSize().run())}
          className="h-8 rounded border border-border bg-white px-1 text-sm"
        >
          <option value="">{t('defaultSize')}</option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size.replace('px', '')}
            </option>
          ))}
        </select>
        <select
          aria-label={t('color')}
          value={state.color}
          onChange={(event) => (event.target.value ? chain().setColor(event.target.value).run() : chain().unsetColor().run())}
          className="h-8 rounded border border-border bg-white px-1 text-sm"
          style={state.color ? { color: state.color } : undefined}
        >
          <option value="">{t('defaultColor')}</option>
          {[brandColor, ...PALETTE.filter((color) => color !== brandColor)].map((color, index) => (
            <option key={color} value={color} style={{ color }}>
              {index === 0 ? `■ ${t('brandColor')}` : `■ ${color}`}
            </option>
          ))}
        </select>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button type="button" title={t('bulletList')} aria-pressed={state.bulletList} className={button(state.bulletList)} onClick={() => chain().toggleBulletList().run()}>
          <List className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" title={t('orderedList')} aria-pressed={state.orderedList} className={button(state.orderedList)} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" aria-hidden />
        </button>
        {(
          [
            ['left', TextAlignStart, t('alignLeft')],
            ['center', TextAlignCenter, t('alignCenter')],
            ['right', TextAlignEnd, t('alignRight')]
          ] as const
        ).map(([option, Icon, title]) => (
          <button
            key={option}
            type="button"
            title={title}
            aria-pressed={state.align === option}
            className={button(state.align === option)}
            onClick={() => chain().setTextAlign(option).run()}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button
          type="button"
          title={t('link')}
          aria-pressed={state.link}
          className={button(state.link)}
          onClick={() => {
            setHref(state.linkHref);
            setLinkOpen((open) => !open);
          }}
        >
          <LinkIcon className="h-4 w-4" aria-hidden />
        </button>
        {state.link && (
          <button type="button" title={t('unlink')} className={button(false)} onClick={() => chain().extendMarkRange('link').unsetLink().run()}>
            <Unlink className="h-4 w-4" aria-hidden />
          </button>
        )}
        <MergeTagMenu onInsert={(text) => chain().insertContent(text).run()} />
      </div>
      {linkOpen && (
        <form
          className="flex flex-wrap items-center gap-2 p-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!href) chain().extendMarkRange('link').unsetLink().run();
            else if (hrefValid) chain().extendMarkRange('link').setLink({ href }).run();
            else return;
            setLinkOpen(false);
          }}
        >
          <input
            type="text"
            inputMode="url"
            autoFocus
            value={href}
            placeholder={t('linkPlaceholder')}
            onChange={(event) => setHref(event.target.value)}
            aria-invalid={!hrefValid || undefined}
            className={`${inputClass} mt-0 h-8 max-w-xs flex-1 py-1 ${hrefValid ? '' : 'border-red-400'}`}
          />
          <button type="button" className="text-xs underline" onClick={() => setHref('{{shop.locale_url}}/shop')}>
            {t('linkShop')}
          </button>
          <button type="submit" className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={!hrefValid}>
            {t('apply')}
          </button>
          <button type="button" className="text-xs underline" onClick={() => setLinkOpen(false)}>
            {t('cancel')}
          </button>
          {!hrefValid && <span className="w-full text-xs text-red-700">{t('linkInvalid')}</span>}
        </form>
      )}
    </div>
  );
}
