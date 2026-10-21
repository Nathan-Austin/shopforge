"use client";

import { useTransition, useState, useMemo } from "react";
import { RotateCcw, CheckCircle2, AlertCircle, Loader2, Minus, Plus } from "lucide-react";
import { refundOrder } from "../actions";
import { formatPrice } from "@/lib/format";

interface Item {
  id: string;
  name: string;
  quantity: number;
  priceCents: number;
  remainingQty: number;
}

interface Props {
  orderId: string;
  currency: string;
  totalCents: number;
  refundedCents: number;
  items: Item[];
}

export default function RefundOrderForm({ orderId, currency, totalCents, refundedCents, items }: Props) {
  const remainingCents = totalCents - refundedCents;
  const [mode, setMode] = useState<"items" | "custom">("items");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [customAmount, setCustomAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; amountCents?: number; emailSent?: boolean } | null>(null);

  const itemsAmountCents = useMemo(
    () => items.reduce((sum, item) => sum + (selected[item.id] ?? 0) * item.priceCents, 0),
    [items, selected],
  );
  const customAmountCents = Math.round(parseFloat(customAmount || "0") * 100);
  const amountCents = mode === "items" ? itemsAmountCents : (Number.isFinite(customAmountCents) ? customAmountCents : 0);

  const toggleItem = (item: Item, checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[item.id] = Math.min(1, item.remainingQty);
      else delete next[item.id];
      return next;
    });
  };

  const setQuantity = (item: Item, qty: number) => {
    setSelected((prev) => ({ ...prev, [item.id]: Math.max(1, Math.min(qty, item.remainingQty)) }));
  };

  const canSubmit =
    confirmed &&
    amountCents > 0 &&
    amountCents <= remainingCents &&
    (mode === "items" ? Object.keys(selected).length > 0 : true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setResult(null);
    startTransition(async () => {
      const res =
        mode === "items"
          ? await refundOrder(orderId, {
              mode: "items",
              items: Object.entries(selected).map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
              reason: reason.trim() || undefined,
              idempotencyKey,
              confirmed,
            })
          : await refundOrder(orderId, {
              mode: "custom",
              amountCents: customAmountCents,
              reason: reason.trim() || undefined,
              idempotencyKey,
              confirmed,
            });

      if (res.error) {
        setResult({ ok: false, error: res.error });
      } else {
        setResult({ ok: true, amountCents: res.amountCents, emailSent: res.emailSent });
        setTimeout(() => window.location.reload(), 1500);
      }
    });
  };

  if (remainingCents <= 0) {
    return (
      <div className="rounded-xl border-2 border-orange-200 bg-orange-50 px-5 py-4 flex items-center gap-2 text-sm text-orange-700">
        <RotateCcw size={16} />
        This order has been fully refunded ({formatPrice(refundedCents, currency)}).
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-brand-red/20 bg-white overflow-hidden">
      <div className="px-5 py-4 bg-brand-red/5 border-b border-brand-red/10 flex items-center gap-2 flex-wrap">
        <RotateCcw size={16} className="text-brand-red" />
        <h2 className="font-bold text-sm text-zinc-900">Refund</h2>
        {refundedCents > 0 && (
          <span className="ml-auto text-xs text-zinc-400">
            {formatPrice(refundedCents, currency)} already refunded &middot; {formatPrice(remainingCents, currency)} refundable
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
        <div className="flex gap-2">
          {(["items", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                mode === m
                  ? "bg-black text-white border-black"
                  : "bg-white text-zinc-600 border-zinc-200 hover:border-brand-red hover:text-brand-red"
              }`}
            >
              {m === "items" ? "Refund Items" : "Custom Amount"}
            </button>
          ))}
        </div>

        {mode === "items" ? (
          <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
            {items.map((item) => {
              const isChecked = item.id in selected;
              const disabled = item.remainingQty <= 0;
              return (
                <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${disabled ? "opacity-40" : ""}`}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={disabled}
                    onChange={(e) => toggleItem(item, e.target.checked)}
                    className="rounded border-zinc-300"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{item.name}</p>
                    <p className="text-xs text-zinc-400">
                      {formatPrice(item.priceCents, currency)} each
                      {disabled ? " · fully refunded" : ` · ${item.remainingQty} refundable`}
                    </p>
                  </div>
                  {isChecked && !disabled && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setQuantity(item, (selected[item.id] ?? 1) - 1)}
                        className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{selected[item.id]}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity(item, (selected[item.id] ?? 1) + 1)}
                        className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
              Refund amount ({currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={(remainingCents / 100).toFixed(2)}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="0.00"
              className="w-full max-w-[160px] rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
            />
            <p className="text-xs text-zinc-400 mt-1">
              Up to {formatPrice(remainingCents, currency)} still refundable on this order.
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
            Reason <span className="font-normal normal-case text-zinc-400">(optional, for your own records)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Item out of stock"
            className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
        </div>

        {amountCents > remainingCents && (
          <p className="text-xs text-red-600">Amount exceeds what&apos;s still refundable on this order.</p>
        )}

        <label className="flex items-start gap-2 text-sm text-zinc-700 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-zinc-300"
          />
          <span>
            I confirm I want to refund <strong>{formatPrice(amountCents, currency)}</strong> to the customer via Stripe.
            This cannot be undone.
          </span>
        </label>

        {result && (
          <div
            className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
              result.ok
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            <span>
              {result.ok
                ? `Refunded ${formatPrice(result.amountCents ?? 0, currency)}. ${
                    result.emailSent ? "Confirmation email sent to the customer." : "Email could not be sent — check Resend config."
                  }`
                : `Error: ${result.error}`}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit || isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-red text-white text-sm font-bold hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
          {isPending ? "Processing…" : `Refund ${amountCents > 0 ? formatPrice(amountCents, currency) : ""}`}
        </button>
      </form>
    </div>
  );
}
