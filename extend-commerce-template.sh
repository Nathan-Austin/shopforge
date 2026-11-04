#!/usr/bin/env bash
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm is required (install via: corepack enable pnpm)." >&2
  exit 1
fi

STORE_MODE="chilli"
# Who asks the customer for the delivery address: our own checkout form, or
# Stripe's payment page. See the note above the checkout config below.
SHIPPING_ADDRESS="form"
for arg in "$@"; do
  case $arg in
    --mode=*)
      STORE_MODE="${arg#--mode=}"
      ;;
    --shipping=*)
      SHIPPING_ADDRESS="${arg#--shipping=}"
      ;;
    *)
      echo "❌ Unknown argument: $arg" >&2
      echo "   Usage: extend-commerce-template.sh [--mode=generic|chilli] [--shipping=form|stripe]" >&2
      exit 2
      ;;
  esac
done

case $SHIPPING_ADDRESS in
  form|stripe) ;;
  *)
    echo "❌ --shipping must be 'form' or 'stripe', got '$SHIPPING_ADDRESS'" >&2
    exit 2
    ;;
esac

MODE_DIR="$SCRIPT_DIR/store-modes/$STORE_MODE"
SHARED_DIR="$SCRIPT_DIR/shared-assets"

if [ ! -d "$MODE_DIR" ]; then
  echo "❌ Unknown store mode: $STORE_MODE" >&2
  echo "   Available modes:" >&2
  ls "$SCRIPT_DIR/store-modes" >&2
  exit 1
fi

echo "🚀 Applying production-grade enhancements (${STORE_MODE}, shipping address: ${SHIPPING_ADDRESS})..."

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

# --- Checkout config ---------------------------------------------------------
# Two ways to collect the delivery address:
#
#   form    Our /checkout page asks for name and address, then hands the
#           customer to Stripe for the card only. The address travels to the
#           webhook in the session metadata. One fewer page for the customer
#           and the form is yours to style, but the address passes through
#           your server.
#
#   stripe  Our /checkout page asks only for an email. Stripe's payment page
#           collects the delivery address alongside the card, and the webhook
#           reads it from the completed session. Some owners prefer this: the
#           customer types everything into Stripe, nothing personal is posted
#           to your server before payment, and Stripe validates the address.
#
# Either way the webhook stores the same address columns on the order.
echo "🧭 Writing checkout config (shipping address: ${SHIPPING_ADDRESS})..."
mkdir -p src/lib/checkout
cat > src/lib/checkout/config.ts <<EOF
/**
 * Checkout configuration.
 *
 * Written by extend-commerce-template.sh from --shipping=form|stripe.
 * Edit by hand or re-run the script to change it.
 */
export const CHECKOUT_CONFIG = {
  /**
   * 'form':   the /checkout page collects the delivery address.
   * 'stripe': Stripe's payment page collects it (shipping_address_collection).
   */
  shippingAddress: '${SHIPPING_ADDRESS}' as 'form' | 'stripe',

  /**
   * Countries the shop delivers to, as ISO 3166-1 alpha-2 codes. The
   * checkout form offers exactly these, and in 'stripe' mode Stripe's page
   * is limited to them too. Placeholder list: replace it with where you
   * actually ship.
   */
  allowedCountries: ['DE', 'AT', 'NL', 'BE', 'FR', 'IE', 'GB'],
} as const;
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
import { createClient } from '@/lib/supabase/server';
import { CHECKOUT_CONFIG } from '@/lib/checkout/config';

const addressSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().min(1),
  postalCode: z.string().min(1),
  // ISO 3166-1 alpha-2, stored uppercase so it matches what Stripe reports.
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .refine((code) => (CHECKOUT_CONFIG.allowedCountries as readonly string[]).includes(code), {
      message: 'We do not deliver to that country'
    }),
});

const checkoutSchema = z.object({
  email: z.string().email(),
  locale: z.string().min(2),
});

