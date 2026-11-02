#!/usr/bin/env bash
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm is required (install via: corepack enable pnpm)." >&2
  exit 1
fi

STORE_MODE="chilli"
for arg in "$@"; do
  case $arg in
    --mode=*)
      STORE_MODE="${arg#--mode=}"
      ;;
  esac
done

MODE_DIR="$SCRIPT_DIR/store-modes/$STORE_MODE"
SHARED_DIR="$SCRIPT_DIR/shared-assets"

if [ ! -d "$MODE_DIR" ]; then
  echo "❌ Unknown store mode: $STORE_MODE" >&2
  echo "   Available modes:" >&2
  ls "$SCRIPT_DIR/store-modes" >&2
  exit 1
fi

echo "🚀 Applying production-grade enhancements (${STORE_MODE})..."

# --- Core Assets & Libraries ------------------------------------------------
echo "📦 Syncing shared libraries..."
mkdir -p src/lib
cp -R "$SHARED_DIR/lib/." src/lib/
mkdir -p src/components
cp -R "$SHARED_DIR/components/." src/components/

# Shops generated before the product field catalogue existed have no config;
# give them every field so nothing the admin form shows is silently dropped.
if [ ! -f src/lib/products/config.ts ]; then
  echo "🗂️  Writing default product field config (all fields)..."
  if [ "$STORE_MODE" = "chilli" ]; then
    HEAT_JSON='{"max": 10, "display": "both", "bands": [{"word": "Mild", "upTo": 3}, {"word": "Medium", "upTo": 6}, {"word": "Hot", "upTo": 8}, {"word": "Extra hot", "upTo": 9}, {"word": "Extreme", "upTo": 10}]}'
  else
    HEAT_JSON="null"
  fi
  FIELD_KEYS=$(python3 "$SCRIPT_DIR/lib/product-fields.py" resolve \
    "$SHARED_DIR/lib/products/catalogue.ts" "$STORE_MODE" all)
  python3 "$SCRIPT_DIR/lib/product-fields.py" config \
    "$SHARED_DIR/lib/products/catalogue.ts" "$STORE_MODE" "$FIELD_KEYS" "$HEAT_JSON" \
    src/lib/products/config.ts
fi

# Stores generated before stripe was added to the generator need it now
if ! grep -q '"stripe"' package.json; then
  echo "📦 Adding stripe..."
  pnpm add stripe
fi

# The cart service is server-only; this makes a client import fail the build.
if ! grep -q '"server-only"' package.json; then
  echo "📦 Adding server-only..."
  pnpm add server-only
fi

echo "🧱 Syncing store components (${STORE_MODE})..."
mkdir -p src/components/store
cp -R "$MODE_DIR/store-components/." src/components/store/

echo "🛡️ Syncing admin panel components (${STORE_MODE})..."
mkdir -p src/app/[locale]/admin
cp -R "$MODE_DIR/admin-components/." src/app/[locale]/admin/

# --- Profile Management -----------------------------------------------------
echo "👤 Setting up server-side profile management..."
mkdir -p src/app/api/profile
cat > src/app/api/profile/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  // New profiles are always customers; promote the owner via the SQL editor.
  const role = existingProfile?.role || 'customer';

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ 
      id: user.id, 
      role,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data });
}
EOF

# --- Advanced Checkout Session API ------------------------------------------
echo "💳 Setting up production-grade Stripe checkout..."
mkdir -p src/app/api/checkout/session
cat > src/app/api/checkout/session/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getStripeServerClient } from '@/lib/stripe/server';
import { calculateShippingCost, SHIPPING_RATE_LABEL } from '@/lib/checkout/pricing';
import { calculatePackageWeight, type OrderItem } from '@/lib/shipping/config';
import { getCart } from '@/lib/cart/service';
import { getCartSessionId } from '@/lib/cart/session';

const checkoutSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().length(3), // ISO 3-letter
  locale: z.string().min(2),
});

