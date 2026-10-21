import Link from "next/link";
import Image from "next/image";
import type { Category } from "./types";

interface CategoryCardProps {
  category: Category & { image_url?: string | null };
  locale: string;
}

export default function CategoryCard({ category, locale }: CategoryCardProps) {
  return (
    <Link
      href={`/${locale}/shop?category=${category.slug}`}
      className="group flex flex-col gap-4"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-zinc-100 transition-all group-hover:ring-2 group-hover:ring-orange-500 active:scale-[0.98]">
        {category.image_url ? (
          <Image
            src={category.image_url}
            alt={category.name}
            fill
            className="object-contain p-6 transition-transform duration-500 group-hover:scale-110"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-200">
            <span className="text-6xl">🌶️</span>
          </div>
        )}
      </div>

      <div className="text-center">
        <h3 className="text-xl font-bold text-zinc-900 transition-colors group-hover:text-orange-600">
          {category.name}
        </h3>
        <p className="mt-1 text-sm font-medium text-zinc-500">
          Explore collection &rarr;
        </p>
      </div>
    </Link>
  );
}
