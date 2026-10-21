"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { Plus, X, Loader2 } from "lucide-react";
import Image from "next/image";

interface ProductImageGalleryProps {
  initialImages: string[];
  productSlug?: string;
  onChange: (urls: string[]) => void;
}

export function ProductImageGallery({
  initialImages,
  productSlug,
  onChange,
}: ProductImageGalleryProps) {
  const [images, setImages] = useState<string[]>(initialImages);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const convertToWebP = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement("img");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to convert to WebP"));
          },
          "image/webp",
          0.85,
        );
      };

      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      setUploading(true);
      const uploadedUrls: string[] = [];

      for (const file of files) {
        const webpBlob = await convertToWebP(file);
        const timestamp = Date.now() + Math.round(Math.random() * 1000);
        const filename = productSlug
          ? `${productSlug}-${timestamp}.webp`
          : `prod-${timestamp}.webp`;

        const { data, error } = await supabase.storage
          .from("product-images")
          .upload(filename, webpBlob, { contentType: "image/webp", upsert: true });

        if (error) throw error;

        const {
          data: { publicUrl },
        } = supabase.storage.from("product-images").getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      }

      const next = [...images, ...uploadedUrls];
      setImages(next);
      onChange(next);
    } catch (err) {
      console.error("Image upload failed:", err);
      alert("Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = (index: number) => {
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {images.map((url, i) => (
          <div
            key={url}
            className="relative aspect-square w-[120px] shrink-0 overflow-hidden rounded-lg border bg-zinc-100"
          >
            <Image
              src={url}
              alt={`Product photo ${i + 1}`}
              fill
              className="object-cover"
            />
            {i === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] leading-none text-white">
                Primary
              </span>
            )}
            <button
              type="button"
              onClick={() => handleRemove(i)}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex aspect-square w-[120px] shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 transition-colors hover:bg-zinc-100 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          ) : (
            <>
              <Plus className="h-5 w-5 text-zinc-400" />
              <span className="mt-1 text-xs text-zinc-500">Add Photo</span>
            </>
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
        disabled={uploading}
      />

      {images.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          First photo is the primary image shown in the shop. Changes are saved with the product.
        </p>
      )}
    </div>
  );
}
