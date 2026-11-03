'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

interface ProductGalleryProps {
  /** Already cleaned by galleryImages(): no blanks, no repeats, main first. */
  images: string[];
  /** Product name, for the alt text. */
  name: string;
}

/**
 * Main image with a row of thumbnails underneath. With one image there are
 * no thumbnails, and with none there is a labelled placeholder so the page
 * keeps its shape.
 */
export default function ProductGallery({ images, name }: ProductGalleryProps) {
  const t = useTranslations('Product');
  const [index, setIndex] = useState(0);
  const current = images[Math.min(index, Math.max(0, images.length - 1))];

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
        {current ? (
          <Image
            key={current}
            src={current}
            alt={t('imageAlt', { name, index: index + 1, count: images.length })}
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            {t('noImage')}
          </div>
        )}
      </div>

      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('galleryLabel')}>
          {images.map((url, position) => {
            const selected = position === index;
            return (
              <li key={url}>
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-pressed={selected}
                  aria-label={t('showImage', { index: position + 1, count: images.length })}
                  className={`relative h-16 w-16 overflow-hidden rounded-md border-2 bg-zinc-100 transition-colors ${
                    selected ? 'border-black' : 'border-transparent hover:border-zinc-400'
                  }`}
                >
                  <Image src={url} alt="" fill className="object-cover" sizes="64px" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
