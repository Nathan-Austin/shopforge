"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductImageGallery } from "./ProductImageGallery";
import { RichTextEditor } from "./RichTextEditor";
import { slugify } from "@/lib/utils";
import type { ChilliType } from "@/components/store/types";

interface ProductVariantDraft {
  id?: string;
  label: string;
  price_euros: string;
  sale_euros: string;
  weight_grams: string;
  in_stock: boolean;
  low_stock_quantity: string;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  details?: string | null;
  pairing?: string | null;
  price_cents: number;
  currency: string;
  category_id?: string | null;
  categoryIds?: string[];
  brand_id?: string | null;
  capacity_ml?: number | null;
  weight_grams?: number | null;
  display_unit?: string | null;
  heat_level?: string | null;
  image_url?: string | null;
  imageUrls?: string[];
  ingredients?: string | null;
  nutrition_info?: Record<string, number> | null;
  is_active?: boolean;
  is_vegan?: boolean;
  is_sugar_free?: boolean;
  on_sale?: boolean;
  sale_price_cents?: number | null;
  size_options?: string[] | null;
  color_options?: string[] | null;
  in_stock?: boolean;
  low_stock_quantity?: number | null;
  chilliTypes?: ChilliType[];
  variants?: Array<{ id: string; label: string; price_cents: number; sale_price_cents?: number | null; weight_grams?: number | null; in_stock: boolean; low_stock_quantity?: number | null; sort_order: number }>;
}

interface Category {
  id: string | number;
  name: string;
  slug: string;
}
interface Brand {
  id: string | number;
  name: string;
  slug?: string;
}

interface ProductFormProps {
  product?: Product;
  categories: Category[];
  brands: Brand[];
  chilliTypes: ChilliType[];
  onSubmit: (data: any) => Promise<any>;
  onDelete?: (...args: any[]) => Promise<any>;
  successRedirectPath?: string;
}

