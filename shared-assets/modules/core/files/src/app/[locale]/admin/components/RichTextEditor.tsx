"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Bold, Italic, Underline } from "lucide-react";

interface RichTextEditorProps {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
}

// Collapse div/p block structure from contentEditable into clean <br> markup
function normalizeEditorHtml(html: string): string {
  return html
    .replace(/<(div|p)><br\s*\/?><\/(div|p)>/gi, "<br><br>")
    .replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, "<br>")
    .replace(/<(div|p)[^>]*>/gi, "")
    .replace(/<\/(div|p)>/gi, "")
    .replace(/^<br>/i, "");
}

// Converts plain **bold** / *italic* markdown to HTML for display in the editor
function markdownToHtml(text: string): string {
  if (!text) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(text)) return text; // already HTML
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

export function RichTextEditor({
  name,
  defaultValue = "",
  placeholder,
  rows = 3,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const initialHtml = markdownToHtml(defaultValue);
  const [html, setHtml] = useState(initialHtml);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  });

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialHtml;
    // Use HTML tags (b/i/u) rather than inline styles
    document.execCommand("styleWithCSS", false, "false");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncFormats = useCallback(() => {
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
    });
  }, []);

  const applyFormat = useCallback(
    (command: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false);
      setHtml(editorRef.current?.innerHTML ?? "");
      syncFormats();
    },
    [syncFormats],
  );

  const handleInput = useCallback(() => {
    setHtml(normalizeEditorHtml(editorRef.current?.innerHTML ?? ""));
    syncFormats();
  }, [syncFormats]);

  // Strip external formatting on paste — keep plain text only
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const minHeight = `${rows * 1.6 + 0.8}rem`;

  return (
    <div className="rounded-md border border-input overflow-hidden focus-within:ring-1 focus-within:ring-ring">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-input bg-muted/40 px-1.5 py-1">
        <FormatButton
          onMouseDown={() => applyFormat("bold")}
          active={activeFormats.bold}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" strokeWidth={2.5} />
        </FormatButton>
        <FormatButton
          onMouseDown={() => applyFormat("italic")}
          active={activeFormats.italic}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </FormatButton>
        <FormatButton
          onMouseDown={() => applyFormat("underline")}
          active={activeFormats.underline}
          title="Underline"
        >
          <Underline className="h-3.5 w-3.5" />
        </FormatButton>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyUp={syncFormats}
        onMouseUp={syncFormats}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className="px-3 py-2 text-sm outline-none leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none"
      />

      <input type="hidden" name={name} value={html} />
    </div>
  );
}

function FormatButton({
  children,
  onMouseDown,
  active,
  title,
}: {
  children: React.ReactNode;
  onMouseDown: () => void;
  active: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        // Prevent stealing focus from editor so selection is preserved
        e.preventDefault();
        onMouseDown();
      }}
      className={`rounded px-1.5 py-0.5 text-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