export async function POST(request: Request) {
  try {
    const stripe = getStripeServerClient();
    const body = await request.json();
    const payload = checkoutSchema.parse(body);
    // Who collects the address is decided in lib/checkout/config.ts. With
    // Stripe collecting, the form sends only the email and the address is
    // asked for on Stripe's page; otherwise it must be in the request.
    const collectsAddressAtStripe = CHECKOUT_CONFIG.shippingAddress === 'stripe';
    const address = collectsAddressAtStripe ? null : addressSchema.parse(body);
    
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

    // Who is paying, if anyone is signed in. The webhook attaches the order
    // to this account; a guest order is written with no user_id.
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    // 4. Create Stripe Session with rich metadata
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: payload.email,
      line_items: lineItems,
      ...(collectsAddressAtStripe
        ? {
            shipping_address_collection: {
              allowed_countries: [...CHECKOUT_CONFIG.allowedCountries],
            },
          }
        : {}),
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
      cancel_url: `${origin}/${payload.locale}/checkout/cancel`,
      // Everything the webhook needs to write the order. Stripe echoes
      // metadata back on the checkout.session.completed event, so the
      // delivery details typed into our form reach the webhook even though
      // Stripe itself never asked for them.
      metadata: {
        cart_session_id: cartSessionId,
        user_id: user?.id ?? '',
        locale: payload.locale,
        package_weight_kg: packageWeight.toString(),
        ...(address
          ? {
              shipping_name: `${address.firstName} ${address.lastName}`,
              shipping_line1: address.addressLine1,
              shipping_city: address.city,
              shipping_postal_code: address.postalCode,
              shipping_country: address.country,
            }
          : {}),
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
import { one } from '@/lib/supabase/relations';
import { sendEmail } from '@/lib/email/send';
import { getEmailConfig } from '@/lib/email/config';
import { renderOrderConfirmation } from '@/lib/email/orderConfirmation';

/**
 * Stripe webhook.
 *
 * This is what makes a payment real: it is the only place that records the
 * order, decrements stock and empties the cart, because it is the only signal
 * that money actually moved. The browser never gets to tell us a payment
 * succeeded.
 */

// Stripe signatures are computed over the raw body, so it must not be parsed.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the parcel goes, as Stripe reported it when the payment completed.
 *
 * In order of preference: an address Stripe collected itself (when the
 * session was created with shipping_address_collection), then the one typed
 * into our own checkout form and carried through metadata, then the billing
 * address as a last resort.
 */
/** Two uppercase letters or null: the orders table enforces the same. */
function countryCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function shippingSnapshot(session: Stripe.Checkout.Session) {
  const collected = session.collected_information?.shipping_details;
  if (collected?.address) {
    return {
      shipping_name: collected.name ?? null,
      shipping_line1: collected.address.line1 ?? null,
      shipping_line2: collected.address.line2 ?? null,
      shipping_city: collected.address.city ?? null,
      shipping_postal_code: collected.address.postal_code ?? null,
      shipping_region: collected.address.state ?? null,
      shipping_country: countryCode(collected.address.country)
    };
  }

  const meta = session.metadata ?? {};
  if (meta.shipping_line1) {
    return {
      shipping_name: meta.shipping_name || null,
      shipping_line1: meta.shipping_line1,
      shipping_line2: null,
      shipping_city: meta.shipping_city || null,
      shipping_postal_code: meta.shipping_postal_code || null,
      shipping_region: null,
      shipping_country: countryCode(meta.shipping_country)
    };
  }

  const billing = session.customer_details?.address;
  return {
    shipping_name: session.customer_details?.name ?? null,
    shipping_line1: billing?.line1 ?? null,
    shipping_line2: billing?.line2 ?? null,
    shipping_city: billing?.city ?? null,
    shipping_postal_code: billing?.postal_code ?? null,
    shipping_region: billing?.state ?? null,
    shipping_country: countryCode(billing?.country)
  };
}

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

    // The cart lines, with the product as it is now. The order copies the
    // name and price so later edits to the product leave the order alone.
    const { data: lines, error: linesError } = await supabase
      .from('cart_items')
      .select(
        'product_id, quantity, selected_size, selected_color, products ( name, price_cents )'
      )
      .eq('cart_session_id', cartSessionId);

    if (linesError) {
      console.error('Could not read the cart:', linesError.message);
      return NextResponse.json({ error: 'Could not read cart' }, { status: 500 });
    }

    // 1. The order. Amounts come from Stripe, not from the cart, because
    //    they are what was actually charged.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: session.metadata?.user_id || null,
        email: session.customer_details?.email ?? session.customer_email ?? '',
        status: 'paid',
        currency: (session.currency ?? 'eur').toUpperCase(),
        subtotal_cents: session.amount_subtotal ?? 0,
        shipping_cents: session.shipping_cost?.amount_total ?? 0,
        total_cents: session.amount_total ?? 0,
        stripe_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        // So later emails (shipping, refunds) are in the customer's language.
        locale: session.metadata?.locale || null,
        ...shippingSnapshot(session)
      })
      .select('id')
      .single();

    if (orderError || !order) {
      // Unique violation on stripe_session_id: an earlier delivery already
      // wrote this order, so there is nothing more to do.
      if (orderError?.code === '23505') {
        return NextResponse.json({ received: true, duplicate: true });
      }
      console.error('Could not record the order:', orderError?.message);
      // Release the event claim and fail the delivery, so Stripe's retry is
      // not turned away as a duplicate and gets another go at writing it.
      await supabase.from('stripe_events').delete().eq('id', event.id);
      return NextResponse.json({ error: 'Could not record order' }, { status: 500 });
    }

    // 2. The lines.
    if (lines && lines.length > 0) {
      const { error: itemsError } = await supabase.from('order_items').insert(
        lines.map((line) => {
          const product = one(line.products);
          return {
            order_id: order.id,
            product_id: line.product_id,
            product_name: product?.name ?? 'Unknown product',
            unit_price_cents: product?.price_cents ?? 0,
            quantity: line.quantity,
            selected_size: line.selected_size,
            selected_color: line.selected_color
          };
        })
      );
      if (itemsError) {
        console.error(`Could not record the lines of order ${order.id}:`, itemsError.message);
      }
    } else {
      console.error(`Order ${order.id} was paid but its cart ${cartSessionId} was empty`);
    }

    // 3. The confirmation email. Best effort: a shop with no provider
    //    configured sends nothing, and a provider outage must not fail the
    //    webhook, because the payment and the order are already real.
    const orderItems = (lines ?? []).map((line) => {
      const product = one(line.products);
      return {
        productName: product?.name ?? 'Unknown product',
        unitPriceCents: product?.price_cents ?? 0,
        quantity: line.quantity,
        selectedSize: line.selected_size,
        selectedColor: line.selected_color
      };
    });

    const customerEmail = session.customer_details?.email ?? session.customer_email ?? '';
    if (customerEmail) {
      const shipping = shippingSnapshot(session);
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? null;
      const locale = session.metadata?.locale || 'en';

      const email = renderOrderConfirmation(
        {
          // Same short reference the success page and the admin show.
          reference: order.id.slice(0, 8).toUpperCase(),
          currency: (session.currency ?? 'eur').toUpperCase(),
          subtotalCents: session.amount_subtotal ?? 0,
          shippingCents: session.shipping_cost?.amount_total ?? 0,
          totalCents: session.amount_total ?? 0,
          items: orderItems,
          shipping: {
            name: shipping.shipping_name,
            line1: shipping.shipping_line1,
            line2: shipping.shipping_line2,
            city: shipping.shipping_city,
            postalCode: shipping.shipping_postal_code,
            region: shipping.shipping_region,
            country: shipping.shipping_country
          },
          orderUrl: siteUrl ? `${siteUrl}/${locale}/account/orders` : null,
          shopName: process.env.NEXT_PUBLIC_SHOP_NAME || 'Our shop'
        },
        locale
      );

      const result = await sendEmail({
        to: customerEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        bcc: getEmailConfig().ownerNotificationEmail
      });

      if (result.sent) {
        await supabase
          .from('orders')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', order.id);
      } else if (result.reason === 'failed') {
        // The order stands; confirmation_sent_at stays null so the shop
        // owner can see it was never confirmed.
        console.error(`Could not email the confirmation for ${order.id}:`, result.error);
      }
    }

    // 4. Stock.
    for (const line of lines ?? []) {
      const { error: stockError } = await supabase.rpc('decrement_product_stock', {
        p_product_id: line.product_id,
        p_quantity: line.quantity
      });
      if (stockError) {
        // Keep going: the order is recorded, and the shop owner can
        // reconcile one line by hand.
        console.error(
          `Could not decrement stock for ${line.product_id}:`,
          stockError.message
        );
      }
    }

    // 5. The cart.
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
mkdir -p "src/app/[locale]/checkout/success" "src/app/[locale]/checkout/cancel"
cat > "src/app/[locale]/checkout/page.tsx" <<'EOF'
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
  // Guests can check out. A signed-in user gets their email filled in and
  // the order attached to their account; a guest is offered an account on
  // the success page and the order follows once their email is confirmed.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

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

      <CheckoutForm locale={locale} defaultEmail={user?.email ?? ''} />
    </main>
  );
}
EOF

