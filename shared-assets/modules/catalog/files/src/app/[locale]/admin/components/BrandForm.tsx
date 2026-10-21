"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { slugify } from "@/lib/utils";

interface BrandFormProps {
  onSubmit: (formData: FormData) => Promise<any>;
  initialData?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    country: string | null;
    website: string | null;
  } | null;
  onCancel?: () => void;
}

export default function BrandForm({
  onSubmit,
  initialData,
  onCancel,
}: BrandFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState(initialData?.slug || "");
  const isEditing = !!initialData;

  useEffect(() => {
    if (initialData) {
      setSlug(initialData.slug);
    } else {
      setSlug("");
    }
  }, [initialData]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isEditing) {
      setSlug(slugify(e.target.value));
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);

    try {
      const result = await onSubmit(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        if (!isEditing) {
          (e.target as HTMLFormElement).reset();
          setSlug("");
        }
        router.refresh();
        if (onCancel) onCancel();
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEditing ? "Edit Brand" : "Add New Brand"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEditing && <input type="hidden" name="slug" value={slug} />}
          <div className="grid gap-4 sm:grid-cols-1">
            <div className="space-y-2">
              <Label htmlFor="name">Brand Name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={initialData?.name || ""}
                placeholder="e.g. Acme Foods"
                onChange={handleNameChange}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                name="country"
                defaultValue={initialData?.country || ""}
                placeholder="e.g. Spain"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                name="website"
                type="url"
                defaultValue={initialData?.website || ""}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={initialData?.description || ""}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            {isEditing && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className="flex-1"
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={loading} className="flex-1">
              {loading
                ? isEditing
                  ? "Updating..."
                  : "Adding..."
                : isEditing
                  ? "Update Brand"
                  : "Add Brand"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
