'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ProductFieldInput from '@/components/admin/ProductFieldInput';
import { enabledProductFieldGroups } from '@/lib/products/catalogue';
import type { DbId } from '@/components/store/types';
import { ImageUploader } from './ImageUploader';

/**
 * A product row as loaded for editing. Beyond the core columns the shape
 * depends on which fields the shop enabled, so the rest is read by column
 * name through the catalogue.
 */
export interface ProductFormProduct extends Record<string, unknown> {
  id: DbId;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  image_url?: string | null;
  category_id?: DbId | null;
  brand_id?: DbId | null;
  /** Chilli types currently linked to this product. */
  chilliTypes?: { id: DbId }[];
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
  /** Every chilli type available to pick from. */
  chilliTypes?: SelectOption[];
  /**
   * Server action (see ../actions). Receives every enabled field by its
   * catalogue key, plus `product_id`, `category_id`, `brand_id`,
   * `image_url` and the selected `chilliTypeIds`.
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
  chilliTypes = [],
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

  const fieldGroups = enabledProductFieldGroups();
  const selectedChilliTypeIds =
    product?.chilliTypes?.map((chilliType) => String(chilliType.id)) ?? [];

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

    // Named inputs (including the chilliTypeIds multi-select) are picked up
    // automatically; add the controlled values.
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {product ? 'Edit product' : 'New product'}
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
            {loading ? 'Saving...' : 'Save product'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" name="name" defaultValue={product?.name} required />
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="price">Price *</Label>
                  <Input
                    id="price"
                    name="price"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={product ? (product.price_cents / 100).toFixed(2) : ''}
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
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={categoryValue} onValueChange={setCategoryValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No category</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Select value={brandValue} onValueChange={setBrandValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select brand" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No brand</SelectItem>
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

          {fieldGroups.map(({ group, fields }) => (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle>{group.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {fields.map((field) => (
                  <ProductFieldInput key={field.key} field={field} values={product} />
                ))}

                {group.key === 'chilli' && chilliTypes.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="chilliTypeIds">Chilli types</Label>
                    <select
                      id="chilliTypeIds"
                      name="chilliTypeIds"
                      multiple
                      defaultValue={selectedChilliTypeIds}
                      className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {chilliTypes.map((chilliType) => (
                        <option key={chilliType.id} value={String(chilliType.id)}>
                          {chilliType.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Hold Cmd/Ctrl to select more than one pepper.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Main image</CardTitle>
            </CardHeader>
            <CardContent>
              <ImageUploader
                imageUrl={imageUrl}
                onUpload={(url) => setImageUrl(url)}
                onRemove={() => setImageUrl(null)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
