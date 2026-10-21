"use client";

import { useState } from "react";
import { createBrand } from "../actions/createBrand";
import { updateBrand } from "../actions/updateBrand";
import BrandForm from "../components/BrandForm";
import { Button } from "@/components/ui/button";

interface Brand {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  country: string | null;
  website: string | null;
}

interface BrandsClientProps {
  brands: Brand[];
  locale: string;
}

export default function BrandsClient({ brands, locale }: BrandsClientProps) {
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);

  const handleEdit = (brand: Brand) => {
    setEditingBrand(brand);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancel = () => {
    setEditingBrand(null);
  };

  const handleSubmit = async (formData: FormData) => {
    if (editingBrand) {
      return await updateBrand({ locale, brandId: editingBrand.id }, formData);
    } else {
      return await createBrand({ locale }, formData);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-[1fr,2fr]">
      <div>
        <BrandForm
          onSubmit={handleSubmit}
          initialData={editingBrand}
          onCancel={handleCancel}
          key={editingBrand ? `edit-${editingBrand.id}` : "create"}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-zinc-50 text-left text-sm font-semibold text-zinc-600">
            <tr>
              <th className="px-4 py-3">Brand Name</th>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Website</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {brands?.map((brand) => (
              <tr
                key={brand.id}
                className={editingBrand?.id === brand.id ? "bg-zinc-50" : ""}
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {brand.name}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {brand.country || "—"}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {brand.website ? (
                    <a
                      href={brand.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-brand-red transition-colors"
                    >
                      Link
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(brand)}
                    className="text-brand-red hover:text-brand-red hover:bg-brand-red/10"
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
            {(!brands || brands.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  No brands found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
