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

  let role = existingProfile?.role || 'customer';
  
  // Auto-promote first user to shop_owner
  if (!existingProfile) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { head: true, count: 'exact' });
    if ((count ?? 0) === 0) role = 'shop_owner';
  }

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
import { createClient } from '@/lib/supabase/server';
import { calculateShippingCost, SHIPPING_RATE_LABEL } from '@/lib/checkout/pricing';
import { calculatePackageWeight, type OrderItem } from '@/lib/shipping/config';

const checkoutSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().length(3), // ISO 3-letter
  locale: z.string().min(2),
  cartSessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const stripe = getStripeServerClient();
    const payload = checkoutSchema.parse(await request.json());
    
    const supabase = await createClient();
    
    // 1. Fetch cart items server-side (Security: Don't trust client prices/items)
    const { data: cartItems, error: cartError } = await supabase
      .from('cart_items')
      .select(`
        id,
        quantity,
        selected_size,
        products (
          id, name, slug, image_url, price_cents, currency, capacity_ml
        )
      `)
      .eq('cart_session_id', payload.cartSessionId);

    if (cartError || !cartItems?.length) {
      return NextResponse.json({ error: 'Cart is empty or invalid' }, { status: 400 });
    }

    // 2. Prepare line items for Stripe
    const lineItems = cartItems.map((item: any) => ({
      quantity: item.quantity,
      price_data: {
        currency: item.products.currency.toLowerCase(),
        unit_amount: item.products.price_cents,
        product_data: {
          name: item.products.name,
          images: item.products.image_url ? [item.products.image_url] : [],
          metadata: { product_id: item.products.id }
        },
      },
    }));

    const subtotalCents = cartItems.reduce((sum: number, item: any) => 
      sum + (item.products.price_cents * item.quantity), 0
    );

    // 3. Calculate shipping based on weight and destination
    const shippingItems: OrderItem[] = cartItems.map((item: any) => ({
      productName: item.products.name,
      quantity: item.quantity,
      capacityMl: item.products.capacity_ml,
      selectedSize: item.selected_size,
    }));
    
    const packageWeight = calculatePackageWeight(shippingItems);
    const shippingCostCents = calculateShippingCost(payload.country, packageWeight, subtotalCents);

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
            currency: cartItems[0].products.currency.toLowerCase(),
          },
        },
      }],
      success_url: `${origin}/${payload.locale}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${payload.locale}/checkout`,
      metadata: {
        cart_session_id: payload.cartSessionId,
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
echo "💡 Next steps: Update your .env.local with STRIPE_SECRET_KEY and DHL credentials if using shipping labels."
