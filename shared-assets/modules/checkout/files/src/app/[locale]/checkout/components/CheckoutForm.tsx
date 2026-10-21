"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/format";
import { getEffectivePriceCents } from "@/lib/pricing";
import {
  calculateShippingCost,
  SHIPPING_RATE_LABEL,
  type ShippingZone,
} from "@/lib/checkout/pricing";
import { COUNTRIES } from "@/lib/countries";
import { createCheckoutSession } from "../actions";
import { Loader2, CreditCard, ShieldCheck } from "lucide-react";
import Image from "next/image";

interface CheckoutFormProps {
  cartItems: any[];
  weightKg: number;
  locale: string;
  initialEmail?: string;
  zones: ShippingZone[];
}

export default function CheckoutForm({
  cartItems,
  weightKg,
  locale,
  initialEmail,
  zones,
}: CheckoutFormProps) {
  const t = useTranslations("Checkout");
  const [isPending, setIsPending] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState("BEL");

  const subtotal = useMemo(
    () =>
      cartItems.reduce(
        (acc, item) => acc + getEffectivePriceCents(item.product, item.variant) * item.quantity,
        0,
      ),
    [cartItems],
  );

  const shippingCost = useMemo(
    () => calculateShippingCost(selectedCountry, weightKg, subtotal, zones),
    [selectedCountry, weightKg, subtotal, zones],
  );

  const total = subtotal + shippingCost;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
      {/* Form Side */}
      <form
        action={async (formData) => {
          setIsPending(true);
          try {
            // Add locale and country to formData
            formData.set("locale", locale);
            formData.set("country", selectedCountry);
            await createCheckoutSession(formData);
          } catch (error) {
            console.error("Checkout failed:", error);
            setIsPending(false);
          }
        }}
        className="space-y-8"
      >
        <div className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-black text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
              1
            </span>
            {t("shipping")}
          </h2>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={initialEmail}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">{t("fullName")}</Label>
              <Input id="name" name="name" required placeholder="John Doe" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="street">{t("street")}</Label>
              <Input id="street" name="street" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="zip">{t("zip")}</Label>
                <Input id="zip" name="zip" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">{t("city")}</Label>
                <Input id="city" name="city" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">{t("country")}</Label>
              <select
                id="country"
                name="country"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                required
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
            <span className="bg-black text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
              2
            </span>
            {t("payment")}
          </h2>

          <div className="bg-zinc-50 p-4 rounded-lg border mb-6">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard className="text-zinc-400 w-4 h-4" />
              <span className="text-sm font-medium">Stripe Secure Payment</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {/* Visa */}
              <div className="bg-white border rounded px-2 h-6 flex items-center">
                <span className="text-[11px] font-black italic" style={{ color: "#1A1F71", fontFamily: "serif", letterSpacing: "-0.5px" }}>VISA</span>
              </div>
              {/* Mastercard */}
              <div className="bg-white border rounded px-1.5 h-6 flex items-center gap-0.5">
                <svg width="13" height="9" viewBox="0 0 13 9"><circle cx="4.5" cy="4.5" r="4.5" fill="#EB001B"/><circle cx="8.5" cy="4.5" r="4.5" fill="#F79E1B" fillOpacity="0.85"/></svg>
                <span className="text-[8px] font-bold text-zinc-600">MC</span>
              </div>
              {/* Cartes Bancaires */}
              <div className="h-6 flex items-center rounded px-1.5 border" style={{ background: "#0066CC" }}>
                <span className="text-[10px] font-black text-white tracking-tight">CB</span>
              </div>
              {/* Apple Pay */}
              <div className="bg-black border border-zinc-700 rounded px-2 h-6 flex items-center gap-1">
                <svg width="9" height="11" viewBox="0 0 9 11" fill="white"><path d="M7.5 5.8c0-1.4 1.1-2 1.1-2S7.7 2 6.3 2c-.8 0-1.4.5-1.8.5C4.1 2.5 3.4 2 2.7 2 1.2 2 0 3.3 0 5.5c0 2.3 1.5 5.5 2.7 5.5.6 0 1-.4 1.7-.4.7 0 1 .4 1.8.4C7.6 11 9 7.9 9 7.9S7.5 7.2 7.5 5.8zM5.7.8C6.1.3 6.3-.1 6.2 0c0 0-.2 1-.9 1.6-.7.6-1.4.5-1.4.5S3.6 1.4 5.7.8z"/></svg>
                <span className="text-[9px] font-semibold text-white">Pay</span>
              </div>
              {/* Google Pay */}
              <div className="bg-white border rounded px-2 h-6 flex items-center gap-0.5">
                <svg width="9" height="9" viewBox="0 0 9 9"><text x="0" y="8" fontSize="9" fontWeight="bold" fill="#4285F4">G</text></svg>
                <span className="text-[9px] font-medium text-zinc-700">Pay</span>
              </div>
              {/* PayPal */}
              <div className="bg-white border rounded px-2 h-6 flex items-center">
                <span className="text-[10px] font-extrabold" style={{ color: "#003087" }}>Pay</span><span className="text-[10px] font-extrabold" style={{ color: "#009CDE" }}>Pal</span>
              </div>
              {/* iDEAL */}
              <div className="bg-white border rounded px-2 h-6 flex items-center">
                <span className="text-[10px] font-black italic" style={{ color: "#C06" }}>i</span><span className="text-[10px] font-bold text-zinc-800">DEAL</span>
              </div>
              {/* Bancontact */}
              <div className="h-6 flex items-center rounded px-2 border" style={{ background: "#005498" }}>
                <span className="text-[9px] font-bold text-white">Bancontact</span>
              </div>
              {/* Revolut Pay */}
              <div className="h-6 flex items-center rounded px-2 border bg-black">
                <span className="text-[9px] font-bold text-white tracking-tight">Revolut Pay</span>
              </div>
              {/* MobilePay */}
              <div className="h-6 flex items-center rounded px-2 border" style={{ background: "#5A78FF" }}>
                <span className="text-[9px] font-bold text-white">MobilePay</span>
              </div>
              {/* BLIK */}
              <div className="h-6 flex items-center rounded px-2 border" style={{ background: "#E3000B" }}>
                <span className="text-[10px] font-black text-white tracking-widest">BLIK</span>
              </div>
              {/* EPS */}
              <div className="h-6 flex items-center rounded px-2 border" style={{ background: "#C8002D" }}>
                <span className="text-[10px] font-bold text-white">EPS</span>
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-14 text-lg font-bold bg-black hover:bg-zinc-800"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-5 w-5" />
            )}
            {t("payNow")}
          </Button>
        </div>
      </form>

      {/* Summary Side */}
      <div className="bg-zinc-50 p-4 sm:p-8 rounded-2xl border h-fit lg:sticky lg:top-24">
        <h2 className="text-xl font-bold mb-6">{t("summary")}</h2>

        <div className="space-y-4 mb-8">
          {cartItems.map((item) => (
            <div
              key={item.id}
              className="flex justify-between items-center text-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative w-12 h-12 bg-white rounded border flex-shrink-0">
                  {item.product.image_url ? (
                    <Image
                      src={item.product.image_url}
                      alt={item.product.name}
                      fill
                      className="object-contain p-1"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      🌶️
                    </div>
                  )}
                  <span className="absolute -top-2 -right-2 bg-zinc-800 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                    {item.quantity}
                  </span>
                </div>
                <span className="font-medium truncate">{item.product.name}</span>
              </div>
              <span className="font-semibold">
                {formatPrice(getEffectivePriceCents(item.product, item.variant) * item.quantity)}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-3 pt-6 border-t text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">{t("summary")} (Subtotal)</span>
            <span className="font-medium">{formatPrice(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">{SHIPPING_RATE_LABEL}</span>
            <span className="font-medium">
              {shippingCost === 0 ? (
                <span className="text-green-600">{t("freeShipping")}</span>
              ) : (
                formatPrice(shippingCost)
              )}
            </span>
          </div>
          <div className="flex justify-between text-lg font-bold pt-4 border-t mt-4">
            <span>Total</span>
            <span className="text-red-600">{formatPrice(total)}</span>
          </div>
          <p className="pt-2 text-xs text-zinc-500">
            Have a discount code? You&apos;ll be able to enter it on the next
            (payment) step.
          </p>
        </div>
      </div>
    </div>
  );
}
