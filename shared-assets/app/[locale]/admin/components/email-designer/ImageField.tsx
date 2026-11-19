'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoaderCircle, Upload } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Field, inputClass } from './fields';

/** Wide enough for a 600px email on a high-density screen, small enough to load fast. */
const MAX_WIDTH = 1200;
/** PNG and GIF files under this size are kept as they are (transparency, animation). */
const KEEP_AS_IS_BYTES = 800_000;

/**
 * An image ready for email. Unlike product photos (WebP), email images are
 * JPEG, PNG or GIF: Outlook for Windows does not show WebP. Large or wide
 * images are scaled down to MAX_WIDTH and saved as JPEG.
 */
async function prepareImage(file: File): Promise<{ blob: Blob; extension: string; type: string }> {
  const keep = (file.type === 'image/png' || file.type === 'image/gif') && file.size <= KEEP_AS_IS_BYTES;
  if (keep) return { blob: file, extension: file.type === 'image/png' ? 'png' : 'gif', type: file.type };

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('not an image'));
      element.src = url;
    });
    const scale = Math.min(1, MAX_WIDTH / image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    // JPEG has no transparency: put transparent areas on white, as an email shows them.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('encoding failed'))), 'image/jpeg', 0.85)
    );
    return { blob, extension: 'jpg', type: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface ImageFieldProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
}

/** An https address, typed or pasted, or an upload to the shop's image bucket. */
export default function ImageField({ label, value, onChange, hint }: ImageFieldProps) {
  const t = useTranslations('Admin.email.designer.fields');
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { blob, extension, type } = await prepareImage(file);
      const supabase = createClient();
      const path = `email/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
      const { data, error: uploadError } = await supabase.storage.from('product-images').upload(path, blob, { contentType: type });
      if (uploadError) throw uploadError;
      onChange(supabase.storage.from('product-images').getPublicUrl(data.path).data.publicUrl);
    } catch (caught) {
      setError(t('uploadFailed', { message: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Field label={label} hint={hint}>
        <input
          type="text"
          inputMode="url"
          value={value}
          placeholder="https://"
          onChange={(event) => onChange(event.target.value.trim())}
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:border-emerald-700 hover:text-emerald-700 disabled:opacity-60"
        >
          {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {uploading ? t('uploading') : t('upload')}
        </button>
        {/^https:\/\//.test(value) && (
          // eslint-disable-next-line @next/next/no-img-element -- any https host, not just next/image's allow-list
          <img src={value} alt="" className="h-12 max-w-32 rounded border border-border object-contain" />
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