cat > "src/app/[locale]/checkout/success/page.tsx" <<'EOF'
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import OrderPending from '@/components/checkout/OrderPending';
import { getOrderByStripeSession, orderReference } from '@/lib/orders/service';
import { formatPrice } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

/**
 * Where Stripe sends the shopper after paying. The order itself is written
 * by the webhook, so this page only reads: if the webhook has not landed
 * yet it shows a holding message and re-renders until it has.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutSuccessPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { locale } = await params;
  const { session_id: sessionId } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Checkout' });

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // A signed-in shopper may have placed earlier orders as a guest with this
  // email. The function only attaches them once the email is confirmed.
  if (user) {
    await supabase.rpc('claim_guest_orders');
  }

  const order = sessionId ? await getOrderByStripeSession(sessionId) : null;

  const isGuestOrder = order !== null && order.userId === null && !user;
  const signUpHref = order
    ? `/${locale}/auth/sign-up?email=${encodeURIComponent(order.email)}&next=${encodeURIComponent(
        `/${locale}/checkout/success?session_id=${order.stripeSessionId}`
      )}`
    : null;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="text-center">
        <p className="text-5xl" aria-hidden="true">
          ✅
        </p>
        <h1 className="mt-4 text-2xl font-bold">{t('successTitle')}</h1>
        <p className="mt-2 text-gray-600">{t('successBody')}</p>
        {!order && sessionId && <OrderPending message={t('processing')} />}
      </div>

      {order && (
        <section className="mt-8 rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold">
            {t('orderNumber', { number: orderReference(order) })}
          </h2>

          <h3 className="mt-4 text-sm font-semibold uppercase text-gray-500">{t('items')}</h3>
          <ul className="mt-2 divide-y divide-gray-100">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 py-2">
                <div>
                  <p className="font-medium">{item.productName}</p>
                  {(item.selectedSize || item.selectedColor) && (
                    <p className="text-sm text-gray-500">
                      {[item.selectedSize, item.selectedColor].filter(Boolean).join(' / ')}
                    </p>
                  )}
                  <p className="text-sm text-gray-500">
                    {item.quantity} × {formatPrice(item.unitPriceCents, order.currency, locale)}
                  </p>
                </div>
                <p className="font-medium">
                  {formatPrice(item.unitPriceCents * item.quantity, order.currency, locale)}
                </p>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1 border-t border-gray-200 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">{t('subtotal')}</dt>
              <dd>{formatPrice(order.subtotalCents, order.currency, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">{t('shippingCost')}</dt>
              <dd>{formatPrice(order.shippingCents, order.currency, locale)}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>{t('total')}</dt>
              <dd>{formatPrice(order.totalCents, order.currency, locale)}</dd>
            </div>
          </dl>

          {order.shipping.line1 && (
            <address className="mt-4 border-t border-gray-200 pt-4 text-sm not-italic text-gray-600">
              <p className="font-semibold text-gray-900">{t('shipTo')}</p>
              {order.shipping.name && <p>{order.shipping.name}</p>}
              <p>{order.shipping.line1}</p>
              {order.shipping.line2 && <p>{order.shipping.line2}</p>}
              <p>
                {[order.shipping.postalCode, order.shipping.city, order.shipping.region]
                  .filter(Boolean)
                  .join(' ')}
              </p>
              {order.shipping.country && <p>{order.shipping.country}</p>}
            </address>
          )}
        </section>
      )}

      {isGuestOrder && signUpHref && (
        <aside className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h2 className="font-semibold">{t('createAccountTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {t('createAccountBody', { email: order.email })}
          </p>
          <Link
            href={signUpHref}
            className="mt-3 inline-block rounded-md border border-gray-900 px-4 py-2 text-sm font-semibold"
          >
            {t('createAccount')}
          </Link>
        </aside>
      )}

      {order && user && order.userId === user.id && (
        <p className="mt-4 text-center text-sm text-gray-500">{t('savedToAccount')}</p>
      )}

      <div className="mt-8 text-center">
        <Link
          href={`/${locale}/shop`}
          className="inline-block rounded-md bg-black px-5 py-2.5 font-semibold text-white"
        >
          {t('keepShopping')}
        </Link>
      </div>
    </main>
  );
}
EOF

# Stripe sends the shopper here when they leave the payment page. Nothing was
# charged and the cart is untouched: the webhook never fired.
cat > "src/app/[locale]/checkout/cancel/page.tsx" <<'EOF'
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function CheckoutCancelPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Checkout' });

  return (
    <main className="mx-auto max-w-2xl p-6 text-center">
      <h1 className="text-2xl font-bold">{t('cancelTitle')}</h1>
      <p className="mt-2 text-gray-600">{t('cancelBody')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href={`/${locale}/checkout`}
          className="inline-block rounded-md bg-black px-5 py-2.5 font-semibold text-white"
        >
          {t('tryAgain')}
        </Link>
        <Link
          href={`/${locale}/cart`}
          className="inline-block rounded-md border border-gray-300 px-5 py-2.5 font-semibold"
        >
          {t('backToCart')}
        </Link>
      </div>
    </main>
  );
}
EOF

# --- Customer order history -------------------------------------------------
echo "📜 Setting up the account orders page..."
mkdir -p "src/app/[locale]/account/orders"
cat > "src/app/[locale]/account/orders/page.tsx" <<'EOF'
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { listOrders, orderReference } from '@/lib/orders/service';
import { normalizeTracking } from '@/lib/orders/notifications';
import { createClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/format';

/**
 * The signed-in customer's orders. Reads go through the user's own client,
 * so RLS limits the list to their rows; the shop owner sees every order
 * here too, but has /admin/orders for that.
 */
