export type DbId = string | number;

export interface ProductVariant {
  id: string;
  label: string;
  price_cents: number;
  sale_price_cents?: number | null;
  weight_grams?: number | null;
  in_stock: boolean;
  low_stock_quantity?: number | null;
  sort_order: number;
}

export interface ChilliType {
  id: DbId;
  name: string;
  slug: string;
  heatLevel?: number | null;
}

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
  heatLevel?: number | null;
  chilliTypes?: ChilliType[];
  category?: Category | null;
  categories?: Category[];
  brandId?: DbId;
  brand?: StoreBrand | null;
  in_stock?: boolean;
  low_stock_quantity?: number | null;
  low_stock_threshold?: number | null;
  is_active?: boolean;
  is_vegan?: boolean;
  is_sugar_free?: boolean;
  on_sale?: boolean;
  sale_price_cents?: number | null;
  capacity_ml?: number | null;
  weight_grams?: number | null;
  display_unit?: string | null;
  created_at?: string;
  avgRating?: number | null;
  reviewCount?: number;
  variants?: ProductVariant[];
}
