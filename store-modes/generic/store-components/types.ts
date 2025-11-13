export interface ChilliType {
  id: string | number;
  name: string;
  slug: string;
  heatLevel?: string | number | null;
}

export interface Category {
  id: string | number;
  name: string;
  slug: string;
}

export interface StoreBrand {
  id: string | number;
  name: string;
  slug: string;
  description?: string;
  country?: string;
  logo_url?: string;
}

export interface StoreProduct {
  id: string | number;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  description?: string;
  image_url?: string;
  heatLevel?: string | number | null;
  chilliTypes?: ChilliType[];
  category?: Category | null;
  brandId?: string | number;
  brand?: StoreBrand | null;
}