export async function POST(request: Request) {
  try {
    const stripe = getStripeServerClient();
    const payload = checkoutSchema.parse(await request.json());
    
    // The cart is identified by the httpOnly cookie, never by anything the
    // caller sends, so a request cannot check out someone else's cart.
    const cartSessionId = await getCartSessionId();
    if (!cartSessionId) {
      return NextResponse.json({ error: 'Cart is empty or invalid' }, { status: 400 });
    }

    // Lines, prices and stock all come from the database.
    const cart = await getCart();
    if (cart.lines.length === 0) {
      return NextResponse.json({ error: 'Cart is empty or invalid' }, { status: 400 });
    }

    // Re-check at the moment of payment: stock may have gone, or the product
    // may have been unpublished, since the item was added.
    const unavailable = cart.lines.filter(
      (line) =>
        !line.available ||
        (line.maxQuantity !== null && line.quantity > line.maxQuantity)
    );
    if (unavailable.length > 0) {
      return NextResponse.json(
        {
          error: 'Some items are no longer available in that quantity',
          lines: unavailable.map((line) => ({
            productId: line.productId,
            name: line.name,
            available: line.available ? line.maxQuantity : 0
          }))
        },
        { status: 409 }
      );
    }

    const lineItems = cart.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: line.currency.toLowerCase(),
        unit_amount: line.unitPriceCents,
        product_data: {
          name: line.name,
          images: line.imageUrl ? [line.imageUrl] : [],
          metadata: { product_id: line.productId }
        },
      },
    }));

    const subtotalCents = cart.totals.subtotalCents;

    // Shipping (flat rate, see lib/shipping/config.ts)
    const shippingItems: OrderItem[] = cart.lines.map((line) => ({
      quantity: line.quantity
    }));

    const packageWeight = calculatePackageWeight(shippingItems);
    const shippingCostCents = calculateShippingCost(subtotalCents);

    const headersList = await headers();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || headersList.get('origin');

    // 4. Create Stripe Session with rich metadata
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: payload.email,
      line_items: lineItems,
      shipping_options: [{
        shipping_rate_data: {
          display_name: SHIPPING_RATE_LABEL,
          type: 'fixed_amount',
          fixed_amount: {
            amount: shippingCostCents,
            currency: cart.currency.toLowerCase(),
          },
        },
      }],
      success_url: `${origin}/${payload.locale}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${payload.locale}/checkout`,
      metadata: {
        cart_session_id: cartSessionId,
        shipping_country: payload.country,
        package_weight_kg: packageWeight.toString(),
        customer_name: `${payload.firstName} ${payload.lastName}`,
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Checkout Error:', error);
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
  }
}
EOF

# --- Stripe webhook ---------------------------------------------------------
echo "🪝 Setting up the Stripe webhook..."
mkdir -p src/app/api/webhooks/stripe
cat > src/app/api/webhooks/stripe/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import type Stripe from 'stripe';

import { getStripeServerClient } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Stripe webhook.
 *
 * This is what makes a payment real: it is the only place that decrements
 * stock and empties the cart, because it is the only signal that money
 * actually moved. The browser never gets to tell us a payment succeeded.
 */

// Stripe signatures are computed over the raw body, so it must not be parsed.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const signature = (await headers()).get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    // Verifying the signature is what stops anyone from POSTing a fake
    // "payment succeeded" and draining the shop's stock.
    event = getStripeServerClient().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.error('Stripe signature verification failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Claim the event before acting on it. Stripe retries, and a repeat must
  // not decrement stock a second time.
  const { error: claimError } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (claimError) {
    // Unique violation means we have already handled this one.
    if (claimError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('Could not record Stripe event:', claimError.message);
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only act once the money is actually there: a session can complete with
    // payment still pending for delayed methods.
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true, pending: true });
    }

    const cartSessionId = session.metadata?.cart_session_id;
    if (!cartSessionId) {
      console.error('Checkout session has no cart_session_id:', session.id);
      return NextResponse.json({ received: true });
    }

    const { data: lines, error: linesError } = await supabase
      .from('cart_items')
      .select('product_id, quantity')
      .eq('cart_session_id', cartSessionId);

    if (linesError) {
      console.error('Could not read the cart:', linesError.message);
      return NextResponse.json({ error: 'Could not read cart' }, { status: 500 });
    }

    for (const line of lines ?? []) {
      const { error: stockError } = await supabase.rpc('decrement_product_stock', {
        p_product_id: line.product_id,
        p_quantity: line.quantity
      });
      if (stockError) {
        // Keep going: the rest of the order should still be recorded, and
        // the shop owner can reconcile one line by hand.
        console.error(
          `Could not decrement stock for ${line.product_id}:`,
          stockError.message
        );
      }
    }

    const { error: clearError } = await supabase
      .from('cart_items')
      .delete()
      .eq('cart_session_id', cartSessionId);

    if (clearError) {
      console.error('Could not clear the cart:', clearError.message);
    }
  }

  return NextResponse.json({ received: true });
}
EOF

