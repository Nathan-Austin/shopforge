#!/usr/bin/env bash
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

STORE_MODE="chilli"
for arg in "$@"; do
  case $arg in
    --mode=*)
      STORE_MODE="${arg#--mode=}"
      ;;
  esac
done

MODE_DIR="$SCRIPT_DIR/store-modes/$STORE_MODE"
if [ ! -d "$MODE_DIR" ]; then
  echo "❌ Unknown store mode: $STORE_MODE" >&2
  echo "   Available modes:" >&2
  ls "$SCRIPT_DIR/store-modes" >&2
  exit 1
fi

echo "🔧 Adding profile helper, payment adapters & checkout API..."

# --- Store components -------------------------------------------------------
echo "🧱 Syncing store components (${STORE_MODE})..."
mkdir -p src/components/store
cp -R "$MODE_DIR/store-components/." src/components/store

echo "🛡️ Syncing admin panel (${STORE_MODE})..."
mkdir -p src/app/[locale]/admin
cp -R "$MODE_DIR/admin-components/." src/app/[locale]/admin

# --- Profile helper ----------------------------------------------------------
mkdir -p src/lib
cat > src/lib/profile.ts <<'EOF'
'use client';
import { supabase } from '@/lib/supabase/client';

export async function ensureProfile(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try { await fetch('/api/profile', { method: 'POST' }); }
  catch (err) { console.error('Failed to ensure profile:', err); }
}
EOF

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

  if (profileError && profileError.code !== 'PGRST116') {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  let role = existingProfile?.role || null;
  if (!role) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { head: true, count: 'exact' })
      .eq('role', 'shop_owner');
    role = (count ?? 0) === 0 ? 'shop_owner' : 'customer';
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, role }, { onConflict: 'id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data });
}
EOF

# Patch sign-up page to call helper (idempotent)
sed -i "/const { data, error } = await supabase.auth.signUp/a\\
    if (!error) { await (await import('@/lib/profile')).ensureProfile(); }" \
  src/app/*/auth/sign-up/page.tsx 2>/dev/null || true

# --- Payments ---------------------------------------------------------------
mkdir -p src/lib/payments
cat > src/lib/payments/types.ts <<'EOF'
export interface CheckoutSession { id: string; url: string; provider: string; }
export interface PaymentAdapter {
  createCheckoutSession(params: {
    userId: string; orderId: string;
    amountCents: number; currency: string;
  }): Promise<CheckoutSession>;
}
EOF

cat > src/lib/payments/stripe.ts <<'EOF'
import type { PaymentAdapter, CheckoutSession } from './types';
import Stripe from 'stripe';

export const stripeAdapter: PaymentAdapter = {
  async createCheckoutSession({ orderId, amountCents, currency }) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-09-30.clover' });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        { price_data: { currency, unit_amount: amountCents,
          product_data: { name: `Order ${orderId}` } }, quantity: 1 }
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/checkout/cancel`
    });
    return { id: session.id, url: session.url!, provider: 'stripe' };
  },
};
EOF

cat > src/lib/payments/mollie.ts <<'EOF'
import type { PaymentAdapter, CheckoutSession } from './types';
import createMollieClient from '@mollie/api-client';

export const mollieAdapter: PaymentAdapter = {
  async createCheckoutSession({ orderId, amountCents, currency }) {
    const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY || '' });
    const payment = await mollie.payments.create({
      amount: { currency, value: (amountCents / 100).toFixed(2) },
      description: `Order ${orderId}`,
      redirectUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/checkout/success`,
      cancelUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/checkout/cancel`,
    });
    return { id: payment.id, url: payment.getCheckoutUrl()!, provider: 'mollie' };
  },
};
EOF

cat > src/lib/payments/paypal.ts <<'EOF'
import type { PaymentAdapter, CheckoutSession } from './types';

export const paypalAdapter: PaymentAdapter = {
  async createCheckoutSession({ orderId, amountCents, currency }) {
    const basicAuth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
    ).toString('base64');
    const res = await fetch(`${process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com'}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          { reference_id: orderId,
            amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) } }
        ],
      }),
    });
    const data = await res.json() as any;
    const approvalUrl = data.links?.find((l: any) => l.rel === 'approve')?.href;
    return { id: data.id, url: approvalUrl, provider: 'paypal' };
  },
};
EOF

cat > src/lib/payments/index.ts <<'EOF'
import type { PaymentAdapter } from './types';
import { stripeAdapter } from './stripe';
import { paypalAdapter } from './paypal';
import { mollieAdapter } from './mollie';

const active = {
  stripe: stripeAdapter,
  paypal: paypalAdapter,
  mollie: mollieAdapter,
} as const;

export function getAdapter(provider: keyof typeof active): PaymentAdapter {
  const adapter = active[provider];
  if (!adapter) {
    throw new Error('Unsupported payment provider: ' + provider);
  }
  return adapter;
}
EOF

# --- Checkout API ------------------------------------------------------------
mkdir -p src/app/api/checkout
cat > src/app/api/checkout/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdapter } from '@/lib/payments';
import type { PaymentAdapter } from '@/lib/payments/types';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { provider = 'stripe', orderId, amountCents, currency = 'EUR' } = await req.json();
  try {
    const adapter: PaymentAdapter = getAdapter(provider);
    const session = await adapter.createCheckoutSession({ userId: user.id, orderId, amountCents, currency });
    return NextResponse.json(session);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
EOF

git add .
git commit -m "feat: add profile helper, payment adapters & checkout API"
echo "✅ Enhancements applied successfully."
