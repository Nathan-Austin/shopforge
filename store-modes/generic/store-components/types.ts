export type DbId = string | number;

export interface Category {
  id: DbId;
  name: string;
  slug: string;
}

export interface StoreBrand {
  id: DbId;
  name: string;
  slug: string;
  description?: string | null;
  country?: string | null;
  logo_url?: string | null;
}

export interface StoreProduct {
  id: DbId;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  description?: string | null;
  image_url?: string | null;
  category?: Category | null;
  brandId?: DbId;
  brand?: StoreBrand | null;
  stock?: number;
  is_active?: boolean;
  isFeatured?: boolean | null;
  /** ISO timestamp; what the archive's "newest" sort orders by. */
  createdAt?: string | null;
  /** Cart variant options and availability, for the card's add-to-cart. */
  sizeOptions?: string[] | null;
  colorOptions?: string[] | null;
  soldOut?: boolean;
}