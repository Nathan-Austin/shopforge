import Stripe from 'stripe';

let stripe: Stripe | null = null;

export function getStripeServerClient() {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    stripe = new Stripe(secretKey, {
      typescript: true,
      apiVersion: '2025-01-27.acacia', // Or latest
    });
  }

  return stripe;
}
