"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { createVoucher } from "../actions/createVoucher";
import { Loader2, Ticket, Settings, ShieldCheck } from "lucide-react";

interface VoucherFormProps {
  locale: string;
}

export default function VoucherForm({ locale }: VoucherFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(
    "percentage",
  );
  const [duration, setDuration] = useState<"once" | "repeating" | "forever">(
    "once",
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    formData.set("discount_type", discountType);
    formData.set("duration", duration);

    try {
      const result = await createVoucher({ locale }, formData);
      if (result.success) {
        router.push(`/${locale}/admin/vouchers`);
        router.refresh();
      } else {
        alert(result.error || "Failed to create voucher");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Ticket className="w-6 h-6" />
          Create New Voucher
        </h1>
        <Button
          type="submit"
          disabled={loading}
          className="bg-black text-white hover:bg-zinc-800"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="mr-2 h-4 w-4" />
          )}
          {loading ? "Creating..." : "Create Voucher"}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Basic Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Internal Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Summer Sale 2026"
                  required
                />
                <p className="text-[10px] text-zinc-500">
                  Only visible to you in the dashboard.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Promo Code *</Label>
                <Input
                  id="code"
                  name="code"
                  placeholder="e.g. SUMMER10"
                  required
                  className="font-mono uppercase"
                />
                <p className="text-[10px] text-zinc-500">
                  The code customers will enter at checkout.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Discount Type</Label>
                  <Select
                    value={discountType}
                    onValueChange={(val: any) => setDiscountType(val)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Amount (€)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">
                    {discountType === "percentage"
                      ? "Percent Off"
                      : "Amount Off (cents)"}
                  </Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    placeholder={discountType === "percentage" ? "10" : "500"}
                    required
                  />
                  <p className="text-[10px] text-zinc-500">
                    {discountType === "percentage"
                      ? "Enter 10 for 10% off."
                      : "Enter 500 for €5.00 off."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Duration & Timing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select
                  value={duration}
                  onValueChange={(val: any) => setDuration(val)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">
                      Once (One order per customer)
                    </SelectItem>
                    <SelectItem value="forever">
                      Forever (Infinite uses)
                    </SelectItem>
                    <SelectItem value="repeating">
                      Repeating (Specific months)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {duration === "repeating" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                  <Label htmlFor="duration_in_months">Duration in Months</Label>
                  <Input
                    id="duration_in_months"
                    name="duration_in_months"
                    type="number"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="expires_at">Expiry Date (Optional)</Label>
                <Input
                  id="expires_at"
                  name="expires_at"
                  type="datetime-local"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Usage Restrictions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg bg-zinc-50/50">
                <div className="space-y-0.5">
                  <Label className="text-sm">First-time customers only</Label>
                  <p className="text-[10px] text-zinc-500">
                    Only applies if user has 0 previous orders.
                  </p>
                </div>
                <input
                  type="checkbox"
                  name="first_time_only"
                  value="true"
                  className="h-4 w-4"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_redemptions">
                  Total Max Redemptions (Optional)
                </Label>
                <Input
                  id="max_redemptions"
                  name="max_redemptions"
                  type="number"
                  placeholder="e.g. 100"
                />
                <p className="text-[10px] text-zinc-500">
                  Limit total number of times this code can be used globally.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
