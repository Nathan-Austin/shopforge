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

echo "✨ All components and libraries updated to production-grade."
echo "💡 Next steps: Update your .env.local with STRIPE_SECRET_KEY and set your rates in src/lib/shipping/config.ts."