# --- Checkout and success pages ---------------------------------------------
echo "🧾 Setting up the checkout page..."
mkdir -p "src/app/[locale]/checkout/success"
cat > "src/app/[locale]/checkout/page.tsx" <<'EOF'
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import CheckoutForm from '@/components/cart/CheckoutForm';
import { createClient } from '@/lib/supabase/server';
import { getCart } from '@/lib/cart/service';
import { formatPrice } from '@/lib/format';

export default async function CheckoutPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/auth/sign-in`);

  const t = await getTranslations({ locale, namespace: 'Checkout' });
  const cart = await getCart();

  if (cart.lines.length === 0 || cart.lines.some((line) => !line.available)) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>
        <p className="text-gray-600">{t('cartProblem')}</p>
        <Link href={`/${locale}/cart`} className="mt-4 inline-block underline">
          {t('backToCart')}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>

      <div className="mb-6 rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t('subtotal')}</span>
          <span className="font-bold">
            {formatPrice(cart.totals.subtotalCents, cart.currency, locale)}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">{t('shippingNote')}</p>
      </div>

      <CheckoutForm locale={locale} defaultEmail={user.email ?? ''} />
    </main>
  );
}
EOF

cat > "src/app/[locale]/checkout/success/page.tsx" <<'EOF'
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function CheckoutSuccessPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Checkout' });

  return (
    <main className="mx-auto max-w-2xl p-6 text-center">
      <p className="text-5xl" aria-hidden="true">
        ✅
      </p>
      <h1 className="mt-4 text-2xl font-bold">{t('successTitle')}</h1>
      <p className="mt-2 text-gray-600">{t('successBody')}</p>
      <Link
        href={`/${locale}/shop`}
        className="mt-6 inline-block rounded-md bg-black px-5 py-2.5 font-semibold text-white"
      >
        {t('keepShopping')}
      </Link>
    </main>
  );
}
EOF

mkdir -p src/components/cart
cat > src/components/cart/CheckoutForm.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Collects the delivery details and asks the server for a Stripe session.
 * The cart itself is never sent: the route reads it from the cart cookie.
 */
export default function CheckoutForm({
  locale,
  defaultEmail
}: {
  locale: string;
  defaultEmail: string;
}) {
  const t = useTranslations('Checkout');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const body = Object.fromEntries(formData.entries());

    try {
      const response = await fetch('/api/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, locale })
      });

      const result = await response.json();

      if (!response.ok || !result.url) {
        setError(response.status === 409 ? t('stockChanged') : t('failed'));
        setLoading(false);
        return;
      }

      window.location.href = result.url;
    } catch {
      setError(t('failed'));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" name="email" type="email" defaultValue={defaultEmail} required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">{t('firstName')}</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">{t('lastName')}</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="addressLine1">{t('address')}</Label>
        <Input id="addressLine1" name="addressLine1" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="city">{t('city')}</Label>
          <Input id="city" name="city" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalCode">{t('postalCode')}</Label>
          <Input id="postalCode" name="postalCode" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">{t('country')}</Label>
          <Input
            id="country"
            name="country"
            required
            maxLength={3}
            minLength={3}
            placeholder="DEU"
          />
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t('redirecting') : t('payNow')}
      </Button>
    </form>
  );
}
EOF

echo "✨ All components and libraries updated to production-grade."
echo "💡 Next steps:"
echo "   • Put STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env.local"
echo "   • Point a Stripe webhook at /api/webhooks/stripe for checkout.session.completed"
echo "   • Set your rates in src/lib/shipping/config.ts"
