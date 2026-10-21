"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { updateProfile } from "@/app/[locale]/actions/updateProfile";

interface ProfileFormProps {
  locale: string;
  initialValues: {
    firstName: string;
    lastName: string;
    phone: string;
    dateOfBirth: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
}

export default function ProfileForm({ locale, initialValues }: ProfileFormProps) {
  const t = useTranslations("Account.profile");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await updateProfile({ locale }, formData);

    if (result.success) {
      setSaved(true);
    } else {
      setError(result.error || "Failed to save");
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="first_name">{t("firstName")}</Label>
          <Input id="first_name" name="first_name" defaultValue={initialValues.firstName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last_name">{t("lastName")}</Label>
          <Input id="last_name" name="last_name" defaultValue={initialValues.lastName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={initialValues.phone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="date_of_birth">{t("dateOfBirth")}</Label>
          <Input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            defaultValue={initialValues.dateOfBirth}
          />
        </div>
      </div>

      <div className="border-t border-zinc-100 pt-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500">
          {t("addressTitle")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="street">{t("street")}</Label>
            <Input id="street" name="street" defaultValue={initialValues.street} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">{t("city")}</Label>
            <Input id="city" name="city" defaultValue={initialValues.city} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postal_code">{t("postalCode")}</Label>
            <Input id="postal_code" name="postal_code" defaultValue={initialValues.postalCode} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="country">{t("country")}</Label>
            <Input id="country" name="country" defaultValue={initialValues.country} />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={loading} className="bg-black text-white hover:bg-zinc-800">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("save")}
        </Button>
        {saved && (
          <span className="text-sm font-medium text-green-600">{t("saved")}</span>
        )}
      </div>
    </form>
  );
}