export default function ProductForm({
  product,
  categories,
  brands,
  chilliTypes,
  onSubmit,
  onDelete,
  successRedirectPath,
}: ProductFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
    product?.categoryIds ??
      (product?.category_id ? [product.category_id] : []),
  );
  const [brandValue, setBrandValue] = useState(product?.brand_id || "none");
  const [imageUrls, setImageUrls] = useState<string[]>(
    product?.imageUrls ?? (product?.image_url ? [product.image_url] : []),
  );
  const [selectedChilliTypes, setSelectedChilliTypes] = useState<string[]>(
    (product?.chilliTypes ?? []).map((ct) => String(ct.id)),
  );
  const [slug, setSlug] = useState(product?.slug || "");
  const [variants, setVariants] = useState<ProductVariantDraft[]>(
    (product?.variants ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      price_euros: (v.price_cents / 100).toFixed(2),
      sale_euros: v.sale_price_cents != null ? (v.sale_price_cents / 100).toFixed(2) : "",
      weight_grams: v.weight_grams != null ? String(v.weight_grams) : "",
      in_stock: v.in_stock ?? true,
      low_stock_quantity: v.low_stock_quantity != null ? String(v.low_stock_quantity) : "",
    })),
  );

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!product) {
      setSlug(slugify(e.target.value));
    }
  };

  const isMerchCategory = selectedCategoryIds.some((id) => {
    const cat = categories.find((c) => String(c.id) === id);
    return cat?.slug === "merch" || cat?.slug?.includes("clothing");
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    // Parse nutrition info from individual fields and store as JSON string
    const nutritionInfo = {
      energy_kj: parseFloat(formData.get("energy_kj") as string) || undefined,
      energy_kcal:
        parseFloat(formData.get("energy_kcal") as string) || undefined,
      fat_g: parseFloat(formData.get("fat_g") as string) || undefined,
      saturated_fat_g:
        parseFloat(formData.get("saturated_fat_g") as string) || undefined,
      carbohydrate_g:
        parseFloat(formData.get("carbohydrate_g") as string) || undefined,
      sugar_g: parseFloat(formData.get("sugar_g") as string) || undefined,
      protein_g: parseFloat(formData.get("protein_g") as string) || undefined,
      salt_g: parseFloat(formData.get("salt_g") as string) || undefined,
    };

    const cleanedNutrition = Object.fromEntries(
      Object.entries(nutritionInfo).filter(([, value]) => value !== undefined),
    );

    // Append multi-select category IDs
    selectedCategoryIds.forEach((id) => formData.append("categoryIds", id));
    formData.set("brand_id", brandValue === "none" ? "" : String(brandValue));
    imageUrls.forEach((url) => formData.append("imageUrls", url));
    if (Object.keys(cleanedNutrition).length > 0) {
      formData.set("nutrition_info", JSON.stringify(cleanedNutrition));
    }

    // Append multi-select chilli types
    selectedChilliTypes.forEach((id) => {
      formData.append("chilliTypeIds", id);
    });

    // Tell the server how many variants were loaded (so it can distinguish
    // "user intentionally cleared all" from "form loaded empty due to query failure")
    formData.set(
      "variants_initial_count",
      String((product?.variants ?? []).length),
    );

    // Serialize variants
    const variantPayload = variants
      .filter((v) => v.label.trim())
      .map((v, i) => ({
        id: v.id,
        label: v.label.trim(),
        price_cents: Math.round(parseFloat(v.price_euros || "0") * 100),
        sale_price_cents: v.sale_euros ? Math.round(parseFloat(v.sale_euros) * 100) : null,
        weight_grams: v.weight_grams ? parseInt(v.weight_grams) : null,
        in_stock: v.in_stock,
        low_stock_quantity: v.low_stock_quantity ? parseInt(v.low_stock_quantity) : null,
        sort_order: i,
      }));
    formData.set("variants", JSON.stringify(variantPayload));

    try {
      const result = await onSubmit(formData);
      if (result?.success) {
        if (result.productId) {
          // New product — go to its edit page
          router.push(`/${locale}/admin/products/${result.productId}`);
        } else {
          // Edit — stay on page, refresh server data, show confirmation
          router.refresh();
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        }
      }
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const nutritionInfo = product?.nutrition_info as
    | Record<string, number>
    | null
    | undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {product?.id && (
        <input type="hidden" name="product_id" value={product.id} />
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {product ? "Edit Product" : "New Product"}
        </h1>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-sm font-semibold text-green-600">
              ✓ Saved
            </span>
          )}
          {product?.slug && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(`/${locale}/shop/${product.slug}`, "_blank")}
            >
              View listing
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!confirm("Delete this product? This cannot be undone.")) return;
                const fd = new FormData();
                fd.append("product_id", String(product!.id));
                const result = await onDelete(fd);
                if (result?.success && successRedirectPath) {
                  router.push(successRedirectPath);
                }
              }}
              disabled={loading}
            >
              Delete
            </Button>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Product"}
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
              <input type="hidden" name="slug" value={slug} />
              <div className="grid gap-4 sm:grid-cols-1">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={product?.name}
                    required
                    onChange={handleNameChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Short Description</Label>
                <RichTextEditor
                  name="description"
                  defaultValue={product?.description || ""}
                  rows={2}
                  placeholder="Short tagline shown below product name"
                />
              </div>

              <div className="space-y-2">
                <Label>Full Details</Label>
                <RichTextEditor
                  name="details"
                  defaultValue={product?.details || ""}
                  rows={4}
                  placeholder="Detailed product information"
                />
              </div>

              <div className="space-y-2">
                <Label>Good With</Label>
                <RichTextEditor
                  name="pairing"
                  defaultValue={product?.pairing || ""}
                  rows={2}
                  placeholder="e.g. Grilled meats, BBQ, cheese"
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
                    defaultValue={product?.currency || "EUR"}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="is_active">Status *</Label>
                  <Select
                    name="is_active"
                    defaultValue={
                      product?.is_active === false ? "false" : "true"
                    }
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

                <div className="space-y-2">
                  <Label htmlFor="on_sale">Sale</Label>
                  <label
                    htmlFor="on_sale"
                    className="flex items-center gap-2 h-9 px-3 border rounded-md cursor-pointer text-sm"
                  >
                    <input
                      id="on_sale"
                      name="on_sale"
                      type="checkbox"
                      defaultChecked={product?.on_sale ?? false}
                      className="h-4 w-4"
                    />
                    On Sale
                  </label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sale_price_cents">Sale Price (cents)</Label>
                  <Input
                    id="sale_price_cents"
                    name="sale_price_cents"
                    type="number"
                    defaultValue={product?.sale_price_cents ?? ""}
                    placeholder="e.g. 899"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Categories</Label>
                  <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                    {categories.map((cat) => {
                      const id = String(cat.id);
                      const checked = selectedCategoryIds.includes(id);
                      return (
                        <label key={id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedCategoryIds((prev) =>
                                checked
                                  ? prev.filter((x) => x !== id)
                                  : [...prev, id],
                              )
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          {cat.name}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Select value={brandValue} onValueChange={setBrandValue}>
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
              <CardTitle>Chilli Specifics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="heat_level">Heat Level (0-20+)</Label>
                  <Input
                    id="heat_level"
                    name="heat_level"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={product?.heat_level || ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity_ml">Capacity (ml)</Label>
                  <Input
                    id="capacity_ml"
                    name="capacity_ml"
                    type="number"
                    defaultValue={product?.capacity_ml || ""}
                    placeholder="e.g. 100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weight_grams">Weight (grams)</Label>
                  <Input
                    id="weight_grams"
                    name="weight_grams"
                    type="number"
                    defaultValue={product?.weight_grams ?? ""}
                    placeholder="e.g. 280"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="display_unit">Display Unit</Label>
                  <Select
                    name="display_unit"
                    defaultValue={product?.display_unit || "ml"}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="in_stock">Availability *</Label>
                  <label
                    htmlFor="in_stock"
                    className="flex items-center gap-2 h-9 px-3 border rounded-md cursor-pointer text-sm"
                  >
                    <input
                      id="in_stock"
                      name="in_stock"
                      type="checkbox"
                      defaultChecked={product?.in_stock ?? true}
                      className="h-4 w-4"
                    />
                    In Stock
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="low_stock_quantity">Low Stock Quantity</Label>
                  <Input
                    id="low_stock_quantity"
                    name="low_stock_quantity"
                    type="number"
                    min="0"
                    defaultValue={product?.low_stock_quantity ?? ""}
                    placeholder="Only fill in for limited quantities"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="is_vegan">Dietary</Label>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="is_vegan"
                      className="flex items-center gap-2 h-9 px-3 border rounded-md cursor-pointer text-sm"
                    >
                      <input
                        id="is_vegan"
                        name="is_vegan"
                        type="checkbox"
                        defaultChecked={product?.is_vegan ?? false}
                        className="h-4 w-4"
                      />
                      Vegan
                    </label>
                    <label
                      htmlFor="is_sugar_free"
                      className="flex items-center gap-2 h-9 px-3 border rounded-md cursor-pointer text-sm"
                    >
                      <input
                        id="is_sugar_free"
                        name="is_sugar_free"
                        type="checkbox"
                        defaultChecked={product?.is_sugar_free ?? false}
                        className="h-4 w-4"
                      />
                      Sugar Free
                    </label>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ingredients</Label>
                <RichTextEditor
                  name="ingredients"
                  defaultValue={product?.ingredients || ""}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Peppers / Chilli Types</Label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md bg-zinc-50/50">
                  {chilliTypes.map((ct) => (
                    <div
                      key={String(ct.id)}
                      className={`flex items-center gap-2 p-1.5 rounded-md cursor-pointer transition-colors ${
                        selectedChilliTypes.includes(String(ct.id))
                          ? "bg-orange-100 border-orange-200"
                          : "hover:bg-zinc-100"
                      }`}
                      onClick={() => {
                        const id = String(ct.id);
                        setSelectedChilliTypes((prev) =>
                          prev.includes(id)
                            ? prev.filter((item) => item !== id)
                            : [...prev, id],
                        );
                      }}
                    >
                      <div
                        className={`w-4 h-4 border rounded flex items-center justify-center ${
                          selectedChilliTypes.includes(String(ct.id))
                            ? "bg-orange-600 border-orange-600 text-white"
                            : "bg-white"
                        }`}
                      >
                        {selectedChilliTypes.includes(String(ct.id)) && (
                          <span className="text-[10px]">✓</span>
                        )}
                      </div>
                      <span className="text-xs truncate">{ct.name}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Select all peppers mentioned in ingredients
                </p>
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
              <ProductImageGallery
                initialImages={imageUrls}
                productSlug={slug || undefined}
                onChange={setImageUrls}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Size / Weight Variants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Add variants if this product comes in different sizes/weights with different prices. Leave empty for single-option products.
                Sale (€) only takes effect while the product&apos;s &quot;On Sale&quot; switch above is checked — leave a variant&apos;s Sale (€) blank to keep it at full price during a sale.
              </p>

              {variants.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_1fr_70px_60px_90px_36px] gap-2 text-xs font-medium text-muted-foreground px-1">
                    <span>Label (e.g. 10g)</span>
                    <span>Price (€)</span>
                    <span>Sale (€)</span>
                    <span>Weight (g)</span>
                    <span>In Stock</span>
                    <span>Low Stock Qty</span>
                    <span />
                  </div>
                  {variants.map((v, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_70px_60px_90px_36px] gap-2 items-center">
                      <Input
                        value={v.label}
                        onChange={(e) => setVariants((prev) => prev.map((row, idx) => idx === i ? { ...row, label: e.target.value } : row))}
                        placeholder="10g"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={v.price_euros}
                        onChange={(e) => setVariants((prev) => prev.map((row, idx) => idx === i ? { ...row, price_euros: e.target.value } : row))}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="2.99"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={v.sale_euros}
                        onChange={(e) => setVariants((prev) => prev.map((row, idx) => idx === i ? { ...row, sale_euros: e.target.value } : row))}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="2.49"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={v.weight_grams}
                        onChange={(e) => setVariants((prev) => prev.map((row, idx) => idx === i ? { ...row, weight_grams: e.target.value } : row))}
                        type="number"
                        min="0"
                        placeholder="10"
                        className="h-8 text-sm"
                      />
                      <div className="flex h-8 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={v.in_stock}
                          onChange={(e) => setVariants((prev) => prev.map((row, idx) => idx === i ? { ...row, in_stock: e.target.checked } : row))}
                          className="h-4 w-4"
                        />
                      </div>
                      <Input
                        value={v.low_stock_quantity}
                        onChange={(e) => setVariants((prev) => prev.map((row, idx) => idx === i ? { ...row, low_stock_quantity: e.target.value } : row))}
                        type="number"
                        min="0"
                        placeholder="e.g. 3"
                        className="h-8 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-zinc-400 hover:text-red-600"
                        onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVariants((prev) => [...prev, { label: "", price_euros: "", sale_euros: "", weight_grams: "", in_stock: true, low_stock_quantity: "" }])}
              >
                + Add Variant
              </Button>
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
