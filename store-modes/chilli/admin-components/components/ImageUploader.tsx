'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase/client';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import Image from 'next/image';

interface ImageUploaderProps {
  imageUrl?: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
  productSlug?: string;
}

export function ImageUploader({
  imageUrl,
  onUpload,
  onRemove,
  productSlug,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const convertToWebP = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to convert image to WebP'));
          },
          'image/webp',
          0.85
        );
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);

      // Convert to WebP
      const webpBlob = await convertToWebP(file);

      // Generate filename
      const timestamp = Date.now();
      const filename = productSlug 
        ? `${productSlug}-${timestamp}.webp` 
        : `prod-${timestamp}.webp`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filename, webpBlob, {
          contentType: 'image/webp',
          upsert: true
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path);

      onUpload(publicUrl);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {imageUrl ? (
        <div className="relative aspect-square w-full max-w-[200px] overflow-hidden rounded-lg border bg-zinc-100">
          <Image
            src={imageUrl}
            alt="Product preview"
            fill
            className="object-cover"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 rounded-full shadow-lg"
            onClick={onRemove}
            disabled={uploading}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div 
          className="flex aspect-square w-full max-w-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 transition-colors hover:bg-zinc-100"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon className="mb-2 h-8 w-8 text-zinc-400" />
          <span className="text-xs text-zinc-500">Click to upload</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={uploading}
      />

      {!imageUrl && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full max-w-[200px]"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload Image
            </>
          )}
        </Button>
      )}
    </div>
  );
}
