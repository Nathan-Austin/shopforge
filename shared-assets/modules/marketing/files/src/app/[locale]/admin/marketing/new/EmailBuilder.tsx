"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Type,
  ImageIcon,
  ShoppingBag,
  MousePointerClick,
  Loader2,
  Send,
  X,
  Upload,
  FlaskConical,
  Columns2,
  GripVertical,
  Bold,
  Italic,
  Underline,
  Save,
  Percent,
} from "lucide-react";
import type { Block, ColumnBlock, TextBlock, ImageBlock, ProductsBlock, ButtonBlock, RowBlock, VoucherBlock } from "@/lib/emails/newsletter-builder";
import { saveCampaignDraft } from "../actions";

type Product = {
  id: string;
  name: string;
  image_url: string | null;
  price_cents: number;
  slug: string;
};

function genId() {
  return Math.random().toString(36).slice(2);
}

const TEXT_SIZE_DEFAULT_PX: Record<TextBlock["size"], number> = {
  heading: 24,
  body: 15,
  small: 12,
};

// Strips a contentEditable's HTML down to just text plus <b>/<i>/<u>/<br> --
// the only formatting the toolbar can produce. Anything else (pasted styles,
// spans, divs from Enter-key paragraphs, etc.) is unwrapped to its text
// content, never dropped outright, so pasting from elsewhere can't smuggle
// in stray markup or inline styles.
function sanitizeRichText(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  const clean = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const escaped = document.createElement("div");
      escaped.textContent = node.textContent || "";
      return escaped.innerHTML;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const inner = Array.from(el.childNodes).map(clean).join("");
    switch (el.tagName) {
      case "BR":
        return "<br>";
      case "B":
      case "STRONG":
        return `<b>${inner}</b>`;
      case "I":
      case "EM":
        return `<i>${inner}</i>`;
      case "U":
        return `<u>${inner}</u>`;
      case "DIV":
      case "P":
        // contentEditable sometimes wraps each line in its own block element
        // instead of using <br> -- treat the boundary as a line break.
        return `${inner}<br>`;
      default:
        return inner;
    }
  };

  const result = Array.from(container.childNodes).map(clean).join("");
  return result.replace(/(<br>)+$/, "");
}

// --- Block editors ---

