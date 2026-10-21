"use client";

import { useRef, useState } from "react";
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
import { COUNTRIES, getCountryName } from "@/lib/countries";

interface BracketDraft {
  id?: string;
  maxWeightKg: string; // empty string = no upper bound
  priceEuros: string;
}

interface ShippingZoneFormProps {
  zone?: {
    id: string;
    name: string;
    carrier: string | null;
    is_default: boolean;
    free_shipping_threshold_cents: number | null;
  };
  initialCountries?: string[];
  initialBrackets?: { id: string; max_weight_kg: number | null; price_cents: number }[];
  onSubmit: (formData: FormData) => Promise<{
    error?: string;
    success?: string;
    zoneId?: string;
  }>;
  onDelete?: (formData: FormData) => Promise<{ error?: string; success?: string }>;
  successRedirectPath: string;
}

export default function ShippingZoneForm({
  zone,
  initialCountries,
  initialBrackets,
  onSubmit,
  onDelete,
  successRedirectPath,
}: ShippingZoneFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const submitting = useRef(false);
  const [loading, setLoading] = useState(false);
  const [isDefault, setIsDefault] = useState(zone?.is_default ?? false);
  const [countries, setCountries] = useState<string[]>(initialCountries ?? []);
  const [countryToAdd, setCountryToAdd] = useState("");
  const [brackets, setBrackets] = useState<BracketDraft[]>(
    (initialBrackets ?? []).length > 0
      ? initialBrackets!.map((b) => ({
          id: b.id,
          maxWeightKg: b.max_weight_kg == null ? "" : String(b.max_weight_kg),
          priceEuros: (b.price_cents / 100).toFixed(2),
        }))
      : [{ maxWeightKg: "", priceEuros: "" }],
  );

  const availableToAdd = COUNTRIES.filter((c) => !countries.includes(c.code));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    formData.set("is_default", String(isDefault));
    formData.set("countries", JSON.stringify(countries));
    formData.set(
      "countries_initial_count",
      String((initialCountries ?? []).length),
    );

    const bracketPayload = brackets
      .filter((b) => b.priceEuros.trim() !== "")
      .map((b, i) => ({
        id: b.id,
        max_weight_kg: b.maxWeightKg.trim() === "" ? null : Number(b.maxWeightKg),
        price_cents: Math.round(parseFloat(b.priceEuros) * 100),
        sort_order: i,
      }));
    formData.set("brackets", JSON.stringify(bracketPayload));

    try {
      const result = await onSubmit(formData);
      if (result?.success || result?.zoneId) {
        if (result.zoneId) {
          router.push(`/${locale}/admin/shipping/${result.zoneId}`);
        } else {
          router.push(successRedirectPath);
        }
        router.refresh();
      } else {
        alert(result?.error || "Something went wrong. Please try again.");
      }
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Zone details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Zone name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={zone?.name}
                placeholder="e.g. Domestic"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="carrier">Carrier</Label>
              <Input
                id="carrier"
                name="carrier"
                defaultValue={zone?.carrier ?? ""}
                placeholder="e.g. Bpost"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="free_shipping_threshold">
                Free shipping threshold (€)
              </Label>
              <Input
                id="free_shipping_threshold"
                name="free_shipping_threshold"
                type="number"
                step="0.01"
                min="0"
                defaultValue={
                  zone?.free_shipping_threshold_cents != null
                    ? (zone.free_shipping_threshold_cents / 100).toFixed(2)
                    : ""
                }
                placeholder="Leave blank for no free-shipping threshold"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="is_default">Default zone</Label>
              <label
                htmlFor="is_default"
                className="flex items-center gap-2 h-9 px-3 border rounded-md cursor-pointer text-sm"
              >
                <input
                  id="is_default"
                  type="checkbox"
                  checked={isDefault}
                  disabled={zone?.is_default}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="h-4 w-4"
                />
                Used for any country not assigned to another zone
              </label>
              {zone?.is_default && (
                <p className="text-xs text-zinc-500">
                  To change the default zone, check this box on a different
                  zone instead — it&apos;ll take over automatically.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Countries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {isDefault
              ? "This zone is the fallback, so it applies to every country not listed in another zone — no need to assign countries here."
              : "Each country can only belong to one zone. Adding a country here moves it out of whichever zone currently has it."}
          </p>

          {!isDefault && (
            <>
              {countries.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {countries.map((code) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 bg-zinc-100 rounded-full pl-3 pr-1 py-1 text-xs font-medium"
                    >
                      {getCountryName(code)}
                      <button
                        type="button"
                        className="h-5 w-5 rounded-full hover:bg-zinc-200 flex items-center justify-center text-zinc-500"
                        onClick={() =>
                          setCountries((prev) => prev.filter((c) => c !== code))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Select value={countryToAdd} onValueChange={setCountryToAdd}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a country to add" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableToAdd.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!countryToAdd}
                  onClick={() => {
                    if (!countryToAdd) return;
                    setCountries((prev) => [...prev, countryToAdd]);
                    setCountryToAdd("");
                  }}
                >
                  Add
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weight brackets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Each bracket applies up to its max weight. Leave the last
            bracket&apos;s max weight blank for &quot;no upper limit&quot;.
          </p>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_36px] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Max weight (kg) — blank = no limit</span>
              <span>Price (€)</span>
              <span />
            </div>
            {brackets.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_36px] gap-2 items-center">
                <Input
                  value={b.maxWeightKg}
                  onChange={(e) =>
                    setBrackets((prev) =>
                      prev.map((row, idx) =>
                        idx === i ? { ...row, maxWeightKg: e.target.value } : row,
                      ),
                    )
                  }
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="e.g. 2"
                  className="h-8 text-sm"
                />
                <Input
                  value={b.priceEuros}
                  onChange={(e) =>
                    setBrackets((prev) =>
                      prev.map((row, idx) =>
                        idx === i ? { ...row, priceEuros: e.target.value } : row,
                      ),
                    )
                  }
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="7.10"
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-zinc-400 hover:text-red-600"
                  onClick={() =>
                    setBrackets((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  ×
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setBrackets((prev) => [...prev, { maxWeightKg: "", priceEuros: "" }])
            }
          >
            + Add bracket
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={loading}
          className="bg-black text-white hover:bg-zinc-800"
        >
          {loading ? "Saving..." : zone ? "Save changes" : "Create zone"}
        </Button>
        {onDelete && zone && (
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={async () => {
              if (!confirm("Delete this shipping zone? This cannot be undone.")) return;
              const fd = new FormData();
              fd.append("zone_id", zone.id);
              const result = await onDelete(fd);
              if (result?.success) {
                router.push(successRedirectPath);
                router.refresh();
              } else {
                alert(result?.error || "Couldn't delete this zone.");
              }
            }}
          >
            Delete zone
          </Button>
        )}
      </div>
    </form>
  );
}
