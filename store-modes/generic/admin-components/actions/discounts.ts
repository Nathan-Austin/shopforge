'use server';

import { revalidatePath } from 'next/cache';

import {
  planNewDiscount,
  type DiscountKind,
  type NewDiscountError
} from '@/lib/discounts/rules';
import { getStripeServerClient } from '@/lib/stripe/server';
import { ensureShopOwner } from '../lib/auth';

export type DiscountActionError =
  | NewDiscountError
  | 'duplicate'
  | 'stripe'
  | 'failed'
  | 'in_use'
  | 'not_found'
  | 'not_authorized';

export type DiscountActionResult =
  | { ok: true; code: string; action: 'created' | 'retired' | 'reactivated' | 'deleted' }
  | { ok: false; error: DiscountActionError; message?: string };

interface DiscountContext {
  locale: string;
}

function done(locale: string) {
  revalidatePath(`/${locale}/admin/discounts`);
}

/**
 * Creates a code. Percent and amount codes are mirrored in Stripe as a
 * coupon plus a promotion code, which Stripe applies to the checkout
 * session and enforces (limits, dates, minimum) on its side too. A
 * free-shipping code has no Stripe counterpart: the shop zeroes the
 * shipping rate itself. The Stripe objects are created first, so a Stripe
 * refusal (say, the code exists there already) never leaves a local row
 * that can't be used.
 */
export async function createDiscount(
  context: DiscountContext,
  _previous: DiscountActionResult | null,
  formData: FormData
): Promise<DiscountActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const field = (name: string) => formData.get(name)?.toString() ?? '';
  const plan = planNewDiscount({
    code: field('code'),
    kind: field('kind') as DiscountKind,
    percent: field('percent'),
    amount: field('amount'),
    currency: field('currency'),
    minSubtotal: field('min_subtotal'),
    startsAt: field('starts_at'),
    endsAt: field('ends_at'),
    maxRedemptions: field('max_redemptions')
  });
  if (!plan.ok) return { ok: false, error: plan.error };
  const row = plan.row;

  const { data: existing } = await supabase
    .from('discount_codes')
    .select('id')
    .eq('code', row.code)
    .maybeSingle();
  if (existing) return { ok: false, error: 'duplicate' };

  let stripeCouponId: string | null = null;
  let stripePromotionCodeId: string | null = null;

  if (row.kind !== 'free_shipping') {
    try {
      const stripe = getStripeServerClient();
      const coupon = await stripe.coupons.create({
        name: row.code,
        duration: 'once',
        ...(row.kind === 'percent'
          ? { percent_off: row.percent_off ?? 0 }
          : {
              amount_off: row.amount_off_cents ?? 0,
              currency: (row.currency ?? 'eur').toLowerCase()
            })
      });
      stripeCouponId = coupon.id;

      const promotion = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        code: row.code,
        active: true,
        ...(row.max_redemptions ? { max_redemptions: row.max_redemptions } : {}),
        ...(row.ends_at ? { expires_at: Math.floor(Date.parse(row.ends_at) / 1000) } : {}),
        ...(row.min_subtotal_cents && row.currency
          ? {
              restrictions: {
                minimum_amount: row.min_subtotal_cents,
                minimum_amount_currency: row.currency.toLowerCase()
              }
            }
          : {}),
        metadata: { shop_discount_code: row.code }
      });
      stripePromotionCodeId = promotion.id;
    } catch (stripeError) {
      // Don't leave a coupon behind with no promotion code.
      if (stripeCouponId) {
        await getStripeServerClient().coupons.del(stripeCouponId).catch(() => undefined);
      }
      return {
        ok: false,
        error: 'stripe',
        message: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      };
    }
  }

  const { error: insertError } = await supabase.from('discount_codes').insert({
    ...row,
    stripe_coupon_id: stripeCouponId,
    stripe_promotion_code_id: stripePromotionCodeId,
    created_by: user?.id ?? null
  });
  if (insertError) {
    if (stripeCouponId) {
      await getStripeServerClient().coupons.del(stripeCouponId).catch(() => undefined);
    }
    return {
      ok: false,
      error: insertError.code === '23505' ? 'duplicate' : 'failed',
      message: insertError.message
    };
  }

  done(context.locale);
  return { ok: true, code: row.code, action: 'created' };
}

/** Retire (active=false) or reactivate a code, in Stripe as well. */
export async function setDiscountActive(
  context: DiscountContext,
  formData: FormData
): Promise<DiscountActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const id = formData.get('id')?.toString() ?? '';
  const active = formData.get('active')?.toString() === 'true';
  const { data: row } = await supabase
    .from('discount_codes')
    .select('id, code, stripe_promotion_code_id')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };

  if (row.stripe_promotion_code_id) {
    try {
      await getStripeServerClient().promotionCodes.update(row.stripe_promotion_code_id, { active });
    } catch (stripeError) {
      return {
        ok: false,
        error: 'stripe',
        message: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      };
    }
  }

  const { error: updateError } = await supabase
    .from('discount_codes')
    .update({ active })
    .eq('id', id);
  if (updateError) return { ok: false, error: 'failed', message: updateError.message };

  done(context.locale);
  return { ok: true, code: row.code, action: active ? 'reactivated' : 'retired' };
}

/** Delete a code that was never used; used codes are retired instead, so orders keep their history. */
export async function deleteDiscount(
  context: DiscountContext,
  formData: FormData
): Promise<DiscountActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const id = formData.get('id')?.toString() ?? '';
  const { data: row } = await supabase
    .from('discount_codes')
    .select('id, code, redemption_count, stripe_coupon_id')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };
  if (row.redemption_count > 0) return { ok: false, error: 'in_use' };

  if (row.stripe_coupon_id) {
    // Deleting the coupon also disables its promotion codes.
    try {
      await getStripeServerClient().coupons.del(row.stripe_coupon_id);
    } catch (stripeError) {
      return {
        ok: false,
        error: 'stripe',
        message: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      };
    }
  }

  const { error: deleteError } = await supabase.from('discount_codes').delete().eq('id', id);
  if (deleteError) return { ok: false, error: 'failed', message: deleteError.message };

  done(context.locale);
  return { ok: true, code: row.code, action: 'deleted' };
}