function TextEditor({ block, onChange }: { block: TextBlock; onChange: (b: TextBlock) => void }) {
  const editableRef = useRef<HTMLDivElement>(null);

  // Only push block.content into the DOM when switching to a different block
  // -- never on every keystroke, or we'd fight the browser over cursor
  // position while the owner is typing.
  useEffect(() => {
    if (editableRef.current) {
      editableRef.current.innerHTML = block.content;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const commit = () => {
    if (!editableRef.current) return;
    onChange({ ...block, content: sanitizeRichText(editableRef.current.innerHTML) });
  };

  const applyFormat = (command: "bold" | "italic" | "underline") => {
    editableRef.current?.focus();
    document.execCommand(command);
    commit();
  };

  const defaultPx = TEXT_SIZE_DEFAULT_PX[block.size];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(["heading", "body", "small"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...block, size: s })}
              className={`px-3 py-1 text-xs rounded-full border transition-colors capitalize ${
                block.size === s
                  ? "bg-black text-white border-black"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-500"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-zinc-500">Size</Label>
          <Input
            type="number"
            min={8}
            max={72}
            placeholder={String(defaultPx)}
            value={block.fontSizePx ?? ""}
            onChange={(e) =>
              onChange({ ...block, fontSizePx: e.target.value ? Number(e.target.value) : undefined })
            }
            className="w-16 h-7 text-xs px-2"
          />
          <span className="text-xs text-zinc-400">px</span>
        </div>
      </div>

      <div className="flex gap-1 border border-zinc-200 rounded-md p-1 w-fit">
        {[
          { command: "bold" as const, Icon: Bold, title: "Bold" },
          { command: "italic" as const, Icon: Italic, title: "Italic" },
          { command: "underline" as const, Icon: Underline, title: "Underline" },
        ].map(({ command, Icon, title }) => (
          <button
            key={command}
            type="button"
            title={title}
            // Prevent losing the text selection to the button's own focus
            // before the click handler runs.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat(command)}
            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-700"
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-400">Highlight text, then click Bold / Italic / Underline.</p>

      <div
        ref={editableRef}
        contentEditable
        onInput={commit}
        onBlur={commit}
        data-placeholder="Write your text here..."
        style={block.fontSizePx ? { fontSize: `${block.fontSizePx}px` } : undefined}
        className={`w-full resize-none rounded-md border border-zinc-200 px-3 py-2 outline-none focus:ring-1 focus:ring-black empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-400 ${
          block.size === "heading" ? "text-xl font-bold min-h-[60px]" :
          block.size === "small" ? "text-xs text-zinc-500 min-h-[60px]" :
          "text-sm min-h-[100px]"
        }`}
      />
    </div>
  );
}

function convertToWebP(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      // Keep the original dimensions -- only re-encode as WebP to shrink
      // file size, never crop or resize the actual image.
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to convert image to WebP"));
        },
        "image/webp",
        0.85,
      );
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

function ImageEditor({ block, onChange }: { block: ImageBlock; onChange: (b: ImageBlock) => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const webpBlob = await convertToWebP(file);
      const filename = `email-${Date.now()}.webp`;
      const { data, error } = await supabase.storage
        .from("product-images")
        .upload(filename, webpBlob, { contentType: "image/webp", upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("product-images").getPublicUrl(data.path);
      onChange({ ...block, url: publicUrl });
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      {block.url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} className="w-full max-h-64 object-contain rounded-lg border bg-zinc-50" />
          <button
            type="button"
            onClick={() => onChange({ ...block, url: "" })}
            className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-zinc-200 rounded-lg cursor-pointer hover:bg-zinc-50 transition-colors"
        >
          {uploading ? (
            <Loader2 size={20} className="animate-spin text-zinc-400" />
          ) : (
            <>
              <Upload size={20} className="text-zinc-400 mb-1" />
              <span className="text-xs text-zinc-500">Click to upload image</span>
            </>
          )}
        </div>
      )}
      {block.url && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-zinc-500">Display size</Label>
            <span className="text-xs text-zinc-400">{block.widthPercent ?? 100}%</span>
          </div>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={block.widthPercent ?? 100}
            onChange={(e) => onChange({ ...block, widthPercent: Number(e.target.value) })}
            className="w-full accent-black"
          />
        </div>
      )}
      <Input
        placeholder="Alt text (optional)"
        value={block.alt}
        onChange={(e) => onChange({ ...block, alt: e.target.value })}
        className="text-sm"
      />
      {block.alt && (
        <p className="text-xs text-zinc-400">
          Alt text (for accessibility / if the image fails to load): <span className="italic">&ldquo;{block.alt}&rdquo;</span>
        </p>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}

function ProductsEditor({
  block,
  onChange,
  allProducts,
}: {
  block: ProductsBlock;
  onChange: (b: ProductsBlock) => void;
  allProducts: Product[];
}) {
  const [search, setSearch] = useState("");
  const selectedIds = new Set(block.products.map((p) => p.id));

  const filtered = allProducts.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (product: Product) => {
    if (selectedIds.has(product.id)) {
      onChange({ ...block, products: block.products.filter((p) => p.id !== product.id) });
    } else if (block.products.length < 4) {
      onChange({
        ...block,
        products: [
          ...block.products,
          {
            id: product.id,
            name: product.name,
            imageUrl: product.image_url || "",
            priceCents: product.price_cents,
            slug: product.slug,
          },
        ],
      });
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Select up to 4 products to feature.</p>
      {block.products.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {block.products.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1 text-xs bg-zinc-100 rounded-full px-3 py-1"
            >
              {p.name}
              <button type="button" onClick={() => toggle({ id: p.id, name: p.name, image_url: p.imageUrl, price_cents: p.priceCents, slug: p.slug })}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        placeholder="Search products..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="text-sm"
      />
      <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
        {filtered.slice(0, 30).map((p) => {
          const selected = selectedIds.has(p.id);
          const disabled = !selected && block.products.length >= 4;
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(p)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                selected ? "bg-red-50" : disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-zinc-50"
              }`}
            >
              {p.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt={p.name} className="w-8 h-8 object-cover rounded" />
              )}
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-zinc-400">€{(p.price_cents / 100).toFixed(2)}</span>
              {selected && <span className="text-red-600 text-xs font-bold">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Row columns keep to a simple subset -- a 2-product grid doesn't read well
// squeezed into a narrow half-width column, and nesting rows would make both
// the editor and the email-client table markup recursive for no real gain.
const COLUMN_BLOCK_TYPES = [
  { type: "text", label: "Text", icon: Type },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "button", label: "Button", icon: MousePointerClick },
] as const;

type ColumnBlockType = (typeof COLUMN_BLOCK_TYPES)[number]["type"];

function createColumnBlock(type: ColumnBlockType): ColumnBlock {
  const id = genId();
  switch (type) {
    case "text": return { id, type: "text", content: "", size: "body" };
    case "image": return { id, type: "image", url: "", alt: "", widthPercent: 100 };
    case "button": return { id, type: "button", label: "Shop Now", url: "https://example.com/en/shop" };
  }
}

function ColumnEditor({
  blocks,
  onChange,
  activeId,
  setActiveId,
}: {
  blocks: ColumnBlock[];
  onChange: (blocks: ColumnBlock[]) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}) {
  const update = (id: string, updated: ColumnBlock) =>
    onChange(blocks.map((b) => (b.id === id ? updated : b)));
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));
  const add = (type: ColumnBlockType) => {
    const block = createColumnBlock(type);
    onChange([...blocks, block]);
    setActiveId(block.id);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {COLUMN_BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            type="button"
            onClick={() => add(type)}
            className="flex items-center gap-1 text-[11px] px-2 py-1 border rounded-md hover:bg-zinc-50 transition-colors"
          >
            <Icon size={12} />
            <span>{label}</span>
            <Plus size={10} className="text-zinc-400" />
          </button>
        ))}
      </div>
      {blocks.length === 0 ? (
        <div className="border border-dashed border-zinc-200 rounded-lg p-4 text-center text-zinc-300 text-xs">
          Empty column
        </div>
      ) : (
        blocks.map((block) => {
          const isActive = activeId === block.id;
          return (
            <div
              key={block.id}
              className={`border rounded-lg p-2 cursor-pointer transition-all ${isActive ? "ring-1 ring-black" : "hover:border-zinc-300"}`}
              onClick={() => setActiveId(isActive ? null : block.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">{block.type}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(block.id); }}
                  className="p-0.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {isActive && (
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  {block.type === "text" && <TextEditor block={block} onChange={(b) => update(block.id, b)} />}
                  {block.type === "image" && <ImageEditor block={block} onChange={(b) => update(block.id, b)} />}
                  {block.type === "button" && <ButtonEditor block={block} onChange={(b) => update(block.id, b)} />}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function RowEditor({
  block,
  onChange,
}: {
  block: RowBlock;
  onChange: (b: RowBlock) => void;
}) {
  // Nested column blocks get their own active-block tracking, independent of
  // the top-level block list -- sharing one id would collapse this row's own
  // card the moment a block inside it was opened (they can't both be "the
  // active id" at once).
  const [activeColId, setActiveColId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const move = (ev: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((ev.clientX - rect.left) / rect.width) * 100;
      onChange({ ...block, splitPercent: Math.min(80, Math.max(20, Math.round(percent))) });
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={containerRef} className="flex items-stretch">
      <div style={{ width: `calc(${block.splitPercent}% - 8px)` }}>
        <ColumnEditor
          blocks={block.left}
          onChange={(left) => onChange({ ...block, left })}
          activeId={activeColId}
          setActiveId={setActiveColId}
        />
      </div>
      <div
        onPointerDown={onDragStart}
        className="w-4 flex-shrink-0 flex items-center justify-center cursor-col-resize group"
        title="Drag to resize columns"
      >
        <div className="w-1.5 self-stretch bg-zinc-200 group-hover:bg-zinc-400 rounded-full flex items-center justify-center transition-colors">
          <GripVertical size={12} className="text-zinc-500 bg-white rounded" />
        </div>
      </div>
      <div style={{ width: `calc(${100 - block.splitPercent}% - 8px)` }}>
        <ColumnEditor
          blocks={block.right}
          onChange={(right) => onChange({ ...block, right })}
          activeId={activeColId}
          setActiveId={setActiveColId}
        />
      </div>
    </div>
  );
}

function ButtonEditor({ block, onChange }: { block: ButtonBlock; onChange: (b: ButtonBlock) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-zinc-500 mb-1 block">Button label</Label>
        <Input
          value={block.label}
          onChange={(e) => onChange({ ...block, label: e.target.value })}
          placeholder="Shop Now"
        />
      </div>
      <div>
        <Label className="text-xs text-zinc-500 mb-1 block">Link URL</Label>
        <Input
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          placeholder="https://example.com/en/shop"
        />
      </div>
    </div>
  );
}

function VoucherEditor({ block, onChange }: { block: VoucherBlock; onChange: (b: VoucherBlock) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Paste a code created in <a href="../../vouchers" className="underline">Vouchers</a> -- usually a
        general one without "first-time customers only" checked, so anyone on the list can use it.
      </p>
      <div>
        <Label className="text-xs text-zinc-500 mb-1 block">Voucher code</Label>
        <Input
          value={block.code}
          onChange={(e) => onChange({ ...block, code: e.target.value.toUpperCase() })}
          placeholder="SUMMER10"
          className="font-mono"
        />
      </div>
      <div>
        <Label className="text-xs text-zinc-500 mb-1 block">Discount text</Label>
        <Input
          value={block.label}
          onChange={(e) => onChange({ ...block, label: e.target.value })}
          placeholder="10% OFF YOUR NEXT ORDER"
        />
      </div>
    </div>
  );
}

// --- Preview ---

function BlockPreview({ block }: { block: Block }) {
  switch (block.type) {
    case "text": {
      if (!block.content) return <p className="text-zinc-300 italic text-sm">Empty text block</p>;
      const classes: Record<string, string> = {
        heading: "text-2xl font-bold text-zinc-900 leading-tight",
        body: "text-sm text-zinc-600 leading-relaxed",
        small: "text-xs text-zinc-400",
      };
      const style: React.CSSProperties = { whiteSpace: "pre-wrap" };
      if (block.fontSizePx) style.fontSize = `${block.fontSizePx}px`;
      return (
        <p
          className={classes[block.size]}
          style={style}
          // block.content is sanitized to <b>/<i>/<u>/<br> only by the editor
          dangerouslySetInnerHTML={{ __html: block.content }}
        />
      );
    }
    case "image":
      return block.url ? (
        <div style={{ width: `${block.widthPercent ?? 100}%` }} className="mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} className="w-full h-auto rounded-lg" />
        </div>
      ) : (
        <div className="w-full h-24 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-400 text-xs">
          No image
        </div>
      );
    case "products":
      return (
        <div className="grid grid-cols-2 gap-2">
          {block.products.map((p) => (
            <div key={p.id} className="border rounded-lg overflow-hidden bg-white">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} className="w-full h-24 object-cover" />
              ) : (
                <div className="w-full h-24 bg-zinc-100" />
              )}
              <div className="p-2">
                <p className="text-xs font-semibold text-zinc-900 truncate">{p.name}</p>
                <p className="text-xs text-red-600 font-bold">€{(p.priceCents / 100).toFixed(2)}</p>
              </div>
            </div>
          ))}
          {block.products.length === 0 && (
            <p className="col-span-2 text-zinc-300 italic text-sm">No products selected</p>
          )}
        </div>
      );
    case "button":
      return (
        <div className="text-center">
          <span className="inline-block bg-red-600 text-white text-sm font-semibold px-6 py-3 rounded-md">
            {block.label || "Button"}
          </span>
        </div>
      );
    case "voucher":
      return block.code ? (
        <div className="text-center bg-zinc-50 border-2 border-dashed border-red-600 rounded-xl p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Use this code at checkout:</p>
          <span className="font-mono text-3xl font-bold text-red-600 tracking-widest">{block.code}</span>
          {block.label && <p className="mt-3 font-bold text-sm">{block.label}</p>}
        </div>
      ) : (
        <p className="text-zinc-300 italic text-sm">No voucher code set</p>
      );
    case "row":
      return (
        <div className="flex gap-3">
          <div style={{ width: `${block.splitPercent}%` }} className="space-y-3 min-w-0">
            {block.left.length === 0 ? (
              <p className="text-zinc-300 italic text-xs">Empty column</p>
            ) : (
              block.left.map((b) => <BlockPreview key={b.id} block={b} />)
            )}
          </div>
          <div style={{ width: `${100 - block.splitPercent}%` }} className="space-y-3 min-w-0">
            {block.right.length === 0 ? (
              <p className="text-zinc-300 italic text-xs">Empty column</p>
            ) : (
              block.right.map((b) => <BlockPreview key={b.id} block={b} />)
            )}
          </div>
        </div>
      );
  }
}

const BLOCK_TYPES = [
  { type: "text", label: "Text", icon: Type },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "products", label: "Products", icon: ShoppingBag },
  { type: "button", label: "Button", icon: MousePointerClick },
  { type: "voucher", label: "Voucher", icon: Percent },
  { type: "row", label: "Row", icon: Columns2 },
] as const;

const TEST_RECIPIENTS = [
  { email: "owner@example.com", label: "Owner" },
  { email: "developer@example.com", label: "Developer" },
  { email: "hello@example.com", label: "Sales inbox" },
];

function createBlock(type: Block["type"]): Block {
  const id = genId();
  switch (type) {
    case "row": return { id, type: "row", splitPercent: 50, left: [], right: [] };
    case "text": return { id, type: "text", content: "", size: "body" };
    case "image": return { id, type: "image", url: "", alt: "", widthPercent: 100 };
    case "products": return { id, type: "products", products: [] };
    case "button": return { id, type: "button", label: "Shop Now", url: "https://example.com/en/shop" };
    case "voucher": return { id, type: "voucher", code: "", label: "10% OFF YOUR NEXT ORDER" };
  }
}

// --- Main builder ---

export default function EmailBuilder({
  locale,
  products,
  subscriberCount,
  initialDraftId = null,
  initialSubject = "",
  initialBlocks = [],
}: {
  locale: string;
  products: Product[];
  subscriberCount: number;
  initialDraftId?: string | null;
  initialSubject?: string;
  initialBlocks?: Block[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [sending, setSending] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [testEmails, setTestEmails] = useState<Set<string>>(
    new Set(TEST_RECIPIENTS.map((r) => r.email)),
  );
  const [sendingTest, setSendingTest] = useState(false);

  const toggleTestEmail = (email: string) => {
    setTestEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const updateBlock = (id: string, updated: Block) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? updated : b)));

  const removeBlock = (id: string) =>
    setBlocks((prev) => prev.filter((b) => b.id !== id));

  const moveBlock = (id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const newArr = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= newArr.length) return prev;
      [newArr[idx], newArr[target]] = [newArr[target], newArr[idx]];
      return newArr;
    });
  };

  const addBlock = (type: Block["type"]) => {
    const block = createBlock(type);
    setBlocks((prev) => [...prev, block]);
    setActiveBlockId(block.id);
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const res = await saveCampaignDraft(draftId, { subject, blocks });
      if (res.error) throw new Error(res.error);
      if (res.draftId) {
        setDraftId(res.draftId);
        // Keep the draft id in the URL so a refresh (or sharing the link)
        // resumes the same draft instead of starting a blank one.
        router.replace(`/${locale}/admin/marketing/new?draft=${res.draftId}`);
      }
      setDraftSavedAt(new Date());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSend = async () => {
    if (!subject.trim()) { alert("Please enter a subject line."); return; }
    if (blocks.length === 0) { alert("Please add at least one block."); return; }
    if (!confirm(`Send to ${subscriberCount} subscribers?`)) return;

    setSending(true);
    try {
      const res = await fetch("/api/admin/send-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, blocks, campaignId: draftId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`Sent to ${data.sent} subscribers!`);
      router.push(`/${locale}/admin/marketing`);
      router.refresh();
    } catch (err: any) {
      alert(err.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const handleSendTest = async () => {
    if (!subject.trim()) { alert("Please enter a subject line."); return; }
    if (blocks.length === 0) { alert("Please add at least one block."); return; }
    const recipients = Array.from(testEmails);
    if (recipients.length === 0) { alert("Select at least one test recipient."); return; }

    setSendingTest(true);
    try {
      const res = await fetch("/api/admin/send-test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, blocks, recipients }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`Test email sent to ${recipients.join(", ")}`);
      setTestPanelOpen(false);
    } catch (err: any) {
      alert(err.message || "Test send failed");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 relative">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Newsletter</h1>
          {draftSavedAt && (
            <p className="text-xs text-zinc-400 mt-0.5">
              Draft saved {draftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={savingDraft}
          >
            {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {savingDraft ? "Saving..." : "Save Draft"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setTestPanelOpen((v) => !v)}
          >
            <FlaskConical className="mr-2 h-4 w-4" />
            Send Test
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {sending ? "Sending..." : `Send to ${subscriberCount} subscribers`}
          </Button>
        </div>

        {testPanelOpen && (
          <Card className="absolute right-0 top-12 z-10 w-72 shadow-lg">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Send test to
              </p>
              <div className="space-y-2">
                {TEST_RECIPIENTS.map((r) => (
                  <label key={r.email} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={testEmails.has(r.email)}
                      onChange={() => toggleTestEmail(r.email)}
                      className="rounded border-zinc-300"
                    />
                    <span className="font-medium">{r.label}</span>
                    <span className="text-zinc-400 text-xs">{r.email}</span>
                  </label>
                ))}
              </div>
              <Button
                type="button"
                onClick={handleSendTest}
                disabled={sendingTest}
                className="w-full bg-black text-white hover:bg-zinc-800"
              >
                {sendingTest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                {sendingTest ? "Sending..." : "Send Test Email"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Subject */}
      <div className="space-y-1">
        <Label htmlFor="subject" className="text-sm font-medium">Subject line *</Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="New arrivals this week 🌶️"
          className="text-base"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: Editor */}
        <div className="space-y-3">
          {/* Add block buttons */}
          <div className="flex flex-wrap gap-2">
            {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => addBlock(type)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <Icon size={14} />
                <span>{label}</span>
                <Plus size={12} className="text-zinc-400" />
              </button>
            ))}
          </div>

          {/* Blocks */}
          {blocks.length === 0 ? (
            <div className="border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center text-zinc-400">
              <Plus size={24} className="mx-auto mb-2" />
              <p className="text-sm">Add a block above to start building your email.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {blocks.map((block, idx) => {
                const isActive = activeBlockId === block.id;
                const Icon = BLOCK_TYPES.find((t) => t.type === block.type)?.icon || Type;
                return (
                  <Card
                    key={block.id}
                    className={`cursor-pointer transition-all ${isActive ? "ring-2 ring-black shadow-md" : "hover:shadow-sm"}`}
                    onClick={() => setActiveBlockId(isActive ? null : block.id)}
                  >
                    <CardContent className="p-4">
                      {/* Block header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                          <Icon size={14} />
                          <span>{block.type}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); moveBlock(block.id, -1); }}
                            disabled={idx === 0}
                            className="p-1 rounded hover:bg-zinc-100 disabled:opacity-30"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 1); }}
                            disabled={idx === blocks.length - 1}
                            className="p-1 rounded hover:bg-zinc-100 disabled:opacity-30"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }}
                            className="p-1 rounded hover:bg-red-50 text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Block editor (only when active) */}
                      {isActive && (
                        <div onClick={(e) => e.stopPropagation()}>
                          {block.type === "text" && (
                            <TextEditor block={block} onChange={(b) => updateBlock(block.id, b)} />
                          )}
                          {block.type === "image" && (
                            <ImageEditor block={block} onChange={(b) => updateBlock(block.id, b)} />
                          )}
                          {block.type === "products" && (
                            <ProductsEditor
                              block={block}
                              onChange={(b) => updateBlock(block.id, b)}
                              allProducts={products}
                            />
                          )}
                          {block.type === "button" && (
                            <ButtonEditor block={block} onChange={(b) => updateBlock(block.id, b)} />
                          )}
                          {block.type === "voucher" && (
                            <VoucherEditor block={block} onChange={(b) => updateBlock(block.id, b)} />
                          )}
                          {block.type === "row" && (
                            <RowEditor
                              block={block}
                              onChange={(b) => updateBlock(block.id, b)}
                            />
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="sticky top-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Preview</p>
          <div className="rounded-xl overflow-hidden border shadow-sm bg-zinc-100">
            {/* Header */}
            <div className="bg-red-600 px-6 py-5 flex items-center gap-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/logo.png" alt="Your Store" className="w-[70px] h-auto rounded-md flex-shrink-0" />
              <span className="flex-1 text-center text-white text-base font-bold leading-tight capitalize tracking-wide">News from Your Store</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/logo.png" alt="Your Store" className="w-[70px] h-auto rounded-md flex-shrink-0" />
            </div>
            {/* Body */}
            <div className="bg-white px-6 py-6 space-y-4 min-h-[200px]">
              {blocks.length === 0 ? (
                <p className="text-zinc-300 text-sm text-center pt-8">Your email preview will appear here.</p>
              ) : (
                blocks.map((block) => (
                  <div key={block.id}>
                    <BlockPreview block={block} />
                  </div>
                ))
              )}
            </div>
            {/* Footer */}
            <div className="bg-zinc-900 px-6 py-4 text-center space-y-1">
              <p className="text-zinc-400 text-xs">Your Store</p>
              <p className="text-zinc-600 text-xs">You&apos;re receiving this because you subscribed or made a purchase.</p>
              <p className="text-zinc-500 text-xs underline">Unsubscribe</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
