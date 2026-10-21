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
interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  details?: string | null;
  price_cents: number;
  currency: string;
  category_id?: string | null;
  brand_id?: string | null;
  capacity_ml?: number | null;
  heat_level?: string | null;
  image_url?: string | null;
  ingredients?: string | null;
  nutrition_info?: Record<string, number> | null;
  is_active?: boolean;
  size_options?: string[] | null;
  color_options?: string[] | null;
}

interface Category { id: string; name: string; slug: string; }
interface Brand { id: string; name: string; slug?: string; }

interface ProductFormProps {
  product?: Product;
  categories: Category[];
  brands: Brand[];
  chilliTypes?: { id: string; name: string }[];
  onSubmit: (data: any) => Promise<void>;
  onDelete?: () => Promise<void>;
  successRedirectPath?: string;
}

export default function ProductForm({
  product,
  categories,
  brands,
  onSubmit,
  onDelete,
}: ProductFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [categoryValue, setCategoryValue] = useState(
    product?.category_id || 'none'
  );
  const [brandValue, setBrandValue] = useState(
    product?.brand_id || 'none'
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    product?.image_url || null
  );

  const selectedCategory = categories.find(
    (cat) => cat.id === categoryValue
  );
  // Example logic for variants (adjust as needed for specific store)
  const isMerchCategory = selectedCategory?.slug === 'merch' || selectedCategory?.slug?.includes('clothing');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    // Parse nutrition info from individual fields
    const nutritionInfo = {
      energy_kj: parseFloat(formData.get('energy_kj') as string) || undefined,
      energy_kcal: parseFloat(formData.get('energy_kcal') as string) || undefined,
      fat_g: parseFloat(formData.get('fat_g') as string) || undefined,
      saturated_fat_g: parseFloat(formData.get('saturated_fat_g') as string) || undefined,
      carbohydrate_g: parseFloat(formData.get('carbohydrate_g') as string) || undefined,
      sugar_g: parseFloat(formData.get('sugar_g') as string) || undefined,
      protein_g: parseFloat(formData.get('protein_g') as string) || undefined,
      salt_g: parseFloat(formData.get('salt_g') as string) || undefined,
    };

    // Remove undefined values
    const cleanedNutrition = Object.fromEntries(
      Object.entries(nutritionInfo).filter(([, value]) => value !== undefined)
    );

    const sizeOptionsRaw = (formData.get('size_options') as string) || '';
    const colorOptionsRaw = (formData.get('color_options') as string) || '';

    const sizeOptions = sizeOptionsRaw
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);
    const colorOptions = colorOptionsRaw
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);

    const capacityMl = formData.get('capacity_ml') as string;
    const heatLevel = formData.get('heat_level') as string;

    const data = {
      name: formData.get('name') as string,
      slug: formData.get('slug') as string,
      description: formData.get('description') as string || null,
      details: formData.get('details') as string || null,
      price_cents: parseInt(formData.get('price_cents') as string),
      currency: formData.get('currency') as string,
      category_id: categoryValue === 'none' ? null : categoryValue,
      brand_id: brandValue === 'none' ? null : brandValue,
      capacity_ml: capacityMl ? parseInt(capacityMl) : null,
      heat_level: heatLevel === 'none' ? null : heatLevel,
      image_url: imageUrl,
      ingredients: formData.get('ingredients') as string || null,
      nutrition_info: Object.keys(cleanedNutrition).length > 0 ? cleanedNutrition : null,
      is_active: formData.get('is_active') === 'true',
      size_options:
        sizeOptions.length > 0 ? sizeOptions : null,
      color_options:
        colorOptions.length > 0 ? colorOptions : null,
    };

    try {
      await onSubmit(data);
    } finally {
      setLoading(false);
    }
  };

  const nutritionInfo = product?.nutrition_info as
    | Record<string, number>
    | null
    | undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {product ? 'Edit Product' : 'New Product'}
        </h1>
        <div className="flex gap-2">
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
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
                        <SelectItem key={cat.id} value={cat.id}>
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
                        <SelectItem key={brand.id} value={brand.id}>
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
              <CardTitle>Chilli Specifics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="heat_level">Heat Level (0-10)</Label>
                  <Input
                    id="heat_level"
                    name="heat_level"
                    type="number"
                    min="0"
                    max="10"
                    defaultValue={product?.heat_level || ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity_ml">Capacity (ml)</Label>
                  <Input
                    id="capacity_ml"
                    name="capacity_ml"
                    type="number"
                    defaultValue={product?.capacity_ml || ''}
                    placeholder="e.g. 100"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ingredients">Ingredients</Label>
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
