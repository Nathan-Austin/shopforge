'use client';

import { useActionState, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { formatPrice } from '@/lib/format';
import {
  isRefundConfirmed,
  parseMajorAmount,
  planRefund,
  REFUND_CONFIRMATION_WORD,
  REFUND_FIELDS,
  remainingRefundableCents,
  type RefundableItem,
  type RefundKind,
  type RefundRequest
} from '@/lib/orders/refunds';
import type { RefundActionResult } from '../actions/refundOrder';

interface RefundFormProps {
  locale: string;
  currency: string;
  totalCents: number;
  refundedCents: number;
  items: RefundableItem[];
  action: (previous: RefundActionResult | null, formData: FormData) => Promise<RefundActionResult>;
}

/**
 * The refund form. Everything the owner types is planned client-side with
 * the same planRefund() the server runs, so the preview, the button label
 * and the server's answer agree. The button stays disabled until the plan
 * is valid and the confirmation word has been typed.
 */
export default function RefundForm({
  locale,
  currency,
  totalCents,
  refundedCents,
  items,
  action
}: RefundFormProps) {
  const t = useTranslations('Admin.refund');
  const [result, formAction, pending] = useActionState(action, null);

  const [kind, setKind] = useState<RefundKind>('full');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState('');

  const money = (cents: number) => formatPrice(cents, currency, locale);
  const remaining = remainingRefundableCents({ totalCents, refundedCents });

  const plan = useMemo(() => {
    const request: RefundRequest =
      kind === 'items'
        ? {
            kind,
            items: Object.entries(quantities).map(([orderItemId, quantity]) => ({
              orderItemId,
              quantity
            }))
          }
        : kind === 'percent'
          ? { kind, percent: percent.trim() === '' ? null : Number(percent.replace(',', '.')) }
          : kind === 'amount'
            ? { kind, amountCents: parseMajorAmount(amount) }
            : { kind };
    return planRefund({ totalCents, refundedCents, items }, request);
  }, [kind, quantities, percent, amount, totalCents, refundedCents, items]);

  const confirmed = isRefundConfirmed(confirm);
  const canSubmit = plan.ok && confirmed && !pending;

  const kinds: { value: RefundKind; label: string }[] = [
    { value: 'full', label: t('kindFull', { amount: money(remaining) }) },
    { value: 'items', label: t('kindItems') },
    { value: 'percent', label: t('kindPercent') },
    { value: 'amount', label: t('kindAmount') }
  ];

  const inputClass =
    'mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

  return (
    <form action={formAction} className="space-y-6 rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-medium">{t('remaining', { amount: money(remaining) })}</p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('kind')}</legend>
        {kinds.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={REFUND_FIELDS.kind}
              value={option.value}
              checked={kind === option.value}
              onChange={() => setKind(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {kind === 'items' && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {items.map((item) => {
              const left = item.quantity - (item.refundedQuantity ?? 0);
              const inputId = `refund-item-${item.id}`;
              return (
                <tr key={item.id}>
                  <td className="py-2">
                    <label htmlFor={inputId}>
                      {item.quantity} × {item.productName}
                      <span className="text-stone-500"> · {money(item.unitPriceCents)}</span>
                    </label>
                    {(item.refundedQuantity ?? 0) > 0 && (
                      <p className="text-xs text-stone-500">
                        {t('itemRefunded', { count: item.refundedQuantity ?? 0 })}
                      </p>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <span className="sr-only">{t('itemQuantity')}</span>
                    <input
                      id={inputId}
                      type="number"
                      name={`${REFUND_FIELDS.itemPrefix}${item.id}`}
                      min={0}
                      max={left}
                      disabled={left <= 0}
                      value={quantities[item.id] ?? 0}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.id]: Math.max(0, Math.min(left, Number(event.target.value) || 0))
                        }))
                      }
                      className={`${inputClass} w-20 text-right disabled:opacity-50`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {kind === 'percent' && (
        <label className="block text-sm font-medium">
          {t('percentLabel', { total: money(totalCents) })}
          <input
            type="number"
            name={REFUND_FIELDS.percent}
            min={0.01}
            max={100}
            step={0.01}
            inputMode="decimal"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            className={`${inputClass} block w-32`}
          />
        </label>
      )}

      {kind === 'amount' && (
        <label className="block text-sm font-medium">
          {t('amountLabel', { currency })}
          <input
            type="text"
            name={REFUND_FIELDS.amount}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${inputClass} block w-40`}
          />
        </label>
      )}

      <label className="block text-sm font-medium">
        {t('reason')}
        <textarea
          name={REFUND_FIELDS.reason}
          rows={3}
          maxLength={1000}
          className={`${inputClass} block w-full`}
        />
        <span className="mt-1 block text-xs font-normal text-stone-500">{t('reasonHint')}</span>
      </label>

      <p className="text-sm" aria-live="polite">
        {plan.ok ? (
          <span className="font-semibold">{t('preview', { amount: money(plan.amountCents) })}</span>
        ) : (
          <span className="text-red-700">
            {t(`errors.${plan.error}`, { word: REFUND_CONFIRMATION_WORD, message: '' })}
          </span>
        )}
      </p>

      <label className="block text-sm font-medium">
        {t('confirmLabel', { word: REFUND_CONFIRMATION_WORD })}
        <input
          type="text"
          name={REFUND_FIELDS.confirm}
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={`${inputClass} block w-40 font-mono uppercase`}
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending
          ? t('submitting')
          : t('submit', { amount: plan.ok ? money(plan.amountCents) : money(0) })}
      </button>

      {result && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            result.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {result.ok ? (
            <>
              <p>
                {t('success', {
                  amount: formatPrice(result.amountCents, result.currency, locale),
                  id: result.stripeRefundId
                })}
              </p>
              <p>
                {result.email === 'sent'
                  ? t('emailSent')
                  : result.email === 'not-configured'
                    ? t('emailOff')
                    : t('emailFailed', { error: result.emailError ?? '' })}
              </p>
            </>
          ) : (
            <p>
              {t(`errors.${result.error}`, {
                word: REFUND_CONFIRMATION_WORD,
                message: result.message ?? ''
              })}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
