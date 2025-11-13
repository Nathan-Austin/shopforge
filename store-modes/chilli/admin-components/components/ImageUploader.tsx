'use client';

import { useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';

interface ImageUploaderProps {
  value?: string;
  onChange: (url: string) => void;
}

export default function ImageUploader({ value, onChange }: ImageUploaderProps) {
  const t = useTranslations('Admin');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    const fileExt = file.name.split('.').pop();
    const filePath = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
    onChange(data.publicUrl);
    setUploading(false);
  };

  return (
    <div className="space-y-3">
      {value ? (
        <div className="relative h-48 w-48 overflow-hidden rounded-xl border border-border bg-gray-50">
          <Image src={value} alt={t('form.imageAlt')} fill className="object-cover" />
        </div>
      ) : (
        <div className="h-48 w-48 rounded-xl border border-dashed border-border bg-gray-50 flex items-center justify-center text-sm text-text-muted">
          {t('form.noImage')}
        </div>
      )}

      <label className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-roh-flag-green hover:text-roh-flag-green transition-colors cursor-pointer">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
        {uploading ? t('form.uploading') : t('form.uploadImage')}
      </label>

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-xs text-text-muted underline"
        >
          {t('form.removeImage')}
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
