"use client";

import { useTransition, useState } from "react";
import { Truck, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { markOrderShipped, type Carrier } from "../actions";

const CARRIERS: { value: Carrier; label: string }[] = [
  { value: "postnl", label: "PostNL" },
  { value: "bpost", label: "bpost" },
  { value: "dhl", label: "DHL" },
  { value: "dpd", label: "DPD" },
  { value: "other", label: "Other carrier" },
];

interface Props {
  orderId: string;
  currentCarrier?: string | null;
  currentTrackingNumber?: string | null;
  isAlreadyShipped: boolean;
}

export default function ShipOrderForm({
  orderId,
  currentCarrier,
  currentTrackingNumber,
  isAlreadyShipped,
}: Props) {
  const [carrier, setCarrier] = useState<Carrier>(
    (currentCarrier as Carrier) || "postnl"
  );
  const [trackingNumber, setTrackingNumber] = useState(currentTrackingNumber ?? "");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    emailSent?: boolean;
    error?: string;
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await markOrderShipped(orderId, trackingNumber.trim(), carrier);
      if (res.error) {
        setResult({ ok: false, error: res.error });
      } else {
        setResult({ ok: true, emailSent: res.emailSent });
        setTimeout(() => window.location.reload(), 1500);
      }
    });
  };

  return (
    <div className="rounded-xl border-2 border-brand-red/20 bg-white overflow-hidden">
      <div className="px-5 py-4 bg-brand-red/5 border-b border-brand-red/10 flex items-center gap-2">
        <Truck size={16} className="text-brand-red" />
        <h2 className="font-bold text-sm text-zinc-900">
          {isAlreadyShipped ? "Update Shipping" : "Mark as Shipped"}
        </h2>
        {isAlreadyShipped && (
          <span className="ml-auto text-xs text-zinc-400">
            Already shipped — update tracking if needed
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
              Carrier
            </label>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value as Carrier)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
            >
              {CARRIERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
              Tracking Number <span className="font-normal normal-case text-zinc-400">(optional)</span>
            </label>
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="e.g. 3STBD19283744"
              className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-mono text-foreground placeholder:font-sans placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-red"
            />
          </div>
        </div>

        {result && (
          <div
            className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
              result.ok
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {result.ok ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
            )}
            <span>
              {result.ok
                ? result.emailSent
                  ? "Order marked as shipped and confirmation email sent to the customer."
                  : "Order marked as shipped. Email could not be sent — check Resend config."
                : `Error: ${result.error}`}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-red text-white text-sm font-bold hover:bg-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Truck size={15} />
          )}
          {isPending
            ? "Saving…"
            : isAlreadyShipped
              ? "Update & Re-send Email"
              : "Mark as Shipped & Email Customer"}
        </button>
      </form>
    </div>
  );
}
