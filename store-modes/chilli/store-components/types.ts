export type DbId = string | number;

export interface ChilliType {
  id: DbId;
  name: string;
  slug: string;
  heatLevel?: string | number | null;
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
  heatLevel?: string | number | null;
  chilliTypes?: ChilliType[];
  category?: Category | null;
  brandId?: DbId;
  brand?: StoreBrand | null;
  stock?: number;
  is_active?: boolean;
}