export const dynamic = 'force-dynamic';

export default async function AccountOrdersPage({
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

  // Pick up any orders placed as a guest with this (confirmed) email.
  await supabase.rpc('claim_guest_orders');

  const t = await getTranslations({ locale, namespace: 'Account' });
  const orders = await listOrders(supabase);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">{t('ordersTitle')}</h1>

      {orders.length === 0 ? (
        <div className="rounded-lg border border-gray-200 p-6 text-center">
          <p className="text-gray-600">{t('noOrders')}</p>
          <Link href={`/${locale}/shop`} className="mt-4 inline-block underline">
            {t('startShopping')}
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li key={order.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {t('orderNumber', { number: orderReference(order) })}
                </h2>
                <span className="text-sm text-gray-500">
                  {dateFormat.format(new Date(order.createdAt))}
                </span>
              </div>
              <p className="mt-1 text-sm">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase text-gray-700">
                  {t(`status.${order.status}`)}
                </span>
              </p>
              {order.status === 'fulfilled' && (() => {
                const tracking = normalizeTracking(order.tracking);
                return (
                  <p className="mt-2 text-sm text-gray-700">
                    {order.shippedAt && (
                      <span>{t('shippedOn', { date: dateFormat.format(new Date(order.shippedAt)) })}</span>
                    )}
                    {tracking.number && (
                      <span>
                        {order.shippedAt ? ' · ' : ''}
                        {t('trackingNumber', { number: tracking.number })}
                        {tracking.carrier ? ` (${tracking.carrier})` : ''}
                      </span>
                    )}
                    {tracking.url && (
                      <>
                        {' · '}
                        <a href={tracking.url} target="_blank" rel="noreferrer" className="underline">
                          {t('track')}
                        </a>
                      </>
                    )}
                  </p>
                );
              })()}
              <ul className="mt-3 divide-y divide-gray-100 text-sm">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4 py-1.5">
                    <span>
                      {item.quantity} × {item.productName}
                      {(item.selectedSize || item.selectedColor) && (
                        <span className="text-gray-500">
                          {' '}
                          ({[item.selectedSize, item.selectedColor].filter(Boolean).join(' / ')})
                        </span>
                      )}
                    </span>
                    <span>
                      {formatPrice(item.unitPriceCents * item.quantity, order.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold">
                <span>{t('total')}</span>
                <span>{formatPrice(order.totalCents, order.currency, locale)}</span>
              </div>
              {order.refundedCents > 0 && (
                <p className="mt-1 text-right text-sm text-red-700">
                  {t('refundedAmount', {
                    amount: formatPrice(order.refundedCents, order.currency, locale)
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
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
import { CHECKOUT_CONFIG } from '@/lib/checkout/config';

/**
 * Collects the delivery details and asks the server for a Stripe session.
 * The cart itself is never sent: the route reads it from the cart cookie.
 * When Stripe collects the address (lib/checkout/config.ts) only the email
 * is asked for here.
 */
const ASKS_FOR_ADDRESS = CHECKOUT_CONFIG.shippingAddress === 'form';

/** The country's name in the shopper's language, falling back to the code. */
function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
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

      {!ASKS_FOR_ADDRESS && (
        <p className="text-sm text-gray-500">{t('addressAtStripe')}</p>
      )}

      {ASKS_FOR_ADDRESS && (
      <>
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
          <select
            id="country"
            name="country"
            required
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="" disabled>
              {t('selectCountry')}
            </option>
            {CHECKOUT_CONFIG.allowedCountries.map((code) => (
              <option key={code} value={code}>
                {countryName(code, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>
      </>
      )}

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
echo "   • For order confirmation and refund emails, set RESEND_API_KEY and EMAIL_FROM (optional)"
echo "   • Point a Stripe webhook at /api/webhooks/stripe for checkout.session.completed"
echo "   • Set your rates in src/lib/shipping/config.ts"
