/**
 * Refund planning.
 *
 * Pure functions that turn what the shop owner asked for (the whole order,
 * some of its lines, a percentage or a figure) into an exact amount in
 * cents, or a reason why not. The server action runs this before touching
 * Stripe and the form runs it again for the live preview, so both agree.
 * Nothing here can exceed what is left of the order: the database function
 * checks once more, but this is where the owner hears about it.
 */

export type RefundKind = 'full' | 'items' | 'percent' | 'amount';

export const REFUND_KINDS: readonly RefundKind[] = ['full', 'items', 'percent', 'amount'];

/** The word the owner must type to confirm. Case-sensitive on purpose. */
export const REFUND_CONFIRMATION_WORD = 'REFUND';

export function isRefundConfirmed(input: string | null | undefined): boolean {
  return (input ?? '').trim() === REFUND_CONFIRMATION_WORD;
}

export interface RefundableItem {
  id: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  /** Units of this line already refunded by earlier item refunds. */
  refundedQuantity?: number;
}

export interface RefundableOrder {
  totalCents: number;
  refundedCents: number;
  items: RefundableItem[];
}

export interface RefundRequest {
  kind: RefundKind;
  /** For 'items': how many units of which lines. */
  items?: { orderItemId: string; quantity: number }[];
  /** For 'percent': 0 < percent <= 100, of the order total. */
  percent?: number | null;
  /** For 'amount': the figure, already in cents. */
  amountCents?: number | null;
}

export interface RefundItemSnapshot {
  orderItemId: string;
  productName: string;
  quantity: number;
  amountCents: number;
}

export type RefundPlanError =
  /** The order is already fully refunded. */
  | 'nothing_left'
  /** 'items' with no lines ticked. */
  | 'no_items'
  /** A line id that is not on this order. */
  | 'unknown_item'
  /** More units than the line has (left). */
  | 'item_quantity'
  /** Percent outside 0 < p <= 100. */
  | 'bad_percent'
  /** Amount missing, zero or negative. */
  | 'bad_amount'
  /** More than what is left of the order. */
  | 'exceeds_remaining';

export type RefundPlan =
  | {
      ok: true;
      kind: RefundKind;
      amountCents: number;
      items: RefundItemSnapshot[];
      percent: number | null;
    }
  | { ok: false; error: RefundPlanError };

/** What can still be refunded on this order. Never negative. */
export function remainingRefundableCents(order: Pick<RefundableOrder, 'totalCents' | 'refundedCents'>): number {
  return Math.max(0, Math.floor(order.totalCents) - Math.floor(order.refundedCents));
}

function wholeCents(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

export function planRefund(order: RefundableOrder, request: RefundRequest): RefundPlan {
  const remaining = remainingRefundableCents(order);
  if (remaining <= 0) return { ok: false, error: 'nothing_left' };

  switch (request.kind) {
    case 'full':
      return { ok: true, kind: 'full', amountCents: remaining, items: [], percent: null };

    case 'items': {
      const wanted = (request.items ?? []).filter((line) => line.quantity > 0);
      if (wanted.length === 0) return { ok: false, error: 'no_items' };

      const items: RefundItemSnapshot[] = [];
      for (const line of wanted) {
        const item = order.items.find((candidate) => candidate.id === line.orderItemId);
        if (!item) return { ok: false, error: 'unknown_item' };

        const quantity = Math.floor(line.quantity);
        const left = item.quantity - (item.refundedQuantity ?? 0);
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > left) {
          return { ok: false, error: 'item_quantity' };
        }
        items.push({
          orderItemId: item.id,
          productName: item.productName,
          quantity,
          amountCents: quantity * Math.round(item.unitPriceCents)
        });
      }

      const amountCents = items.reduce((sum, item) => sum + item.amountCents, 0);
      if (amountCents <= 0) return { ok: false, error: 'bad_amount' };
      if (amountCents > remaining) return { ok: false, error: 'exceeds_remaining' };
      return { ok: true, kind: 'items', amountCents, items, percent: null };
    }

    case 'percent': {
      const percent = request.percent;
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return { ok: false, error: 'bad_percent' };
      }
      const amountCents = Math.round((Math.floor(order.totalCents) * percent) / 100);
      if (amountCents <= 0) return { ok: false, error: 'bad_amount' };
      if (amountCents > remaining) return { ok: false, error: 'exceeds_remaining' };
      return { ok: true, kind: 'percent', amountCents, items: [], percent };
    }

    case 'amount': {
      const amountCents = wholeCents(request.amountCents);
      if (amountCents === null || amountCents <= 0) return { ok: false, error: 'bad_amount' };
      if (amountCents > remaining) return { ok: false, error: 'exceeds_remaining' };
      return { ok: true, kind: 'amount', amountCents, items: [], percent: null };
    }

    default:
      return { ok: false, error: 'bad_amount' };
  }
}

/**
 * "12.50" or "12,50" (or "12") typed by the owner, as cents. Null for
 * anything that is not a plain positive number. No thousands separators:
 * "1.250" is ambiguous and is read as 1.25.
 */
export function parseMajorAmount(input: string | null | undefined): number | null {
  const raw = (input ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * Units of each line refunded so far, from the item snapshots of earlier
 * successful refunds, so a line cannot be refunded twice.
 */
export function refundedQuantities(
  refunds: readonly { status: string; items: readonly { orderItemId: string; quantity: number }[] }[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const refund of refunds) {
    if (refund.status !== 'succeeded') continue;
    for (const item of refund.items) {
      totals.set(item.orderItemId, (totals.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }
  return totals;
}

/** Form field names shared by the refund form and the server action. */
export const REFUND_FIELDS = {
  kind: 'kind',
  /** Per-line unit count: `item_<orderItemId>`. */
  itemPrefix: 'item_',
  percent: 'percent',
  amount: 'amount',
  reason: 'reason',
  confirm: 'confirm'
} as const;

/**
 * Reads the owner's request out of the submitted form. Only the fields for
 * the chosen kind are read, so a stale percentage cannot leak into an
 * item refund. Quantities and the amount are parsed, not trusted.
 */
export function refundRequestFromForm(formData: FormData): RefundRequest {
  const kindValue = formData.get(REFUND_FIELDS.kind)?.toString() as RefundKind | undefined;
  const kind: RefundKind = kindValue && REFUND_KINDS.includes(kindValue) ? kindValue : 'full';

  switch (kind) {
    case 'items': {
      const items: { orderItemId: string; quantity: number }[] = [];
      for (const [name, value] of formData.entries()) {
        if (!name.startsWith(REFUND_FIELDS.itemPrefix)) continue;
        const quantity = Number.parseInt(value.toString(), 10);
        items.push({
          orderItemId: name.slice(REFUND_FIELDS.itemPrefix.length),
          quantity: Number.isFinite(quantity) ? quantity : 0
        });
      }
      return { kind, items };
    }
    case 'percent': {
      const raw = formData.get(REFUND_FIELDS.percent)?.toString().trim().replace(',', '.') ?? '';
      const percent = raw === '' ? null : Number(raw);
      return { kind, percent: percent !== null && Number.isFinite(percent) ? percent : null };
    }
    case 'amount':
      return { kind, amountCents: parseMajorAmount(formData.get(REFUND_FIELDS.amount)?.toString()) };
    case 'full':
    default:
      return { kind: 'full' };
  }
}
