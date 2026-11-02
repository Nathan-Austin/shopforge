'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImageUploader } from './ImageUploader';
import type { DbId } from '@/components/store/types';

/** Product fields the form can edit; mirrors the `products` table columns. */
export interface ProductFormProduct {
  id: DbId;
  name: string;
  slug: string;
  description?: string | null;
  details?: string | null;
  price_cents: number;
  currency: string;
  category_id?: DbId | null;
  brand_id?: DbId | null;
  capacity_ml?: number | null;
  image_url?: string | null;
  ingredients?: string | null;
  nutrition_info?: Record<string, number> | null;
  is_active?: boolean | null;
  size_options?: string[] | null;
  color_options?: string[] | null;
}

interface SelectOption {
  id: DbId;
  name: string;
  slug?: string;
}

export interface ProductFormResult {
  error?: string;
  success?: string;
}

interface ProductFormProps {
  product?: ProductFormProduct;
  categories: SelectOption[];
  brands: SelectOption[];
  /**
   * Server action (see ../actions). Receives every named form field plus
   * `product_id`, `category_id`, `brand_id` and `image_url`.
   */
  onSubmit: (formData: FormData) => Promise<ProductFormResult>;
  /** Server action receiving `product_id`. */
  onDelete?: (formData: FormData) => Promise<ProductFormResult>;
  /** Where to go after a successful save or delete. */
  successRedirectPath?: string;
}

export default function ProductForm({
  product,
  categories,
  brands,
  onSubmit,
  onDelete,
  successRedirectPath,
}: ProductFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryValue, setCategoryValue] = useState(
    product?.category_id ? String(product.category_id) : 'none'
  );
  const [brandValue, setBrandValue] = useState(
    product?.brand_id ? String(product.brand_id) : 'none'
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    product?.image_url || null
  );

  const finish = (result: ProductFormResult) => {
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (successRedirectPath) {
      router.push(successRedirectPath);
      router.refresh();
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Named inputs are picked up automatically; add the controlled values.
    const formData = new FormData(e.currentTarget);
    if (product) formData.set('product_id', String(product.id));
    formData.set('category_id', categoryValue === 'none' ? '' : categoryValue);
    formData.set('brand_id', brandValue === 'none' ? '' : brandValue);
    formData.set('image_url', imageUrl ?? '');

    try {
      finish(await onSubmit(formData));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !product) return;
    if (!window.confirm('Delete this product?')) return;
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.set('product_id', String(product.id));

    try {
      finish(await onDelete(formData));
    } finally {
      setLoading(false);
    }
  };

  const nutritionInfo = product?.nutrition_info;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {product ? 'Edit Product' : 'New Product'}
        </h1>
        <div className="flex gap-2">
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              Delete
            </Button>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save Product'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={product?.name}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">Slug *</Label>
                  <Input
                    id="slug"
                    name="slug"
                    defaultValue={product?.slug}
                    required
                    placeholder="product-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Short Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={product?.description || ''}
                  rows={2}
                  placeholder="Short tagline shown below product name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="details">Full Details (Tabs)</Label>
                <Textarea
                  id="details"
                  name="details"
                  defaultValue={product?.details || ''}
                  rows={4}
                  placeholder="Detailed product information for the Details tab"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="price_cents">Price (cents) *</Label>
                  <Input
                    id="price_cents"
                    name="price_cents"
                    type="number"
                    defaultValue={product?.price_cents}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Currency *</Label>
                  <Input
                    id="currency"
                    name="currency"
                    defaultValue={product?.currency || 'EUR'}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="is_active">Status *</Label>
                  <Select
                    name="is_active"
                    defaultValue={product?.is_active === false ? 'false' : 'true'}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={categoryValue}
                    onValueChange={setCategoryValue}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Category</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Select
                    value={brandValue}
                    onValueChange={setBrandValue}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select brand" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Brand</SelectItem>
                      {brands.map((brand) => (
                        <SelectItem key={brand.id} value={String(brand.id)}>
                          {brand.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Product Particulars</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="capacity_ml">Capacity (ml / g)</Label>
                <Input
                  id="capacity_ml"
                  name="capacity_ml"
                  type="number"
                  defaultValue={product?.capacity_ml || ''}
                  placeholder="e.g. 500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ingredients">Ingredients / Materials</Label>
                <Textarea
                  id="ingredients"
                  name="ingredients"
                  defaultValue={product?.ingredients || ''}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
            </CardHeader>
            <CardContent>
              <ImageUploader
                imageUrl={imageUrl}
                onUpload={(url) => setImageUrl(url)}
                onRemove={() => setImageUrl(null)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Variants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="size_options">Size Options (comma separated)</Label>
                <Input
                  id="size_options"
                  name="size_options"
                  defaultValue={product?.size_options?.join(', ') || ''}
                  placeholder="S, M, L, XL"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="color_options">Color Options (comma separated)</Label>
                <Input
                  id="color_options"
                  name="color_options"
                  defaultValue={product?.color_options?.join(', ') || ''}
                  placeholder="Red, Blue, Black"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nutrition Information (per 100g/ml)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="energy_kj">Energy (kJ)</Label>
                  <Input
                    id="energy_kj"
                    name="energy_kj"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.energy_kj}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="energy_kcal">Energy (kcal)</Label>
                  <Input
                    id="energy_kcal"
                    name="energy_kcal"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.energy_kcal}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fat_g">Fat (g)</Label>
                  <Input
                    id="fat_g"
                    name="fat_g"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.fat_g}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="saturated_fat_g">Saturated Fat (g)</Label>
                  <Input
                    id="saturated_fat_g"
                    name="saturated_fat_g"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.saturated_fat_g}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="carbohydrate_g">Carbohydrate (g)</Label>
                  <Input
                    id="carbohydrate_g"
                    name="carbohydrate_g"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.carbohydrate_g}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sugar_g">Sugar (g)</Label>
                  <Input
                    id="sugar_g"
                    name="sugar_g"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.sugar_g}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="protein_g">Protein (g)</Label>
                  <Input
                    id="protein_g"
                    name="protein_g"
                    type="number"
                    step="0.1"
                    defaultValue={nutritionInfo?.protein_g}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salt_g">Salt (g)</Label>
                  <Input
                    id="salt_g"
                    name="salt_g"
                    type="number"
                    step="0.01"
                    defaultValue={nutritionInfo?.salt_g}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
